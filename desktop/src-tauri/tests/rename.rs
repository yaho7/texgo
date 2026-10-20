use std::{fs, path::Path, sync::atomic::AtomicBool};
use texgo_desktop::{ConversionOptions, Workspace};

fn fixture(tex: &str) -> (tempfile::TempDir, Workspace) {
    let dir = tempfile::tempdir().unwrap();
    image::RgbImage::new(20, 10).save(dir.path().join("result.png")).unwrap();
    fs::write(dir.path().join("main.tex"), tex).unwrap();
    let ws = Workspace::open(&dir.path().join("main.tex")).unwrap();
    (dir, ws)
}
fn rename(ws: &mut Workspace, name: &str) -> Result<texgo_desktop::RenameResult, String> {
    let project = ws.project();
    let id = project.images.iter().find(|a| a.relative_path == "result.png").unwrap().id.clone();
    let expected = project.state_fingerprint.clone();
    ws.rename_asset(&id, name, &expected)
}
fn convert(ws: &mut Workspace) {
    let ids = ws.project().images.iter().filter(|a| a.status == "ready").map(|a| a.id.clone()).collect();
    ws.convert(&ConversionOptions { image_ids: ids, quality: "custom".into(), dpi: 300, jpeg_quality: 90, output_dir: "out".into() }, &AtomicBool::new(false), |_| {}).unwrap();
}
fn apply_references(ws: &mut Workspace) {
    let plan=ws.plan().unwrap();
    let selected=plan.files.iter().flat_map(|f|f.changes.iter().map(|c|c.id.clone())).collect();
    ws.apply_reviewed(selected,&plan,false).unwrap();
}
#[test]
fn source_rename_preserves_extensionless_references_and_changes_asset_identity() {
    let (dir, mut ws) = fixture(r"\includegraphics{result}\includegraphics{result.png}% result.png");
    let result = rename(&mut ws, "pressure-map").unwrap();
    assert_ne!(result.old_image_id, result.new_image_id);
    assert!(!dir.path().join("result.png").exists());
    assert!(dir.path().join("pressure-map.png").exists());
    assert_eq!(fs::read_to_string(dir.path().join("main.tex")).unwrap(), r"\includegraphics{pressure-map}\includegraphics{pressure-map.png}% result.png");
    assert_eq!(result.project.images[0].id, result.new_image_id);
    assert_eq!(ws.conversion_history().unwrap()[0].references_changed, 2);
}
#[test]
fn managed_pdf_mapping_moves_and_undo_restores_previous_conversion_undo() {
    let (dir, mut ws) = fixture(r"\includegraphics{result.png}");
    convert(&mut ws);
    apply_references(&mut ws);
    let pdf = fs::read(dir.path().join("out/result.pdf")).unwrap();
    let result = rename(&mut ws, "pressure-map").unwrap();
    assert_eq!(fs::read(dir.path().join("out/pressure-map.pdf")).unwrap(), pdf);
    assert!(!dir.path().join("out/result.pdf").exists());
    assert_eq!(fs::read_to_string(dir.path().join("main.tex")).unwrap(), r"\includegraphics{out/pressure-map.pdf}");
    assert_eq!(result.project.status.pending_images, 0);
    assert!(!result.project.images[0].update_available);
    let history = ws.conversion_history().unwrap();
    assert!(history[0].rename.is_some());
    assert!(!history[1].can_undo);
    ws.undo_conversion(&history[0].id).unwrap();
    assert_eq!(fs::read(dir.path().join("out/result.pdf")).unwrap(), pdf);
    assert!(dir.path().join("result.png").exists());
    assert_eq!(fs::read_to_string(dir.path().join("main.tex")).unwrap(), r"\includegraphics{out/result.pdf}");
    ws.undo_conversion(&history[1].id).unwrap();
    assert!(!dir.path().join("out/result.pdf").exists());
    assert_eq!(fs::read_to_string(dir.path().join("main.tex")).unwrap(), r"\includegraphics{result.png}");
}
#[test]
fn rename_updates_multiple_tex_files_and_graphics_path_style() {
    let (dir, _) = fixture(r"\graphicspath{{./}}\includegraphics{result}\input{chapter}");
    fs::write(dir.path().join("chapter.tex"), r"\includegraphics[width=1cm]{./result.png}").unwrap();
    let mut ws = Workspace::open(&dir.path().join("main.tex")).unwrap();
    rename(&mut ws, "map").unwrap();
    assert_eq!(fs::read_to_string(dir.path().join("chapter.tex")).unwrap(), r"\includegraphics[width=1cm]{./map.png}");
    assert!(fs::read_to_string(dir.path().join("main.tex")).unwrap().contains("{map}"));
}
#[test]
fn external_source_tex_and_pdf_edits_are_rejected_without_partial_changes() {
    for target in ["result.png", "main.tex", "out/result.pdf"] {
        let (dir, mut ws) = fixture(r"\includegraphics{result.png}");
        convert(&mut ws);
        fs::write(dir.path().join(target), b"external edits").unwrap();
        assert!(rename(&mut ws, "map").is_err(), "{target}");
        assert!(!dir.path().join("map.png").exists());
        assert!(!dir.path().join("out/map.pdf").exists());
        assert_eq!(fs::read(dir.path().join(target)).unwrap(), b"external edits");
    }
}
#[test]
fn source_and_pdf_collisions_never_overwrite() {
    for target in ["map.png", "out/map.pdf"] {
        let (dir, mut ws) = fixture(r"\includegraphics{result.png}");
        convert(&mut ws);
        fs::write(dir.path().join(target), b"unrelated").unwrap();
        assert!(rename(&mut ws, "map").is_err());
        assert_eq!(fs::read(dir.path().join(target)).unwrap(), b"unrelated");
        assert!(dir.path().join("result.png").exists());
    }
}
#[test]
fn invalid_reserved_and_tex_special_names_are_rejected() {
    let (dir, mut ws) = fixture(r"\includegraphics{result.png}");
    for name in ["", ".", "..", "a/b", "a\\b", "CON", "nul.txt", "map.", "map ", "a\n", "a%", "a{b}", "result", "RESULT"] {
        assert!(rename(&mut ws, name).is_err(), "{name:?}");
    }
    assert!(dir.path().join("result.png").exists());
}
#[test]
fn undo_refuses_external_changes_to_any_member() {
    for target in ["map.png", "main.tex", "out/map.pdf"] {
        let (dir, mut ws) = fixture(r"\includegraphics{result.png}");
        convert(&mut ws);
        rename(&mut ws, "map").unwrap();
        let id = ws.conversion_history().unwrap()[0].id.clone();
        fs::write(dir.path().join(target), b"external edit after rename").unwrap();
        assert!(ws.undo_conversion(&id).is_err());
        assert_eq!(fs::read(dir.path().join(target)).unwrap(), b"external edit after rename");
        assert!(!dir.path().join("result.png").exists());
    }
}
#[test]
fn stale_snapshot_and_unsafe_journal_prevent_rename() {
    let (dir, mut ws) = fixture(r"\includegraphics{result.png}");
    let id = ws.project().images[0].id.clone();
    assert!(ws.rename_asset(&id, "map", "stale").is_err());
    fs::create_dir_all(dir.path().join(".texgo")).unwrap();
    fs::write(dir.path().join(".texgo/conversions.json"), b"damaged").unwrap();
    assert!(rename(&mut ws, "map").is_err());
    assert!(dir.path().join("result.png").exists());
}
#[test]
fn reopening_and_smart_convert_keep_managed_relationship() {
    let (dir, mut ws) = fixture(r"\includegraphics{result.png}");
    convert(&mut ws); apply_references(&mut ws);
    rename(&mut ws, "map").unwrap();
    let mut ws = Workspace::open(&dir.path().join("main.tex")).unwrap();
    assert_eq!(ws.project().status.pending_images, 0);
    image::RgbImage::from_pixel(20, 10, image::Rgb([240, 30, 10])).save(dir.path().join("map.png")).unwrap();
    let report = ws.smart_convert(&Default::default(), &AtomicBool::new(false), |_| {}, |_| {}).unwrap();
    assert_eq!(report.result.images.len(), 1);
    assert!(Path::new(report.result.images[0].pdf_path.as_ref().unwrap()).ends_with(Path::new("out").join("map.pdf")));
    let history = ws.conversion_history().unwrap();
    assert!(ws.undo_conversion(&history.iter().find(|e| e.rename.is_some()).unwrap().id).is_err());
    ws.undo_conversion(&history[0].id).unwrap();
    let renamed = ws.conversion_history().unwrap().into_iter().find(|e| e.rename.is_some()).unwrap();
    // Source was externally edited since rename: safe undo still refuses.
    assert!(!renamed.can_undo);
}
#[cfg(unix)]
#[test]
fn symlink_source_or_target_is_rejected() {
    use std::os::unix::fs::symlink;
    let (dir, mut ws) = fixture(r"\includegraphics{result.png}");
    symlink(dir.path().join("result.png"), dir.path().join("map.png")).unwrap();
    assert!(rename(&mut ws, "map").is_err());
    fs::remove_file(dir.path().join("map.png")).unwrap();
    fs::rename(dir.path().join("result.png"), dir.path().join("real.png")).unwrap();
    symlink(dir.path().join("real.png"), dir.path().join("result.png")).unwrap();
    assert!(rename(&mut ws, "map").is_err());
}
#[test]
fn permanent_ignore_identity_migrates_and_undo_restores_it() {
    let (dir, mut ws) = fixture(r"\includegraphics{result.png}");
    let id = ws.project().images[0].id.clone();
    ws.set_ignore_mode(&id, texgo_desktop::IgnoreMode::Permanent).unwrap();
    let original = fs::read(dir.path().join(".texgo/ignore.json")).unwrap();
    let renamed = rename(&mut ws, "map").unwrap();
    assert_eq!(renamed.project.images[0].ignore_mode, texgo_desktop::IgnoreMode::Permanent);
    let rules = fs::read_to_string(dir.path().join(".texgo/ignore.json")).unwrap();
    assert!(rules.contains("map.png"));
    assert!(!rules.contains("result.png"));
    let history = ws.conversion_history().unwrap();
    ws.undo_conversion(&history[0].id).unwrap();
    assert_eq!(fs::read(dir.path().join(".texgo/ignore.json")).unwrap(), original);
    let ws = Workspace::open(&dir.path().join("main.tex")).unwrap();
    assert_eq!(ws.project().images[0].ignore_mode, texgo_desktop::IgnoreMode::Permanent);
}
#[test]
fn session_ignore_migrates_without_becoming_permanent() {
    let (dir, mut ws) = fixture(r"\includegraphics{result.png}");
    let id = ws.project().images[0].id.clone(); ws.ignore(&id, true).unwrap();
    let renamed = rename(&mut ws, "map").unwrap();
    assert_eq!(renamed.project.images[0].ignore_mode, texgo_desktop::IgnoreMode::Session);
    assert!(!dir.path().join(".texgo/ignore.json").exists());
}
#[test]
fn dotted_basename_and_reference_whitespace_are_preserved() {
    let (dir, mut ws) = fixture(r"\includegraphics{  result.png  }");
    rename(&mut ws, "pressure.v2").unwrap();
    assert!(dir.path().join("pressure.v2.png").exists());
    assert_eq!(fs::read_to_string(dir.path().join("main.tex")).unwrap(), r"\includegraphics{  pressure.v2.png  }");
}
#[test]
fn failed_preflight_does_not_change_journal_or_ignore_metadata() {
    let (dir, mut ws) = fixture(r"\includegraphics{result.png}");
    convert(&mut ws);
    let id=ws.project().images[0].id.clone(); ws.set_ignore_mode(&id,texgo_desktop::IgnoreMode::Permanent).unwrap();
    let before_journal=fs::read(dir.path().join(".texgo/conversions.json")).unwrap();
    let before_ignore=fs::read(dir.path().join(".texgo/ignore.json")).unwrap();
    fs::write(dir.path().join("map.png"),b"existing").unwrap();
    assert!(rename(&mut ws,"map").is_err());
    assert_eq!(fs::read(dir.path().join(".texgo/conversions.json")).unwrap(),before_journal);
    assert_eq!(fs::read(dir.path().join(".texgo/ignore.json")).unwrap(),before_ignore);
    assert!(!dir.path().join(".texgo/rename-active.json").exists());
}
#[test]
fn tampered_undo_record_is_rejected_without_restoring_any_file() {
    let (dir, mut ws) = fixture(r"\includegraphics{result.png}");
    rename(&mut ws,"map").unwrap();
    let id=ws.conversion_history().unwrap()[0].id.clone();
    let path=dir.path().join(format!(".texgo/rename-undo/{id}.json"));
    let mut record:serde_json::Value=serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    record["files"][1]["before"]="dGFtcGVyZWQ=".into();
    fs::write(path,serde_json::to_vec(&record).unwrap()).unwrap();
    assert!(ws.undo_conversion(&id).is_err());
    assert!(!dir.path().join("result.png").exists());
    assert!(dir.path().join("map.png").exists());
}
#[test]
fn extensionless_target_collisions_are_rejected_but_explicit_extensions_remain_valid() {
    for extension in ["jpg","pdf"] {
        let (dir,mut ws)=fixture(r"\includegraphics{result}");
        fs::write(dir.path().join(format!("map.{extension}")),b"existing image").unwrap();
        assert!(rename(&mut ws,"map").is_err());
        assert!(dir.path().join("result.png").exists());
        assert!(!dir.path().join("map.png").exists());
    }
    let (dir,mut ws)=fixture(r"\includegraphics{result.png}");
    fs::write(dir.path().join("map.jpg"),b"existing image").unwrap();
    rename(&mut ws,"map").unwrap();
    assert!(dir.path().join("map.png").exists());
    assert_eq!(fs::read(dir.path().join("map.jpg")).unwrap(),b"existing image");
}
#[test]
fn graphicspath_rename_refuses_a_new_name_that_root_resolution_would_capture() {
    let dir=tempfile::tempdir().unwrap();
    fs::create_dir(dir.path().join("figures")).unwrap();
    image::RgbImage::new(20,10).save(dir.path().join("figures/result.png")).unwrap();
    fs::write(dir.path().join("main.tex"),r"\graphicspath{{figures/}}\includegraphics{result}").unwrap();
    let mut ws=Workspace::open(&dir.path().join("main.tex")).unwrap();
    let expected=ws.project().state_fingerprint.clone();let id=ws.project().images[0].id.clone();
    fs::write(dir.path().join("map.jpg"),b"root image").unwrap();
    let before=fs::read(dir.path().join("main.tex")).unwrap();
    assert!(ws.rename_asset(&id,"map",&expected).is_err());
    assert_eq!(fs::read(dir.path().join("main.tex")).unwrap(),before);
    assert!(dir.path().join("figures/result.png").exists());
    assert!(!dir.path().join("figures/map.png").exists());
}
