//! Update packages stay native and in memory; the webview receives opaque tokens only.
use serde::Serialize;
use std::sync::{Arc, Mutex, atomic::{AtomicU8, AtomicU64, Ordering}};
use std::time::Duration;
use tauri::{Manager, State};
use tauri_plugin_updater::{Update, UpdaterExt};

const IDLE: u8 = 0;
const CHECKING: u8 = 1;
const DOWNLOADING: u8 = 2;
const INSTALLING: u8 = 3;
const INSTALLED: u8 = 4;
#[derive(Clone, Default)]
pub(crate) struct UpdateState(Arc<Inner>);
#[derive(Default)]
struct Inner { phase: AtomicU8, next: AtomicU64, candidate: Mutex<Option<Candidate>> }
struct Candidate { token: u64, update: Update, bytes: Option<Vec<u8>> }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateInfo { current_version: String, version: Option<String>, token: Option<u64>, stage: &'static str, installer_restarts: bool }
impl UpdateInfo {
    fn candidate(candidate: &Candidate, stage: &'static str) -> Self {
        Self { current_version: candidate.update.current_version.clone(), version: Some(candidate.update.version.clone()), token: Some(candidate.token), stage, installer_restarts: cfg!(windows) }
    }
}
struct UpdateLease { inner: Arc<Inner>, release_to: u8 }
impl UpdateLease {
    fn acquire(state: &UpdateState, phase: u8) -> Result<Self, String> {
        state.0.phase.compare_exchange(IDLE, phase, Ordering::SeqCst, Ordering::SeqCst).map_err(|_| "更新任务正在运行，请稍后重试")?;
        Ok(Self { inner: state.0.clone(), release_to: IDLE })
    }
}
impl Drop for UpdateLease { fn drop(&mut self) { self.inner.phase.store(self.release_to, Ordering::SeqCst); } }
fn candidate(cache: &Option<Candidate>, token: u64) -> Result<&Candidate, String> {
    cache.as_ref().filter(|c| c.token == token).ok_or_else(|| "更新信息已失效，请重新检查".into())
}
fn validate_download(update: &Update) -> Result<(), String> {
    let url = &update.download_url;
    let expected = format!("/yaho7/texgo/releases/download/v{}/texgo_{}_", update.version, update.version);
    if url.scheme() != "https" || url.host_str() != Some("github.com") || !url.username().is_empty() || url.password().is_some() || url.port().is_some() || url.query().is_some() || url.fragment().is_some() || !url.path().starts_with(&expected) || update.signature.trim().is_empty() {
        return Err("更新来源或签名信息无效，未下载更新".into());
    }
    Ok(())
}
#[tauri::command]
pub(crate) async fn check_application_update(app: tauri::AppHandle, state: State<'_, UpdateState>) -> Result<UpdateInfo, String> {
    if state.0.phase.load(Ordering::SeqCst) == INSTALLED {
        let cache = state.0.candidate.lock().map_err(|_| "更新状态不可用")?;
        return cache.as_ref().map(|c| UpdateInfo::candidate(c, "installed")).ok_or_else(|| "更新状态不可用".into());
    }
    let _lease = UpdateLease::acquire(&state, CHECKING)?;
    let updater = app.updater_builder().timeout(Duration::from_secs(12))
        .configure_client(|client| client.https_only(true)).build().map_err(|e| e.to_string())?;
    let update = updater.check().await.map_err(|e| format!("无法检查更新：{e}"))?;
    let mut cache = state.0.candidate.lock().map_err(|_| "更新状态不可用")?;
    *cache = None;
    match update {
        Some(mut update) => {
            validate_download(&update)?;
            update.timeout = Some(Duration::from_secs(180));
            let entry = Candidate { token: state.0.next.fetch_add(1, Ordering::SeqCst) + 1, update, bytes: None };
            let info = UpdateInfo::candidate(&entry, "available"); *cache = Some(entry); Ok(info)
        },
        None => Ok(UpdateInfo { current_version: app.package_info().version.to_string(), version: None, token: None, stage: "current", installer_restarts: cfg!(windows) }),
    }
}
#[tauri::command]
pub(crate) async fn download_application_update(token: u64, state: State<'_, UpdateState>) -> Result<UpdateInfo, String> {
    let _lease = UpdateLease::acquire(&state, DOWNLOADING)?;
    let update = { let cache = state.0.candidate.lock().map_err(|_| "更新状态不可用")?; candidate(&cache, token)?.update.clone() };
    validate_download(&update)?;
    // The official plugin verifies both package and signed version before returning bytes.
    let bytes = update.download(|_, _| {}, || {}).await.map_err(|e| format!("下载或签名验证失败，未安装更新：{e}"))?;
    let mut cache = state.0.candidate.lock().map_err(|_| "更新状态不可用")?;
    candidate(&cache, token)?;
    let entry = cache.as_mut().ok_or("更新信息已失效")?;
    entry.bytes = Some(bytes);
    Ok(UpdateInfo::candidate(entry, "ready"))
}
#[tauri::command]
pub(crate) async fn install_application_update(token: u64, app: tauri::AppHandle, state: State<'_, UpdateState>) -> Result<UpdateInfo, String> {
    let mut lease = UpdateLease::acquire(&state, INSTALLING)?;
    let native = app.state::<crate::commands::AppState>().inner().clone();
    let updates = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        crate::commands::with_update_workspace(&native, || {
            let mut cache = updates.0.candidate.lock().map_err(|_| "更新状态不可用")?;
            let entry = candidate(&cache, token)?;
            let bytes = entry.bytes.as_ref().ok_or("请先下载并验证更新")?;
            // install() verifies again immediately before platform installation.
            entry.update.install(bytes).map_err(|e| format!("安装更新失败：{e}"))?;
            let info = UpdateInfo::candidate(entry, "installed");
            if let Some(entry) = cache.as_mut() { entry.bytes = None; }
            lease.release_to = INSTALLED;
            Ok(info)
        })
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
pub(crate) async fn restart_after_update(app: tauri::AppHandle, state: State<'_, UpdateState>) -> Result<(), String> {
    if state.0.phase.load(Ordering::SeqCst) != INSTALLED { return Err("尚未安装更新".into()); }
    let native = app.state::<crate::commands::AppState>().inner().clone();
    tauri::async_runtime::spawn_blocking(move || crate::commands::with_update_workspace(&native, || app.restart())).await.map_err(|e| e.to_string())?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn update_leases_exclude_competing_actions_and_release_after_errors() {
        let state = UpdateState::default();
        let lease = UpdateLease::acquire(&state, DOWNLOADING).unwrap();
        assert!(UpdateLease::acquire(&state, CHECKING).is_err());
        assert!(UpdateLease::acquire(&state, INSTALLING).is_err());
        drop(lease);
        assert!(UpdateLease::acquire(&state, CHECKING).is_ok());
    }
    #[test]
    fn installed_updates_cannot_be_replaced_or_installed_twice() {
        let state = UpdateState::default();
        let mut lease = UpdateLease::acquire(&state, INSTALLING).unwrap();
        lease.release_to = INSTALLED; drop(lease);
        assert!(UpdateLease::acquire(&state, CHECKING).is_err());
        assert!(UpdateLease::acquire(&state, INSTALLING).is_err());
        assert!(candidate(&None, 1).is_err());
    }
}

#[cfg(all(test, feature = "updater-tests"))]
mod signature_tests {
    use super::*;
    #[test]
    fn official_plugin_verifies_real_signed_bytes_and_rejects_forged_version() {
        let config: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let mut context = tauri::test::mock_context(tauri::test::noop_assets());
        context.config_mut().plugins.0.insert("updater".into(), config["plugins"]["updater"].clone());
        let app = tauri::test::mock_builder().plugin(tauri_plugin_updater::Builder::new().pubkey(config["plugins"]["updater"]["pubkey"].as_str().unwrap()).build())
            .build(context).unwrap();
        let updater = app.updater_builder().version_comparator(|_, _| true).target("test")
            .endpoints(vec!["https://github.com/yaho7/texgo/releases/latest/download/latest.json".parse().unwrap()]).unwrap()
            .executable_path("/tmp/Texgo.app/Contents/MacOS/texgo").build().unwrap();
        let signature = include_str!("../../tests/fixtures/updater-payload.txt.sig").trim();
        let mut metadata = serde_json::json!({"version":"0.4.0", "platforms":{"test":{"url":"https://github.com/yaho7/texgo/releases/download/v0.4.0/texgo_0.4.0_test", "signature":signature}}});
        let update = updater.restore_update(metadata.clone()).unwrap().unwrap();
        update.verify(include_bytes!("../../tests/fixtures/updater-payload.txt")).unwrap();
        assert!(update.verify(b"tampered").is_err());
        assert!(validate_download(&update).is_ok());
        let mut wrong_origin = update.clone(); wrong_origin.download_url = "http://example.com/update".parse().unwrap();
        assert!(validate_download(&wrong_origin).is_err());
        metadata["version"] = serde_json::json!("0.5.0");
        let forged = updater.restore_update(metadata).unwrap().unwrap();
        assert!(forged.verify(include_bytes!("../../tests/fixtures/updater-payload.txt")).is_err());
    }
}
