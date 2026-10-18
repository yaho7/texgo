use crate::conversion;
use crate::models::*;
use crate::{scanner, transaction};
use crate::journal::{self, Journal, Managed};
use base64::{engine::general_purpose::STANDARD, Engine};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

pub struct Workspace {
    scan: scanner::Scan,
    converted: BTreeMap<String, StoredConversion>,
    extra_directories: Vec<(PathBuf, bool)>,
}

pub(crate) struct StoredConversion {
    pub path: PathBuf,
    pub source_hash: String,
    pub pdf_hash: String,
    pub dependencies: Vec<(PathBuf, String)>,
}

impl Workspace {
    pub fn open(main: &Path) -> Result<Self, String> {
        let scan = scanner::scan(main)?;
        let root = Path::new(&scan.project.root);
        let directories = Journal::load(root)?.directories(root);
        Self::from_scan(scan, directories)
    }

    pub fn open_directory(directory: &Path, recursive: bool) -> Result<Self, String> {
        let root = directory.canonicalize().map_err(|e| e.to_string())?;
        let journal = Journal::load(&root)?;
        Self::from_scan(scanner::scan_directory(&root, recursive, &journal.excluded(&root))?, journal.directories(&root))
    }

    fn from_scan(mut scan: scanner::Scan, extra_directories: Vec<(PathBuf, bool)>) -> Result<Self, String> {
        crate::manifest::restore_sources(&mut scan.project);
        let root = Path::new(&scan.project.root);
        let journal = Journal::load(root)?;
        let excluded = journal.excluded(root);
        for (directory, recursive) in &extra_directories {
            if let Err(error) = scanner::add_directory(&mut scan, directory, *recursive, &excluded) {
                scan.project.warnings.push(format!("附加图片目录暂不可用：{}：{error}", directory.display()));
            }
        }
        let mut workspace = Self { scan, converted: BTreeMap::new(), extra_directories };
        workspace.rehydrate(&journal);
        Ok(workspace)
    }

    fn rehydrate(&mut self, journal: &Journal) {
        let root = Path::new(&self.scan.project.root);
        self.converted.clear();
        self.scan.project.converted_images.clear();
        self.scan.project.undo_available = transaction::undo_available(root);
        for asset in &self.scan.project.images {
            for output in journal.preferred_outputs(&asset.relative_path) {
                let Some(managed) = journal.outputs.get(&output) else { continue; };
                if managed.source != asset.relative_path || !journal.valid(root, &output, managed) { continue; }
                let path = root.join(&output);
                self.scan.project.converted_images.push(ConvertedImage { id: asset.id.clone(), pdf_path: Some(path.to_string_lossy().into()),
                    bytes: fs::metadata(&path).ok().map(|m| m.len()), cached: true, error: None });
                self.converted.insert(asset.id.clone(), StoredConversion { path, source_hash: managed.source_hash.clone(),
                    pdf_hash: managed.pdf_hash.clone(), dependencies: managed.dependencies.iter().map(|(p, h)| (root.join(p), h.clone())).collect() });
                break;
            }
        }
    }

    pub fn add_image_directory(&mut self, directory: &Path, recursive: bool) -> Result<Project, String> {
        let root = Path::new(&self.scan.project.root);
        let directory = if directory.is_absolute() { directory.to_path_buf() } else { root.join(directory) };
        if directory.starts_with(root) { journal::safe_path(root, &directory)?; }
        if fs::symlink_metadata(&directory).is_ok_and(|metadata| metadata.file_type().is_symlink()) { return Err("图片目录不能是符号链接".into()); }
        let directory = directory.canonicalize().map_err(|e| e.to_string())?;
        journal::safe_path(root, &directory)?;
        if !directory.is_dir() { return Err("Image directory does not exist".into()); }
        let excluded = Journal::load(root)?.excluded(root);
        scanner::add_directory(&mut scanner::Scan { project: self.scan.project.clone(), sources: BTreeMap::new() }, &directory, recursive, &excluded)?;
        let mut directories = self.extra_directories.clone();
        directories.retain(|(path, _)| path != &directory);
        directories.push((directory, recursive));
        let refreshed = self.scan_again(directories.clone())?;
        {
            let _lock = transaction::lock_project(root)?;
            let mut journal = Journal::load(root)?;
            journal.directories = directories.iter().map(|(path, recursive)| Ok((journal::relative(root, path)?, *recursive))).collect::<Result<_, String>>()?;
            journal.save(root)?;
        }
        *self = refreshed;
        Ok(self.project().clone())
    }

    fn scan_again(&self, directories: Vec<(PathBuf, bool)>) -> Result<Self, String> {
        let root = Path::new(&self.scan.project.root);
        let scan = if self.scan.project.mode == "directory" {
            let journal = Journal::load(root)?;
            scanner::scan_directory(root, self.scan.project.recursive, &journal.excluded(root))?
        } else { scanner::scan(Path::new(&self.scan.project.main_file))? };
        Self::from_scan(scan, directories)
    }

    pub fn refresh(&mut self) -> Result<Project, String> {
        *self = self.scan_again(self.extra_directories.clone())?;
        Ok(self.project().clone())
    }

    pub fn refresh_workspace(&mut self) -> Result<Project, String> { self.refresh() }

    pub fn conversion_history(&self) -> Result<Vec<ConversionHistoryEntry>, String> {
        let root = Path::new(&self.scan.project.root);
        Ok(Journal::load(root)?.history(root))
    }

    pub fn undo_conversion(&mut self, entry_id: &str) -> Result<Project, String> {
        let root = Path::new(&self.scan.project.root);
        {
            let _lock = transaction::lock_project(root)?;
            let mut journal = Journal::load(root)?;
            journal.undo(root, entry_id)?;
        }
        self.refresh()
    }

    pub fn project(&self) -> &Project { &self.scan.project }

    pub fn convert(&mut self, options: &ConversionOptions, cancel: &AtomicBool, progress: impl Fn(Progress)) -> Result<ConversionResult, String> {
        conversion::validate(options)?;
        let selected: HashSet<&str> = options.image_ids.iter().map(String::as_str).collect();
        if selected.is_empty() { return Err("请先选择图片".into()); }
        if selected.iter().any(|id| !self.scan.project.images.iter().any(|asset| asset.id == *id && asset.status == "ready")) {
            return Err("所选图片不存在或无法转换，请重新扫描".into());
        }
        // Any failure below must not leave an older output eligible for replacement.
        self.converted.retain(|id, _| !selected.contains(id.as_str()));
        self.scan.project.converted_images.retain(|image| !selected.contains(image.id.as_str()));
        let root = PathBuf::from(&self.scan.project.root);
        let _lock = transaction::lock_project(&root)?;
        let mut journal = Journal::load(&root)?;
        let batch = journal.begin(&root, options)?;
        // Check the entire source tree, including images not referenced by TeX or selected in the UI.
        let preflight = (|| {
            let output_dir = journal::output_directory(&root, &options.output_dir)?;
            if output_dir.is_dir() && !scanner::directory_images(&output_dir, true, &[])?.is_empty() {
                return Err("输出目录包含原图片，请使用独立的新目录".to_string());
            }
            let mut excluded = journal.excluded(&root);
            excluded.push(output_dir.clone());
            let mut sources = scanner::directory_images(&root, true, &excluded)?;
            sources.extend(self.scan.project.images.iter().filter_map(|asset| asset.path.as_ref().map(PathBuf::from)).filter(|path| scanner::supported_source(path)));
            sources.sort(); sources.dedup();
            let mut destinations = BTreeMap::new();
            let targets: HashSet<_> = self.scan.project.images.iter().filter(|asset| selected.contains(asset.id.as_str()))
                .map(|asset| output_dir.join(&asset.relative_path).with_extension("pdf").to_string_lossy().to_lowercase()).collect();
            for source in sources {
                journal::safe_path(&root, &source)?;
                if source.starts_with(&output_dir) { return Err("Output directory contains workspace image sources".to_string()); }
                let output = output_dir.join(source.strip_prefix(&root).map_err(|e| e.to_string())?).with_extension("pdf");
                // Conservative case folding also protects case-insensitive filesystems.
                let key = output.to_string_lossy().to_lowercase();
                if !targets.contains(&key) { continue; }
                if let Some(previous) = destinations.insert(key, source.clone()) {
                    return Err(format!("同名 PDF 冲突：{} 与 {}，请调整源文件名后重新扫描", previous.display(), source.display()));
                }
            }
            Ok(output_dir)
        })();
        let mut images = Vec::new();
        let mut cancelled = false;
        for asset in self.scan.project.images.iter().filter(|asset| selected.contains(asset.id.as_str())) {
            if cancel.load(Ordering::Relaxed) { cancelled = true; break; }
            let output = preflight.as_ref().map(|dir| dir.join(&asset.relative_path).with_extension("pdf"));
            journal.record(&root, batch, ConversionHistoryFile { source: asset.relative_path.clone(),
                output: output.as_ref().ok().and_then(|path| path.strip_prefix(&root).ok()).map(|p| p.to_string_lossy().replace('\\', "/")).unwrap_or_default(),
                cached: false, error: Some("Conversion interrupted before completion".into()) })?;
            progress(Progress { current: images.len(), total: selected.len(), name: asset.relative_path.clone(), status: "converting".into() });
            let result = (|| {
                let output = output.map_err(Clone::clone)?;
                let path = Path::new(asset.path.as_deref().ok_or("图片路径不存在")?);
                journal::safe_path(&root, path)?;
                let output_relative = journal::relative(&root, &output)?;
                journal.verify_managed(&root, &output_relative, &asset.relative_path)?;
                let rendered = conversion::render(path, &root, options)?;
                let managed = Managed { source: asset.relative_path.clone(), source_hash: rendered.source_hash,
                    pdf_hash: digest(&rendered.pdf), key: rendered.key,
                    dependencies: rendered.dependencies.iter().map(|(p, h)| Ok((journal::relative(&root, p)?, h.clone()))).collect::<Result<_, String>>()? };
                journal.valid_sources(&root, &managed)?;
                let cached = journal.outputs.get(&output_relative).is_some_and(|old| old.key == managed.key && journal.valid(&root, &output_relative, old));
                if !cached { journal.write(&root, batch, &output_relative, managed, &rendered.pdf)?; }
                Ok(ConvertedImage { id: asset.id.clone(), pdf_path: Some(output.to_string_lossy().into()),
                    bytes: fs::metadata(output).ok().map(|m| m.len()), cached, error: None })
            })();
            let converted = result.unwrap_or_else(|error| ConvertedImage { id: asset.id.clone(), pdf_path: None, bytes: None, cached: false, error: Some(error) });
            journal.finish_file(&root, batch, converted.cached, converted.error.clone())?;
            let status = if converted.error.is_some() { "error" } else { "done" };
            images.push(converted);
            progress(Progress { current: images.len(), total: selected.len(), name: asset.relative_path.clone(), status: status.into() });
        }
        cancelled |= cancel.load(Ordering::Relaxed);
        journal.finish_batch(&root, batch, cancelled)?;
        self.rehydrate(&journal);
        // Keep a failed or cancelled selection out of this session's reference plan.
        let succeeded: HashSet<_> = images.iter().filter(|image| image.error.is_none() && image.pdf_path.is_some()).map(|image| image.id.as_str()).collect();
        self.converted.retain(|id, _| !selected.contains(id.as_str()) || succeeded.contains(id.as_str()));
        self.scan.project.converted_images.retain(|image| !selected.contains(image.id.as_str()) || succeeded.contains(image.id.as_str()));
        Ok(ConversionResult { images, cancelled })
    }

    pub fn plan(&self) -> Result<ReplacementPlan, String> {
        Journal::load(Path::new(&self.scan.project.root))?.ensure_settled()?;
        Ok(transaction::prepare(&self.scan.project, &self.scan.sources, &self.converted)?.plan)
    }

    pub fn apply(&mut self) -> Result<MutationResult, String> {
        let result = (|| {
            let root = Path::new(&self.scan.project.root);
            let _lock = transaction::lock_project(root)?;
            Journal::load(root)?.ensure_settled()?;
            let prepared = transaction::prepare(&self.scan.project, &self.scan.sources, &self.converted)?;
            transaction::apply(&self.scan.project, prepared)
        })();
        self.scan.project.undo_available = transaction::undo_available(Path::new(&self.scan.project.root));
        if result.is_ok() {
            self.refresh()?;
        }
        result
    }

    pub fn undo(&mut self) -> Result<MutationResult, String> {
        let result = transaction::undo(&self.scan.project)?;
        self.refresh()?;
        Ok(result)
    }

    pub fn preview(&self, image_id: &str, converted: bool) -> Result<AssetPreview, String> {
        let asset = self.scan.project.images.iter().find(|asset| asset.id == image_id).ok_or("找不到图片")?;
        let path = if converted {
            self.converted.get(image_id).map(|entry| entry.path.as_path()).ok_or("请先转换此图片")?
        } else { Path::new(asset.path.as_deref().ok_or("图片路径未解析")?) };
        let path = path.canonicalize().map_err(|e| e.to_string())?;
        if !path.starts_with(&self.scan.project.root) { return Err("图片位于项目之外".into()); }
        if fs::metadata(&path).map_err(|e| e.to_string())?.len() > 64 * 1024 * 1024 { return Err("文件过大，无法内嵌预览".into()); }
        let bytes = fs::read(&path).map_err(|e| e.to_string())?;
        if path.extension().and_then(|ext| ext.to_str()).is_some_and(|ext| ext.eq_ignore_ascii_case("pdf")) {
            return Ok(AssetPreview { data: STANDARD.encode(bytes), kind: "pdf".into() });
        }
        // Decode raster formats so TIFF/BMP preview consistently in every WebView.
        if asset.format == "svg" {
            return Ok(AssetPreview { data: format!("data:image/svg+xml;base64,{}", STANDARD.encode(bytes)), kind: "image".into() });
        }
        let mut reader = image::ImageReader::new(std::io::Cursor::new(bytes)).with_guessed_format().map_err(|e| e.to_string())?;
        let mut limits = image::Limits::default();
        limits.max_alloc = Some(256 * 1024 * 1024);
        reader.limits(limits);
        let image = reader.decode().map_err(|e| e.to_string())?.thumbnail(1600, 1600);
        let mut png = std::io::Cursor::new(Vec::new());
        image.write_to(&mut png, image::ImageFormat::Png).map_err(|e| e.to_string())?;
        Ok(AssetPreview { data: format!("data:image/png;base64,{}", STANDARD.encode(png.into_inner())), kind: "image".into() })
    }
}

pub(crate) fn digest(bytes: &[u8]) -> String { format!("{:x}", Sha256::digest(bytes)) }

pub(crate) fn save_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("文件目录不存在")?;
    let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    if let Ok(metadata) = fs::metadata(path) { file.as_file().set_permissions(metadata.permissions()).map_err(|e| e.to_string())?; }
    file.write_all(bytes).map_err(|e| e.to_string())?;
    file.as_file().sync_all().map_err(|e| e.to_string())?;
    file.persist(path).map_err(|e| e.to_string())?;
    sync_directory(parent)?;
    Ok(())
}

pub(crate) fn sync_directory(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    fs::File::open(path).and_then(|directory| directory.sync_all()).map_err(|e| e.to_string())?;
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}
