use crate::*;
use std::path::{Path, PathBuf};
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager, State};
use crate::preferences::Preferences;

#[derive(Clone, Default)]
pub(crate) struct AppState {
    workspace: Arc<Mutex<Option<Workspace>>>,
    workspace_session: Arc<AtomicU64>,
    observer: Arc<Mutex<Option<crate::watcher::Service>>>,
    preview: Arc<Mutex<Option<Workspace>>>,
    completed_previews: Arc<Mutex<BTreeMap<String, String>>>,
    cancel: Arc<AtomicBool>,
    converting: Arc<AtomicBool>,
    shortcut_recording: Arc<AtomicBool>,
    preferences: Arc<Mutex<Preferences>>,
    shortcut: Arc<Mutex<Option<String>>>,
    startup_error: Arc<Mutex<Option<String>>>,
    settings_update: Arc<Mutex<()>>,
}

// The observer owns only the workspace/preview projection, not its service
// handle. This prevents a reference cycle and preserves workspace -> preview
// lock ordering used by foreground work.
struct ObservationState {
    workspace: Arc<Mutex<Option<Workspace>>>,
    preview: Arc<Mutex<Option<Workspace>>>,
    completed: Arc<Mutex<BTreeMap<String, String>>>,
    session: Arc<AtomicU64>,
}
impl From<&AppState> for ObservationState {
    fn from(state: &AppState) -> Self {
        Self { workspace: state.workspace.clone(), preview: state.preview.clone(), completed: state.completed_previews.clone(), session: state.workspace_session.clone() }
    }
}
impl ObservationState {
    fn reconcile_and_publish(&self, session: u64, paths: &[PathBuf], force: bool, publish: impl FnOnce(&Project)) -> Result<Option<Project>, String> {
        if self.session.load(Ordering::SeqCst) != session { return Ok(None); }
        let mut workspace = self.workspace.lock().map_err(|_| "Workspace unavailable")?;
        // A stale worker may have waited behind close/open or a long mutation.
        if self.session.load(Ordering::SeqCst) != session { return Ok(None); }
        let Some(ws) = workspace.as_mut() else { return Ok(None); };
        let result = ws.reconcile_observation(paths, force)?;
        if result.is_some() {
            if let Ok(mut preview) = self.preview.lock() { *preview = workspace.clone(); }
            if let Ok(mut completed) = self.completed.lock() { completed.clear(); }
        }
        // Publication belongs to the same serialized operation as the refresh.
        // A foreground mutation must not publish/return P2 before this P1 event.
        // Preview/completed guards above have already been released.
        if let Some(project) = &result { publish(project); }
        Ok(result)
    }
}

fn sync_observer(app: &tauri::AppHandle, state: &AppState) {
    let Ok(workspace) = state.workspace.lock() else { return; };
    let enabled = state.preferences.lock().is_ok_and(|preferences| preferences.auto_watch);
    let Ok(mut observer) = state.observer.lock() else { return; };
    let Some(ws) = workspace.as_ref().filter(|_| enabled) else {
        if observer.is_some() { state.workspace_session.fetch_add(1, Ordering::SeqCst); }
        *observer = None;
        return;
    };
    let session = state.workspace_session.load(Ordering::SeqCst);
    if observer.as_ref().is_some_and(|observer| observer.session == session) { return; }
    *observer = None;
    let root = PathBuf::from(&ws.project().root);
    let identity = serde_json::json!({ "root": ws.project().root, "mainFile": ws.project().main_file, "session": session });
    let observation = ObservationState::from(state);
    let app = app.clone();
    // Native callback queues behind the same workspace mutex as all mutations.
    // The service retains its own 30-second fallback even when init fails.
    match crate::watcher::Service::start(root, session, move |batch| {
        match observation.reconcile_and_publish(session, &batch.paths, batch.force, |project| {
            update_tray_status(&app, project);
            let _ = app.emit("workspace-observed", serde_json::json!({ "project": project, "session": session }));
        }) {
            Ok(_) => Ok(()),
            Err(error) => {
                let _ = app.emit("workspace-observation-unavailable", &identity);
                Err(error)
            }
        }
    }) {
        Ok(service) => *observer = Some(service),
        Err(error) => eprintln!("Texgo observation worker unavailable: {error}"),
    }
}

#[tauri::command]
async fn observation_identity(state: State<'_, AppState>) -> Result<Option<serde_json::Value>, String> {
    let workspace = state.workspace.clone();
    let session = state.workspace_session.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let workspace = workspace.lock().map_err(|_| "工作区状态不可用")?;
        Ok(workspace.as_ref().map(|ws| serde_json::json!({ "root": ws.project().root, "mainFile": ws.project().main_file, "session": session.load(Ordering::SeqCst) })))
    }).await.map_err(|error| error.to_string())?
}

async fn work<T: Send + 'static>(state: AppState, action: impl FnOnce(&mut Option<Workspace>) -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || {
        // Mutations and scans share one worker-side lock; previews use a read snapshot.
        let mut workspace = state.workspace.lock().map_err(|_| "工作区状态不可用，请重新启动应用".to_string())?;
        let result = action(&mut workspace);
        if let Ok(mut preview) = state.preview.lock() { *preview = workspace.clone(); }
        if let Ok(mut completed) = state.completed_previews.lock() { completed.clear(); }
        result
    }).await.map_err(|e| format!("后台任务失败：{e}"))?
}

fn current(workspace: &mut Option<Workspace>) -> Result<&mut Workspace, String> {
    workspace.as_mut().ok_or_else(|| "请先打开 LaTeX 项目".into())
}

#[tauri::command]
fn get_preferences(state: State<'_, AppState>) -> Result<Preferences, String> {
    state.preferences.lock().map(|p| p.clone()).map_err(|_| "设置状态不可用".into())
}

#[tauri::command]
async fn save_preferences(preferences: Preferences, app: tauri::AppHandle, state: State<'_, AppState>) -> Result<Preferences, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        preferences.validate()?;
        let _update = state.settings_update.lock().map_err(|_| "设置状态不可用")?;
        let mut shortcut = state.shortcut.lock().map_err(|_| "快捷键状态不可用")?;
        let path = app.path().app_config_dir().map_err(|e| e.to_string())?.join("preferences.json");
        let next = normalized_shortcut(&preferences)?;
        let old = shortcut.clone();
        let registrar = NativeRegistrar(app.clone());
        crate::background::replace_shortcut(&registrar, &mut shortcut, next)?;
        if let Err(error) = preferences.save(&path) {
            if let Err(rollback) = crate::background::replace_shortcut(&registrar, &mut shortcut, old) { return Err(format!("{error}；{rollback}")); }
            return Err(error);
        }
        *state.preferences.lock().map_err(|_| "设置状态不可用")? = preferences.clone();
        *state.startup_error.lock().map_err(|_| "状态不可用")? = None;
        sync_observer(&app, &state);
        Ok(preferences)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
fn desktop_status(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({ "converting": state.converting.load(Ordering::Relaxed), "error": state.startup_error.lock().map_err(|_| "状态不可用")?.clone() }))
}

// Transient guard: recording a shortcut must not invoke the previously registered
// global shortcut. Registration and persisted preferences remain untouched.
#[tauri::command]
fn set_shortcut_recording(recording: bool, state: State<'_, AppState>) {
    state.shortcut_recording.store(recording, Ordering::SeqCst);
}

#[tauri::command]
async fn close_workspace(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let session = state.workspace_session.clone();
    work(state.inner().clone(), move |workspace| {
        session.fetch_add(1, Ordering::SeqCst);
        *workspace = None;
        Ok(())
    }).await?;
    sync_observer(&app, state.inner());
    Ok(())
}

#[tauri::command]
async fn open_project(main_file: String, app: tauri::AppHandle, state: State<'_, AppState>) -> Result<Project, String> {
    let session = state.workspace_session.clone();
    let project = work(state.inner().clone(), move |workspace| {
        let opened = Workspace::open(Path::new(&main_file))?;
        let project = opened.project().clone();
        session.fetch_add(1, Ordering::SeqCst);
        *workspace = Some(opened);
        Ok(project)
    }).await?;
    sync_observer(&app, state.inner());
    update_tray_status(&app, &project);
    Ok(project)
}

#[tauri::command]
async fn refresh_workspace(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<Project, String> {
    let project = work(state.inner().clone(), |workspace| current(workspace)?.refresh()).await?;
    update_tray_status(&app, &project);
    Ok(project)
}

#[tauri::command]
async fn poll_workspace(root: String, app: tauri::AppHandle, state: State<'_, AppState>) -> Result<Option<Project>, String> {
    if state.converting.load(Ordering::Relaxed) { return Ok(None); }
    let project = work(state.inner().clone(), move |workspace| {
        let ws = current(workspace)?;
        if ws.project().root != root { return Ok(None); }
        ws.poll_changes()
    }).await?;
    if let Some(project) = &project { update_tray_status(&app, project); }
    Ok(project)
}

#[tauri::command]
async fn open_release_page(url: String) -> Result<(), String> {
    if !url.starts_with("https://github.com/yaho7/texgo/releases/tag/") || url.chars().any(|c| c.is_control() || c == '"') {
        return Err("无效的发行版地址".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "macos")]
        let status = std::process::Command::new("open").arg(&url).status();
        #[cfg(target_os = "windows")]
        let status = std::process::Command::new("rundll32.exe").args(["url.dll,FileProtocolHandler", &url]).status();
        #[cfg(target_os = "linux")]
        let status = std::process::Command::new("xdg-open").arg(&url).status();
        status.map_err(|e| e.to_string()).and_then(|s| if s.success() { Ok(()) } else { Err("无法打开浏览器".into()) })
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn conversion_history(state: State<'_, AppState>) -> Result<Vec<ConversionHistoryEntry>, String> {
    work(state.inner().clone(), |workspace| current(workspace)?.conversion_history()).await
}

#[tauri::command]
async fn undo_conversion(entry_id: String, state: State<'_, AppState>) -> Result<Project, String> {
    work(state.inner().clone(), move |workspace| current(workspace)?.undo_conversion(&entry_id)).await
}

struct ConversionGuard(Arc<AtomicBool>);
impl Drop for ConversionGuard {
    fn drop(&mut self) { self.0.store(false, Ordering::Relaxed); }
}

#[tauri::command]
async fn convert_images(options: ConversionOptions, intent: Option<ConversionIntent>, app: tauri::AppHandle, state: State<'_, AppState>) -> Result<ConversionResult, String> {
    if state.converting.swap(true, Ordering::Relaxed) { return Err("已有转换任务正在运行".into()); }
    let guard = ConversionGuard(state.converting.clone());
    state.cancel.store(false, Ordering::Relaxed);
    let cancel = state.cancel.clone();
    let allow_unreviewed = state.preferences.lock().map_err(|_| "设置状态不可用")?.allow_unreviewed;
    let completed = state.completed_previews.clone();
    completed.lock().map_err(|_| "预览状态不可用")?.clear();
    let native_app = app.clone();
    let preferences = state.preferences.lock().map_err(|_| "设置状态不可用")?.clone();
    work(state.inner().clone(), move |workspace| {
        let _guard = guard;
        let ws = current(workspace)?;
        let result = (|| {
        ws.refresh()?;
        ws.ensure_can_convert(allow_unreviewed)?;
        ws.convert_with_intent(&options, intent.unwrap_or_default(), allow_unreviewed, &cancel,
            |progress| { let _ = app.emit("conversion-progress", progress); },
            |image| {
                if image.error.is_none() {
                    if let Some(path) = &image.pdf_path { if let Ok(mut paths) = completed.lock() { paths.insert(image.id.clone(), path.clone()); } }
                }
                let _ = app.emit("conversion-result", image);
            })
        })();
        match &result {
            Ok(result) => {
                update_tray_status(&native_app, ws.project());
                let target = conversion_target(ws, result, ws.conversion_history().ok().and_then(|h| h.first().map(|e| e.id.clone())));
                if let Some(notice) = crate::background::workspace_notice(&ws.project().status, result, &preferences) { deliver_notice(&native_app, notice, target); }
            }
            Err(error) => {
                let project = ws.reconcile_after_error(error);
                publish_workspace(&native_app, &project);
                if preferences.notify_failure { deliver_notice(&native_app, crate::background::Notice { title: "Texgo · 更新失败".into(), body: error.clone() }, workspace_target(ws, "problems", None, project.status.problem_ids.first().cloned())); }
            }
        }
        result
    }).await
}

#[tauri::command]
fn cancel_conversion(state: State<'_, AppState>) {
    state.cancel.store(true, Ordering::Relaxed);
}

#[tauri::command]
async fn asset_preview(image_id: String, converted: bool, state: State<'_, AppState>) -> Result<AssetPreview, String> {
    let preview = state.preview.clone();
    let completed = state.completed_previews.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let workspace = preview.lock().map_err(|_| "预览状态不可用")?.clone().ok_or("请先打开项目")?;
        if converted {
            let path = completed.lock().map_err(|_| "预览状态不可用")?.get(&image_id).cloned();
            if let Some(path) = path { return workspace.preview_output(&image_id, Path::new(&path)); }
        }
        workspace.preview(&image_id, converted)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn ignore_asset(image_id: String, ignored: Option<bool>, mode: Option<IgnoreMode>, app: tauri::AppHandle, state: State<'_, AppState>) -> Result<Project, String> {
    let project = work(state.inner().clone(), move |workspace| {
        let ws = current(workspace)?;
        ws.set_ignore_mode(&image_id, mode.unwrap_or(if ignored.unwrap_or(true) { IgnoreMode::Session } else { IgnoreMode::None }))
    }).await?;
    update_tray_status(&app, &project);
    Ok(project)
}

#[tauri::command]
async fn rename_asset(image_id: String, new_base_name: String, expected_fingerprint: String, app: tauri::AppHandle, state: State<'_, AppState>) -> Result<RenameResult, String> {
    if state.converting.swap(true, Ordering::SeqCst) { return Err("已有项目操作正在运行，请稍后重试".into()); }
    let guard = ConversionGuard(state.converting.clone());
    let project_app = app.clone();
    let result = work(state.inner().clone(), move |workspace| {
        let _guard = guard;
        let ws = current(workspace)?;
        let result = ws.rename_asset(&image_id, &new_base_name, &expected_fingerprint);
        if let Err(error) = &result {
            let project = ws.reconcile_after_error(error);
            publish_workspace(&project_app, &project);
        }
        result
    }).await?;
    update_tray_status(&app, &result.project);
    Ok(result)
}

#[tauri::command]
async fn retry_asset(image_id: String, app: tauri::AppHandle, state: State<'_, AppState>) -> Result<Project, String> {
    let project = work(state.inner().clone(), move |workspace| current(workspace)?.retry_asset(&image_id)).await?;
    update_tray_status(&app, &project);
    Ok(project)
}

#[tauri::command]
async fn preview_changes(state: State<'_, AppState>) -> Result<ReplacementPlan, String> {
    work(state.inner().clone(), |workspace| current(workspace)?.plan()).await
}

#[tauri::command]
async fn apply_replacements(selection: Vec<String>, expected: ReplacementPlan, repair: Option<bool>, state: State<'_, AppState>) -> Result<MutationResult, String> {
    work(state.inner().clone(), move |workspace| current(workspace)?.apply_reviewed(selection.into_iter().collect(), &expected, repair.unwrap_or(false))).await
}

#[tauri::command]
async fn repair_candidates(image_id: String, state: State<'_, AppState>) -> Result<Vec<crate::repair::Candidate>, String> {
    work(state.inner().clone(), move |workspace| current(workspace)?.repair_candidates(&image_id)).await
}

#[tauri::command]
async fn preview_repair(image_id: String, target: String, state: State<'_, AppState>) -> Result<ReplacementPlan, String> {
    work(state.inner().clone(), move |workspace| current(workspace)?.preview_repair(&image_id, Path::new(&target))).await
}

#[tauri::command]
async fn undo_replacements(state: State<'_, AppState>) -> Result<MutationResult, String> {
    work(state.inner().clone(), |workspace| current(workspace)?.undo()).await
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().with_handler(|app, _, event| {
            if event.state == ShortcutState::Pressed { trigger_smart(app); }
        }).build())
        .manage(AppState::default())
        .setup(|app| {
            crate::desktop_menu::install(app)?;
            let path = app.path().app_config_dir()?.join("preferences.json");
            match Preferences::load(&path) {
                Ok(preferences) => *app.state::<AppState>().preferences.lock().unwrap() = preferences,
                Err(error) => { *app.state::<AppState>().startup_error.lock().unwrap() = Some(error); }
            }
            install_background(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![observation_identity, desktop_status, set_shortcut_recording, smart_convert, close_workspace, get_preferences, save_preferences, ignore_asset, rename_asset, retry_asset, open_project, refresh_workspace, poll_workspace, open_release_page, repair_candidates, preview_repair, conversion_history, undo_conversion, convert_images, cancel_conversion, asset_preview, preview_changes, apply_replacements, undo_replacements])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let background = window.state::<AppState>().preferences.lock().is_ok_and(|p| p.close_action == "background");
                if background { api.prevent_close(); let _ = window.hide(); }
                else { window.app_handle().exit(0); }
            }
        })
        .build(tauri::generate_context!())
        .expect("failed to start texgo desktop")
        .run(|app, event| {
            if matches!(&event, tauri::RunEvent::Exit) {
                let state = app.state::<AppState>();
                state.workspace_session.fetch_add(1, Ordering::SeqCst);
                if let Ok(mut observer) = state.observer.lock() { *observer = None; }
                let _ = app.global_shortcut().unregister_all();
            }
            #[cfg(target_os = "macos")]
            if matches!(&event, tauri::RunEvent::Reopen { .. }) { show_window(app); }
        });
}

use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tauri_plugin_notification::NotificationExt;
use crate::background::{NotificationTarget, Notice, ShortcutRegistrar};

struct NativeRegistrar(tauri::AppHandle);
impl ShortcutRegistrar for NativeRegistrar {
    fn register(&self, key: &str) -> Result<(), String> {
        self.0.global_shortcut().register(key).map_err(|e| format!("无法注册全局快捷键 {key}，可能已被占用：{e}"))
    }
    fn unregister(&self, key: &str) -> Result<(), String> {
        self.0.global_shortcut().unregister(key).map_err(|e| format!("无法释放全局快捷键：{e}"))
    }
}

fn normalized_shortcut(prefs: &Preferences) -> Result<Option<String>, String> {
    if !prefs.shortcut_enabled { return Ok(None); }
    let shortcut: Shortcut = prefs.shortcut.parse().map_err(|e| format!("无效的快捷键：{e}"))?;
    // Require Alt plus the primary modifier or Super. This reserves a separate namespace
    // from application shortcuts (Cmd/Ctrl Enter, Shift Enter, O, R, F and comma).
    use tauri_plugin_global_shortcut::Modifiers;
    if !shortcut.mods.contains(Modifiers::ALT) || !shortcut.mods.intersects(Modifiers::CONTROL | Modifiers::META | Modifiers::SUPER) {
        return Err("全局快捷键必须包含 Cmd/Ctrl + Alt/Option，避免与应用内快捷键冲突".into());
    }
    Ok(Some(shortcut.to_string()))
}

fn workspace_target(ws: &Workspace, view: &str, batch_id: Option<String>, image_id: Option<String>) -> NotificationTarget {
    let p = ws.project();
    NotificationTarget { path: p.main_file.clone(), view: view.into(), batch_id, image_id }
}
fn conversion_target(ws: &Workspace, result: &ConversionResult, batch_id: Option<String>) -> NotificationTarget {
    let view = if result.images.iter().any(|image| image.error.is_some()) || ws.project().status.blocking_reason.is_some() { "problems" }
        else { match ws.project().status.next_action { NextAction::ReviewReferences => "review", NextAction::ResolveProblems => "problems", NextAction::ConvertImages => "images", NextAction::UpToDate => "history" } };
    workspace_target(ws, view, batch_id, result.images.iter().find(|image| image.error.is_some()).map(|image| image.id.clone()))
}
fn update_tray_status(app: &tauri::AppHandle, project: &Project) {
    if let Some(tray) = app.tray_by_id("texgo") {
        let _ = tray.set_tooltip(Some(format!("Texgo · {}", crate::background::status_label(&project.status))));
    }
}

fn publish_workspace(app: &tauri::AppHandle, project: &Project) {
    update_tray_status(app, project);
    let _ = app.emit("workspace-updated", project);
}

fn deliver_notice(app: &tauri::AppHandle, notice: Notice, target: NotificationTarget) {
    // Register on_action once at setup, BEFORE any notification can be sent.
    // extra travels with the specific notification, including old workspaces/batches.
    if let Err(error) = app.notification().builder().title(notice.title).body(notice.body).extra("texgoTarget", target).show() {
        let _ = app.emit("desktop-error", format!("系统通知不可用：{error}"));
    }
}

fn show_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize(); let _ = window.show(); let _ = window.set_focus();
    }
}

fn notification_clicked(app: tauri::AppHandle, target: NotificationTarget) {
    show_window(&app);
    let state = app.state::<AppState>().inner().clone();
    tauri::async_runtime::spawn(async move {
        let wanted = target.clone();
        let session = state.workspace_session.clone();
        let result = work(state.clone(), move |workspace| {
            let same = workspace.as_ref().is_some_and(|ws| {
                ws.project().main_file == wanted.path
            });
            if !same {
                let opened = Workspace::open(Path::new(&wanted.path))?;
                session.fetch_add(1, Ordering::SeqCst);
                *workspace = Some(opened);
            }
            current(workspace)?.refresh()
        }).await;
        sync_observer(&app, &state);
        match result {
            Ok(project) => { let _ = app.emit("notification-navigate", serde_json::json!({ "target": target, "project": project })); }
            Err(error) => { let _ = app.emit("desktop-error", error); }
        }
    });
}

#[tauri::command]
async fn smart_convert(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    run_smart(app, state.inner().clone()).await
}
async fn run_smart(app: tauri::AppHandle, state: AppState) -> Result<(), String> {
    if state.shortcut_recording.load(Ordering::SeqCst) { return Err("请先完成快捷键录制".into()); }
    if state.converting.swap(true, Ordering::Relaxed) { return Err("已有转换任务正在运行".into()); }
    let guard = ConversionGuard(state.converting.clone());
    state.cancel.store(false, Ordering::Relaxed);
    let cancel = state.cancel.clone(); let completed = state.completed_previews.clone();
    let preview_snapshot = state.preview.clone();
    let preferences = state.preferences.lock().map_err(|_| "设置状态不可用")?.clone();
    let events = app.clone();
    let result = work(state, move |workspace| {
        let _guard = guard;
        let ws = current(workspace)?;
        if let Err(error) = ws.refresh() {
            let project = ws.reconcile_after_error(&error);
            publish_workspace(&events, &project);
            if preferences.notify_failure { deliver_notice(&events, Notice { title: "Texgo · 更新失败".into(), body: error.clone() }, workspace_target(ws, "problems", None, None)); }
            let _ = events.emit("desktop-error", &error);
            return Err(error);
        }
        *preview_snapshot.lock().map_err(|_| "预览状态不可用")? = Some(ws.clone());
        let _ = events.emit("background-start", ws.project());
        completed.lock().map_err(|_| "预览状态不可用")?.clear();
        let report = ws.smart_convert(&preferences, &cancel,
            |progress| { let _ = events.emit("conversion-progress", progress); },
            |image| {
                if let Some(path) = &image.pdf_path { if let Ok(mut paths) = completed.lock() { paths.insert(image.id.clone(), path.clone()); } }
                let _ = events.emit("conversion-result", image);
            });
        match &report {
            Ok(report) => {
                update_tray_status(&events, &report.project);
                // Pending references block the whole operation by default; fresh successful
                // conversions also remain for manual review, never auto-apply TeX.
                let blocked_review = report.result.images.is_empty() && report.pending_references > 0 && !preferences.allow_unreviewed;
                let blocking = report.project.status.blocking_reason.as_ref();
                if preferences.notify_failure && (blocked_review || !report.problem_ids.is_empty() || blocking.is_some()) {
                    let count = (report.problem_ids.len() + usize::from(blocked_review)).max(1);
                    deliver_notice(&events, Notice { title: format!("Texgo · 发现 {count} 个问题需要处理"), body: if let Some(reason) = blocking { reason.clone() } else if blocked_review { format!("{} 处引用等待确认", report.pending_references) } else { "点击查看图片问题".into() } },
                        workspace_target(ws, if blocked_review { "review" } else { "problems" }, report.batch_ids.last().cloned(), report.problem_ids.first().cloned()));
                }
                if blocking.is_none() && (!report.result.images.is_empty() || (!blocked_review && report.problem_ids.is_empty())) {
                    if let Some(notice) = crate::background::workspace_notice(&report.project.status, &report.result, &preferences) {
                        let failed_source = report.result.images.iter().find(|i| i.error.is_some()).and_then(|i| ws.project().images.iter().find(|a| a.id == i.id)).map(|a| a.relative_path.as_str());
                        let batch_id = failed_source.and_then(|source| ws.conversion_history().ok()?.into_iter().find(|entry| report.batch_ids.contains(&entry.id) && entry.files.iter().any(|file| file.source == source && file.error.is_some())).map(|entry| entry.id))
                            .or_else(|| report.batch_ids.last().cloned());
                        let target = conversion_target(ws, &report.result, batch_id);
                        deliver_notice(&events, notice, target);
                    }
                }
                let _ = events.emit("background-finished", report);
            }
            Err(error) => {
                let project = ws.reconcile_after_error(error);
                publish_workspace(&events, &project);
                if preferences.notify_failure { deliver_notice(&events, Notice { title: "Texgo · 更新失败".into(), body: error.clone() }, workspace_target(ws, "problems", None, project.status.problem_ids.first().cloned())); }
                let _ = events.emit("desktop-error", error);
            }
        }
        report.map(|_| ())
    }).await;
    let _ = app.emit("background-idle", ());
    result
}

fn trigger_smart(app: &tauri::AppHandle) {
    let app = app.clone(); let state = app.state::<AppState>().inner().clone();
    if state.shortcut_recording.load(Ordering::SeqCst) { return; }
    tauri::async_runtime::spawn(async move {
        if let Err(error) = run_smart(app.clone(), state.clone()).await {
            let _ = app.emit("desktop-error", &error);
            // No workspace: inform without showing or activating the main window.
            if error.contains("请先打开") && state.preferences.lock().is_ok_and(|p| p.notify_failure) {
                if let Err(e) = app.notification().builder().title("Texgo · 尚未打开项目").body("请从托盘打开 Texgo 并选择项目").show() { eprintln!("{e}"); }
            }
        }
    });
}

fn install_background(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let handle = app.handle().clone();
    app.notification().on_action(move |action| {
        if action.action_id() != "tap" { return; }
        if let Some(target) = action.notification().and_then(|n| n.extra().get("texgoTarget")).and_then(|v| serde_json::from_value::<NotificationTarget>(v.clone()).ok()) {
            notification_clicked(handle.clone(), target);
        } else { show_window(&handle); }
    })?;
    let state = app.state::<AppState>();
    let prefs = state.preferences.lock().unwrap().clone();
    let registration = normalized_shortcut(&prefs).and_then(|next| crate::background::replace_shortcut(&NativeRegistrar(app.handle().clone()), &mut state.shortcut.lock().unwrap(), next));
    if let Err(error) = registration { *state.startup_error.lock().unwrap() = Some(error); }
    use tauri::{menu::{Menu, MenuItem}, tray::TrayIconBuilder};
    let convert = MenuItem::with_id(app, "smart-convert", "快速更新项目图片", true, None::<&str>)?;
    let open = MenuItem::with_id(app, "show-texgo", "打开 Texgo", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit-texgo", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&convert, &open, &quit])?;
    let mut tray = TrayIconBuilder::with_id("texgo").tooltip("Texgo").menu(&menu).on_menu_event(|app, event| match event.id.as_ref() {
        "smart-convert" => trigger_smart(app), "show-texgo" => show_window(app), "quit-texgo" => app.exit(0), _ => (),
    });
    if let Some(icon) = app.default_window_icon() { tray = tray.icon(icon.clone()); }
    tray.build(app)?;
    Ok(())
}

#[cfg(test)]
mod desktop_policy_tests {
    use super::*;
    #[test]
    fn shortcuts_validate_modifiers_and_disable_without_parsing() {
        let mut prefs = Preferences::default();
        assert!(normalized_shortcut(&prefs).unwrap().is_some());
        prefs.shortcut = "Command+Option+Enter".into();
        assert!(normalized_shortcut(&prefs).unwrap().is_some());
        prefs.shortcut = "Control+Alt+Enter".into();
        assert!(normalized_shortcut(&prefs).unwrap().is_some());
        prefs.shortcut = "Ctrl+Enter".into(); assert!(normalized_shortcut(&prefs).is_err());
        prefs.shortcut = "bad shortcut".into(); assert!(normalized_shortcut(&prefs).is_err());
        prefs.shortcut_enabled = false; assert!(normalized_shortcut(&prefs).unwrap().is_none());
    }
}

#[cfg(test)]
mod native_observation_lifecycle_tests {
    use super::*;
    #[test]
    fn stale_sessions_cannot_refresh_a_reopened_project_at_the_same_path() {
        let directory = tempfile::tempdir().unwrap();
        let main = directory.path().join("main.tex");
        std::fs::write(&main, r"\includegraphics{a.png}").unwrap();
        let state = AppState::default();
        *state.workspace.lock().unwrap() = Some(Workspace::open(&main).unwrap());
        state.workspace_session.store(2, Ordering::SeqCst);
        std::fs::write(&main, r"\includegraphics{b.png}").unwrap();
        let observed = ObservationState::from(&state);
        assert!(observed.reconcile_and_publish(1, &[main.clone()], true, |_| {}).unwrap().is_none());
        assert_eq!(state.workspace.lock().unwrap().as_ref().unwrap().project().images[0].relative_path, "a.png");
        assert!(observed.reconcile_and_publish(2, &[main], true, |_| {}).unwrap().is_some());
        assert_eq!(state.workspace.lock().unwrap().as_ref().unwrap().project().images[0].relative_path, "b.png");
    }
    #[test]
    fn queued_old_session_is_rechecked_after_the_workspace_mutex() {
        let directory = tempfile::tempdir().unwrap();
        let main = directory.path().join("main.tex");
        std::fs::write(&main, r"\includegraphics{a.png}").unwrap();
        let state = AppState::default();
        let mut locked = state.workspace.lock().unwrap();
        *locked = Some(Workspace::open(&main).unwrap());
        state.workspace_session.store(1, Ordering::SeqCst);
        let observed = ObservationState::from(&state);
        let queued = std::thread::spawn(move || observed.reconcile_and_publish(1, &[], true, |_| {}));
        state.workspace_session.store(2, Ordering::SeqCst);
        drop(locked);
        assert!(queued.join().unwrap().unwrap().is_none());
    }
}

#[cfg(test)]
mod observation_publication_tests {
    use super::*;
    use std::{sync::mpsc, time::Duration};
    #[test]
    fn foreground_mutation_cannot_overtake_an_older_observation_publication() {
        let directory = tempfile::tempdir().unwrap();
        let main = directory.path().join("main.tex");
        std::fs::write(&main, r"\includegraphics{a.png}").unwrap();
        let state = AppState::default();
        *state.workspace.lock().unwrap() = Some(Workspace::open(&main).unwrap());
        let publications = Arc::new(Mutex::new(Vec::new()));
        let observed_publications = publications.clone();
        let observation = ObservationState::from(&state);
        let (entered, publishing) = mpsc::sync_channel(0);
        let (resume, released) = mpsc::sync_channel(0);
        let watcher = std::thread::spawn(move || observation.reconcile_and_publish(0, &[], true, |project| {
            assert_eq!(project.status.ignored_count, 0);
            entered.send(()).unwrap();
            released.recv_timeout(Duration::from_secs(5)).unwrap();
            observed_publications.lock().unwrap().push("observation P1");
        }));
        publishing.recv_timeout(Duration::from_secs(5)).unwrap();
        // Force the exact old gap: the watcher has its P1 snapshot and pauses
        // immediately before emission while a foreground mutation requests P2.
        let overtook = match state.workspace.try_lock() {
            Ok(mut workspace) => {
                let ws = workspace.as_mut().unwrap();
                let image = ws.project().images[0].id.clone();
                ws.set_ignore_mode(&image, IgnoreMode::Session).unwrap();
                publications.lock().unwrap().push("foreground P2");
                true
            }
            Err(std::sync::TryLockError::WouldBlock) => false,
            Err(error) => panic!("Unexpected workspace lock failure: {error}"),
        };
        let foreground = if !overtook {
            let state = state.clone();
            let publications = publications.clone();
            Some(std::thread::spawn(move || {
                let mut workspace = state.workspace.lock().unwrap();
                let ws = workspace.as_mut().unwrap();
                let image = ws.project().images[0].id.clone();
                ws.set_ignore_mode(&image, IgnoreMode::Session).unwrap();
                publications.lock().unwrap().push("foreground P2");
            }))
        } else { None };
        resume.send(()).unwrap();
        watcher.join().unwrap().unwrap();
        if let Some(foreground) = foreground { foreground.join().unwrap(); }
        assert!(!overtook, "foreground P2 must wait until older watcher P1 has been published");
        assert_eq!(*publications.lock().unwrap(), ["observation P1", "foreground P2"]);
        assert_eq!(state.workspace.lock().unwrap().as_ref().unwrap().project().status.ignored_count, 1);
    }
}
