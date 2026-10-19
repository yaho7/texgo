//! Shared outcome policy. Desktop adapters own OS integration; Workspace owns mutations.
use crate::{preferences::Preferences, ConversionResult};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NotificationTarget {
    pub mode: String,
    pub path: String,
    pub recursive: bool,
    pub view: String,
    pub batch_id: Option<String>,
    pub image_id: Option<String>,
}

#[derive(Debug, PartialEq)]
pub struct Notice {
    pub title: String,
    pub body: String,
}

pub fn result_notice(result: &ConversionResult, prefs: &Preferences) -> Option<Notice> {
    if result.cancelled { return None; }
    let succeeded = result.images.iter().filter(|i| i.pdf_path.is_some() && i.error.is_none()).count();
    let failed = result.images.len() - succeeded;
    if failed > 0 && prefs.notify_failure {
        Some(Notice { title: format!("Texgo · 转换完成，但有 {failed} 项失败"), body: format!("{succeeded} 张成功，{failed} 张失败") })
    } else if failed == 0 && succeeded > 0 && prefs.notify_success {
        Some(Notice { title: "Texgo · 转换完成".into(), body: format!("已更新 {succeeded} 张图片") })
    } else if result.images.is_empty() && prefs.notify_unchanged {
        Some(Notice { title: "Texgo · 无需转换".into(), body: "当前工作区没有需要更新的图片".into() })
    } else { None }
}

// Isolated registrar makes replacement/rollback testable without grabbing real OS hotkeys.
pub trait ShortcutRegistrar {
    fn register(&self, shortcut: &str) -> Result<(), String>;
    fn unregister(&self, shortcut: &str) -> Result<(), String>;
}
pub fn replace_shortcut(registrar: &impl ShortcutRegistrar, current: &mut Option<String>, next: Option<String>) -> Result<(), String> {
    if *current == next { return Ok(()); }
    let previous = current.clone();
    if let Some(old) = &previous { registrar.unregister(old)?; }
    *current = None;
    if let Some(new) = &next {
        if let Err(error) = registrar.register(new) {
            if let Some(old) = previous {
                if let Err(restore) = registrar.register(&old) { return Err(format!("{error}；旧快捷键恢复失败：{restore}")); }
                *current = Some(old);
            }
            return Err(error);
        }
    }
    *current = next;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    struct Fake(RefCell<Vec<String>>);
    impl ShortcutRegistrar for Fake {
        fn register(&self, key: &str) -> Result<(), String> { self.0.borrow_mut().push(format!("+{key}")); if key == "taken" { Err("占用".into()) } else { Ok(()) } }
        fn unregister(&self, key: &str) -> Result<(), String> { self.0.borrow_mut().push(format!("-{key}")); Ok(()) }
    }
    #[test]
    fn shortcut_register_modify_disable_deduplicate_and_rollback() {
        let fake = Fake(RefCell::new(vec![])); let mut current = None;
        replace_shortcut(&fake, &mut current, Some("a".into())).unwrap();
        replace_shortcut(&fake, &mut current, Some("a".into())).unwrap();
        replace_shortcut(&fake, &mut current, Some("b".into())).unwrap();
        assert!(replace_shortcut(&fake, &mut current, Some("taken".into())).is_err());
        assert_eq!(current.as_deref(), Some("b"));
        replace_shortcut(&fake, &mut current, None).unwrap();
        assert_eq!(*fake.0.borrow(), vec!["+a", "-a", "+b", "-b", "+taken", "+b", "-b"]);
    }
    #[test]
    fn notification_policy_covers_success_failure_partial_and_unchanged() {
        let mut prefs = Preferences::default();
        let success = crate::ConvertedImage { id: "a".into(), pdf_path: Some("a.pdf".into()), bytes: Some(1), cached: false, error: None };
        let failure = crate::ConvertedImage { error: Some("failed".into()), pdf_path: None, ..success.clone() };
        let result = |images| ConversionResult { images, cancelled: false };
        assert_eq!(result_notice(&result(vec![success.clone()]), &prefs).unwrap().body, "已更新 1 张图片");
        assert_eq!(result_notice(&result(vec![failure.clone()]), &prefs).unwrap().body, "0 张成功，1 张失败");
        assert_eq!(result_notice(&result(vec![success, failure]), &prefs).unwrap().body, "1 张成功，1 张失败");
        assert!(result_notice(&result(vec![]), &prefs).is_none());
        prefs.notify_unchanged = true;
        assert!(result_notice(&result(vec![]), &prefs).unwrap().title.contains("无需转换"));
        prefs.notify_success = false; prefs.notify_failure = false;
        assert!(result_notice(&result(vec![crate::ConvertedImage { id: "a".into(), pdf_path: None, bytes: None, cached: false, error: Some("x".into()) }]), &prefs).is_none());
        assert!(result_notice(&ConversionResult { images: vec![], cancelled: true }, &prefs).is_none());
    }
}
