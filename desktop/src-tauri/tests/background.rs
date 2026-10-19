use std::{fs, sync::atomic::AtomicBool};
use texgo_desktop::{ConversionOptions, Workspace};

#[test]
fn unchanged_poll_is_cheap_and_changed_sources_are_rehydrated() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("plot.png");
    image::RgbImage::from_pixel(20, 10, image::Rgb([1, 2, 3])).save(&path).unwrap();
    fs::write(dir.path().join("main.tex"), r"\includegraphics{plot.png}").unwrap();
    let mut workspace = Workspace::open(&dir.path().join("main.tex")).unwrap();
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
    fs::write(dir.path().join("main.tex"), r"\includegraphics{plot.png}\includegraphics{new.png}").unwrap();
    assert_eq!(workspace.poll_changes().unwrap().unwrap().images.len(), 2);
    fs::remove_file(path).unwrap();
    let project = workspace.poll_changes().unwrap().unwrap();
    assert_eq!(project.images.len(), 2);
    assert_eq!(project.status.problem_count, 1);
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
    fs::write(dir.path().join("main.tex"), r"\includegraphics{a.png}\includegraphics{b.png}").unwrap();
    let mut ws = Workspace::open(&dir.path().join("main.tex")).unwrap();
    let ids = ws.project().images.iter().map(|a| a.id.clone()).collect();
    ws.convert(&ConversionOptions { image_ids: ids, quality: "custom".into(), dpi: 300, jpeg_quality: 90, output_dir: "original-output".into() }, &AtomicBool::new(false), |_| {}).unwrap();
    let plan = ws.plan().unwrap();
    let selection = plan.files.iter().flat_map(|file| file.changes.iter().map(|change| change.id.clone())).collect();
    ws.apply_reviewed(selection, &plan, false).unwrap();
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

#[test]
fn repaired_source_is_retried_after_a_failed_smart_conversion() {
    let (dir, mut ws) = managed_pair();
    fs::write(dir.path().join("a.png"), b"broken image").unwrap();
    let prefs = texgo_desktop::preferences::Preferences::default();
    let failed = ws.smart_convert(&prefs, &AtomicBool::new(false), |_| {}, |_| {}).unwrap();
    assert_eq!(failed.result.images.iter().filter(|i| i.error.is_some()).count(), 1);
    make_png(dir.path(), "a.png", 120);
    let recovered = ws.smart_convert(&prefs, &AtomicBool::new(false), |_| {}, |_| {}).unwrap();
    assert_eq!(recovered.result.images.len(), 1);
    assert!(recovered.result.images[0].pdf_path.is_some());
    assert!(recovered.result.images[0].error.is_none());
    assert!(!ws.project().images.iter().any(|a| a.update_available));
}

#[test]
fn workspace_status_prioritizes_review_then_pending_then_problems_and_ignores() {
    use texgo_desktop::NextAction;
    let dir = tempfile::tempdir().unwrap();
    make_png(dir.path(), "first.png", 1);
    make_png(dir.path(), "second.png", 2);
    fs::write(dir.path().join("main.tex"), r"\includegraphics{first.png}\includegraphics{second.png}\includegraphics{missing.png}").unwrap();
    let mut ws = Workspace::open(&dir.path().join("main.tex")).unwrap();
    assert_eq!(ws.project().status.next_action, NextAction::ConvertImages);
    assert_eq!(ws.project().status.pending_images, 2);
    assert_eq!(ws.project().status.problem_count, 1);
    assert!(ws.project().status.blocking_reason.is_none());
    let first = ws.project().images.iter().find(|asset| asset.relative_path == "first.png").unwrap().id.clone();
    ws.convert(&ConversionOptions { image_ids: vec![first.clone()], quality: "custom".into(), dpi: 300, jpeg_quality: 90, output_dir: "pdf".into() }, &AtomicBool::new(false), |_| {}).unwrap();
    assert_eq!(ws.project().status.next_action, NextAction::ReviewReferences);
    assert_eq!(ws.project().status.pending_references, ws.plan().unwrap().reference_count);
    assert_eq!(ws.project().status.completed_image_ids, vec![first.clone()]);
    ws.ignore(&first, true).unwrap();
    assert_eq!(ws.project().status.pending_references, 0);
    assert_eq!(ws.plan().unwrap().reference_count, 0);
    assert_eq!(ws.project().status.next_action, NextAction::ConvertImages);
    let second = ws.project().images.iter().find(|asset| asset.relative_path == "second.png").unwrap().id.clone();
    ws.ignore(&second, true).unwrap();
    assert_eq!(ws.project().status.next_action, NextAction::ResolveProblems);
    let missing = ws.project().status.problem_ids[0].clone();
    ws.ignore(&missing, true).unwrap();
    assert_eq!(ws.project().status.next_action, NextAction::UpToDate);
    assert_eq!(ws.project().status.ignored_count, 3);
    ws.refresh().unwrap();
    assert_eq!(ws.project().status.ignored_count, 3);
    assert_eq!(ws.project().status.next_action, NextAction::UpToDate);
}

#[test]
fn smart_first_conversion_uses_all_pending_and_reports_the_same_status_as_gui() {
    use texgo_desktop::NextAction;
    let dir = tempfile::tempdir().unwrap();
    make_png(dir.path(), "a.png", 1);
    make_png(dir.path(), "b.png", 2);
    fs::write(dir.path().join("main.tex"), r"\includegraphics{a.png}\includegraphics{b.png}").unwrap();
    let mut ws = Workspace::open(&dir.path().join("main.tex")).unwrap();
    let report = ws.smart_convert(&texgo_desktop::preferences::Preferences::default(), &AtomicBool::new(false), |_| {}, |_| {}).unwrap();
    assert_eq!(report.result.images.len(), 2);
    assert_eq!(report.project.status, ws.project().status);
    assert_eq!(report.project.status.next_action, NextAction::ReviewReferences);
    assert_eq!(report.pending_references, 2);
    let plan = ws.plan().unwrap();
    let selection = plan.files.iter().flat_map(|file| file.changes.iter().map(|change| change.id.clone())).collect();
    ws.apply_reviewed(selection, &plan, false).unwrap();
    assert_eq!(ws.project().status.next_action, NextAction::UpToDate);
    make_png(dir.path(), "a.png", 7);
    let update = ws.smart_convert(&texgo_desktop::preferences::Preferences::default(), &AtomicBool::new(false), |_| {}, |_| {}).unwrap();
    assert_eq!(update.result.images.len(), 1);
    assert_eq!(update.project.status.next_action, NextAction::UpToDate);
    assert_eq!(update.pending_references, 0);
    assert_eq!(ws.plan().unwrap().reference_count, 0);
}

#[test]
fn conversion_failure_stays_a_problem_on_refresh_and_reopen_until_source_changes() {
    use texgo_desktop::NextAction;
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("main.tex"), r"\includegraphics{broken.png}").unwrap();
    fs::write(dir.path().join("broken.png"), b"invalid raster bytes").unwrap();
    let mut ws = Workspace::open(&dir.path().join("main.tex")).unwrap();
    let report = ws.smart_convert(&texgo_desktop::preferences::Preferences::default(), &AtomicBool::new(false), |_| {}, |_| {}).unwrap();
    assert_eq!(report.project.status.next_action, NextAction::ResolveProblems);
    assert_eq!(report.project.status.problem_count, 1);
    ws.refresh().unwrap();
    assert_eq!(ws.project().status.problem_count, 1);
    let mut ws = Workspace::open(&dir.path().join("main.tex")).unwrap();
    assert_eq!(ws.project().status.problem_count, 1);
    make_png(dir.path(), "broken.png", 4);
    ws.refresh().unwrap();
    assert_eq!(ws.project().status.next_action, NextAction::ConvertImages);
    assert_eq!(ws.project().status.problem_count, 0);
}

#[test]
fn existing_pdf_is_completed_and_cancelled_unprocessed_images_stay_pending() {
    use texgo_desktop::NextAction;
    let dir = tempfile::tempdir().unwrap();
    make_png(dir.path(), "a.png", 1);
    fs::write(dir.path().join("existing.pdf"), b"%PDF-1.4\n").unwrap();
    fs::write(dir.path().join("main.tex"), r"\includegraphics{a.png}\includegraphics{existing.pdf}").unwrap();
    let mut ws = Workspace::open(&dir.path().join("main.tex")).unwrap();
    assert_eq!(ws.project().status.completed_images, 1);
    let options = texgo_desktop::preferences::Preferences::default().options(ws.project().status.pending_image_ids.clone());
    ws.convert(&options, &AtomicBool::new(true), |_| {}).unwrap();
    ws.refresh().unwrap();
    assert_eq!(ws.project().status.problem_count, 0);
    assert_eq!(ws.project().status.pending_images, 1);
    assert_eq!(ws.project().status.next_action, NextAction::ConvertImages);
}

#[test]
fn explicit_selection_and_default_pending_update_keep_managed_paths_and_global_progress() {
    use std::cell::RefCell;
    let (dir, mut ws) = managed_pair();
    make_png(dir.path(), "new.png", 10);
    let main = dir.path().join("main.tex");
    let content = fs::read_to_string(&main).unwrap();
    fs::write(&main, format!("{content}\\includegraphics{{new.png}}")).unwrap();
    make_png(dir.path(), "a.png", 200);
    ws.refresh().unwrap();
    let mut options = texgo_desktop::preferences::Preferences::default().options(vec![]);
    options.output_dir = "new-output".into();
    let progress = RefCell::new(Vec::new());
    let result = ws.update_pending_with_results(&options, &AtomicBool::new(false), |event| progress.borrow_mut().push((event.current, event.total)), |_| {}).unwrap();
    assert_eq!(result.images.len(), 2);
    assert!(result.images.iter().any(|image| image.pdf_path.as_ref().is_some_and(|path| path.ends_with("original-output/a.pdf"))));
    assert!(result.images.iter().any(|image| image.pdf_path.as_ref().is_some_and(|path| path.ends_with("new-output/new.pdf"))));
    assert!(!dir.path().join("new-output/a.pdf").exists());
    assert!(progress.borrow().iter().all(|(_, total)| *total == 2));
    assert_eq!(progress.borrow().last(), Some(&(2, 2)));

    let dir = tempfile::tempdir().unwrap();
    make_png(dir.path(), "a.png", 1);
    make_png(dir.path(), "b.png", 2);
    fs::write(dir.path().join("main.tex"), r"\includegraphics{a.png}\includegraphics{b.png}").unwrap();
    let mut ws = Workspace::open(&dir.path().join("main.tex")).unwrap();
    let id = ws.project().status.pending_image_ids[0].clone();
    let options = texgo_desktop::preferences::Preferences::default().options(vec![id.clone()]);
    let result = ws.update_pending_with_results(&options, &AtomicBool::new(false), |_| {}, |_| {}).unwrap();
    assert_eq!(result.images.len(), 1);
    assert_eq!(result.images[0].id, id);
    assert_eq!(ws.project().status.pending_images, 1);
    assert_eq!(ws.project().status.pending_references, 1);
}

#[test]
fn damaged_journal_is_a_visible_blocking_status_and_never_allows_writes() {
    let dir = tempfile::tempdir().unwrap();
    make_png(dir.path(), "a.png", 1);
    fs::write(dir.path().join("main.tex"), r"\includegraphics{a.png}").unwrap();
    fs::create_dir(dir.path().join(".texgo")).unwrap();
    fs::write(dir.path().join(".texgo/conversions.json"), "damaged").unwrap();
    let mut ws = Workspace::open(&dir.path().join("main.tex")).unwrap();
    assert!(ws.project().status.blocking_reason.is_some());
    let options = texgo_desktop::preferences::Preferences::default().options(vec![]);
    assert!(ws.update_pending_with_results(&options, &AtomicBool::new(false), |_| {}, |_| {}).is_err());
    assert!(!dir.path().join("texgo-pdf").exists());
}

#[test]
fn explicit_retry_after_only_fixing_output_conflict_survives_refresh_and_keeps_history() {
    let dir = tempfile::tempdir().unwrap();
    make_png(dir.path(), "a.png", 1);
    fs::write(dir.path().join("main.tex"), r"\includegraphics{a.png}").unwrap();
    fs::create_dir(dir.path().join("texgo-pdf")).unwrap();
    let output = dir.path().join("texgo-pdf/a.pdf");
    fs::write(&output, b"unrelated file").unwrap();
    let mut ws = Workspace::open(&dir.path().join("main.tex")).unwrap();
    let prefs = texgo_desktop::preferences::Preferences::default();
    let failure = ws.smart_convert(&prefs, &AtomicBool::new(false), |_| {}, |_| {}).unwrap();
    assert_eq!(failure.project.status.problem_count, 1);
    let id = failure.project.status.problem_ids[0].clone();
    let history = ws.conversion_history().unwrap();
    fs::remove_file(&output).unwrap();
    ws.retry_asset(&id).unwrap();
    ws.refresh().unwrap();
    assert_eq!(ws.project().status.pending_image_ids, vec![id]);
    assert_eq!(ws.project().status.problem_count, 0);
    assert_eq!(ws.conversion_history().unwrap().len(), history.len());
    assert!(ws.conversion_history().unwrap()[0].files[0].error.is_some());
    let result = ws.smart_convert(&prefs, &AtomicBool::new(false), |_| {}, |_| {}).unwrap();
    assert_eq!(result.result.images.len(), 1);
    assert!(result.result.images[0].error.is_none());
}

#[test]
fn explicit_retry_after_fixing_only_svg_dependency_can_succeed() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("main.tex"), r"\includegraphics{plot.svg}").unwrap();
    let svg = r#"<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><image href="embedded.png" width="20" height="10"/></svg>"#;
    fs::write(dir.path().join("plot.svg"), svg).unwrap();
    let mut ws = Workspace::open(&dir.path().join("main.tex")).unwrap();
    let prefs = texgo_desktop::preferences::Preferences::default();
    let failed = ws.smart_convert(&prefs, &AtomicBool::new(false), |_| {}, |_| {}).unwrap();
    assert_eq!(failed.project.status.problem_count, 1);
    let id = failed.project.status.problem_ids[0].clone();
    make_png(dir.path(), "embedded.png", 20);
    ws.refresh().unwrap();
    assert_eq!(ws.project().status.problem_count, 1);
    ws.retry_asset(&id).unwrap();
    let retried = ws.smart_convert(&prefs, &AtomicBool::new(false), |_| {}, |_| {}).unwrap();
    assert_eq!(retried.result.images.len(), 1);
    assert!(retried.result.images[0].error.is_none());
    assert_eq!(fs::read_to_string(dir.path().join("plot.svg")).unwrap(), svg);
}

#[test]
fn retry_does_not_bypass_safe_overwrite_and_a_second_failure_is_still_a_problem() {
    let dir = tempfile::tempdir().unwrap();
    make_png(dir.path(), "a.png", 1);
    fs::write(dir.path().join("main.tex"), r"\includegraphics{a.png}").unwrap();
    fs::create_dir(dir.path().join("texgo-pdf")).unwrap();
    let output = dir.path().join("texgo-pdf/a.pdf");
    fs::write(&output, b"unrelated").unwrap();
    let prefs = texgo_desktop::preferences::Preferences::default();
    let mut ws = Workspace::open(&dir.path().join("main.tex")).unwrap();
    let failed = ws.smart_convert(&prefs, &AtomicBool::new(false), |_| {}, |_| {}).unwrap();
    let id = failed.project.status.problem_ids[0].clone();
    ws.retry_asset(&id).unwrap();
    let failed_again = ws.smart_convert(&prefs, &AtomicBool::new(false), |_| {}, |_| {}).unwrap();
    assert_eq!(failed_again.project.status.problem_count, 1);
    assert!(failed_again.result.images[0].error.is_some());
    assert_eq!(fs::read(&output).unwrap(), b"unrelated");
    ws.retry_asset(&id).unwrap();
    fs::remove_file(&output).unwrap();
    ws.smart_convert(&prefs, &AtomicBool::new(false), |_| {}, |_| {}).unwrap();
    // An externally modified managed output remains a real blocking state.
    fs::write(&output, b"external edit").unwrap();
    ws.refresh().unwrap();
    assert!(ws.project().status.blocking_reason.is_some());
    assert!(ws.retry_asset(&id).is_err());
    assert_eq!(fs::read(&output).unwrap(), b"external edit");
}
