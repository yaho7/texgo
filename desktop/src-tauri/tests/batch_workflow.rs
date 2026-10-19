use std::{collections::HashSet, fs, path::Path, sync::atomic::AtomicBool};
use texgo_desktop::{ConversionOptions, ReplacementPlan, Workspace};

const ORIGINAL: &str = "\\includegraphics{plot.png}\n\\includegraphics{plot.png}\n";

fn fixture() -> (tempfile::TempDir, Workspace) {
    let directory = tempfile::tempdir().unwrap();
    image::RgbImage::from_pixel(24, 12, image::Rgb([40u8, 90, 120]))
        .save(directory.path().join("plot.png")).unwrap();
    fs::write(directory.path().join("main.tex"), ORIGINAL).unwrap();
    let workspace = Workspace::open(&directory.path().join("main.tex")).unwrap();
    (directory, workspace)
}

fn convert(workspace: &mut Workspace, output_dir: &str) {
    let options = ConversionOptions {
        image_ids: workspace.project().images.iter().filter(|image| image.status == "ready")
            .map(|image| image.id.clone()).collect(),
        quality: "custom".into(), dpi: 150, jpeg_quality: 100, output_dir: output_dir.into(),
    };
    let result = workspace.convert(&options, &AtomicBool::new(false), |_| {}).unwrap();
    assert!(!result.images.is_empty());
    assert!(result.images.iter().all(|image| image.error.is_none()), "{:?}", result.images);
}

fn selection(plan: &ReplacementPlan) -> HashSet<String> {
    plan.files.iter().flat_map(|file| file.changes.iter().map(|change| change.id.clone())).collect()
}

fn apply_all(workspace: &mut Workspace) {
    let expected = workspace.plan().unwrap();
    assert!(expected.reference_count > 0);
    workspace.apply_reviewed(selection(&expected), &expected, false).unwrap();
}

fn tex(root: &Path) -> String { fs::read_to_string(root.join("main.tex")).unwrap() }

#[test]
fn gui_complete_batches_continue_without_standalone_undo_and_restore_lifo() {
    let (directory, mut workspace) = fixture();
    convert(&mut workspace, "pdf-a");
    apply_all(&mut workspace);
    let a_tex = tex(directory.path());
    let a = workspace.conversion_history().unwrap()[0].id.clone();
    assert!(!directory.path().join(".texgo/undo.json").exists());

    convert(&mut workspace, "pdf-b");
    apply_all(&mut workspace);
    let history = workspace.conversion_history().unwrap();
    let b = history[0].id.clone();
    assert_eq!(history[0].references_changed, 2);
    assert_eq!(history[1].references_changed, 2);
    assert!(!directory.path().join(".texgo/undo.json").exists());
    assert!(workspace.undo_conversion(&a).is_err());
    assert!(tex(directory.path()).contains("pdf-b/plot.pdf"));

    workspace.undo_conversion(&b).unwrap();
    assert_eq!(tex(directory.path()), a_tex);
    assert!(directory.path().join("pdf-a/plot.pdf").exists());
    assert!(!directory.path().join("pdf-b/plot.pdf").exists());
    workspace.undo_conversion(&a).unwrap();
    assert_eq!(tex(directory.path()), ORIGINAL);
    assert!(!directory.path().join("pdf-a/plot.pdf").exists());
}

#[test]
fn gui_remaining_selection_creates_reference_only_batch_and_keeps_pdf_until_a_undo() {
    let (directory, mut workspace) = fixture();
    convert(&mut workspace, "pdf-a");
    let expected = workspace.plan().unwrap();
    let first = expected.files[0].changes[0].id.clone();
    workspace.apply_reviewed(HashSet::from([first]), &expected, false).unwrap();
    let partial_tex = tex(directory.path());
    let a = workspace.conversion_history().unwrap()[0].id.clone();
    assert_eq!(workspace.plan().unwrap().reference_count, 1);

    apply_all(&mut workspace);
    let history = workspace.conversion_history().unwrap();
    assert_eq!(history.len(), 2);
    let b = history[0].id.clone();
    assert_ne!(a, b);
    assert!(history[0].files.is_empty(), "The second application must not reconvert PDFs");
    assert_eq!(history[0].references_changed, 1);
    assert_eq!(history[0].files_changed, 1);
    assert!(!history[1].can_undo);
    assert!(!directory.path().join(".texgo/undo.json").exists());

    workspace.undo_conversion(&b).unwrap();
    assert_eq!(tex(directory.path()), partial_tex);
    assert!(directory.path().join("pdf-a/plot.pdf").exists());
    workspace.undo_conversion(&a).unwrap();
    assert_eq!(tex(directory.path()), ORIGINAL);
    assert!(!directory.path().join("pdf-a/plot.pdf").exists());
}

#[test]
fn gui_reapplying_after_reference_only_undo_never_falls_back_to_legacy() {
    let (directory, mut workspace) = fixture();
    convert(&mut workspace, "pdf-a");
    let expected = workspace.plan().unwrap();
    workspace.apply_reviewed(HashSet::from([expected.files[0].changes[0].id.clone()]), &expected, false).unwrap();
    let a = workspace.conversion_history().unwrap()[0].id.clone();
    apply_all(&mut workspace);
    let b = workspace.conversion_history().unwrap()[0].id.clone();
    workspace.undo_conversion(&b).unwrap();

    apply_all(&mut workspace);
    let history = workspace.conversion_history().unwrap();
    let c = history[0].id.clone();
    assert_ne!(b, c);
    assert_eq!(history[0].references_changed, 1);
    assert!(history[0].files.is_empty());
    assert!(!directory.path().join(".texgo/undo.json").exists());
    workspace.undo_conversion(&c).unwrap();
    workspace.undo_conversion(&a).unwrap();
    assert_eq!(tex(directory.path()), ORIGINAL);
}

#[test]
fn gui_linked_recovery_does_not_enable_the_standalone_undo_menu() {
    let (_directory, mut workspace) = fixture();
    convert(&mut workspace, "pdf-a");
    apply_all(&mut workspace);
    assert!(!workspace.project().undo_available, "The legacy menu must not target archived batch records");
    assert!(workspace.conversion_history().unwrap()[0].can_undo);
}

#[test]
fn legacy_cli_apply_keeps_its_standalone_recovery_contract() {
    let (directory, mut workspace) = fixture();
    convert(&mut workspace, "pdf-a");
    assert_eq!(workspace.apply().unwrap().references_changed, 2);
    assert!(directory.path().join(".texgo/undo.json").exists());
    assert!(workspace.project().undo_available);
    workspace.undo().unwrap();
    assert_eq!(tex(directory.path()), ORIGINAL);
    assert!(directory.path().join("pdf-a/plot.pdf").exists());
    assert!(!directory.path().join(".texgo/undo.json").exists());
}

#[test]
fn bypassed_unreviewed_batches_use_a_separate_reference_batch_with_independent_undo() {
    let directory = tempfile::tempdir().unwrap();
    let original = r"\includegraphics{a.png}\includegraphics{b.png}";
    fs::write(directory.path().join("main.tex"), original).unwrap();
    for file in ["a.png", "b.png"] { image::RgbImage::new(24, 12).save(directory.path().join(file)).unwrap(); }
    let mut ws = Workspace::open(&directory.path().join("main.tex")).unwrap();
    let mut ids = vec![];
    for file in ["a.png", "b.png"] {
        let id = ws.project().images.iter().find(|a| a.relative_path == file).unwrap().id.clone();
        ws.ensure_can_convert(true).unwrap();
        ws.convert(&ConversionOptions { image_ids: vec![id], quality: "custom".into(), dpi: 300, jpeg_quality: 90, output_dir: "pdf".into() }, &AtomicBool::new(false), |_| {}).unwrap();
        ids.push(ws.conversion_history().unwrap()[0].id.clone());
    }
    apply_all(&mut ws);
    let history = ws.conversion_history().unwrap();
    assert_eq!(history.len(), 3);
    assert!(history[0].files.is_empty());
    assert_eq!(history[0].references_changed, 2);
    assert_eq!(history[1].references_changed, 0);
    ws.undo_conversion(&history[0].id).unwrap();
    assert_eq!(tex(directory.path()), original);
    assert!(directory.path().join("pdf/a.pdf").exists());
    assert!(directory.path().join("pdf/b.pdf").exists());
    ws.undo_conversion(&ids[1]).unwrap();
    ws.undo_conversion(&ids[0]).unwrap();
    assert!(!directory.path().join("pdf/a.pdf").exists());
}
