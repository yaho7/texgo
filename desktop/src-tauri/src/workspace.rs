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

#[derive(Clone)]
pub struct Workspace {
    scan: scanner::Scan,
    converted: BTreeMap<String, StoredConversion>,
    failures: BTreeMap<String, (String, Option<String>)>,
    observed: Option<crate::observation::Snapshot>,
    pending_repair: Option<(String, PathBuf, ReplacementPlan)>,
    invalidated: HashSet<String>,
    ignored: HashSet<String>,
}

#[derive(Clone)]
pub(crate) struct StoredConversion {
    pub path: PathBuf,
    pub source_hash: String,
    pub pdf_hash: String,
    pub dependencies: Vec<(PathBuf, String)>,
}

impl Workspace {
    pub fn open(main: &Path) -> Result<Self, String> {
        let scan = scanner::scan(main)?;
        Self::from_scan(scan)
    }

    fn from_scan(mut scan: scanner::Scan) -> Result<Self, String> {
        crate::manifest::restore_sources(&mut scan.project);
        let root = Path::new(&scan.project.root);
        let journal = Journal::load(root);
        let mut workspace = Self { scan, converted: BTreeMap::new(), failures: BTreeMap::new(), observed: None, pending_repair: None, invalidated: HashSet::new(), ignored: HashSet::new() };
        if let Ok(journal) = journal {
            workspace.rehydrate(&journal);
            for asset in &workspace.scan.project.images {
                if let Some(failure) = journal.source_failure(Path::new(&workspace.scan.project.root), &asset.relative_path) {
                    workspace.failures.insert(asset.id.clone(), failure);
                }
            }
        }
        workspace.invalidated.extend(workspace.failures.keys().cloned());
        workspace.converted.retain(|id, _| !workspace.failures.contains_key(id));
        workspace.scan.project.converted_images.retain(|image| !workspace.failures.contains_key(&image.id));
        workspace.update_status();
        workspace.observed = crate::observation::snapshot(Path::new(&workspace.scan.project.root)).ok();
        Ok(workspace)
    }

    fn rehydrate(&mut self, journal: &Journal) {
        let root = Path::new(&self.scan.project.root);
        self.converted.clear();
        self.scan.project.converted_images.clear();
        self.scan.project.undo_available = transaction::standalone_undo_available(root).unwrap_or_else(|_| transaction::legacy_undo_available(root));
        for asset in &mut self.scan.project.images {
            asset.update_available = false;
            for output in journal.preferred_outputs(&asset.relative_path) {
                let Some(managed) = journal.outputs.get(&output) else { continue; };
                if managed.source != asset.relative_path || !journal.valid_output(root, &output, managed) { continue; }
                if journal.valid_sources(root, managed).is_err() {
                    asset.update_available |= asset.status == "ready" && journal.sources_changed(root, managed);
                    continue;
                }
                // A current valid output takes precedence over older stale conversions.
                asset.update_available = false;
                // Failed output remains ineligible for reference replacement, but changed
                // source fingerprints above must still be visible for a safe Smart retry.
                if self.invalidated.contains(&asset.id) { break; }
                let path = root.join(&output);
                self.scan.project.converted_images.push(ConvertedImage { id: asset.id.clone(), pdf_path: Some(path.to_string_lossy().into()),
                    bytes: fs::metadata(&path).ok().map(|m| m.len()), cached: true, error: None });
                self.converted.insert(asset.id.clone(), StoredConversion { path, source_hash: managed.source_hash.clone(),
                    pdf_hash: managed.pdf_hash.clone(), dependencies: managed.dependencies.iter().map(|(p, h)| (root.join(p), h.clone())).collect() });
                break;
            }
        }
    }

    fn scan_again(&self) -> Result<Self, String> {
        let scan = scanner::scan(Path::new(&self.scan.project.main_file))?;
        let mut refreshed = Self::from_scan(scan)?;
        refreshed.ignored = self.ignored.clone();
        refreshed.ignored.retain(|id| refreshed.scan.project.images.iter().any(|asset| &asset.id == id));
        refreshed.invalidated = self.invalidated.clone();
        refreshed.failures.extend(self.failures.iter().filter(|(id, (_, fingerprint))| {
            refreshed.scan.project.images.iter().find(|asset| &asset.id == *id)
                .is_some_and(|asset| Self::source_fingerprint(asset) == *fingerprint)
        }).map(|(id, failure)| (id.clone(), failure.clone())).collect::<BTreeMap<_, _>>());
        refreshed.converted.retain(|id, _| !refreshed.invalidated.contains(id));
        refreshed.scan.project.converted_images.retain(|image| !refreshed.invalidated.contains(&image.id));
        refreshed.update_status();
        Ok(refreshed)
    }

    pub fn refresh(&mut self) -> Result<Project, String> {
        *self = self.scan_again()?;
        Ok(self.project().clone())
    }

    pub fn refresh_workspace(&mut self) -> Result<Project, String> { self.refresh() }

    pub fn poll_changes(&mut self) -> Result<Option<Project>, String> {
        let observed = crate::observation::snapshot(Path::new(&self.scan.project.root))?;
        if self.observed.as_ref() == Some(&observed) { return Ok(None); }
        self.refresh().map(Some)
    }

    pub fn conversion_history(&self) -> Result<Vec<ConversionHistoryEntry>, String> {
        let root = Path::new(&self.scan.project.root);
        Ok(Journal::load(root)?.history(root))
    }

    pub fn undo_conversion(&mut self, entry_id: &str) -> Result<Project, String> {
        let root = Path::new(&self.scan.project.root);
        let result = (|| {
            let _lock = transaction::lock_project(root)?;
            transaction::undo_batch_locked(&self.scan.project, entry_id)
        })();
        if result.is_ok() {
            // The journal is authoritative after undo; do not revive session-only
            // failures or invalidate outputs which have just been restored.
            self.failures.clear();
            self.invalidated.clear();
        }
        let refreshed = self.refresh();
        result?;
        refreshed
    }

    pub fn project(&self) -> &Project { &self.scan.project }

    pub fn ignored(&self) -> &HashSet<String> { &self.ignored }

    pub fn ignore(&mut self, id: &str, ignored: bool) -> Result<(), String> {
        if !self.project().images.iter().any(|a| a.id == id) { return Err("找不到图片".into()); }
        if ignored { self.ignored.insert(id.into()); } else { self.ignored.remove(id); }
        self.update_status();
        Ok(())
    }

    fn source_fingerprint(asset: &ImageAsset) -> Option<String> {
        asset.path.as_ref().and_then(|path| fs::read(path).ok()).map(|bytes| digest(&bytes))
    }

    fn review_project(&self) -> Project {
        let mut project = self.scan.project.clone();
        project.images.retain(|asset| !self.ignored.contains(&asset.id));
        project
    }

    pub fn pending_references(&self) -> usize {
        transaction::prepare(&self.review_project(), &self.scan.sources, &self.converted)
            .map(|prepared| prepared.plan.reference_count).unwrap_or(0)
    }

    fn update_status(&mut self) {
        let mut status = WorkspaceStatus { total_images: self.scan.project.images.len(),
            pending_references: self.pending_references(), ..Default::default() };
        let root = Path::new(&self.scan.project.root);
        let journal = Journal::load(root);
        match &journal {
            Ok(journal) => status.blocking_reason = journal.ensure_settled().err(),
            Err(error) => status.blocking_reason = Some(error.clone()),
        }
        if let Err(error) = transaction::prepare(&self.review_project(), &self.scan.sources, &self.converted) {
            status.blocking_reason.get_or_insert(error);
        }
        for asset in &self.scan.project.images {
            if self.ignored.contains(&asset.id) { status.ignored_image_ids.push(asset.id.clone()); continue; }
            let unsafe_output = journal.as_ref().ok().is_some_and(|journal| {
                journal.preferred_outputs(&asset.relative_path).first().is_some_and(|output| {
                    journal.outputs.get(output).is_some_and(|managed| root.join(output).exists() && !journal.valid_output(root, output, managed))
                })
            });
            if unsafe_output {
                status.blocking_reason.get_or_insert_with(|| "输出文件已被外部修改，无法安全覆盖，请检查问题图片".into());
            }
            if matches!(asset.status.as_str(), "missing" | "ambiguous" | "unsupported" | "error") || self.failures.contains_key(&asset.id) || unsafe_output {
                status.problem_ids.push(asset.id.clone());
            } else if asset.status == "ready" && (asset.update_available || !self.converted.contains_key(&asset.id)) {
                status.pending_image_ids.push(asset.id.clone());
            } else if asset.status == "pdf" || self.converted.contains_key(&asset.id) {
                status.completed_images += 1;
                status.completed_image_ids.push(asset.id.clone());
            }
        }
        self.scan.project.converted_images.retain(|image| image.error.is_none());
        self.scan.project.converted_images.extend(self.failures.iter().map(|(id, (error, _))| ConvertedImage {
            id: id.clone(), pdf_path: None, bytes: None, cached: false, error: Some(error.clone()),
        }));
        self.scan.project.status = status.finish();
    }

    pub fn ensure_can_convert(&self, allow_unreviewed: bool) -> Result<(), String> {
        Journal::load(Path::new(&self.project().root))?.ensure_settled()?;
        if !allow_unreviewed && self.pending_references() > 0 {
            return Err("存在未审核引用，请先检查引用变更".into());
        }
        Ok(())
    }

    pub fn convert(&mut self, options: &ConversionOptions, cancel: &AtomicBool, progress: impl Fn(Progress)) -> Result<ConversionResult, String> {
        let result = self.convert_internal(options, cancel, progress, |_| {}, true);
        self.update_status();
        result
    }

    pub fn convert_with_results(&mut self, options: &ConversionOptions, cancel: &AtomicBool, progress: impl Fn(Progress), on_image: impl Fn(ConvertedImage)) -> Result<ConversionResult, String> {
        let result = self.convert_internal(options, cancel, progress, on_image, false);
        self.update_status();
        result
    }

    pub(crate) fn convert_for_pipeline(&mut self, options: &ConversionOptions) -> Result<ConversionResult, String> {
        let result = self.convert_internal(options, &AtomicBool::new(false), |_| {}, |_| {}, true);
        self.update_status();
        result
    }

    fn convert_internal(&mut self, options: &ConversionOptions, cancel: &AtomicBool, progress: impl Fn(Progress), on_image: impl Fn(ConvertedImage), allow_managed_refresh: bool) -> Result<ConversionResult, String> {
        conversion::validate(options)?;
        let selected: HashSet<&str> = options.image_ids.iter().map(String::as_str).collect();
        if selected.is_empty() { return Err("请先选择图片".into()); }
        if selected.iter().any(|id| !self.scan.project.images.iter().any(|asset| asset.id == *id && asset.status == "ready")) {
            return Err("所选图片不存在或无法转换，请重新扫描".into());
        }
        // Any failure below must not leave an older output eligible for replacement.
        self.invalidated.extend(selected.iter().map(|id| (*id).to_owned()));
        self.converted.retain(|id, _| !selected.contains(id.as_str()));
        self.scan.project.converted_images.retain(|image| !selected.contains(image.id.as_str()));
        let root = PathBuf::from(&self.scan.project.root);
        let _lock = transaction::lock_project(&root)?;
        let mut journal = Journal::load(&root)?;
        let preserving_standalone = allow_managed_refresh && transaction::standalone_undo_available(&root)?;
        let batch = if allow_managed_refresh { journal.begin_managed_refresh(&root, options, &self.scan.project)? } else { journal.begin(&root, options)? };
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
            journal.record(&root, batch, ConversionHistoryFile { source: asset.relative_path.clone(), source_hash: Self::source_fingerprint(asset),
                output: output.as_ref().ok().and_then(|path| path.strip_prefix(&root).ok()).map(|p| p.to_string_lossy().replace('\\', "/")).unwrap_or_default(),
                cached: false, error: Some("Conversion interrupted before completion".into()) })?;
            progress(Progress { current: images.len(), total: selected.len(), name: asset.relative_path.clone(), status: "converting".into() });
            let result = (|| {
                let output = output.map_err(Clone::clone)?;
                if preserving_standalone { transaction::validate_standalone_refresh(&self.scan.project)?; }
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
                if !cached {
                    if preserving_standalone { transaction::validate_standalone_refresh(&self.scan.project)?; }
                    journal.write(&root, batch, &output_relative, managed, &rendered.pdf)?;
                }
                Ok(ConvertedImage { id: asset.id.clone(), pdf_path: Some(output.to_string_lossy().into()),
                    bytes: fs::metadata(output).ok().map(|m| m.len()), cached, error: None })
            })();
            let converted = result.unwrap_or_else(|error| ConvertedImage { id: asset.id.clone(), pdf_path: None, bytes: None, cached: false, error: Some(error) });
            journal.finish_file(&root, batch, converted.cached, converted.error.clone())?;
            let status = if converted.error.is_some() { "error" } else { "done" };
            on_image(converted.clone());
            images.push(converted);
            progress(Progress { current: images.len(), total: selected.len(), name: asset.relative_path.clone(), status: status.into() });
        }
        cancelled |= cancel.load(Ordering::Relaxed);
        journal.finish_batch(&root, batch, cancelled)?;
        // Keep a failed or cancelled selection out of this session's reference plan.
        let succeeded: HashSet<_> = images.iter().filter(|image| image.error.is_none() && image.pdf_path.is_some()).map(|image| image.id.as_str()).collect();
        self.invalidated.retain(|id| !succeeded.contains(id.as_str()));
        self.rehydrate(&journal);
        self.converted.retain(|id, _| !selected.contains(id.as_str()) || succeeded.contains(id.as_str()));
        self.scan.project.converted_images.retain(|image| !selected.contains(image.id.as_str()) || succeeded.contains(image.id.as_str()));
        for image in &images {
            if let Some(error) = &image.error {
                let fingerprint = self.scan.project.images.iter().find(|asset| asset.id == image.id).and_then(Self::source_fingerprint);
                self.failures.insert(image.id.clone(), (error.clone(), fingerprint));
            } else { self.failures.remove(&image.id); }
        }
        self.update_status();
        Ok(ConversionResult { images, cancelled })
    }

    /// GUI and Smart Convert share one update operation. Existing managed PDFs
    /// keep their destination even if the user's default output directory changed.
    /// Empty selection means every pending image; explicit IDs support selection mode.
    pub fn update_pending_with_results(&mut self, options: &ConversionOptions, cancel: &AtomicBool,
        progress: impl Fn(Progress), on_image: impl Fn(ConvertedImage)) -> Result<ConversionResult, String> {
        conversion::validate(options)?;
        if let Some(reason) = &self.project().status.blocking_reason { return Err(reason.clone()); }
        let ids = if options.image_ids.is_empty() { self.project().status.pending_image_ids.clone() } else { options.image_ids.clone() };
        let selected: HashSet<_> = ids.iter().cloned().collect();
        if selected.iter().any(|id| self.ignored.contains(id) || !self.project().images.iter().any(|asset| &asset.id == id && asset.status == "ready")) {
            return Err("所选图片不存在、已忽略或无法更新，请重新扫描".into());
        }
        let root = PathBuf::from(&self.project().root);
        let journal = Journal::load(&root)?;
        journal.ensure_settled()?;
        let mut groups: BTreeMap<String, Vec<String>> = BTreeMap::new();
        for asset in self.project().images.iter().filter(|asset| selected.contains(&asset.id)) {
            let output = journal.preferred_outputs(&asset.relative_path).into_iter().find(|output| {
                journal.outputs.get(output).is_some_and(|managed| managed.source == asset.relative_path
                    && (!root.join(output).exists() || journal.valid_output(&root, output, managed)))
            });
            let directory = if let Some(output) = output {
                let source_pdf = Path::new(&asset.relative_path).with_extension("pdf").to_string_lossy().replace('\\', "/");
                output.strip_suffix(&source_pdf).and_then(|prefix| prefix.strip_suffix('/')).filter(|value| !value.is_empty())
                    .ok_or("无法安全定位原输出目录")?.to_owned()
            } else { options.output_dir.clone() };
            journal::output_directory(&root, &directory)?;
            groups.entry(directory).or_default().push(asset.id.clone());
        }
        let mut result = ConversionResult { images: Vec::new(), cancelled: false };
        let total = selected.len();
        for (output_dir, image_ids) in groups {
            if cancel.load(Ordering::Relaxed) { result.cancelled = true; break; }
            let offset = result.images.len();
            let group = ConversionOptions { image_ids, output_dir, ..options.clone() };
            let converted = self.convert_internal(&group, cancel, |mut event| {
                event.current += offset;
                event.total = total;
                progress(event);
            }, &on_image, true);
            self.update_status();
            let converted = converted?;
            result.images.extend(converted.images);
            result.cancelled |= converted.cancelled;
        }
        Ok(result)
    }

    pub fn smart_convert(&mut self, preferences: &crate::preferences::Preferences, cancel: &AtomicBool,
        progress: impl Fn(Progress), on_image: impl Fn(ConvertedImage)) -> Result<SmartReport, String> {
        self.refresh()?;
        let root = PathBuf::from(&self.project().root);
        let status = self.project().status.clone();
        let mut report = SmartReport { project: self.project().clone(), result: ConversionResult { images: vec![], cancelled: false },
            batch_ids: vec![], problem_ids: status.problem_ids.clone(), pending_references: status.pending_references };
        if status.blocking_reason.is_some() || (status.next_action == NextAction::ReviewReferences && !preferences.allow_unreviewed) { return Ok(report); }
        self.ensure_can_convert(preferences.allow_unreviewed)?;
        let before: HashSet<_> = self.conversion_history()?.into_iter().map(|entry| entry.id).collect();
        report.result = self.update_pending_with_results(&preferences.options(status.pending_image_ids), cancel, progress, on_image)?;
        report.batch_ids = Journal::load(&root)?.history(&root).into_iter().filter(|entry| !before.contains(&entry.id)).map(|entry| entry.id).collect();
        report.project = self.project().clone();
        report.pending_references = report.project.status.pending_references;
        report.problem_ids = report.project.status.problem_ids.clone();
        Ok(report)
    }

    pub fn plan(&self) -> Result<ReplacementPlan, String> {
        Journal::load(Path::new(&self.scan.project.root))?.ensure_settled()?;
        Ok(transaction::prepare(&self.review_project(), &self.scan.sources, &self.converted)?.plan)
    }

    pub(crate) fn repair_candidates(&self, image_id: &str) -> Result<Vec<crate::repair::Candidate>, String> {
        crate::repair::candidates(self.project(), image_id)
    }

    pub fn preview_repair(&mut self, image_id: &str, target: &Path) -> Result<ReplacementPlan, String> {
        let prepared = crate::repair::prepare(&self.scan, image_id, target)?;
        self.pending_repair = Some((image_id.into(), target.to_path_buf(), prepared.plan.clone()));
        Ok(prepared.plan)
    }

    pub fn apply_reviewed(&mut self, selection: HashSet<String>, expected: &ReplacementPlan, repair: bool) -> Result<MutationResult, String> {
        let result = (|| {
            let root = Path::new(&self.scan.project.root);
            let _lock = transaction::lock_project(root)?;
            let mut journal = Journal::load(root)?;
            journal.ensure_settled()?;
            let prepared = if repair {
                let (id, target, reviewed) = self.pending_repair.as_ref().ok_or("修复预览已失效，请重新定位文件")?;
                transaction::verify_review(reviewed, expected)?;
                crate::repair::prepare_reviewed(&self.scan, id, target, expected, &selection)?
            } else { transaction::prepare_reviewed(&self.review_project(), &self.scan.sources, &self.converted, &selection, expected)? };
            let candidate = journal.latest_batch_id().map(str::to_owned).filter(|id|
                journal.history(root).iter().any(|entry| entry.id == *id && entry.references_changed == 0
                    && prepared.plan.files.iter().flat_map(|file| &file.changes).all(|change| entry.files.iter().any(|file| file.output == change.after && file.error.is_none()))));
            let batch_id = if repair || candidate.is_none() {
                let options = ConversionOptions { image_ids: Vec::new(), quality: "custom".into(), dpi: 300, jpeg_quality: 100, output_dir: "texgo-pdf".into() };
                let index = journal.begin(root, &options)?;
                journal.finish_batch(root, index, false)?;
                journal.latest_batch_id().map(str::to_owned)
            } else { candidate };
            transaction::apply_linked(&self.scan.project, prepared, batch_id.as_deref())
        })();
        if result.is_ok() { self.pending_repair = None; }
        self.refresh()?;
        result
    }

    pub fn apply(&mut self) -> Result<MutationResult, String> {
        let result = (|| {
            let root = Path::new(&self.scan.project.root);
            let _lock = transaction::lock_project(root)?;
            Journal::load(root)?.ensure_settled()?;
            let prepared = transaction::prepare(&self.review_project(), &self.scan.sources, &self.converted)?;
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
        self.preview_output(image_id, path)
    }

    pub fn preview_output(&self, image_id: &str, path: &Path) -> Result<AssetPreview, String> {
        let asset = self.scan.project.images.iter().find(|asset| asset.id == image_id).ok_or("找不到图片")?;
        journal::safe_path(Path::new(&self.scan.project.root), path)?;
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
