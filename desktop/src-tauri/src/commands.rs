use crate::*;
use std::path::Path;
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, State};

#[derive(Clone, Default)]
struct AppState {
    workspace: Arc<Mutex<Option<Workspace>>>,
    preview: Arc<Mutex<Option<Workspace>>>,
    completed_previews: Arc<Mutex<BTreeMap<String, String>>>,
    cancel: Arc<AtomicBool>,
    converting: Arc<AtomicBool>,
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
    workspace.as_mut().ok_or_else(|| "请先打开 .tex 主文件或图片目录".into())
}

#[tauri::command]
async fn open_project(main_file: String, state: State<'_, AppState>) -> Result<Project, String> {
    work(state.inner().clone(), move |workspace| {
        let opened = Workspace::open(Path::new(&main_file))?;
        let project = opened.project().clone();
        *workspace = Some(opened);
        Ok(project)
    }).await
}

#[tauri::command]
async fn open_directory(directory: String, recursive: bool, state: State<'_, AppState>) -> Result<Project, String> {
    work(state.inner().clone(), move |workspace| {
        let opened = Workspace::open_directory(Path::new(&directory), recursive)?;
        let project = opened.project().clone();
        *workspace = Some(opened);
        Ok(project)
    }).await
}

#[tauri::command]
async fn add_image_directory(directory: String, recursive: bool, state: State<'_, AppState>) -> Result<Project, String> {
    work(state.inner().clone(), move |workspace| current(workspace)?.add_image_directory(Path::new(&directory), recursive)).await
}

#[tauri::command]
async fn refresh_workspace(state: State<'_, AppState>) -> Result<Project, String> {
    work(state.inner().clone(), |workspace| current(workspace)?.refresh()).await
}

#[tauri::command]
async fn poll_workspace(root: String, state: State<'_, AppState>) -> Result<Option<Project>, String> {
    if state.converting.load(Ordering::Relaxed) { return Ok(None); }
    work(state.inner().clone(), move |workspace| {
        let ws = current(workspace)?;
        if ws.project().root != root { return Ok(None); }
        ws.poll_changes()
    }).await
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
async fn convert_images(options: ConversionOptions, app: tauri::AppHandle, state: State<'_, AppState>) -> Result<ConversionResult, String> {
    if state.converting.swap(true, Ordering::Relaxed) { return Err("已有转换任务正在运行".into()); }
    let guard = ConversionGuard(state.converting.clone());
    state.cancel.store(false, Ordering::Relaxed);
    let cancel = state.cancel.clone();
    let completed = state.completed_previews.clone();
    completed.lock().map_err(|_| "预览状态不可用")?.clear();
    work(state.inner().clone(), move |workspace| {
        let _guard = guard;
        let ws = current(workspace)?;
        ws.refresh()?;
        ws.ensure_can_convert(false)?;
        ws.convert_with_results(&options, &cancel,
            |progress| { let _ = app.emit("conversion-progress", progress); },
            |image| {
                if image.error.is_none() {
                    if let Some(path) = &image.pdf_path { if let Ok(mut paths) = completed.lock() { paths.insert(image.id.clone(), path.clone()); } }
                }
                let _ = app.emit("conversion-result", image);
            })
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
async fn ignore_asset(image_id: String, ignored: bool, state: State<'_, AppState>) -> Result<(), String> {
    work(state.inner().clone(), move |workspace| current(workspace)?.ignore(&image_id, ignored)).await
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
        .manage(AppState::default())
        .setup(|app| { crate::desktop_menu::install(app)?; Ok(()) })
        .invoke_handler(tauri::generate_handler![ignore_asset, open_project, open_directory, add_image_directory, refresh_workspace, poll_workspace, open_release_page, repair_candidates, preview_repair, conversion_history, undo_conversion, convert_images, cancel_conversion, asset_preview, preview_changes, apply_replacements, undo_replacements])
        .run(tauri::generate_context!())
        .expect("failed to start texgo desktop");
}
