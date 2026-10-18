use crate::*;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, State};

#[derive(Clone, Default)]
struct AppState {
    workspace: Arc<Mutex<Option<Workspace>>>,
    cancel: Arc<AtomicBool>,
    converting: Arc<AtomicBool>,
}

async fn work<T: Send + 'static>(state: AppState, action: impl FnOnce(&mut Option<Workspace>) -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || {
        // Preview and history reads can overlap; serialize them on a worker thread.
        let mut workspace = state.workspace.lock().map_err(|_| "工作区状态不可用，请重新启动应用".to_string())?;
        action(&mut workspace)
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
    work(state.inner().clone(), move |workspace| {
        let _guard = guard;
        current(workspace)?.convert(&options, &cancel, |progress| { let _ = app.emit("conversion-progress", progress); })
    }).await
}

#[tauri::command]
fn cancel_conversion(state: State<'_, AppState>) {
    state.cancel.store(true, Ordering::Relaxed);
}

#[tauri::command]
async fn asset_preview(image_id: String, converted: bool, state: State<'_, AppState>) -> Result<AssetPreview, String> {
    work(state.inner().clone(), move |workspace| current(workspace)?.preview(&image_id, converted)).await
}

#[tauri::command]
async fn preview_changes(state: State<'_, AppState>) -> Result<ReplacementPlan, String> {
    work(state.inner().clone(), |workspace| current(workspace)?.plan()).await
}

#[tauri::command]
async fn apply_replacements(state: State<'_, AppState>) -> Result<MutationResult, String> {
    work(state.inner().clone(), |workspace| current(workspace)?.apply()).await
}

#[tauri::command]
async fn undo_replacements(state: State<'_, AppState>) -> Result<MutationResult, String> {
    work(state.inner().clone(), |workspace| current(workspace)?.undo()).await
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![open_project, open_directory, add_image_directory, refresh_workspace, conversion_history, undo_conversion, convert_images, cancel_conversion, asset_preview, preview_changes, apply_replacements, undo_replacements])
        .run(tauri::generate_context!())
        .expect("failed to start texgo desktop");
}
