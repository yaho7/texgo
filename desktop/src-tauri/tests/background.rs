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
