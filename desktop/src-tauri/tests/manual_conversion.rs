use std::{fs, sync::atomic::AtomicBool};
use texgo_desktop::{ConversionIntent, ConversionOptions, IgnoreMode, Workspace};

fn project() -> (tempfile::TempDir, Workspace, String) {
    let dir = tempfile::tempdir().unwrap();
    image::RgbImage::from_pixel(20, 10, image::Rgb([10, 20, 30])).save(dir.path().join("plot.png")).unwrap();
    fs::write(dir.path().join("main.tex"), r"\includegraphics{plot.png}").unwrap();
    let ws = Workspace::open(&dir.path().join("main.tex")).unwrap();
    let id = ws.project().images[0].id.clone();
    (dir, ws, id)
}
fn options(id: &str) -> ConversionOptions {
    ConversionOptions { image_ids: vec![id.into()], quality: "custom".into(), dpi: 300, jpeg_quality: 90, output_dir: "pdf".into() }
}
fn run(ws: &mut Workspace, id: &str, intent: ConversionIntent) -> texgo_desktop::ConversionResult {
    ws.convert_with_intent(&options(id), intent, true, &AtomicBool::new(false), |_| {}, |_| {}).unwrap()
}
#[test]
fn explicit_reconvert_bypasses_cache_and_preserves_the_managed_destination() {
    let (_dir, mut ws, id) = project();
    let first = run(&mut ws, &id, ConversionIntent::Pending);
    let plan = ws.plan().unwrap();
    ws.apply_reviewed(plan.files.iter().flat_map(|f| f.changes.iter().map(|c| c.id.clone())).collect(), &plan, false).unwrap();
    assert!(ws.project().status.pending_image_ids.is_empty());
    assert!(ws.project().status.convertible_image_ids.contains(&id));
    let mut changed = options(&id); changed.output_dir = "new-location".into();
    let second = ws.convert_with_intent(&changed, ConversionIntent::Reconvert, false, &AtomicBool::new(false), |_| {}, |_| {}).unwrap();
    assert!(!second.images[0].cached);
    assert_eq!(first.images[0].pdf_path, second.images[0].pdf_path);
    assert_eq!(ws.project().status.pending_references, 0);
}
#[test]
fn ignored_assets_can_be_manually_converted_without_changing_ignore_rules() {
    let (dir, mut ws, id) = project();
    ws.set_ignore_mode(&id, IgnoreMode::Permanent).unwrap();
    let rules = fs::read(dir.path().join(".texgo/ignore.json")).unwrap();
    assert!(ws.project().status.pending_image_ids.is_empty());
    let result = run(&mut ws, &id, ConversionIntent::Reconvert);
    assert!(result.images[0].error.is_none());
    assert_eq!(ws.project().images[0].ignore_mode, IgnoreMode::Permanent);
    assert_eq!(fs::read(dir.path().join(".texgo/ignore.json")).unwrap(), rules);
    assert!(ws.project().status.pending_image_ids.is_empty());
    let report = ws.smart_convert(&Default::default(), &AtomicBool::new(false), |_| {}, |_| {}).unwrap();
    assert!(report.result.images.is_empty());
}
#[test]
fn manual_conversion_obeys_pending_reference_safety() {
    let (_dir, mut ws, id) = project();
    run(&mut ws, &id, ConversionIntent::Pending);
    let history = ws.conversion_history().unwrap().len();
    assert!(ws.convert_with_intent(&options(&id), ConversionIntent::Reconvert, false, &AtomicBool::new(false), |_| {}, |_| {}).is_err());
    assert_eq!(ws.conversion_history().unwrap().len(), history);
    assert!(run(&mut ws, &id, ConversionIntent::Reconvert).images[0].error.is_none());
}
#[test]
fn manually_selected_completed_images_are_reconverted_but_pending_intent_is_not() {
    let (_dir, mut ws, id) = project();
    run(&mut ws, &id, ConversionIntent::Pending);
    let plan = ws.plan().unwrap();
    ws.apply_reviewed(plan.files.iter().flat_map(|f| f.changes.iter().map(|c| c.id.clone())).collect(), &plan, false).unwrap();
    assert!(run(&mut ws, &id, ConversionIntent::Pending).images.is_empty());
    assert!(!run(&mut ws, &id, ConversionIntent::Selected).images[0].cached);
}
#[test]
fn manual_conversion_does_not_overwrite_an_externally_edited_output() {
    let (dir, mut ws, id) = project();
    run(&mut ws, &id, ConversionIntent::Pending);
    fs::write(dir.path().join("pdf/plot.pdf"), b"external edit").unwrap();
    ws.refresh().unwrap();
    let attempt = ws.convert_with_intent(&options(&id), ConversionIntent::Reconvert, true, &AtomicBool::new(false), |_| {}, |_| {});
    assert!(attempt.is_err() || attempt.unwrap().images.iter().any(|image| image.error.is_some()));
    assert_eq!(fs::read(dir.path().join("pdf/plot.pdf")).unwrap(), b"external edit");
}
#[test]
fn ordinary_missing_references_do_not_remove_manual_conversion_of_normal_images() {
    let (dir, mut ws, id) = project();
    fs::write(dir.path().join("main.tex"), r"\includegraphics{plot.png}\includegraphics{missing.png}").unwrap();
    ws.refresh().unwrap();
    assert_eq!(ws.project().status.problem_count, 1);
    assert!(ws.project().status.convertible_image_ids.contains(&id));
    assert!(run(&mut ws, &id, ConversionIntent::Reconvert).images[0].error.is_none());
}
