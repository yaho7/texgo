use std::{fs, path::Path};
use base64::{engine::general_purpose::STANDARD, Engine};
use texgo_desktop::Workspace;

fn workspace(root: &Path, name: &str) -> Workspace {
    fs::write(root.join("main.tex"), format!("\\includegraphics{{{name}}}")).unwrap();
    Workspace::open(&root.join("main.tex")).unwrap()
}
fn pixels(ws: &Workspace) -> image::RgbaImage {
    let asset = &ws.project().images[0];
    let preview = ws.thumbnail(&asset.id, &ws.project().main_file).unwrap();
    assert_eq!(preview.kind, "image");
    let encoded = preview.data.strip_prefix("data:image/png;base64,").unwrap();
    image::load_from_memory(&STANDARD.decode(encoded).unwrap()).unwrap().into_rgba8()
}
#[test]
fn raster_thumbnail_preserves_content_and_source_files_with_a_bounded_size() {
    let dir = tempfile::tempdir().unwrap(); let root = dir.path().canonicalize().unwrap();
    image::RgbImage::from_pixel(1200, 600, image::Rgb([30, 80, 210])).save(root.join("plot.png")).unwrap();
    let ws = workspace(&root, "plot.png");
    let before = fs::read(root.join("main.tex")).unwrap();
    let original = fs::read(root.join("plot.png")).unwrap();
    let thumbnail = pixels(&ws);
    assert_eq!(thumbnail.dimensions(), (120, 60));
    assert_eq!(thumbnail.get_pixel(60, 30).0, [30, 80, 210, 255]);
    assert_eq!(fs::read(root.join("main.tex")).unwrap(), before);
    assert_eq!(fs::read(root.join("plot.png")).unwrap(), original);
    assert!(!root.join("texgo-pdf").exists());
}
#[test]
fn svg_thumbnail_renders_vector_content_but_never_opens_external_resources() {
    let dir = tempfile::tempdir().unwrap(); let root = dir.path().canonicalize().unwrap();
    fs::write(root.join("diagram.svg"), r#"<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120"><rect width="240" height="120" fill="red"/></svg>"#).unwrap();
    let ws = workspace(&root, "diagram.svg");
    assert_eq!(pixels(&ws).get_pixel(60, 30).0, [255, 0, 0, 255]);
    fs::write(root.join("diagram.svg"), r#"<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><image href="https://example.invalid/secret.png" width="100" height="100"/></svg>"#).unwrap();
    assert!(ws.thumbnail(&ws.project().images[0].id, &ws.project().main_file).is_err());
}
#[test]
fn thumbnails_require_current_project_and_known_source_and_bound_pdf_reads() {
    let dir = tempfile::tempdir().unwrap(); let root = dir.path().canonicalize().unwrap();
    let bytes = b"%PDF-1.4\nthumbnail fixture";
    fs::write(root.join("paper.pdf"), bytes).unwrap();
    let ws = workspace(&root, "paper.pdf"); let asset = &ws.project().images[0];
    assert!(ws.thumbnail(&asset.id, "/other/main.tex").is_err());
    assert!(ws.thumbnail("unknown", &ws.project().main_file).is_err());
    let preview = ws.thumbnail(&asset.id, &ws.project().main_file).unwrap();
    assert_eq!(preview.kind, "pdf"); assert_eq!(STANDARD.decode(preview.data).unwrap(), bytes);
    fs::File::create(root.join("paper.pdf")).unwrap().set_len(8 * 1024 * 1024 + 1).unwrap();
    assert!(ws.thumbnail(&asset.id, &ws.project().main_file).is_err());
}
#[cfg(unix)]
#[test]
fn thumbnail_rejects_a_source_replaced_by_a_symlink_and_a_replaced_root() {
    let dir = tempfile::tempdir().unwrap(); let root = dir.path().join("paper"); fs::create_dir(&root).unwrap();
    let root = root.canonicalize().unwrap();
    image::RgbImage::new(2, 2).save(root.join("plot.png")).unwrap();
    let ws = workspace(&root, "plot.png"); let asset = &ws.project().images[0];
    let outside = dir.path().join("outside.png"); image::RgbImage::new(2, 2).save(&outside).unwrap();
    fs::remove_file(root.join("plot.png")).unwrap(); std::os::unix::fs::symlink(&outside, root.join("plot.png")).unwrap();
    assert!(ws.thumbnail(&asset.id, &ws.project().main_file).is_err());
    fs::rename(&root, dir.path().join("old-paper")).unwrap(); fs::create_dir(&root).unwrap();
    assert!(ws.thumbnail(&asset.id, &ws.project().main_file).is_err());
}

#[test]
fn svg_thumbnail_validates_embedded_images_before_rendering() {
    let dir = tempfile::tempdir().unwrap(); let root = dir.path().canonicalize().unwrap();
    image::RgbImage::from_pixel(2, 2, image::Rgb([40, 120, 240])).save(root.join("embedded.png")).unwrap();
    let data = STANDARD.encode(fs::read(root.join("embedded.png")).unwrap());
    let svg = |mime: &str| format!(r#"<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><image href="data:{mime};base64,{data}" width="120" height="120"/></svg>"#);
    fs::write(root.join("diagram.svg"), svg("image/png")).unwrap();
    let ws = workspace(&root, "diagram.svg");
    assert_eq!(pixels(&ws).get_pixel(60, 60).0, [40, 120, 240, 255]);
    fs::write(root.join("diagram.svg"), svg("image/svg+xml")).unwrap();
    assert!(ws.thumbnail(&ws.project().images[0].id, &ws.project().main_file).is_err());
}
