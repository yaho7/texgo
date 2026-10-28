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
    observation_root: crate::observation::ObservationRoot,
    rename_fingerprints: BTreeMap<String, String>,
    converted: BTreeMap<String, StoredConversion>,
    failures: BTreeMap<String, (String, Option<String>)>,
    retrying: HashSet<String>,
    observed: Option<crate::observation::Snapshot>,
    expected_writes: BTreeMap<PathBuf, String>,
    pending_repair: Option<(String, PathBuf, ReplacementPlan)>,
    invalidated: HashSet<String>,
    ignored: HashSet<String>,
    session_ignored: HashSet<String>,
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
        crate::diagnostics::trace(crate::diagnostics::Category::Workspace, || {
            let canonical = main.canonicalize().map_err(|e|e.to_string())?;
            let root = canonical.parent().ok_or("主文件没有父目录")?;
            let observation_root = crate::observation::ObservationRoot::open(root)?;
            observation_root.validate_project(&canonical)?;
            if root.join(".texgo/rename-active.json").symlink_metadata().is_ok() {
                let _lock = transaction::lock_project(root)?;
                crate::rename::recover(root)?;
            }
            let scan = scanner::scan(&canonical)?;
            observation_root.validate_project(&canonical)?;
            Self::from_scan(scan, observation_root)
        })
    }

    fn from_scan(mut scan: scanner::Scan, observation_root: crate::observation::ObservationRoot) -> Result<Self, String> {
        if Path::new(&scan.project.root) != observation_root.path() { return Err("Workspace root changed; reopen the project".into()); }
        observation_root.validate_project(Path::new(&scan.project.main_file))?;
        crate::manifest::restore_sources(&mut scan.project);
        let root = Path::new(&scan.project.root);
        let journal = Journal::load(root);
        let rename_fingerprints = crate::rename::fingerprints(&scan.project, &scan.sources)?;
        let mut workspace = Self { scan, observation_root, rename_fingerprints, converted: BTreeMap::new(), failures: BTreeMap::new(), retrying: HashSet::new(), observed: None, expected_writes: BTreeMap::new(), pending_repair: None, invalidated: HashSet::new(), ignored: HashSet::new(), session_ignored: HashSet::new() };
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
        workspace.observed = workspace.observation_snapshot().ok();
        workspace.observation_root.validate_project(Path::new(&workspace.scan.project.main_file))?;
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
        let main = Path::new(&self.scan.project.main_file);
        self.observation_root.validate_project(main)?;
        let root = Path::new(&self.scan.project.root);
        if root.join(".texgo/rename-active.json").symlink_metadata().is_ok() {
            return Err("存在未完成的重命名恢复，请重新打开项目以安全恢复；自动检测和智能转换已暂停".into());
        }
        let scan = scanner::scan(main)?;
        self.observation_root.validate_project(main)?;
        if scan.project.root != self.scan.project.root || scan.project.main_file != self.scan.project.main_file {
            return Err("Workspace identity changed; reopen the project".into());
        }
        let mut refreshed = Self::from_scan(scan, self.observation_root.clone())?;
        refreshed.expected_writes = self.expected_writes.clone();
        refreshed.session_ignored = self.session_ignored.clone();
        refreshed.session_ignored.retain(|id| refreshed.scan.project.images.iter().any(|asset| &asset.id == id));
        refreshed.invalidated.extend(self.invalidated.iter().cloned());
        refreshed.retrying = self.retrying.iter().filter(|id| refreshed.scan.project.images.iter().any(|asset| &asset.id == *id)).cloned().collect();
        refreshed.invalidated.extend(refreshed.retrying.iter().cloned());
        refreshed.failures.extend(self.failures.iter().filter(|(id, (_, fingerprint))| {
            refreshed.scan.project.images.iter().find(|asset| &asset.id == *id)
                .is_some_and(|asset| Self::source_fingerprint(asset) == *fingerprint)
        }).map(|(id, failure)| (id.clone(), failure.clone())).collect::<BTreeMap<_, _>>());
        refreshed.failures.retain(|id, _| !refreshed.retrying.contains(id));
        refreshed.converted.retain(|id, _| !refreshed.invalidated.contains(id));
        refreshed.scan.project.converted_images.retain(|image| !refreshed.invalidated.contains(&image.id));
        refreshed.update_status();
        refreshed.observation_root.validate_project(Path::new(&refreshed.scan.project.main_file))?;
        Ok(refreshed)
    }

    pub fn refresh(&mut self) -> Result<Project, String> {
        *self = self.scan_again()?;
        Ok(self.project().clone())
    }

    pub fn refresh_workspace(&mut self) -> Result<Project, String> { self.refresh() }

    fn observation_snapshot(&self) -> Result<crate::observation::Snapshot, String> {
        self.observation_root.validate_project(Path::new(&self.scan.project.main_file))?;
        let root = Path::new(&self.scan.project.root);
        let mut snapshot = crate::observation::snapshot(root)?;
        // SVG resources are identified by their content, so a dependency can
        // have an arbitrary filename extension. Keep those exact paths in the
        // metadata fallback as well as the native invalidation policy.
        for (path, _) in self.converted.values().flat_map(|conversion| &conversion.dependencies) {
            if journal::safe_path(root, path).is_err() { continue; }
            match fs::symlink_metadata(path) {
                Ok(metadata) if metadata.is_file() => { snapshot.insert(path.clone(), (metadata.len(), metadata.modified().ok())); }
                Ok(_) => (),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
                Err(error) => return Err(error.to_string()),
            }
        }
        Ok(snapshot)
    }

    pub fn poll_changes(&mut self) -> Result<Option<Project>, String> {
        let observed = self.observation_snapshot()?;
        if self.observed.as_ref() == Some(&observed) { return Ok(None); }
        self.refresh().map(Some)
    }

    /// Native events are content invalidations, including events with unchanged
    /// metadata. Only exact files whose bytes still match our writes are quiet.
    #[cfg(any(feature = "desktop", test))]
    pub(crate) fn reconcile_observation(&mut self, paths: &[PathBuf], force: bool) -> Result<Option<Project>, String> {
        let external = paths.iter().filter(|path| crate::observation::relevant_path(path)
            || self.converted.values().any(|conversion| conversion.dependencies.iter().any(|(dependency, _)| dependency == *path))).any(|path| {
            !self.expected_writes.get(path).is_some_and(|hash|
                crate::observation::verified_metadata(&self.observation_root, path, hash).is_some())
        });
        if force || external { self.refresh().map(Some) } else { self.poll_changes() }
    }

    fn remember_conversion_writes(&mut self, root: &Path, journal: &Journal, batch: usize) {
        for (path, hash) in journal.written_fingerprints(root, batch) {
            // Never take a new whole-tree snapshot here: sources or TeX may have
            // been edited while rendering. Advance only verified self writes.
            if let Some(metadata) = crate::observation::verified_metadata(&self.observation_root, &path, &hash) {
                if let Some(observed) = &mut self.observed { observed.insert(path.clone(), metadata); }
                self.expected_writes.insert(path, hash);
            }
        }
    }

    pub fn conversion_history(&self) -> Result<Vec<ConversionHistoryEntry>, String> {
        let root = Path::new(&self.scan.project.root);
        Ok(Journal::load(root)?.history(root))
    }

    pub fn undo_conversion(&mut self, entry_id: &str) -> Result<Project, String> {
        let root = Path::new(&self.scan.project.root);
        let session_migration = Journal::load(root)?.history(root).into_iter().find(|e|e.id==entry_id)
            .and_then(|entry|entry.rename).and_then(|rename| {
                let current=digest(root.join(&rename.new_source).to_string_lossy().as_bytes());
                self.session_ignored.contains(&current).then(||(current,digest(root.join(rename.old_source).to_string_lossy().as_bytes())))
            });
        let result = (|| {
            let _lock = transaction::lock_project(root)?;
            transaction::undo_batch_locked(&self.scan.project, entry_id)
        })();
        if result.is_ok() {
            if let Some((current,previous)) = session_migration {
                self.session_ignored.remove(&current); self.session_ignored.insert(previous);
            }
            // The journal is authoritative after undo; do not revive session-only
            // failures or invalidate outputs which have just been restored.
            self.failures.clear();
            self.retrying.clear();
            self.invalidated.clear();
        }
        let refreshed = self.refresh();
        result?;
        refreshed
    }

    pub fn rename_asset(&mut self, image_id: &str, new_base_name: &str, expected_fingerprint: &str) -> Result<RenameResult, String> {
        let root = PathBuf::from(&self.scan.project.root);
        let (old_image_id, new_image_id) = {
            let _lock = transaction::lock_project(&root)?;
            crate::rename::rename_locked(&self.scan.project, &self.scan.sources, &self.rename_fingerprints,
                image_id, new_base_name, expected_fingerprint)?
        };
        if self.session_ignored.remove(&old_image_id) { self.session_ignored.insert(new_image_id.clone()); }
        self.failures.remove(&old_image_id);
        self.retrying.remove(&old_image_id);
        self.invalidated.remove(&old_image_id);
        let project = self.refresh()?;
        Ok(RenameResult { project, old_image_id, new_image_id })
    }

    pub fn project(&self) -> &Project { &self.scan.project }

    /// Resolve only a source owned by this live workspace. This read-only path
    /// check deliberately avoids scans, content reads and preview mutation.
    pub fn asset_path(&self, image_id: &str, expected_main_file: &str) -> Result<PathBuf, String> {
        let project = &self.scan.project;
        if project.main_file != expected_main_file { return Err("项目已切换，请重新选择图片".into()); }
        let main = Path::new(&project.main_file);
        self.observation_root.validate_project(main)?;
        let asset = project.images.iter().find(|asset| asset.id == image_id).ok_or("图片不属于当前项目")?;
        if matches!(asset.status.as_str(), "missing" | "ambiguous") { return Err("图片路径尚未确定，请先修复引用".into()); }
        let path = PathBuf::from(asset.path.as_ref().ok_or("图片路径尚未确定")?);
        let root = Path::new(&project.root);
        journal::safe_path(root, &path)?;
        let canonical = path.canonicalize().map_err(|error| format!("无法定位图片：{error}"))?;
        if canonical != path || !canonical.starts_with(root) || !fs::symlink_metadata(&canonical).map_err(|error| error.to_string())?.is_file() {
            return Err("图片必须是当前项目内的普通文件".into());
        }
        self.observation_root.validate_project(main)?;
        journal::safe_path(root, &canonical)?;
        Ok(canonical)
    }

    pub fn ignored(&self) -> &HashSet<String> { &self.ignored }

    pub fn ignore(&mut self, id: &str, ignored: bool) -> Result<(), String> {
        self.set_ignore_mode(id, if ignored { IgnoreMode::Session } else { IgnoreMode::None }).map(|_| ())
    }

    pub fn set_ignore_mode(&mut self, id: &str, mode: IgnoreMode) -> Result<Project, String> {
        let asset = self.project().images.iter().find(|asset| asset.id == id).ok_or("找不到图片")?.clone();
        let root = PathBuf::from(&self.project().root);
        let rules = crate::ignore::IgnoreStore::load(&root)?;
        let was_permanent = rules.matches(&root, &asset);
        if mode == IgnoreMode::Session && was_permanent {
            return Err("此图片已始终忽略，请先恢复处理".into());
        }
        if mode == IgnoreMode::Permanent || (mode == IgnoreMode::None && was_permanent) {
            let _lock = transaction::lock_project(&root)?;
            let mut rules = crate::ignore::IgnoreStore::load(&root)?;
            rules.set(&root, &asset, mode == IgnoreMode::Permanent)?;
            rules.save(&root)?;
        }
        if mode == IgnoreMode::Session { self.session_ignored.insert(id.into()); }
        else { self.session_ignored.remove(id); }
        self.update_status();
        Ok(self.project().clone())
    }

    /// Explicitly retry a failed image after repairing output settings, permissions,
    /// or SVG resources. History remains immutable and all write checks still run.
    pub fn retry_asset(&mut self, id: &str) -> Result<Project, String> {
        self.update_status();
        if let Some(reason) = &self.scan.project.status.blocking_reason { return Err(reason.clone()); }
        Journal::load(Path::new(&self.scan.project.root))?.ensure_settled()?;
        if self.ignored.contains(id) || !self.failures.contains_key(id)
            || !self.scan.project.images.iter().any(|asset| asset.id == id && asset.status == "ready") {
            return Err("此图片没有可以重试的更新失败，请先处理引用或重新扫描".into());
        }
        self.retrying.insert(id.into());
        self.failures.remove(id);
        self.invalidated.insert(id.into());
        self.converted.remove(id);
        self.scan.project.converted_images.retain(|image| image.id != id);
        self.update_status();
        Ok(self.project().clone())
    }

    /// A mutation may have committed earlier files before failing. Publish a safe
    /// refreshed snapshot even when the operation itself returns an error.
    pub(crate) fn reconcile_after_error(&mut self, error: &str) -> Project {
        match self.refresh() {
            Ok(project) => project,
            Err(_) => {
                self.update_status();
                self.scan.project.status.blocking_reason.get_or_insert_with(|| format!("项目状态无法重新读取，请重新打开项目：{error}"));
                self.scan.project.status = self.scan.project.status.clone().finish();
                self.project().clone()
            }
        }
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
        let root_path = PathBuf::from(&self.scan.project.root);
        let root = root_path.as_path();
        let rules = crate::ignore::IgnoreStore::load(root);
        self.ignored = self.session_ignored.clone();
        for asset in &mut self.scan.project.images {
            asset.ignore_mode = if rules.as_ref().is_ok_and(|rules| rules.matches(root, asset)) {
                self.ignored.insert(asset.id.clone()); IgnoreMode::Permanent
            } else if self.session_ignored.contains(&asset.id) { IgnoreMode::Session } else { IgnoreMode::None };
            asset.can_rename = asset.status == "ready" && asset.path.as_ref().is_some_and(|path| {
                let path = Path::new(path);
                path.is_file() && journal::safe_path(root, path).is_ok() && scanner::supported_source(path)
            });
        }
        let journal = Journal::load(root);
        let mut blocking_reason = match &journal {
            Ok(journal) => journal.ensure_settled().err(),
            Err(error) => Some(error.clone()),
        };
        if let Err(error) = rules { blocking_reason.get_or_insert(error); }
        if let Err(error) = transaction::prepare(&self.review_project(), &self.scan.sources, &self.converted) {
            blocking_reason.get_or_insert(error);
        }
        let mut unsafe_output_ids = HashSet::new();
        for asset in &self.scan.project.images {
            if self.ignored.contains(&asset.id) { continue; }
            let unsafe_output = journal.as_ref().ok().is_some_and(|journal| {
                journal.preferred_outputs(&asset.relative_path).first().is_some_and(|output| {
                    journal.outputs.get(output).is_some_and(|managed| root.join(output).exists() && !journal.valid_output(root, output, managed))
                })
            });
            if unsafe_output {
                unsafe_output_ids.insert(asset.id.clone());
                blocking_reason.get_or_insert_with(|| "输出文件已被外部修改，无法安全覆盖，请检查问题图片".into());
            }
        }
        let mut problems = unsafe_output_ids.clone();
        problems.extend(self.failures.keys().cloned());
        let completed = self.converted.keys().cloned().collect();
        let mut status = WorkspaceStatus::classify(&self.scan.project.images, &completed, &problems, &self.ignored, self.pending_references(), blocking_reason);
        status.convertible_image_ids = self.scan.project.images.iter().filter(|asset| asset.can_rename && !unsafe_output_ids.contains(&asset.id)).map(|asset| asset.id.clone()).collect();
        for asset in &mut self.scan.project.images {
            if let Some((error, _)) = self.failures.get(&asset.id) { asset.message = Some(error.clone()); }
            else if unsafe_output_ids.contains(&asset.id) { asset.message = Some("输出 PDF 已被外部修改，Texgo 无法安全覆盖。请检查文件，或忽略本次处理。".into()); }
            else if asset.status == "ready" && asset.message.as_deref() != Some("已关联原图片，重新转换可更新 PDF") { asset.message = None; }
        }
        self.scan.project.converted_images.retain(|image| image.error.is_none());
        self.scan.project.converted_images.extend(self.failures.iter().map(|(id, (error, _))| ConvertedImage {
            id: id.clone(), pdf_path: None, bytes: None, cached: false, error: Some(error.clone()),
        }));
        self.scan.project.status = status;
        self.scan.project.state_fingerprint = crate::rename::state_fingerprint(&self.scan.project, &self.rename_fingerprints).unwrap_or_default();
    }

    pub fn ensure_can_convert(&self, allow_unreviewed: bool) -> Result<(), String> {
        Journal::load(Path::new(&self.project().root))?.ensure_settled()?;
        if !allow_unreviewed && self.pending_references() > 0 {
            return Err("存在未审核引用，请先检查引用变更".into());
        }
        Ok(())
    }

    pub fn convert(&mut self, options: &ConversionOptions, cancel: &AtomicBool, progress: impl Fn(Progress)) -> Result<ConversionResult, String> {
        let result = self.convert_internal(options, cancel, progress, |_| {}, true, false);
        self.update_status();
        result
    }

    pub fn convert_with_results(&mut self, options: &ConversionOptions, cancel: &AtomicBool, progress: impl Fn(Progress), on_image: impl Fn(ConvertedImage)) -> Result<ConversionResult, String> {
        let result = self.convert_internal(options, cancel, progress, on_image, false, false);
        self.update_status();
        result
    }

    pub(crate) fn convert_for_pipeline(&mut self, options: &ConversionOptions) -> Result<ConversionResult, String> {
        let result = self.convert_internal(options, &AtomicBool::new(false), |_| {}, |_| {}, true, false);
        self.update_status();
        result
    }

    fn convert_internal(&mut self, options: &ConversionOptions, cancel: &AtomicBool, progress: impl Fn(Progress), on_image: impl Fn(ConvertedImage), allow_managed_refresh: bool, force: bool) -> Result<ConversionResult, String> {
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
                let cached = !force && journal.outputs.get(&output_relative).is_some_and(|old| old.key == managed.key && journal.valid(&root, &output_relative, old));
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
        self.remember_conversion_writes(&root, &journal, batch);
        // Keep a failed or cancelled selection out of this session's reference plan.
        let succeeded: HashSet<_> = images.iter().filter(|image| image.error.is_none() && image.pdf_path.is_some()).map(|image| image.id.as_str()).collect();
        self.invalidated.retain(|id| !succeeded.contains(id.as_str()));
        self.rehydrate(&journal);
        self.converted.retain(|id, _| !selected.contains(id.as_str()) || succeeded.contains(id.as_str()));
        self.scan.project.converted_images.retain(|image| !selected.contains(image.id.as_str()) || succeeded.contains(image.id.as_str()));
        for image in &images {
            self.retrying.remove(&image.id);
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
        self.convert_grouped(options, ConversionIntent::Pending, cancel, progress, on_image)
    }

    /// A recommendation does not remove explicit user control. Manual intents may
    /// include completed/ignored assets, but retain every file and journal check.
    pub fn convert_with_intent(&mut self, options: &ConversionOptions, intent: ConversionIntent, allow_unreviewed: bool,
        cancel: &AtomicBool, progress: impl Fn(Progress), on_image: impl Fn(ConvertedImage)) -> Result<ConversionResult, String> {
        self.update_status();
        self.ensure_can_convert(allow_unreviewed)?;
        self.convert_grouped(options, intent, cancel, progress, on_image)
    }

    fn convert_grouped(&mut self, options: &ConversionOptions, intent: ConversionIntent, cancel: &AtomicBool,
        progress: impl Fn(Progress), on_image: impl Fn(ConvertedImage)) -> Result<ConversionResult, String> {
        conversion::validate(options)?;
        if let Some(reason) = &self.project().status.blocking_reason { return Err(reason.clone()); }
        let ids = if intent == ConversionIntent::Pending {
            self.project().status.pending_image_ids.iter().filter(|id| options.image_ids.is_empty() || options.image_ids.contains(id)).cloned().collect()
        } else { options.image_ids.clone() };
        let selected: HashSet<_> = ids.iter().cloned().collect();
        if selected.iter().any(|id| (intent == ConversionIntent::Pending && self.ignored.contains(id)) || !self.project().status.convertible_image_ids.contains(id)) {
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
            }, &on_image, true, intent != ConversionIntent::Pending);
            self.update_status();
            let converted = converted?;
            result.images.extend(converted.images);
            result.cancelled |= converted.cancelled;
        }
        Ok(result)
    }

    pub fn smart_convert(&mut self, preferences: &crate::preferences::Preferences, cancel: &AtomicBool,
        progress: impl Fn(Progress), on_image: impl Fn(ConvertedImage)) -> Result<SmartReport, String> {
        crate::diagnostics::trace(crate::diagnostics::Category::Automation, || {
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
        })
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
        self.apply_reviewed_checked(selection, expected, repair).map_err(|error| error.to_string())
    }

    pub fn apply_reviewed_checked(&mut self, selection: HashSet<String>, expected: &ReplacementPlan, repair: bool) -> Result<MutationResult, ReviewApplyError> {
        // Reject a replaced root before creating a lock at its pathname. Target
        // validation follows fingerprint checks so missing/rebound reviewed files
        // retain the pre-write conflict outcome and explicit rescan path.
        self.observation_root.validate_current_root()?;
        let result: Result<MutationResult, ReviewApplyError> = (|| {
            let root = Path::new(&self.scan.project.root);
            let _lock = transaction::lock_project(root)?;
            self.observation_root.validate_current_root()?;
            transaction::verify_fingerprints(&self.observation_root, expected)?;
            self.observation_root.validate_project(Path::new(&self.scan.project.main_file))?;
            let mut journal = Journal::load(root)?;
            journal.ensure_settled()?;
            let prepared = if repair {
                let (id, target, reviewed) = self.pending_repair.as_ref().ok_or_else(|| "修复预览已失效，请重新定位文件".to_string())?;
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
            transaction::apply_linked(&self.scan.project, prepared, batch_id.as_deref()).map_err(ReviewApplyError::from)
        })();
        if result.is_ok() { self.pending_repair = None; }
        // Keep a conflict available for explicit rescanning; refresh clears repair context.
        if matches!(result, Err(ReviewApplyError::ReviewConflict { .. })) { return result; }
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

    pub fn thumbnail(&self, image_id: &str, expected_main_file: &str) -> Result<AssetPreview, String> {
        self.thumbnail_source(image_id, expected_main_file)?.render()
    }

    pub(crate) fn thumbnail_source(&self, image_id: &str, expected_main_file: &str) -> Result<crate::thumbnail::Source, String> {
        let path = self.asset_path(image_id, expected_main_file)?;
        let asset = self.scan.project.images.iter().find(|asset| asset.id == image_id).ok_or("找不到图片")?;
        Ok(crate::thumbnail::Source { root: self.observation_root.clone(), path, format: asset.format.clone() })
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

#[cfg(test)]
mod error_snapshot_tests {
    use super::*;

    #[test]
    fn reconciliation_exposes_partial_conversion_and_journal_failure_without_watcher() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        image::RgbImage::new(20, 10).save(root.join("a.png")).unwrap();
        fs::write(root.join("main.tex"), r"\includegraphics{a.png}").unwrap();
        let mut ws = Workspace::open(&root.join("main.tex")).unwrap();
        let options = crate::preferences::Preferences::default().options(vec![]);
        // Simulate state storage becoming unavailable immediately after a PDF
        // was committed. The operation must fail, while its real snapshot shows
        // the safety blocker instead of claiming that no work happened.
        let result = ws.update_pending_with_results(&options, &AtomicBool::new(false), |_| {}, |_| {
            fs::rename(root.join(".texgo/conversions.json"), root.join(".texgo/saved-conversions.json")).unwrap();
            fs::create_dir(root.join(".texgo/conversions.json")).unwrap();
        });
        assert!(result.is_err());
        assert!(root.join("texgo-pdf/a.pdf").is_file());
        let project = ws.reconcile_after_error("state storage unavailable");
        assert!(project.status.blocking_reason.is_some());
        assert_eq!(project.status.total_images, 1);
        assert!(ws.update_pending_with_results(&options, &AtomicBool::new(false), |_| {}, |_| {}).is_err());
    }
}

#[cfg(test)]
mod native_observation_tests {
    use super::*;
    fn fixture() -> (tempfile::TempDir, PathBuf, Workspace) {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().canonicalize().unwrap();
        image::RgbImage::new(20, 10).save(root.join("a.png")).unwrap();
        fs::write(root.join("main.tex"), r"\includegraphics{a.png}").unwrap();
        let workspace = Workspace::open(&root.join("main.tex")).unwrap();
        (directory, root, workspace)
    }
    #[test]
    fn internal_conversion_only_advances_known_write_baselines() {
        let (_directory, _root, mut workspace) = fixture();
        let options = crate::preferences::Preferences::default().options(vec![]);
        workspace.update_pending_with_results(&options, &AtomicBool::new(false), |_| {}, |_| {}).unwrap();
        assert!(workspace.poll_changes().unwrap().is_none(), "own PDF and journal writes must not invalidate the workspace");
    }
    #[test]
    fn external_tex_edit_during_conversion_remains_dirty() {
        let (_directory, root, mut workspace) = fixture();
        let options = crate::preferences::Preferences::default().options(vec![]);
        workspace.update_pending_with_results(&options, &AtomicBool::new(false), |_| {}, |_| {
            fs::write(root.join("main.tex"), r"\includegraphics{missing.png}").unwrap();
        }).unwrap();
        let fresh = workspace.poll_changes().unwrap().expect("external TeX edits must survive internal baseline updates");
        assert!(fresh.images.iter().any(|image| image.relative_path == "missing.png"));
    }
    #[test]
    fn external_managed_pdf_edit_remains_a_safety_event() {
        let (_directory, root, mut workspace) = fixture();
        let options = crate::preferences::Preferences::default().options(vec![]);
        workspace.update_pending_with_results(&options, &AtomicBool::new(false), |_| {}, |_| {}).unwrap();
        fs::write(root.join("texgo-pdf/a.pdf"), b"external PDF edit").unwrap();
        let project = workspace.poll_changes().unwrap().unwrap();
        assert!(project.status.blocking_reason.is_some());
    }
    #[test]
    fn native_pdf_event_checks_content_even_when_size_and_mtime_match() {
        let (_directory, root, mut workspace) = fixture();
        let options = crate::preferences::Preferences::default().options(vec![]);
        workspace.update_pending_with_results(&options, &AtomicBool::new(false), |_| {}, |_| {}).unwrap();
        let output = root.join("texgo-pdf/a.pdf");
        assert!(workspace.reconcile_observation(&[output.clone()], false).unwrap().is_none());
        let metadata = fs::metadata(&output).unwrap();
        let mut bytes = fs::read(&output).unwrap();
        bytes[0] ^= 1;
        fs::write(&output, bytes).unwrap();
        fs::File::options().write(true).open(&output).unwrap().set_times(fs::FileTimes::new().set_modified(metadata.modified().unwrap())).unwrap();
        assert!(workspace.poll_changes().unwrap().is_none(), "fixture must have unchanged metadata");
        assert!(workspace.reconcile_observation(&[output], false).unwrap().unwrap().status.blocking_reason.is_some());
    }
    #[test]
    fn private_backup_writes_are_quiet_but_external_safety_json_is_not() {
        let (_directory, root, mut workspace) = fixture();
        let options = crate::preferences::Preferences::default().options(vec![]);
        workspace.update_pending_with_results(&options, &AtomicBool::new(false), |_| {}, |_| {}).unwrap();
        image::RgbImage::new(31, 12).save(root.join("a.png")).unwrap();
        workspace.refresh().unwrap();
        workspace.update_pending_with_results(&options, &AtomicBool::new(false), |_| {}, |_| {}).unwrap();
        assert!(workspace.poll_changes().unwrap().is_none());
        fs::write(root.join(".texgo/ignore.json"), b"corrupted externally").unwrap();
        assert!(workspace.reconcile_observation(&[root.join(".texgo/ignore.json")], false).unwrap().unwrap().status.blocking_reason.is_some());
    }
    #[cfg(unix)]
    #[test]
    fn self_write_verification_does_not_follow_symlinks_outside_root() {
        let (_directory, root, mut workspace) = fixture();
        let outside = tempfile::tempdir().unwrap();
        let path = root.join("linked.pdf");
        fs::write(outside.path().join("external.pdf"), b"outside").unwrap();
        std::os::unix::fs::symlink(outside.path().join("external.pdf"), &path).unwrap();
        workspace.expected_writes.insert(path.clone(), digest(b"outside"));
        assert!(crate::observation::verified_metadata(&workspace.observation_root, &path, &digest(b"outside")).is_none());
        assert!(crate::observation::snapshot(&root).unwrap().get(&path).is_none());
    }
    #[test]
    fn svg_dependencies_with_arbitrary_extensions_invalidate_native_and_fallback() {
        let (_directory, root, _) = fixture();
        let resource = root.join("linked.data");
        image::RgbImage::new(12, 12).save_with_format(&resource, image::ImageFormat::Png).unwrap();
        fs::write(root.join("plot.svg"), r#"<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12"><image href="linked.data" width="12" height="12"/></svg>"#).unwrap();
        fs::write(root.join("main.tex"), r"\includegraphics{plot.svg}").unwrap();
        let mut workspace = Workspace::open(&root.join("main.tex")).unwrap();
        let options = crate::preferences::Preferences::default().options(vec![]);
        workspace.update_pending_with_results(&options, &AtomicBool::new(false), |_| {}, |_| {}).unwrap();
        assert_eq!(workspace.project().converted_images.len(), 1);
        assert!(workspace.converted.values().any(|conversion| conversion.dependencies.iter().any(|(path, _)| path == &resource)));
        workspace.refresh().unwrap();
        let mut fallback = workspace.clone();
        image::RgbImage::new(19, 19).save_with_format(&resource, image::ImageFormat::Png).unwrap();
        assert!(workspace.reconcile_observation(&[resource], false).unwrap().is_some());
        assert!(fallback.poll_changes().unwrap().is_some());
    }
    #[test]
    fn refresh_rejects_a_replacement_root_directory_without_rebinding_anchor() {
        let parent = tempfile::tempdir().unwrap();
        let root = parent.path().canonicalize().unwrap().join("project");
        fs::create_dir(&root).unwrap();
        fs::write(root.join("main.tex"), r"\includegraphics{original.png}").unwrap();
        let mut workspace = Workspace::open(&root.join("main.tex")).unwrap();
        fs::rename(&root, root.with_file_name("saved")).unwrap();
        fs::create_dir(&root).unwrap();
        fs::write(root.join("main.tex"), r"\includegraphics{replacement.png}").unwrap();
        assert!(workspace.refresh().is_err());
        assert!(workspace.poll_changes().is_err());
        assert_eq!(workspace.project().images[0].relative_path, "original.png");
    }
    #[cfg(unix)]
    #[test]
    fn refresh_rejects_a_main_file_replaced_by_a_symlink() {
        let (_directory, root, mut workspace) = fixture();
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("main.tex"), r"\includegraphics{outside.png}").unwrap();
        fs::remove_file(root.join("main.tex")).unwrap();
        std::os::unix::fs::symlink(outside.path().join("main.tex"), root.join("main.tex")).unwrap();
        assert!(workspace.refresh().is_err());
        assert_eq!(workspace.project().root, root.to_string_lossy());
        assert_eq!(workspace.project().images[0].relative_path, "a.png");
    }
    #[test]
    fn source_save_and_tex_save_are_detected() {
        let (_directory, root, mut workspace) = fixture();
        image::RgbImage::new(30, 10).save(root.join("a.png")).unwrap();
        assert!(workspace.poll_changes().unwrap().is_some());
        fs::write(root.join("main.tex"), r"\includegraphics{missing.png}").unwrap();
        assert!(workspace.poll_changes().unwrap().unwrap().images.iter().any(|asset| asset.relative_path == "missing.png"));
    }
    #[test]
    fn native_observation_refuses_pending_rename_recovery_without_tex_writes() {
        let (_directory, root, mut workspace) = fixture();
        let main = root.join("main.tex");
        let before = fs::read(&main).unwrap();
        fs::create_dir_all(root.join(".texgo")).unwrap();
        let pending = root.join(".texgo/rename-active.json");
        fs::write(&pending, b"{}").unwrap();
        let error = workspace.reconcile_observation(&[pending.clone()], true).unwrap_err();
        assert!(error.contains("重新打开"));
        assert_eq!(fs::read(main).unwrap(), before);
        assert_eq!(fs::read(pending).unwrap(), b"{}");
    }

}
