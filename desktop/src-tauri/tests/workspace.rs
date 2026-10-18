use std::{fs, path::Path, sync::atomic::{AtomicBool, Ordering}};
use texgo_desktop::{ConversionOptions, Workspace};

fn png(root: &Path, name: &str, color: u8) {
    let path = root.join(name);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    image::RgbImage::from_pixel(24, 12, image::Rgb([color, 50, 80])).save(path).unwrap();
}

fn options(ws: &Workspace) -> ConversionOptions {
    ConversionOptions {
        image_ids: ws.project().images.iter().filter(|a| a.status == "ready").map(|a| a.id.clone()).collect(),
        quality: "custom".into(), dpi: 150, jpeg_quality: 100, output_dir: "output".into(),
    }
}

#[test]
fn directory_modes_exclusions_and_extra_directories_survive_refresh() {
    let dir = tempfile::tempdir().unwrap();
    png(dir.path(), "top.png", 1);
    for name in ["figures/实验 图.png", "output/ignored.png", "texgo-pdf/ignored.png", ".texgo/ignored.png", ".git/ignored.png", "node_modules/ignored.png"] { png(dir.path(), name, 2); }
    let mut ws = Workspace::open_directory(dir.path(), false).unwrap();
    assert_eq!(ws.project().mode, "directory");
    assert_eq!(ws.project().main_file, "");
    assert_eq!(ws.project().images.len(), 1);
    ws.add_image_directory(&dir.path().join("figures"), true).unwrap();
    ws.refresh().unwrap();
    assert_eq!(ws.project().images.len(), 2);
    assert!(!ws.project().recursive);
    let reopened = Workspace::open_directory(dir.path(), false).unwrap();
    assert_eq!(reopened.project().images.len(), 2);
    let outside = tempfile::tempdir().unwrap();
    assert!(ws.add_image_directory(outside.path(), true).is_err());
}

#[test]
fn stable_unicode_paths_rehydrate_and_undo_restores_previous_pdf() {
    let dir = tempfile::tempdir().unwrap();
    png(dir.path(), "figures/实验 图.png", 1);
    let mut ws = Workspace::open_directory(dir.path(), true).unwrap();
    let opts = options(&ws);
    let first = ws.convert(&opts, &AtomicBool::new(false), |_| {}).unwrap();
    let output = dir.path().canonicalize().unwrap().join("output/figures/实验 图.pdf");
    assert_eq!(Path::new(first.images[0].pdf_path.as_ref().unwrap()), output);
    let original = fs::read(&output).unwrap();
    let mut ws = Workspace::open_directory(dir.path(), true).unwrap();
    assert_eq!(ws.project().converted_images.len(), 1);
    assert!(ws.convert(&opts, &AtomicBool::new(false), |_| {}).unwrap().images[0].cached);
    png(dir.path(), "figures/实验 图.png", 200);
    let updated = ws.convert(&opts, &AtomicBool::new(false), |_| {}).unwrap();
    assert_eq!(updated.images[0].pdf_path, first.images[0].pdf_path);
    assert_ne!(fs::read(&output).unwrap(), original);
    let history = ws.conversion_history().unwrap();
    assert!(history[0].can_undo);
    ws.undo_conversion(&history[0].id).unwrap();
    assert_eq!(fs::read(&output).unwrap(), original);
    let history = ws.conversion_history().unwrap();
    let first = history.iter().find(|entry| entry.can_undo).unwrap();
    ws.undo_conversion(&first.id).unwrap();
    assert!(!output.exists());
}

#[test]
fn collision_with_unselected_unreferenced_source_prevents_all_writes() {
    let dir = tempfile::tempdir().unwrap();
    png(dir.path(), "a.png", 1);
    image::RgbImage::new(2, 2).save(dir.path().join("a.jpg")).unwrap();
    fs::write(dir.path().join("main.tex"), "\\includegraphics{a.png}").unwrap();
    let mut ws = Workspace::open(&dir.path().join("main.tex")).unwrap();
    let result = ws.convert(&options(&ws), &AtomicBool::new(false), |_| {});
    assert!(result.is_err() || result.unwrap().images.iter().all(|image| image.error.is_some()));
    assert!(!dir.path().join("output/a.pdf").exists());
    assert!(!ws.conversion_history().unwrap().is_empty());
}

#[test]
fn unrelated_or_edited_outputs_are_never_overwritten_or_undone() {
    let dir = tempfile::tempdir().unwrap();
    png(dir.path(), "a.png", 1);
    let mut ws = Workspace::open_directory(dir.path(), true).unwrap();
    let opts = options(&ws);
    fs::create_dir(dir.path().join("output")).unwrap();
    let output = dir.path().join("output/a.pdf");
    fs::write(&output, "unrelated").unwrap();
    assert!(ws.convert(&opts, &AtomicBool::new(false), |_| {}).unwrap().images[0].error.is_some());
    assert_eq!(fs::read(&output).unwrap(), b"unrelated");
    fs::remove_file(&output).unwrap();
    ws.convert(&opts, &AtomicBool::new(false), |_| {}).unwrap();
    let id = ws.conversion_history().unwrap()[0].id.clone();
    fs::write(&output, "edited").unwrap();
    assert!(ws.undo_conversion(&id).is_err());
    assert!(ws.convert(&opts, &AtomicBool::new(false), |_| {}).unwrap().images[0].error.is_some());
    assert_eq!(fs::read(&output).unwrap(), b"edited");
    assert!(Workspace::open_directory(dir.path(), true).unwrap().project().converted_images.is_empty());
}

#[test]
fn cancellation_and_failures_persist_and_reference_undo_blocks_conversion_undo() {
    let dir = tempfile::tempdir().unwrap();
    png(dir.path(), "a.png", 1);
    png(dir.path(), "b.png", 2);
    fs::write(dir.path().join("main.tex"), "\\includegraphics{a.png}").unwrap();
    let mut ws = Workspace::open(&dir.path().join("main.tex")).unwrap();
    ws.add_image_directory(dir.path(), true).unwrap();
    let opts = options(&ws);
    let cancel = AtomicBool::new(false);
    let result = ws.convert(&opts, &cancel, |p| { if p.current == 1 { cancel.store(true, Ordering::Relaxed); } }).unwrap();
    assert!(result.cancelled);
    assert_eq!(result.images.len(), 1);
    let id = ws.conversion_history().unwrap()[0].id.clone();
    assert!(ws.conversion_history().unwrap()[0].cancelled);
    ws.apply().unwrap();
    assert!(ws.undo_conversion(&id).is_err());
    assert!(!ws.conversion_history().unwrap()[0].can_undo);
    ws.undo().unwrap();
    ws.undo_conversion(&id).unwrap();
    assert_eq!(ws.project().images.len(), 2);
    assert!(!dir.path().join("output/a.pdf").exists());
}

#[test]
fn changed_source_during_render_is_not_committed() {
    let dir = tempfile::tempdir().unwrap();
    png(dir.path(), "a.png", 1);
    let mut ws = Workspace::open_directory(dir.path(), true).unwrap();
    let opts = options(&ws);
    let result = ws.convert(&opts, &AtomicBool::new(false), |p| {
        if p.status == "converting" { fs::remove_file(dir.path().join("a.png")).unwrap(); }
    }).unwrap();
    assert!(result.images[0].error.is_some());
    assert!(!dir.path().join("output/a.pdf").exists());
    assert!(ws.conversion_history().unwrap()[0].files[0].error.is_some());
}

#[cfg(unix)]
#[test]
fn scans_skip_links_and_nested_output_symlinks_are_rejected() {
    let dir = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    png(dir.path(), "figures/a.png", 1);
    std::os::unix::fs::symlink(dir.path().join("figures"), dir.path().join("linked")).unwrap();
    let mut ws = Workspace::open_directory(dir.path(), true).unwrap();
    assert_eq!(ws.project().images.len(), 1);
    fs::create_dir(dir.path().join("output")).unwrap();
    std::os::unix::fs::symlink(outside.path(), dir.path().join("output/figures")).unwrap();
    let result = ws.convert(&options(&ws), &AtomicBool::new(false), |_| {}).unwrap();
    assert!(result.images[0].error.is_some());
    assert_eq!(fs::read_dir(outside.path()).unwrap().count(), 0);
}

#[test]
fn undo_preflights_every_file_and_only_latest_meaningful_batch() {
    let dir = tempfile::tempdir().unwrap();
    png(dir.path(), "a.png", 1);
    png(dir.path(), "b.png", 2);
    let mut ws = Workspace::open_directory(dir.path(), true).unwrap();
    let opts = options(&ws);
    ws.convert(&opts, &AtomicBool::new(false), |_| {}).unwrap();
    let first_id = ws.conversion_history().unwrap()[0].id.clone();
    let original_a = fs::read(dir.path().join("output/a.pdf")).unwrap();
    png(dir.path(), "a.png", 200);
    ws.convert(&opts, &AtomicBool::new(false), |_| {}).unwrap();
    let latest = ws.conversion_history().unwrap()[0].id.clone();
    assert!(ws.undo_conversion(&first_id).is_err());
    ws.undo_conversion(&latest).unwrap();
    assert_eq!(fs::read(dir.path().join("output/a.pdf")).unwrap(), original_a);
    fs::write(dir.path().join("output/b.pdf"), b"editor bytes").unwrap();
    assert!(ws.undo_conversion(&first_id).is_err());
    assert_eq!(fs::read(dir.path().join("output/a.pdf")).unwrap(), original_a);
    assert_eq!(fs::read(dir.path().join("output/b.pdf")).unwrap(), b"editor bytes");
}

#[test]
fn failed_image_and_successful_image_share_persisted_history() {
    let dir = tempfile::tempdir().unwrap();
    png(dir.path(), "a.png", 1);
    fs::write(dir.path().join("b.png"), b"not an image").unwrap();
    let mut ws = Workspace::open_directory(dir.path(), true).unwrap();
    let result = ws.convert(&options(&ws), &AtomicBool::new(false), |_| {}).unwrap();
    assert!(result.images[0].error.is_none());
    assert!(result.images[1].error.is_some());
    let mut ws = Workspace::open_directory(dir.path(), true).unwrap();
    let history = ws.conversion_history().unwrap();
    assert_eq!(history[0].files.len(), 2);
    assert!(history[0].files[1].error.is_some());
    assert!(history[0].can_undo);
    ws.undo_conversion(&history[0].id).unwrap();
    assert!(!dir.path().join("output/a.pdf").exists());
}

#[test]
fn sampling_uses_intrinsic_density_and_quality_100_is_lossless() {
    let dir = tempfile::tempdir().unwrap();
    let file = fs::File::create(dir.path().join("dense.png")).unwrap();
    let mut encoder = png::Encoder::new(file, 200, 100);
    encoder.set_color(png::ColorType::Rgb);
    encoder.set_depth(png::BitDepth::Eight);
    encoder.set_pixel_dims(Some(png::PixelDimensions { xppu: 11811, yppu: 11811, unit: png::Unit::Meter }));
    let mut writer = encoder.write_header().unwrap();
    writer.write_image_data(&vec![120; 200 * 100 * 3]).unwrap();
    writer.finish().unwrap();
    let mut ws = Workspace::open_directory(dir.path(), true).unwrap();
    let mut opts = options(&ws);
    for (dpi, expected) in [(150, 100), (600, 200)] {
        opts.dpi = dpi;
        let result = ws.convert(&opts, &AtomicBool::new(false), |_| {}).unwrap();
        let doc = lopdf::Document::load(result.images[0].pdf_path.as_ref().unwrap()).unwrap();
        let stream = doc.objects.values().filter_map(|obj| obj.as_stream().ok()).find(|stream| stream.dict.get(b"Subtype").is_ok_and(|value| value.as_name().ok() == Some(b"Image"))).unwrap();
        assert_eq!(stream.dict.get(b"Width").unwrap().as_i64().unwrap(), expected);
        assert!(!stream.dict.get(b"Filter").is_ok_and(|filter| filter.as_name().ok() == Some(b"DCTDecode")));
    }
    png(dir.path(), "fallback.png", 3);
    let mut ws = Workspace::open_directory(dir.path(), true).unwrap();
    let result = ws.convert(&options(&ws), &AtomicBool::new(false), |_| {}).unwrap();
    let fallback = result.images.iter().find(|image| image.pdf_path.as_ref().is_some_and(|path| path.ends_with("fallback.pdf"))).unwrap();
    let doc = lopdf::Document::load(fallback.pdf_path.as_ref().unwrap()).unwrap();
    assert!(doc.objects.values().filter_map(|obj| obj.as_stream().ok()).any(|stream| stream.dict.get(b"Width").is_ok_and(|width| width.as_i64().ok() == Some(24))));
}

#[test]
fn latest_output_directory_is_used_for_preview_and_reference_plans_after_reopen() {
    let dir = tempfile::tempdir().unwrap();
    png(dir.path(), "a.png", 1);
    fs::write(dir.path().join("main.tex"), "\\includegraphics{a.png}").unwrap();
    let mut ws = Workspace::open(&dir.path().join("main.tex")).unwrap();
    let mut opts = options(&ws);
    opts.output_dir = "aaa".into();
    ws.convert(&opts, &AtomicBool::new(false), |_| {}).unwrap();
    opts.output_dir = "zzz".into();
    ws.convert(&opts, &AtomicBool::new(false), |_| {}).unwrap();
    assert_eq!(ws.plan().unwrap().files[0].changes[0].after, "zzz/a.pdf");
    let mut ws = Workspace::open(&dir.path().join("main.tex")).unwrap();
    assert_eq!(ws.plan().unwrap().files[0].changes[0].after, "zzz/a.pdf");
    opts.output_dir = "aaa".into();
    assert!(ws.convert(&opts, &AtomicBool::new(false), |_| {}).unwrap().images[0].cached);
    let ws = Workspace::open(&dir.path().join("main.tex")).unwrap();
    assert_eq!(ws.plan().unwrap().files[0].changes[0].after, "aaa/a.pdf");
}

#[test]
fn missing_saved_directory_warns_without_blocking_the_main_file() {
    let dir = tempfile::tempdir().unwrap();
    png(dir.path(), "extra/a.png", 1);
    fs::write(dir.path().join("main.tex"), "").unwrap();
    let mut ws = Workspace::open(&dir.path().join("main.tex")).unwrap();
    ws.add_image_directory(&dir.path().join("extra"), true).unwrap();
    fs::remove_dir_all(dir.path().join("extra")).unwrap();
    let ws = Workspace::open(&dir.path().join("main.tex")).unwrap();
    assert!(!ws.project().warnings.is_empty());
    assert!(ws.project().images.is_empty());
}

#[test]
fn collisions_elsewhere_do_not_block_unrelated_selected_targets() {
    let dir = tempfile::tempdir().unwrap();
    png(dir.path(), "a.png", 1);
    png(dir.path(), "elsewhere/b.png", 2);
    image::RgbImage::new(2, 2).save(dir.path().join("elsewhere/b.jpg")).unwrap();
    fs::write(dir.path().join("main.tex"), "\\includegraphics{a.png}").unwrap();
    let mut ws = Workspace::open(&dir.path().join("main.tex")).unwrap();
    let result = ws.convert(&options(&ws), &AtomicBool::new(false), |_| {}).unwrap();
    assert!(result.images[0].error.is_none());
}

#[test]
fn output_paths_reject_cross_platform_reserved_and_tex_special_names() {
    let dir = tempfile::tempdir().unwrap();
    png(dir.path(), "a.png", 1);
    let mut ws = Workspace::open_directory(dir.path(), false).unwrap();
    for output in ["../out", ".texgo/out", ".GIT/out", "C:\\out", "out#files", "CON", "out/..", "out."] {
        let mut opts = options(&ws);
        opts.output_dir = output.into();
        let result = ws.convert(&opts, &AtomicBool::new(false), |_| {});
        assert!(result.is_err() || result.unwrap().images.iter().all(|image| image.error.is_some()), "{output}");
    }
}

#[test]
fn failed_output_selection_does_not_hide_source_directories() {
    let dir = tempfile::tempdir().unwrap();
    png(dir.path(), "figures/a.png", 1);
    let mut ws = Workspace::open_directory(dir.path(), true).unwrap();
    let mut opts = options(&ws);
    opts.output_dir = "figures".into();
    assert!(ws.convert(&opts, &AtomicBool::new(false), |_| {}).unwrap().images[0].error.is_some());
    let ws = Workspace::open_directory(dir.path(), true).unwrap();
    assert_eq!(ws.project().images.len(), 1);
}

#[test]
fn recovery_rehydrates_a_committed_pdf_and_retries_an_interrupted_undo() {
    let dir = tempfile::tempdir().unwrap();
    png(dir.path(), "a.png", 1);
    png(dir.path(), "b.png", 2);
    let mut ws = Workspace::open_directory(dir.path(), true).unwrap();
    ws.convert(&options(&ws), &AtomicBool::new(false), |_| {}).unwrap();
    let path = dir.path().join(".texgo/conversions.json");
    let mut journal: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    journal["batches"][0]["changes"][0]["committed"] = false.into();
    journal["batches"][0]["entry"]["files"][0]["error"] = "interrupted".into();
    journal["outputs"].as_object_mut().unwrap().remove("output/a.pdf");
    fs::write(&path, serde_json::to_vec(&journal).unwrap()).unwrap();
    let ws = Workspace::open_directory(dir.path(), true).unwrap();
    assert_eq!(ws.project().converted_images.len(), 2);
    assert!(ws.conversion_history().unwrap()[0].files[0].error.is_none());
    journal["batches"][0]["undoing"] = true.into();
    fs::remove_file(dir.path().join("output/a.pdf")).unwrap();
    fs::write(&path, serde_json::to_vec(&journal).unwrap()).unwrap();
    let mut ws = Workspace::open_directory(dir.path(), true).unwrap();
    assert!(ws.convert(&options(&ws), &AtomicBool::new(false), |_| {}).is_err());
    let entry = ws.conversion_history().unwrap().remove(0);
    assert!(entry.can_undo);
    ws.undo_conversion(&entry.id).unwrap();
    assert!(!dir.path().join("output/b.pdf").exists());
    assert!(ws.conversion_history().unwrap()[0].undone);
}

#[test]
fn failed_selected_images_do_not_silently_reuse_older_outputs_in_a_plan() {
    let dir = tempfile::tempdir().unwrap();
    png(dir.path(), "a.png", 1);
    png(dir.path(), "b.png", 2);
    fs::write(dir.path().join("main.tex"), "\\includegraphics{a.png}\n\\includegraphics{b.png}").unwrap();
    let mut ws = Workspace::open(&dir.path().join("main.tex")).unwrap();
    let mut opts = options(&ws);
    ws.convert(&opts, &AtomicBool::new(false), |_| {}).unwrap();
    opts.output_dir = "next".into();
    fs::create_dir(dir.path().join("next")).unwrap();
    fs::write(dir.path().join("next/a.pdf"), b"unrelated").unwrap();
    let result = ws.convert(&opts, &AtomicBool::new(false), |_| {}).unwrap();
    assert!(result.images[0].error.is_some());
    assert!(result.images[1].error.is_none());
    let plan = ws.plan().unwrap();
    assert_eq!(plan.reference_count, 1);
    assert_eq!(plan.files[0].changes[0].after, "next/b.pdf");
}

#[test]
fn failed_batch_start_invalidates_selected_outputs_in_the_session() {
    let dir = tempfile::tempdir().unwrap();
    png(dir.path(), "a.png", 1);
    fs::write(dir.path().join("main.tex"), "\\includegraphics{a.png}").unwrap();
    let mut ws = Workspace::open(&dir.path().join("main.tex")).unwrap();
    let opts = options(&ws);
    ws.convert(&opts, &AtomicBool::new(false), |_| {}).unwrap();
    let lock = fs::OpenOptions::new().read(true).write(true).open(dir.path().join(".texgo/write.lock")).unwrap();
    fs2::FileExt::lock_exclusive(&lock).unwrap();
    assert!(ws.convert(&opts, &AtomicBool::new(false), |_| {}).is_err());
    drop(lock);
    assert!(ws.project().converted_images.is_empty());
    assert_eq!(ws.plan().unwrap().reference_count, 0);
}

#[test]
fn unrelated_changed_images_do_not_block_reference_replacement() {
    let dir = tempfile::tempdir().unwrap();
    png(dir.path(), "a.png", 1);
    png(dir.path(), "unused.png", 2);
    fs::write(dir.path().join("main.tex"), "\\includegraphics{a.png}").unwrap();
    let mut ws = Workspace::open(&dir.path().join("main.tex")).unwrap();
    ws.add_image_directory(dir.path(), true).unwrap();
    ws.convert(&options(&ws), &AtomicBool::new(false), |_| {}).unwrap();
    png(dir.path(), "unused.png", 3);
    assert_eq!(ws.plan().unwrap().reference_count, 1);
    assert_eq!(ws.apply().unwrap().references_changed, 1);
}

#[test]
fn undo_recreated_output_restores_absence_instead_of_stale_ownership() {
    let dir = tempfile::tempdir().unwrap();
    png(dir.path(), "a.png", 1);
    let mut ws = Workspace::open_directory(dir.path(), false).unwrap();
    let opts = options(&ws);
    ws.convert(&opts, &AtomicBool::new(false), |_| {}).unwrap();
    fs::remove_file(dir.path().join("output/a.pdf")).unwrap();
    ws.convert(&opts, &AtomicBool::new(false), |_| {}).unwrap();
    let id = ws.conversion_history().unwrap()[0].id.clone();
    ws.undo_conversion(&id).unwrap();
    let journal: serde_json::Value = serde_json::from_slice(&fs::read(dir.path().join(".texgo/conversions.json")).unwrap()).unwrap();
    assert!(journal["outputs"].as_object().unwrap().is_empty());
    assert!(!dir.path().join("output/a.pdf").exists());
}
