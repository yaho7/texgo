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
