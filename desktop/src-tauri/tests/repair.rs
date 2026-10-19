// Import the real private modules without changing the shared library exports.
#![allow(dead_code)]
#[path = "../src/conversion.rs"] mod conversion;
#[path = "../src/journal.rs"] mod journal;
#[path = "../src/manifest.rs"] mod manifest;
#[path = "../src/models.rs"] mod models;
#[path = "../src/preferences.rs"] mod preferences;
#[path = "../src/observation.rs"] mod observation;
#[path = "../src/repair.rs"] mod repair;
#[path = "../src/scanner.rs"] mod scanner;
#[path = "../src/transaction.rs"] mod transaction;
#[path = "../src/workspace.rs"] mod workspace;
pub use models::*;

use std::{collections::HashSet, fs, path::Path};

fn tempdir() -> tempfile::TempDir {
    tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap()
}

fn write(root: &Path, name: &str, bytes: impl AsRef<[u8]>) {
    let path = root.join(name);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, bytes).unwrap();
}

fn scan(root: &Path, source: &str) -> scanner::Scan {
    write(root, "main.tex", source);
    scanner::scan(&root.join("main.tex")).unwrap()
}

#[test]
fn candidates_are_exact_bounded_root_relative_and_exclude_outputs() {
    let dir = tempdir();
    for name in ["figs/plot.png", "plot.pdf", "figs/plot-extra.png", "figs/PLOT.png", "texgo-pdf/plot.png", ".git/plot.png", "target/plot.png"] {
        write(dir.path(), name, b"image");
    }
    let scan = scan(dir.path(), "\\includegraphics{missing/plot}");
    let found = repair::candidates(&scan.project, &scan.project.images[0].id).unwrap();
    assert_eq!(found.iter().map(|c| c.relative_path.as_str()).collect::<Vec<_>>(), vec!["figs/plot.png", "plot.pdf"]);
    assert!(found.iter().all(|c| Path::new(&c.path).starts_with(&scan.project.root)));
}

#[test]
fn an_explicit_extension_limits_discovery_not_manual_location() {
    let dir = tempdir();
    write(dir.path(), "figs/plot.png", b"image");
    write(dir.path(), "figs/plot.pdf", b"image");
    let scan = scan(dir.path(), "\\includegraphics{missing/plot.png}");
    let id = &scan.project.images[0].id;
    let found = repair::candidates(&scan.project, id).unwrap();
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].relative_path, "figs/plot.png");
    assert!(repair::prepare(&scan, id, &dir.path().join("figs/plot.pdf")).is_ok());
}

#[test]
fn preview_only_replaces_argument_spans_and_preserves_utf8_options_comments_crlf() {
    let dir = tempdir();
    write(dir.path(), "figs/实验.png", b"image");
    write(dir.path(), "chapters/body.tex", "中文 \\includegraphics*[width=.8\\linewidth]{ missing } % keep\r\n\\includegraphics{missing}\r\n");
    let scan = scan(dir.path(), "\\input{chapters/body}\r\n");
    let id = &scan.project.images[0].id;
    let prepared = repair::prepare(&scan, id, &dir.path().join("figs/实验.png")).unwrap();
    assert_eq!(prepared.plan.reference_count, 2);
    assert_eq!(prepared.files.len(), 1);
    let (path, before, after) = &prepared.files[0];
    assert_eq!(fs::read(path).unwrap(), *before);
    assert_eq!(String::from_utf8(after.clone()).unwrap(), "中文 \\includegraphics*[width=.8\\linewidth]{ figs/实验.png } % keep\r\n\\includegraphics{figs/实验.png}\r\n");
    assert!(!dir.path().join(".texgo/undo.json").exists());
}

#[test]
fn ambiguous_reference_is_repairable_but_not_automatically_selected() {
    let dir = tempdir();
    write(dir.path(), "plot.png", b"image");
    write(dir.path(), "plot.pdf", b"image");
    let scan = scan(dir.path(), "\\includegraphics{plot}");
    assert_eq!(scan.project.images[0].status, "ambiguous");
    let prepared = repair::prepare(&scan, &scan.project.images[0].id, &dir.path().join("plot.pdf")).unwrap();
    assert_eq!(prepared.files[0].2, b"\\includegraphics{plot.pdf}");
    assert_eq!(fs::read(dir.path().join("main.tex")).unwrap(), b"\\includegraphics{plot}");
}

#[test]
fn changed_unrelated_source_invalidates_the_whole_scan_snapshot() {
    let dir = tempdir();
    write(dir.path(), "figs/plot.png", b"image");
    write(dir.path(), "chapter.tex", "unchanged");
    let scan = scan(dir.path(), "\\input{chapter}\\includegraphics{missing}");
    write(dir.path(), "chapter.tex", "edited externally");
    assert!(repair::prepare(&scan, &scan.project.images[0].id, &dir.path().join("figs/plot.png")).is_err());
}

#[test]
fn stale_resolution_and_forged_reference_ranges_are_rejected() {
    let dir = tempdir();
    write(dir.path(), "figs/plot.png", b"image");
    let mut scan = scan(dir.path(), "\\includegraphics{plot}");
    let id = scan.project.images[0].id.clone();
    write(dir.path(), "plot.png", b"now resolved");
    assert!(repair::prepare(&scan, &id, &dir.path().join("figs/plot.png")).is_err());
    fs::remove_file(dir.path().join("plot.png")).unwrap();
    scan.project.images[0].references[0].start = 0;
    assert!(repair::prepare(&scan, &id, &dir.path().join("figs/plot.png")).is_err());
}

#[test]
fn dynamic_and_nonproblem_references_cannot_be_repaired() {
    let dir = tempdir();
    write(dir.path(), "plot.png", b"image");
    for source in ["\\includegraphics{\\name}", "\\includegraphics{plot.png}"] {
        let scan = scan(dir.path(), source);
        let id = &scan.project.images[0].id;
        assert!(repair::candidates(&scan.project, id).is_err());
        assert!(repair::prepare(&scan, id, &dir.path().join("plot.png")).is_err());
    }
}

#[test]
fn outside_directory_reserved_and_tex_metacharacter_targets_are_rejected() {
    let dir = tempdir();
    let outside = tempdir();
    write(outside.path(), "plot.png", b"image");
    let scan = scan(dir.path(), "\\includegraphics{missing}");
    let id = &scan.project.images[0].id;
    assert!(repair::prepare(&scan, id, &outside.path().join("plot.png")).is_err());
    assert!(repair::prepare(&scan, id, dir.path()).is_err());
    for name in ["texgo-pdf/plot.png", "bad%/plot.png", "bad#/plot.png", "plot.tex"] {
        write(dir.path(), name, b"image");
        assert!(repair::prepare(&scan, id, &dir.path().join(name)).is_err(), "{name:?}");
    }
    // These are legal Unix filenames; Windows rejects them at file creation or
    // interprets backslash as a directory separator instead of a literal name.
    #[cfg(unix)]
    for name in ["bad\\/plot.png", "bad\n/plot.png"] {
        write(dir.path(), name, b"image");
        assert!(repair::prepare(&scan, id, &dir.path().join(name)).is_err(), "{name:?}");
    }
}

#[cfg(unix)]
#[test]
fn symlink_files_and_ancestors_are_never_candidates_or_targets() {
    use std::os::unix::fs::symlink;
    let dir = tempdir();
    write(dir.path(), "figs/plot.png", b"image");
    symlink(dir.path().join("figs"), dir.path().join("alias")).unwrap();
    symlink(dir.path().join("figs/plot.png"), dir.path().join("plot.png")).unwrap();
    let scan = scan(dir.path(), "\\includegraphics{missing/plot}");
    let id = &scan.project.images[0].id;
    let found = repair::candidates(&scan.project, id).unwrap();
    assert_eq!(found.len(), 1);
    for name in ["alias/plot.png", "plot.png"] {
        assert!(repair::prepare(&scan, id, &dir.path().join(name)).is_err());
    }
}

#[test]
fn apply_revalidates_reviewed_bytes_and_records_an_undo() {
    let dir = tempdir();
    write(dir.path(), "figs/plot.png", b"image");
    let scan = scan(dir.path(), "\\includegraphics{missing}");
    let id = &scan.project.images[0].id;
    let target = dir.path().join("figs/plot.png");
    let prepared = repair::prepare(&scan, id, &target).unwrap();
    assert_eq!(repair::apply(&scan, id, &target, prepared).unwrap().references_changed, 1);
    assert!(Path::new(&scan.project.root).join(".texgo/undo.json").is_file());
    transaction::undo(&scan.project).unwrap();
    assert_eq!(fs::read(dir.path().join("main.tex")).unwrap(), b"\\includegraphics{missing}");
}

#[test]
fn apply_rejects_a_changed_review_or_held_project_lock() {
    let dir = tempdir();
    write(dir.path(), "plot.png", b"image");
    let scan = scan(dir.path(), "\\includegraphics{missing}");
    let id = &scan.project.images[0].id;
    let target = dir.path().join("plot.png");
    let mut prepared = repair::prepare(&scan, id, &target).unwrap();
    prepared.files[0].2.push(b'!');
    assert!(repair::apply(&scan, id, &target, prepared).is_err());
    let prepared = repair::prepare(&scan, id, &target).unwrap();
    let _lock = transaction::lock_project(Path::new(&scan.project.root)).unwrap();
    assert!(repair::apply(&scan, id, &target, prepared).is_err());
    assert_eq!(fs::read(dir.path().join("main.tex")).unwrap(), b"\\includegraphics{missing}");
}

#[test]
fn custom_conversion_output_directories_are_not_candidates_or_targets() {
    let dir = tempdir();
    let root = dir.path();
    write(root, "source.png", b"source");
    let _lock = transaction::lock_project(root).unwrap();
    let mut journal = journal::Journal::load(root).unwrap();
    let batch = journal.begin(root, &models::ConversionOptions {
        image_ids: vec![], quality: "custom".into(), dpi: 150,
        jpeg_quality: 90, output_dir: "generated".into(),
    }).unwrap();
    journal.write(root, batch, "generated/plot.pdf", journal::Managed {
        source: "source.png".into(), source_hash: workspace::digest(b"source"),
        pdf_hash: workspace::digest(b"pdf"), key: "test".into(), dependencies: vec![],
    }, b"pdf").unwrap();
    let scan = scan(root, "\\includegraphics{missing/plot}");
    let id = &scan.project.images[0].id;
    assert!(repair::candidates(&scan.project, id).unwrap().is_empty());
    assert!(repair::prepare(&scan, id, &root.join("generated/plot.pdf")).is_err());
}

#[test]
fn applying_after_an_external_edit_preserves_the_edit_without_an_undo_record() {
    let dir = tempdir();
    write(dir.path(), "plot.png", b"image");
    let scan = scan(dir.path(), "\\includegraphics{missing}");
    let id = &scan.project.images[0].id;
    let target = dir.path().join("plot.png");
    let prepared = repair::prepare(&scan, id, &target).unwrap();
    write(dir.path(), "main.tex", "user edit");
    assert!(repair::apply(&scan, id, &target, prepared).is_err());
    assert_eq!(fs::read(dir.path().join("main.tex")).unwrap(), b"user edit");
    assert!(!dir.path().join(".texgo/undo.json").exists());
}

#[test]
fn too_many_candidates_fail_closed_instead_of_silently_truncating() {
    let dir = tempdir();
    for index in 0..513 {
        write(dir.path(), &format!("figures/{index}/plot.png"), b"image");
    }
    let scan = scan(dir.path(), "\\includegraphics{missing/plot}");
    let error = repair::candidates(&scan.project, &scan.project.images[0].id).unwrap_err();
    assert!(error.contains("512"));
}

#[test]
fn reviewed_subset_preparation_is_read_only_and_preserves_unselected_arguments() {
    let dir = tempdir();
    write(dir.path(), "figs/实验.png", b"image");
    let source = "中文 \\includegraphics{ missing }\r\n\\includegraphics[width=2cm]{missing}\r\n\\includegraphics{missing}%keep";
    let scan = scan(dir.path(), source);
    let id = &scan.project.images[0].id;
    let target = dir.path().join("figs/实验.png");
    let expected = repair::prepare(&scan, id, &target).unwrap().plan;
    let selection = HashSet::from([
        expected.files[0].changes[0].id.clone(),
        expected.files[0].changes[2].id.clone(),
    ]);
    let prepared = repair::prepare_reviewed(&scan, id, &target, &expected, &selection).unwrap();
    assert_eq!(prepared.plan.reference_count, 2);
    assert_eq!(prepared.plan.files[0].changes.len(), 2);
    assert_eq!(prepared.files[0].2, "中文 \\includegraphics{ figs/实验.png }\r\n\\includegraphics[width=2cm]{missing}\r\n\\includegraphics{figs/实验.png}%keep".as_bytes());
    assert_eq!(fs::read(dir.path().join("main.tex")).unwrap(), source.as_bytes());
    assert!(!dir.path().join(".texgo").exists());
}

#[test]
fn reviewed_subset_rejects_unknown_empty_and_mixed_selections_without_writes() {
    let dir = tempdir();
    write(dir.path(), "plot.png", b"image");
    let scan = scan(dir.path(), "\\includegraphics{missing}");
    let id = &scan.project.images[0].id;
    let target = dir.path().join("plot.png");
    let expected = repair::prepare(&scan, id, &target).unwrap().plan;
    let valid = expected.files[0].changes[0].id.clone();
    for selection in [HashSet::new(), HashSet::from(["unknown:0".into()]), HashSet::from([valid, "unknown:0".into()])] {
        assert!(repair::prepare_reviewed(&scan, id, &target, &expected, &selection).is_err());
    }
    assert!(!dir.path().join(".texgo").exists());
}

#[test]
fn reviewed_subset_compares_the_complete_plan_including_unselected_changes() {
    let dir = tempdir();
    write(dir.path(), "plot.png", b"image");
    let scan = scan(dir.path(), "\\includegraphics{missing}\\includegraphics{missing}");
    let id = &scan.project.images[0].id;
    let target = dir.path().join("plot.png");
    let expected = repair::prepare(&scan, id, &target).unwrap().plan;
    let selection = HashSet::from([expected.files[0].changes[0].id.clone()]);
    let mut changed = expected.clone();
    changed.files[0].changes[1].after = "tampered-unselected.png".into();
    assert!(repair::prepare_reviewed(&scan, id, &target, &changed, &selection).is_err());
    let mut truncated = expected.clone();
    truncated.files[0].changes.pop();
    truncated.reference_count -= 1;
    assert!(repair::prepare_reviewed(&scan, id, &target, &truncated, &selection).is_err());
    assert!(!dir.path().join(".texgo").exists());
}

#[test]
fn reviewed_subset_application_is_locked_and_undo_restores_only_its_changes() {
    let dir = tempdir();
    write(dir.path(), "plot.png", b"image");
    let source = "\\includegraphics{missing}\\includegraphics{missing}";
    let scan = scan(dir.path(), source);
    let id = &scan.project.images[0].id;
    let target = dir.path().join("plot.png");
    let expected = repair::prepare(&scan, id, &target).unwrap().plan;
    let selection = HashSet::from([expected.files[0].changes[1].id.clone()]);
    {
        let _lock = transaction::lock_project(Path::new(&scan.project.root)).unwrap();
        assert!(repair::prepare_reviewed(&scan, id, &target, &expected, &selection).is_ok());
        assert!(repair::apply_reviewed(&scan, id, &target, &expected, &selection).is_err());
    }
    let result = repair::apply_reviewed(&scan, id, &target, &expected, &selection).unwrap();
    assert_eq!(result.files_changed, 1);
    assert_eq!(result.references_changed, 1);
    assert_eq!(fs::read(dir.path().join("main.tex")).unwrap(), b"\\includegraphics{missing}\\includegraphics{plot.png}");
    transaction::undo(&scan.project).unwrap();
    assert_eq!(fs::read(dir.path().join("main.tex")).unwrap(), source.as_bytes());
}

#[test]
fn reviewed_subset_revalidates_unselected_source_graph_before_applying() {
    let dir = tempdir();
    write(dir.path(), "plot.png", b"image");
    write(dir.path(), "chapter.tex", "original");
    let scan = scan(dir.path(), "\\input{chapter}\\includegraphics{missing}");
    let id = &scan.project.images[0].id;
    let target = dir.path().join("plot.png");
    let expected = repair::prepare(&scan, id, &target).unwrap().plan;
    let selection = HashSet::from([expected.files[0].changes[0].id.clone()]);
    write(dir.path(), "chapter.tex", "external edit");
    assert!(repair::prepare_reviewed(&scan, id, &target, &expected, &selection).is_err());
    assert!(repair::apply_reviewed(&scan, id, &target, &expected, &selection).is_err());
    assert!(!dir.path().join(".texgo/undo.json").exists());
}

#[test]
fn reviewed_subset_can_be_linked_to_a_task_with_one_external_lock() {
    let dir = tempdir();
    write(dir.path(), "plot.png", b"image");
    let source = "\\includegraphics{missing}\\includegraphics{missing}";
    let scan = scan(dir.path(), source);
    let id = &scan.project.images[0].id;
    let target = dir.path().join("plot.png");
    let expected = repair::prepare(&scan, id, &target).unwrap().plan;
    let selection = HashSet::from([expected.files[0].changes[0].id.clone()]);
    let root = Path::new(&scan.project.root);
    let _lock = transaction::lock_project(root).unwrap();
    let prepared = repair::prepare_reviewed(&scan, id, &target, &expected, &selection).unwrap();
    let mut journal = journal::Journal::load(root).unwrap();
    journal.begin(root, &models::ConversionOptions {
        image_ids: vec![], quality: "custom".into(), dpi: 150,
        jpeg_quality: 90, output_dir: "texgo-pdf".into(),
    }).unwrap();
    let batch_id = journal.latest_batch_id().unwrap().to_owned();
    transaction::apply_linked(&scan.project, prepared, Some(&batch_id)).unwrap();
    transaction::undo_batch_locked(&scan.project, &batch_id).unwrap();
    assert_eq!(fs::read(root.join("main.tex")).unwrap(), source.as_bytes());
}

#[test]
fn nested_target_references_and_candidate_labels_use_forward_slashes() {
    let dir = tempdir();
    write(dir.path(), "figs/nested/plot.png", b"image");
    let scan = scan(dir.path(), "\\includegraphics{missing/plot}");
    let id = &scan.project.images[0].id;
    let prepared = repair::prepare(&scan, id, &dir.path().join("figs/nested/plot.png")).unwrap();
    assert_eq!(prepared.plan.files[0].changes[0].after, "figs/nested/plot.png");
    assert_eq!(repair::candidates(&scan.project, id).unwrap()[0].relative_path, "figs/nested/plot.png");
}

#[test]
fn reviewed_apply_rejects_empty_unknown_and_unreviewed_selections_without_tex_writes() {
    let dir = tempdir();
    write(dir.path(), "plot.png", b"image");
    let source = "\\includegraphics{missing}";
    let scan = scan(dir.path(), source);
    let id = &scan.project.images[0].id;
    let target = dir.path().join("plot.png");
    let expected = repair::prepare(&scan, id, &target).unwrap().plan;
    for selection in [HashSet::new(), HashSet::from(["unknown:0".into()])] {
        assert!(repair::apply_reviewed(&scan, id, &target, &expected, &selection).is_err());
    }
    let selection = HashSet::from([expected.files[0].changes[0].id.clone()]);
    let mut changed = expected.clone();
    changed.files[0].changes[0].line += 1;
    assert!(repair::apply_reviewed(&scan, id, &target, &changed, &selection).is_err());
    assert_eq!(fs::read(dir.path().join("main.tex")).unwrap(), source.as_bytes());
    assert!(!dir.path().join(".texgo/undo.json").exists());
}
