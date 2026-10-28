//! Read-only, bounded raster thumbnails; external SVG resources are never opened.
use crate::AssetPreview;
use base64::{engine::general_purpose::STANDARD, Engine};
use std::{io::Cursor, path::PathBuf, sync::{Arc, OnceLock, atomic::{AtomicBool, Ordering}}};

pub(crate) struct Source {
    pub(crate) root: crate::observation::ObservationRoot,
    pub(crate) path: PathBuf,
    pub(crate) format: String,
}
impl Source {
    pub(crate) fn render(&self) -> Result<AssetPreview, String> {
        let limit = if self.format == "pdf" { 8 * 1024 * 1024 } else if self.format == "svg" { 512 * 1024 } else { 32 * 1024 * 1024 };
        let bytes = self.root.read_bounded(&self.path, limit)?;
        render(&bytes, &self.format)
    }
}

const EDGE: u32 = 120;
const PIXELS: u64 = 16 * 1024 * 1024;
static FONTS: OnceLock<Arc<resvg::usvg::fontdb::Database>> = OnceLock::new();

pub(crate) fn render(bytes: &[u8], format: &str) -> Result<AssetPreview, String> {
    if format == "pdf" { return Ok(AssetPreview { kind: "pdf".into(), data: STANDARD.encode(bytes) }); }
    let png = if format == "svg" { svg(bytes)? } else {
        let reader = bounded_reader(bytes)?;
        let (width, height) = reader.into_dimensions().map_err(|error| error.to_string())?;
        if u64::from(width) * u64::from(height) > PIXELS { return Err("图片分辨率超出缩略图限制".into()); }
        let reader = bounded_reader(bytes)?;
        let decoded = reader.decode().map_err(|error| error.to_string())?.thumbnail(EDGE, EDGE);
        let mut output = Cursor::new(Vec::new()); decoded.write_to(&mut output, image::ImageFormat::Png).map_err(|error| error.to_string())?; output.into_inner()
    };
    Ok(AssetPreview { kind: "image".into(), data: format!("data:image/png;base64,{}", STANDARD.encode(png)) })
}

fn bounded_reader(bytes: &[u8]) -> Result<image::ImageReader<Cursor<&[u8]>>, String> {
    let mut reader = image::ImageReader::new(Cursor::new(bytes)).with_guessed_format().map_err(|error| error.to_string())?;
    let mut limits = image::Limits::default(); limits.max_alloc = Some(96 * 1024 * 1024); reader.limits(limits);
    Ok(reader)
}

fn svg(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let mut options = resvg::usvg::Options::default();
    options.fontdb = FONTS.get_or_init(|| { let mut db = resvg::usvg::fontdb::Database::new(); db.load_system_fonts(); Arc::new(db) }).clone();
    let blocked = Arc::new(AtomicBool::new(false));
    let external = blocked.clone();
    options.image_href_resolver.resolve_string = Box::new(move |_, _| { external.store(true, Ordering::Relaxed); None });
    let embedded = blocked.clone();
    // Validate embedded raster dimensions before resvg decodes them. Nested SVGs
    // and unknown payloads fall back to a format icon, never a partial thumbnail.
    let resolver = resvg::usvg::ImageHrefResolver::default_data_resolver();
    options.image_href_resolver.resolve_data = Box::new(move |mime, data, settings| {
        let dimensions = bounded_reader(data.as_slice()).ok().and_then(|reader| reader.into_dimensions().ok());
        if !dimensions.is_some_and(|(w, h)| u64::from(w) * u64::from(h) <= PIXELS) {
            embedded.store(true, Ordering::Relaxed); return None;
        }
        let image = resolver(mime, data, settings);
        if image.is_none() { embedded.store(true, Ordering::Relaxed); }
        image
    });
    let tree = resvg::usvg::Tree::from_data(bytes, &options).map_err(|error| error.to_string())?;
    if blocked.load(Ordering::Relaxed) { return Err("SVG 依赖外部或不支持的资源".into()); }
    let size = tree.size();
    let scale = (EDGE as f32 / size.width()).min(EDGE as f32 / size.height());
    let width = (size.width() * scale).ceil().clamp(1.0, EDGE as f32) as u32;
    let height = (size.height() * scale).ceil().clamp(1.0, EDGE as f32) as u32;
    let mut pixmap = resvg::tiny_skia::Pixmap::new(width, height).ok_or("缩略图无法分配内存")?;
    resvg::render(&tree, resvg::tiny_skia::Transform::from_scale(scale, scale), &mut pixmap.as_mut());
    pixmap.encode_png().map_err(|error| error.to_string())
}
