use std::{fs, sync::atomic::AtomicBool};
use texgo_desktop::{IgnoreMode, NextAction, Workspace};

fn fixture() -> (tempfile::TempDir, std::path::PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().canonicalize().unwrap();
    image::RgbImage::new(8, 8).save(root.join("a.png")).unwrap();
    fs::write(root.join("main.tex"), "\\includegraphics{a.png}\n\\includegraphics{missing}\n").unwrap();
    (dir, root)
}

#[test]
fn session_ignore_refreshes_status_but_does_not_persist_across_reopen() {
    let (_dir, root) = fixture();
    let mut ws = Workspace::open(&root.join("main.tex")).unwrap();
    let id = ws.project().images.iter().find(|asset| asset.status == "ready").unwrap().id.clone();
    let project = ws.set_ignore_mode(&id, IgnoreMode::Session).unwrap();
    assert_eq!(project.status.pending_images, 0);
    assert_eq!(project.images.iter().find(|a| a.id == id).unwrap().ignore_mode, IgnoreMode::Session);
    assert!(!root.join(".texgo/ignore.json").exists());
    ws.refresh().unwrap();
    assert_eq!(ws.project().status.pending_images, 0);
    let reopened = Workspace::open(&root.join("main.tex")).unwrap();
    assert_eq!(reopened.project().status.pending_images, 1);
    assert_eq!(reopened.project().images.iter().find(|a| a.id == id).unwrap().ignore_mode, IgnoreMode::None);
}

#[test]
fn permanent_ignore_excludes_pending_problems_and_smart_convert_after_reopen() {
    let (_dir, root) = fixture();
    let tex = fs::read(root.join("main.tex")).unwrap();
    let source = fs::read(root.join("a.png")).unwrap();
    let mut ws = Workspace::open(&root.join("main.tex")).unwrap();
    let ids: Vec<_> = ws.project().images.iter().map(|a| a.id.clone()).collect();
    for id in &ids { ws.set_ignore_mode(id, IgnoreMode::Permanent).unwrap(); }
    drop(ws);
    let mut reopened = Workspace::open(&root.join("main.tex")).unwrap();
    assert_eq!(reopened.project().status.pending_images, 0);
    assert_eq!(reopened.project().status.problem_count, 0);
    assert_eq!(reopened.project().status.ignored_count, 2);
    assert_eq!(reopened.project().status.next_action, NextAction::UpToDate);
    assert!(reopened.project().images.iter().all(|a| a.ignore_mode == IgnoreMode::Permanent));
    let options = texgo_desktop::preferences::Preferences::default().options(vec![]);
    let result = reopened.update_pending_with_results(&options, &AtomicBool::new(false), |_| {}, |_| {}).unwrap();
    assert!(result.images.is_empty());
    assert_eq!(fs::read(root.join("main.tex")).unwrap(), tex);
    assert_eq!(fs::read(root.join("a.png")).unwrap(), source);
}

#[test]
fn restore_deletes_persistent_rules_and_survives_reopen() {
    let (_dir, root) = fixture();
    let mut ws = Workspace::open(&root.join("main.tex")).unwrap();
    let id = ws.project().images.iter().find(|a| a.status == "missing").unwrap().id.clone();
    ws.set_ignore_mode(&id, IgnoreMode::Permanent).unwrap();
    assert_eq!(ws.project().status.problem_count, 0);
    ws.set_ignore_mode(&id, IgnoreMode::None).unwrap();
    assert_eq!(ws.project().status.problem_count, 1);
    let value: serde_json::Value = serde_json::from_slice(&fs::read(root.join(".texgo/ignore.json")).unwrap()).unwrap();
    assert_eq!(value["entries"].as_array().unwrap().len(), 0);
    assert_eq!(Workspace::open(&root.join("main.tex")).unwrap().project().status.problem_count, 1);
}

#[test]
fn permanent_path_remains_ignored_after_file_is_removed_and_reference_line_changes() {
    let (_dir, root) = fixture();
    let mut ws = Workspace::open(&root.join("main.tex")).unwrap();
    let id = ws.project().images.iter().find(|a| a.status == "ready").unwrap().id.clone();
    ws.set_ignore_mode(&id, IgnoreMode::Permanent).unwrap();
    fs::remove_file(root.join("a.png")).unwrap();
    fs::write(root.join("main.tex"), "\n\n\\includegraphics{a.png}\n").unwrap();
    let mut reopened = Workspace::open(&root.join("main.tex")).unwrap();
    assert_eq!(reopened.project().images[0].status, "missing");
    assert_eq!(reopened.project().images[0].ignore_mode, IgnoreMode::Permanent);
    assert_eq!(reopened.project().status.problem_count, 0);
    let missing_id = reopened.project().images[0].id.clone();
    reopened.set_ignore_mode(&missing_id, IgnoreMode::None).unwrap();
    assert_eq!(reopened.project().status.problem_count, 1);
}

#[test]
fn malformed_rules_surface_safety_blocker_and_cannot_be_silently_replaced() {
    let (_dir, root) = fixture();
    fs::create_dir_all(root.join(".texgo")).unwrap();
    fs::write(root.join(".texgo/ignore.json"), "corrupt").unwrap();
    let mut ws = Workspace::open(&root.join("main.tex")).unwrap();
    assert!(ws.project().status.blocking_reason.as_ref().is_some_and(|reason| reason.contains("忽略规则")));
    let id = ws.project().images[0].id.clone();
    assert!(ws.set_ignore_mode(&id, IgnoreMode::Permanent).is_err());
    assert_eq!(fs::read_to_string(root.join(".texgo/ignore.json")).unwrap(), "corrupt");
}
