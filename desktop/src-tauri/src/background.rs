//! Shared outcome policy. Desktop adapters own OS integration; Workspace owns mutations.
use crate::{preferences::Preferences, ConversionResult, NextAction, WorkspaceStatus};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NotificationTarget {
    pub path: String,
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
        Some(Notice { title: format!("Texgo · 更新完成，但有 {failed} 项失败"), body: format!("{succeeded} 张成功，{failed} 张失败") })
    } else if failed == 0 && succeeded > 0 && prefs.notify_success {
        Some(Notice { title: "Texgo · 图片已更新".into(), body: format!("已更新 {succeeded} 张图片") })
    } else if result.images.is_empty() && prefs.notify_unchanged {
        Some(Notice { title: "Texgo · 项目已是最新".into(), body: "当前项目没有需要更新的图片".into() })
    } else { None }
}

/// Notification follow-up comes from exactly the same next action shown in the window.
pub fn workspace_notice(status: &WorkspaceStatus, result: &ConversionResult, prefs: &Preferences) -> Option<Notice> {
    if result.cancelled { return None; }
    if let Some(reason) = &status.blocking_reason {
        return prefs.notify_failure.then(|| Notice { title: "Texgo · 项目需要处理安全问题".into(), body: reason.clone() });
    }
    if result.images.is_empty() && status.next_action != NextAction::UpToDate { return None; }
    let mut notice = result_notice(result, prefs)?;
    if status.next_action == NextAction::ReviewReferences && result.images.iter().all(|image| image.error.is_none()) {
        notice.body = format!("已更新 {} 张图片，{} 处引用等待确认", result.images.len(), status.pending_references);
    } else if status.next_action == NextAction::UpToDate && result.images.is_empty() {
        notice.body = "项目已是最新状态".into();
    }
    Some(notice)
}

pub fn status_label(status: &WorkspaceStatus) -> String {
    if status.blocking_reason.is_some() { return "项目需要处理安全问题".into(); }
    match status.next_action {
        NextAction::ReviewReferences => format!("{} 处引用等待确认", status.pending_references),
        NextAction::ConvertImages => format!("{} 张图片需要更新", status.pending_images),
        NextAction::ResolveProblems => format!("{} 个问题需要处理", status.problem_count),
        NextAction::UpToDate => "项目已是最新状态".into(),
    }
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
        assert!(result_notice(&result(vec![]), &prefs).unwrap().title.contains("项目已是最新"));
        prefs.notify_success = false; prefs.notify_failure = false;
        assert!(result_notice(&result(vec![crate::ConvertedImage { id: "a".into(), pdf_path: None, bytes: None, cached: false, error: Some("x".into()) }]), &prefs).is_none());
        assert!(result_notice(&ConversionResult { images: vec![], cancelled: true }, &prefs).is_none());
    }
}

#[cfg(test)]
mod workspace_status_tests {
    use super::*;
    #[test]
    fn notifications_and_tray_describe_the_same_next_action_as_the_window() {
        let prefs = Preferences::default();
        let result = ConversionResult { images: vec![crate::ConvertedImage {
            id: "image".into(), pdf_path: Some("image.pdf".into()), bytes: Some(10), cached: false, error: None,
        }], cancelled: false };
        let status = WorkspaceStatus { next_action: NextAction::ReviewReferences, pending_references: 3, ..Default::default() };
        assert_eq!(status_label(&status), "3 处引用等待确认");
        assert_eq!(workspace_notice(&status, &result, &prefs).unwrap().body, "已更新 1 张图片，3 处引用等待确认");
        let status = WorkspaceStatus { next_action: NextAction::ConvertImages, pending_images: 2, ..Default::default() };
        assert_eq!(status_label(&status), "2 张图片需要更新");
        let status = WorkspaceStatus { next_action: NextAction::ResolveProblems, problem_count: 1, ..Default::default() };
        assert_eq!(status_label(&status), "1 个问题需要处理");
        assert_eq!(status_label(&WorkspaceStatus::default()), "项目已是最新状态");
    }
}

#[cfg(test)]
mod blocked_notice_tests {
    use super::*;
    #[test]
    fn no_change_notification_never_claims_blocked_or_pending_projects_are_current() {
        let prefs = Preferences { notify_unchanged: true, ..Default::default() };
        let empty = ConversionResult { images: vec![], cancelled: false };
        let status = WorkspaceStatus { next_action: NextAction::ConvertImages, pending_images: 1, ..Default::default() };
        assert!(workspace_notice(&status, &empty, &prefs).is_none());
        let status = WorkspaceStatus { blocking_reason: Some("unsafe output".into()), ..Default::default() };
        let notice = workspace_notice(&status, &empty, &prefs).unwrap();
        assert!(notice.title.contains("安全问题"));
        assert_eq!(notice.body, "unsafe output");
        let muted = Preferences { notify_failure: false, ..prefs };
        assert!(workspace_notice(&status, &empty, &muted).is_none());
        assert!(workspace_notice(&WorkspaceStatus::default(), &empty, &muted).unwrap().body.contains("最新"));
    }
}
