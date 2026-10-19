// Import the real private modules without changing the shared library exports.
#![allow(dead_code)]
#[path = "../src/conversion.rs"] mod conversion;
#[path = "../src/journal.rs"] mod journal;
#[path = "../src/manifest.rs"] mod manifest;
#[path = "../src/models.rs"] mod models;
#[path = "../src/observation.rs"] mod observation;
#[path = "../src/repair.rs"] mod repair;
#[path = "../src/scanner.rs"] mod scanner;
#[path = "../src/transaction.rs"] mod transaction;
#[path = "../src/workspace.rs"] mod workspace;
pub use models::*;

use std::{fs, path::Path};

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
    for name in ["texgo-pdf/plot.png", "bad%/plot.png", "bad#/plot.png", "bad\\/plot.png", "plot.tex", "bad\n/plot.png"] {
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
