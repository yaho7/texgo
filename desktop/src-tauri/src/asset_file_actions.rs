use std::path::Path;
use serde::Deserialize;
use crate::Workspace;

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum AssetFileAction { Reveal, RevealPdf, CopyPath }

pub(crate) trait FileActionPort {
    fn reveal(&self, path: &Path) -> Result<(), String>;
    fn copy_path(&self, path: &str) -> Result<(), String>;
}

pub(crate) fn dispatch(workspace: &Workspace, image_id: &str, expected_main_file: &str, action: AssetFileAction, port: &impl FileActionPort) -> Result<(), String> {
    let path = match action { AssetFileAction::RevealPdf => workspace.asset_pdf_path(image_id, expected_main_file)?, _ => workspace.asset_path(image_id, expected_main_file)? };
    match action {
        AssetFileAction::Reveal | AssetFileAction::RevealPdf => port.reveal(&path),
        AssetFileAction::CopyPath => port.copy_path(path.to_str().ok_or("图片路径无法表示为文本")?),
    }
}

#[cfg(feature = "desktop")]
pub(crate) struct NativeFileActions(pub tauri::AppHandle);
#[cfg(feature = "desktop")]
impl FileActionPort for NativeFileActions {
    fn reveal(&self, path: &Path) -> Result<(), String> {
        use tauri_plugin_opener::OpenerExt;
        self.0.opener().reveal_item_in_dir(path).map_err(|error| format!("无法在文件管理器中显示图片：{error}"))
    }
    fn copy_path(&self, path: &str) -> Result<(), String> {
        use tauri_plugin_clipboard_manager::ClipboardExt;
        self.0.clipboard().write_text(path).map_err(|error| format!("无法复制图片路径：{error}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{cell::RefCell, fs};
    #[derive(Default)]
    struct FakePort { calls: RefCell<Vec<(String, String)>>, fail: bool }
    impl FileActionPort for FakePort {
        fn reveal(&self, path: &Path) -> Result<(), String> {
            self.calls.borrow_mut().push(("reveal".into(), path.to_str().unwrap().into()));
            if self.fail { Err("file manager unavailable".into()) } else { Ok(()) }
        }
        fn copy_path(&self, path: &str) -> Result<(), String> {
            self.calls.borrow_mut().push(("copy".into(), path.into()));
            if self.fail { Err("clipboard unavailable".into()) } else { Ok(()) }
        }
    }
    #[test]
    fn dispatches_only_validated_paths_and_propagates_platform_errors() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().canonicalize().unwrap();
        let path = root.join("plot.png");
        image::RgbImage::new(2, 2).save(&path).unwrap();
        fs::write(root.join("main.tex"), "\\includegraphics{plot.png}").unwrap();
        let workspace = Workspace::open(&root.join("main.tex")).unwrap();
        let id = &workspace.project().images[0].id;
        let main = &workspace.project().main_file;
        let port = FakePort::default();
        dispatch(&workspace, id, main, AssetFileAction::Reveal, &port).unwrap();
        dispatch(&workspace, id, main, AssetFileAction::CopyPath, &port).unwrap();
        assert_eq!(*port.calls.borrow(), vec![("reveal".into(), path.to_str().unwrap().into()), ("copy".into(), path.to_str().unwrap().into())]);
        assert!(dispatch(&workspace, "unknown", main, AssetFileAction::Reveal, &port).is_err());
        assert_eq!(port.calls.borrow().len(), 2);
        let unavailable = FakePort { fail: true, ..Default::default() };
        assert_eq!(dispatch(&workspace, id, main, AssetFileAction::CopyPath, &unavailable).unwrap_err(), "clipboard unavailable");
        fs::remove_file(&path).unwrap();
        assert!(dispatch(&workspace, id, main, AssetFileAction::Reveal, &port).is_err());
        assert_eq!(port.calls.borrow().len(), 2);
    }
    #[test]
    fn reveals_only_a_live_managed_pdf_for_the_expected_project() {
        let dir = tempfile::tempdir().unwrap(); let root = dir.path().canonicalize().unwrap();
        image::RgbImage::new(2, 2).save(root.join("plot.png")).unwrap();
        fs::write(root.join("main.tex"), "\\includegraphics{plot.png}").unwrap();
        let mut ws = Workspace::open(&root.join("main.tex")).unwrap();
        let id = ws.project().images[0].id.clone(); let main = ws.project().main_file.clone();
        let options = crate::ConversionOptions { image_ids: vec![id.clone()], quality: "custom".into(), dpi: 300, jpeg_quality: 100, output_dir: "pdf".into() };
        let result = ws.convert(&options, &std::sync::atomic::AtomicBool::new(false), |_| {}).unwrap();
        let pdf = result.images[0].pdf_path.as_ref().unwrap(); let port = FakePort::default();
        dispatch(&ws, &id, &main, AssetFileAction::RevealPdf, &port).unwrap();
        assert_eq!(port.calls.borrow()[0], ("reveal".into(), pdf.clone()));
        assert!(dispatch(&ws, &id, "another.tex", AssetFileAction::RevealPdf, &port).is_err());
        fs::remove_file(pdf).unwrap();
        assert!(dispatch(&ws, &id, &main, AssetFileAction::RevealPdf, &port).is_err());
        assert_eq!(port.calls.borrow().len(), 1);
    }

}
