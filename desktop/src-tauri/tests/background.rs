use std::{fs, sync::atomic::AtomicBool};
use texgo_desktop::{ConversionOptions, Workspace};

#[test]
fn unchanged_poll_is_cheap_and_changed_sources_are_rehydrated() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("plot.png");
    image::RgbImage::from_pixel(20, 10, image::Rgb([1, 2, 3])).save(&path).unwrap();
    let mut workspace = Workspace::open_directory(dir.path(), true).unwrap();
    assert!(workspace.poll_changes().unwrap().is_none());
    let options = ConversionOptions { image_ids: vec![workspace.project().images[0].id.clone()], quality: "custom".into(), dpi: 300, jpeg_quality: 90, output_dir: "pdf".into() };
    workspace.convert(&options, &AtomicBool::new(false), |_| {}).unwrap();
    let _ = workspace.poll_changes().unwrap();
    assert!(workspace.poll_changes().unwrap().is_none());
    image::RgbImage::from_pixel(30, 10, image::Rgb([4, 5, 6])).save(&path).unwrap();
    let project = workspace.poll_changes().unwrap().unwrap();
    assert!(project.images[0].update_available);
    assert!(project.converted_images.is_empty());
    assert!(workspace.poll_changes().unwrap().is_none());
    image::RgbImage::from_pixel(10, 10, image::Rgb([1, 2, 3])).save(dir.path().join("new.png")).unwrap();
    assert_eq!(workspace.poll_changes().unwrap().unwrap().images.len(), 2);
    fs::remove_file(path).unwrap();
    assert_eq!(workspace.poll_changes().unwrap().unwrap().images.len(), 1);
}

#[test]
fn ignored_session_survives_refresh_without_editing_tex_and_review_blocks_next_batch() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("main.tex"), r"\includegraphics{plot.png}\includegraphics{missing}").unwrap();
    image::RgbImage::new(20, 10).save(dir.path().join("plot.png")).unwrap();
    let before = fs::read(dir.path().join("main.tex")).unwrap();
    let mut ws = Workspace::open(&dir.path().join("main.tex")).unwrap();
    let missing = ws.project().images.iter().find(|a| a.status == "missing").unwrap().id.clone();
    ws.ignore(&missing, true).unwrap();
    ws.refresh().unwrap();
    assert!(ws.ignored().contains(&missing));
    let id = ws.project().images.iter().find(|a| a.status == "ready").unwrap().id.clone();
    ws.convert(&ConversionOptions { image_ids: vec![id], quality: "custom".into(), dpi: 300, jpeg_quality: 90, output_dir: "pdf".into() }, &AtomicBool::new(false), |_| {}).unwrap();
    assert!(ws.ensure_can_convert(false).is_err());
    assert!(ws.ensure_can_convert(true).is_ok());
    assert_eq!(fs::read(dir.path().join("main.tex")).unwrap(), before);
    ws.ignore(&missing, false).unwrap();
    assert!(ws.ignored().is_empty());
}

fn make_png(root: &std::path::Path, name: &str, color: u8) {
    image::RgbImage::from_pixel(20, 10, image::Rgb([color, 2, 3])).save(root.join(name)).unwrap();
}
fn managed_pair() -> (tempfile::TempDir, Workspace) {
    let dir = tempfile::tempdir().unwrap();
    make_png(dir.path(), "a.png", 1); make_png(dir.path(), "b.png", 1);
    let mut ws = Workspace::open_directory(dir.path(), true).unwrap();
    let ids = ws.project().images.iter().map(|a| a.id.clone()).collect();
    ws.convert(&ConversionOptions { image_ids: ids, quality: "custom".into(), dpi: 300, jpeg_quality: 90, output_dir: "original-output".into() }, &AtomicBool::new(false), |_| {}).unwrap();
    (dir, ws)
}
#[test]
fn smart_refreshes_and_converts_only_changed_managed_images_to_original_output() {
    let (dir, mut ws) = managed_pair();
    make_png(dir.path(), "a.png", 200); make_png(dir.path(), "new.png", 100);
    let before_b = fs::read(dir.path().join("original-output/b.pdf")).unwrap();
    let mut prefs = texgo_desktop::preferences::Preferences::default(); prefs.output_dir = "other".into();
    let report = ws.smart_convert(&prefs, &AtomicBool::new(false), |_| {}, |_| {}).unwrap();
    assert_eq!(report.result.images.len(), 1);
    assert!(report.result.images[0].pdf_path.as_ref().unwrap().contains("original-output"));
    assert_eq!(report.batch_ids.len(), 1);
    assert!(!dir.path().join("other").exists());
    assert_eq!(fs::read(dir.path().join("original-output/b.pdf")).unwrap(), before_b);
    ws.undo_conversion(&report.batch_ids[0]).unwrap();
    assert!(ws.project().images.iter().any(|a| a.update_available));
}
#[test]
fn smart_unchanged_does_not_create_a_batch_and_ignored_changes_are_skipped() {
    let (dir, mut ws) = managed_pair();
    let prefs = texgo_desktop::preferences::Preferences::default();
    let count = ws.conversion_history().unwrap().len();
    assert!(ws.smart_convert(&prefs, &AtomicBool::new(false), |_| {}, |_| {}).unwrap().result.images.is_empty());
    make_png(dir.path(), "a.png", 9);
    let id = ws.project().images.iter().find(|a| a.relative_path == "a.png").unwrap().id.clone();
    ws.ignore(&id, true).unwrap();
    assert!(ws.smart_convert(&prefs, &AtomicBool::new(false), |_| {}, |_| {}).unwrap().result.images.is_empty());
    assert_eq!(ws.conversion_history().unwrap().len(), count);
}
#[test]
fn smart_partial_failure_retains_success_and_recovery_history() {
    let (dir, mut ws) = managed_pair();
    make_png(dir.path(), "a.png", 20); fs::write(dir.path().join("b.png"), b"broken image").unwrap();
    let report = ws.smart_convert(&texgo_desktop::preferences::Preferences::default(), &AtomicBool::new(false), |_| {}, |_| {}).unwrap();
    assert_eq!(report.result.images.len(), 2);
    assert_eq!(report.result.images.iter().filter(|i| i.error.is_some()).count(), 1);
    assert_eq!(report.result.images.iter().filter(|i| i.pdf_path.is_some()).count(), 1);
    assert_eq!(ws.conversion_history().unwrap()[0].files.len(), 2);
}
#[test]
fn smart_reports_pending_references_without_writing_another_batch() {
    let (dir, _) = managed_pair();
    fs::write(dir.path().join("main.tex"), r"\includegraphics{a.png}\includegraphics{missing}").unwrap();
    let mut ws = Workspace::open(&dir.path().join("main.tex")).unwrap();
    let count = ws.conversion_history().unwrap().len();
    let report = ws.smart_convert(&texgo_desktop::preferences::Preferences::default(), &AtomicBool::new(false), |_| {}, |_| {}).unwrap();
    assert!(report.pending_references > 0);
    assert_eq!(report.problem_ids.len(), 1);
    assert!(report.result.images.is_empty());
    assert_eq!(ws.conversion_history().unwrap().len(), count);
}
#[test]
fn smart_never_overwrites_an_edited_managed_output() {
    let (dir, mut ws) = managed_pair();
    make_png(dir.path(), "a.png", 10); fs::write(dir.path().join("original-output/a.pdf"), b"user edited PDF").unwrap();
    let report = ws.smart_convert(&texgo_desktop::preferences::Preferences::default(), &AtomicBool::new(false), |_| {}, |_| {}).unwrap();
    assert_eq!(report.problem_ids.len(), 1);
    assert!(report.result.images.is_empty());
    assert_eq!(fs::read(dir.path().join("original-output/a.pdf")).unwrap(), b"user edited PDF");
}
