use crate::models::{ConversionHistoryEntry, ConversionHistoryFile, ConversionOptions};
use crate::workspace::{digest, save_atomic};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct Managed {
    pub source: String,
    pub source_hash: String,
    pub pdf_hash: String,
    pub key: String,
    pub dependencies: Vec<(String, String)>,
}

#[derive(Serialize, Deserialize)]
struct Change {
    output: String,
    before: Option<Managed>,
    backup: Option<String>,
    after: Managed,
    committed: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum ReferencePhase {
    Prepared,
    Active,
    Restored,
    NotApplied,
    Complete,
}

#[derive(Serialize, Deserialize)]
struct Batch {
    entry: ConversionHistoryEntry,
    changes: Vec<Change>,
    #[serde(default)]
    undoing: bool,
    #[serde(default)]
    references_applying: bool,
    #[serde(default)]
    reference_phase: Option<ReferencePhase>,
}

#[derive(Serialize, Deserialize)]
pub(crate) struct Journal {
    version: u8,
    pub outputs: BTreeMap<String, Managed>,
    #[serde(default)]
    pub directories: Vec<(String, bool)>,
    batches: Vec<Batch>,
}

// Validate every existing component, including the leaf, without following links.
pub(crate) fn safe_path(root: &Path, path: &Path) -> Result<(), String> {
    if root.canonicalize().map_err(|e| e.to_string())? != root { return Err("Workspace root changed".into()); }
    let relative = path.strip_prefix(root).map_err(|_| "Path is outside the workspace")?;
    let mut current = root.to_path_buf();
    for component in relative.components() {
        let Component::Normal(name) = component else { return Err("Path must not contain traversal components".into()); };
        current.push(name);
        match fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() => return Err("路径不能包含符号链接 (symlink)".into()),
            Ok(_) => (),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok(())
}

pub(crate) fn relative(root: &Path, path: &Path) -> Result<String, String> {
    safe_path(root, path)?;
    path.strip_prefix(root).map(|p| p.to_string_lossy().replace('\\', "/")).map_err(|e| e.to_string())
}

pub(crate) fn output_directory(root: &Path, value: &str) -> Result<PathBuf, String> {
    let normalized = value.replace('\\', "/");
    let path = Path::new(&normalized);
    if normalized.trim() != normalized || normalized.is_empty() || path.is_absolute()
        || normalized.chars().any(|c| c.is_control() || "<>:\"|?*{}%#$&^~".contains(c)) {
        return Err("请输入工作区内的输出目录名，不能使用绝对路径或特殊字符".into());
    }
    for part in normalized.split('/') {
        let lower = part.to_ascii_lowercase();
        let stem = lower.split('.').next().unwrap_or("");
        if part.is_empty() || part == "." || part == ".." || part.ends_with(['.', ' '])
            || matches!(lower.as_str(), ".texgo" | ".git" | "node_modules")
            || matches!(stem, "con" | "prn" | "aux" | "nul")
            || (stem.len() == 4 && (stem.starts_with("com") || stem.starts_with("lpt")) && matches!(stem.as_bytes()[3], b'1'..=b'9')) {
            return Err("输出目录不能包含上级路径或系统保留名称".into());
        }
    }
    let mut result = root.to_path_buf();
    for component in path.components() {
        match component {
            Component::Normal(name) => result.push(name),
            _ => return Err("outputDir cannot use traversal or reserved directories".into()),
        }
    }
    if result == root { return Err("outputDir cannot be the workspace root".into()); }
    safe_path(root, &result)?;
    if result.exists() && !result.is_dir() { return Err("outputDir is not a directory".into()); }
    Ok(result)
}

fn read_optional(path: &Path) -> Result<Option<Vec<u8>>, String> {
    match fs::read(path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

impl Journal {
    pub fn load(root: &Path) -> Result<Self, String> {
        let path = root.join(".texgo/conversions.json");
        safe_path(root, &path)?;
        let Some(bytes) = read_optional(&path)? else { return Ok(Self { version: 1, outputs: BTreeMap::new(), directories: Vec::new(), batches: Vec::new() }); };
        let mut journal: Self = serde_json::from_slice(&bytes).map_err(|e| format!("Conversion journal is damaged: {e}"))?;
        if journal.version != 1 { return Err("Unsupported conversion journal version".into()); }
        // Recover a rename that completed before its final journal update.
        for batch in &mut journal.batches {
            if batch.entry.undone || batch.undoing { continue; }
            for change in &mut batch.changes {
                if !change.committed {
                    let path = root.join(&change.output);
                    if safe_path(root, &path).is_ok() && fs::read(&path).is_ok_and(|bytes| digest(&bytes) == change.after.pdf_hash) {
                        journal.outputs.insert(change.output.clone(), change.after.clone());
                        change.committed = true;
                        if let Some(file) = batch.entry.files.iter_mut().find(|file| file.output == change.output) {
                            file.error = None;
                        }
                    }
                }
            }
        }
        Ok(journal)
    }

    pub fn save(&self, root: &Path) -> Result<(), String> {
        let path = root.join(".texgo/conversions.json");
        safe_path(root, &path)?;
        save_atomic(&path, &serde_json::to_vec_pretty(self).map_err(|e| e.to_string())?)
    }

    pub fn excluded(&self, root: &Path) -> Vec<PathBuf> {
        self.batches.iter().filter(|batch| !batch.changes.is_empty() || batch.entry.files.iter().any(|file| file.cached && file.error.is_none()))
            .filter_map(|batch| output_directory(root, &batch.entry.output_dir).ok()).collect()
    }

    /// The last attempted result for this source, including across app restarts.
    /// A changed source can be retried; an unprocessed cancelled item is not a failure.
    pub fn source_failure(&self, root: &Path, source: &str) -> Option<(String, Option<String>)> {
        let file = self.batches.iter().rev().filter(|batch| !batch.entry.undone)
            .flat_map(|batch| batch.entry.files.iter().rev()).find(|file| file.source == source)?;
        let error = file.error.as_ref()?;
        if error == "Conversion interrupted before completion" { return None; }
        let current = fs::read(root.join(source)).ok().map(|bytes| digest(&bytes));
        if file.source_hash.is_some() && file.source_hash != current { return None; }
        Some((error.clone(), current))
    }

    pub fn begin(&mut self, root: &Path, options: &ConversionOptions) -> Result<usize, String> {
        self.begin_validated(root, options, false)
    }

    // Headless compatibility: all writes must keep the exact destinations already referenced by TeX.
    pub fn begin_managed_refresh(&mut self, root: &Path, options: &ConversionOptions, project: &crate::Project) -> Result<usize, String> {
        if !crate::transaction::standalone_undo_available(root)? { return self.begin(root, options); }
        crate::transaction::validate_standalone_refresh(project)?;
        let directory = output_directory(root, &options.output_dir)?;
        if options.image_ids.is_empty() { return Err("独立引用记录存在时只允许原位置更新".into()); }
        for id in &options.image_ids {
            let asset = project.images.iter().find(|asset| &asset.id == id).ok_or("找不到图片")?;
            let output = relative(root, &directory.join(&asset.relative_path).with_extension("pdf"))?;
            let managed = self.outputs.get(&output).ok_or("独立引用记录存在时不能创建新 PDF 路径")?;
            let missing_output = fs::symlink_metadata(root.join(&output)).is_err_and(|error| error.kind() == std::io::ErrorKind::NotFound);
            if managed.source != asset.relative_path || !(self.valid_output(root, &output, managed) || missing_output)
                || asset.references.is_empty() || asset.references.iter().any(|reference| reference.original != output) {
                return Err("独立引用记录存在时只能更新已引用的托管 PDF".into());
            }
        }
        self.begin_validated(root, options, true)
    }

    fn begin_validated(&mut self, root: &Path, options: &ConversionOptions, preserving_standalone: bool) -> Result<usize, String> {
        self.ensure_settled()?;
        crate::transaction::archive_linked_legacy(root)?;
        self.cleanup_finished_references(root)?;
        if crate::transaction::legacy_undo_available(root) && !preserving_standalone {
            return Err("存在旧版独立引用恢复记录，请先单独恢复".into());
        }
        let created_at = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|e| e.to_string())?.as_millis() as u64;
        let id = format!("{created_at}-{}", self.batches.len());
        self.batches.push(Batch {
            entry: ConversionHistoryEntry { id, created_at, output_dir: options.output_dir.clone(),
                dpi: options.dpi, jpeg_quality: options.jpeg_quality, files: Vec::new(), undone: false, can_undo: false, cancelled: false, undo_reason: None,
                references_changed: 0, files_changed: 0 },
            changes: Vec::new(), undoing: false, references_applying: false, reference_phase: None,
        });
        self.save(root)?;
        Ok(self.batches.len() - 1)
    }

    pub fn ensure_settled(&self) -> Result<(), String> {
        if self.batches.iter().any(|batch| !batch.entry.undone && (batch.undoing || batch.references_applying || batch.changes.iter().any(|change| !change.committed))) {
            return Err("请先从操作记录撤销上次中断的文件操作，再开始新操作".into());
        }
        Ok(())
    }

    pub fn record(&mut self, root: &Path, batch: usize, file: ConversionHistoryFile) -> Result<(), String> {
        self.batches[batch].entry.files.push(file);
        self.save(root)
    }

    pub fn finish_file(&mut self, root: &Path, batch: usize, cached: bool, error: Option<String>) -> Result<(), String> {
        let file = self.batches[batch].entry.files.last_mut().ok_or("Missing history file")?;
        file.cached = cached;
        file.error = error;
        self.save(root)
    }

    pub fn finish_batch(&mut self, root: &Path, batch: usize, cancelled: bool) -> Result<(), String> {
        self.batches[batch].entry.cancelled = cancelled;
        self.save(root)
    }

    pub fn verify_managed(&self, root: &Path, output: &str, source: &str) -> Result<Option<Vec<u8>>, String> {
        let path = root.join(output);
        safe_path(root, &path)?;
        let bytes = read_optional(&path)?;
        if let Some(bytes) = &bytes {
            let managed = self.outputs.get(output).ok_or("目标 PDF 已存在且不是 Texgo 生成的，请更换输出目录；原文件未覆盖")?;
            if managed.source != source || managed.pdf_hash != digest(bytes) {
                return Err("目标 PDF 已被修改或属于另一张图片，请更换输出目录；原文件未覆盖".into());
            }
        }
        Ok(bytes)
    }

    // The caller holds the one project lock. This function never acquires another lock.
    pub fn write(&mut self, root: &Path, batch: usize, output: &str, after: Managed, pdf: &[u8]) -> Result<(), String> {
        let previous = self.verify_managed(root, output, &after.source)?;
        let before = previous.as_ref().and_then(|_| self.outputs.get(output).cloned());
        let backup = if let Some(bytes) = &previous {
            let backup = format!(".texgo/backups/{}-{}.pdf", self.batches[batch].entry.id, self.batches[batch].changes.len());
            let path = root.join(&backup);
            safe_path(root, &path)?;
            fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
            safe_path(root, &path)?;
            if path.exists() { return Err("Backup already exists; refusing to overwrite".into()); }
            save_atomic(&path, bytes)?;
            Some(backup)
        } else { None };
        self.batches[batch].changes.push(Change { output: output.into(), before, backup, after: after.clone(), committed: false });
        self.save(root)?;
        let path = root.join(output);
        safe_path(root, &path)?;
        fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
        safe_path(root, &path)?;
        self.valid_sources(root, &after)?;
        if self.verify_managed(root, output, &after.source)? != previous { return Err("Output changed before commit".into()); }
        if previous.is_none() {
            // persist_noclobber prevents an unrelated file appearing in this window from being replaced.
            use std::io::Write;
            let mut file = tempfile::NamedTempFile::new_in(path.parent().unwrap()).map_err(|e| e.to_string())?;
            file.write_all(pdf).map_err(|e| e.to_string())?;
            file.as_file().sync_all().map_err(|e| e.to_string())?;
            file.persist_noclobber(&path).map_err(|e| e.to_string())?;
            crate::workspace::sync_directory(path.parent().unwrap())?;
        } else { save_atomic(&path, pdf)?; }
        self.outputs.insert(output.into(), after);
        self.batches[batch].changes.last_mut().unwrap().committed = true;
        self.save(root)
    }

    pub fn valid(&self, root: &Path, output: &str, managed: &Managed) -> bool {
        self.valid_output(root, output, managed) && self.valid_sources(root, managed).is_ok()
    }

    pub fn valid_output(&self, root: &Path, output: &str, managed: &Managed) -> bool {
        let path = root.join(output);
        safe_path(root, &path).is_ok()
            && fs::read(&path).is_ok_and(|bytes| digest(&bytes) == managed.pdf_hash)
            && lopdf::Document::load(path).is_ok_and(|doc| doc.get_pages().len() == 1)
    }

    pub fn sources_changed(&self, root: &Path, managed: &Managed) -> bool {
        std::iter::once((&managed.source, &managed.source_hash)).chain(managed.dependencies.iter().map(|(path, hash)| (path, hash))).any(|(path, hash)| {
            let path = root.join(path);
            if safe_path(root, &path).is_err() { return false; }
            match fs::read(path) {
                Ok(bytes) => digest(&bytes) != *hash,
                Err(error) => error.kind() == std::io::ErrorKind::NotFound,
            }
        })
    }

    pub fn valid_sources(&self, root: &Path, managed: &Managed) -> Result<(), String> {
        for (path, hash) in std::iter::once((&managed.source, &managed.source_hash)).chain(managed.dependencies.iter().map(|(p, h)| (p, h))) {
            let path = root.join(path);
            safe_path(root, &path)?;
            if digest(&fs::read(path).map_err(|e| e.to_string())?) != *hash { return Err("Source or SVG dependency changed during conversion".into()); }
        }
        Ok(())
    }

    pub fn preferred_outputs(&self, source: &str) -> Vec<String> {
        let mut outputs = Vec::new();
        for batch in self.batches.iter().rev().filter(|batch| !batch.entry.undone) {
            for file in batch.entry.files.iter().rev().filter(|file| file.source == source && file.error.is_none()) {
                if !outputs.contains(&file.output) { outputs.push(file.output.clone()); }
            }
        }
        for (output, managed) in &self.outputs {
            if managed.source == source && !outputs.contains(output) { outputs.push(output.clone()); }
        }
        outputs
    }

    fn latest(&self) -> Option<usize> {
        self.batches.iter().rposition(|batch| !batch.entry.undone && (!batch.changes.is_empty() || batch.entry.references_changed > 0))
    }

    fn undo_preflight(&self, root: &Path, index: usize) -> Result<(), String> {
        self.preflight_references(root, &self.batches[index].entry.id)?;
        for change in &self.batches[index].changes {
            let path = root.join(&change.output);
            safe_path(root, &path)?;
            let current = read_optional(&path)?;
            let backup = self.backup(root, change)?;
            let is_after = current.as_ref().is_some_and(|bytes| digest(bytes) == change.after.pdf_hash);
            let is_before = current == backup;
            if !is_after && !(is_before && (self.batches[index].undoing || !change.committed)) {
                return Err(format!("{} 已被修改或移除，无法安全撤销；请恢复文件后重新扫描", path.display()));
            }
        }
        Ok(())
    }

    /// Associate only the newest batch, including a cached-only conversion.
    /// Call while holding the project lock, before writing references.
    pub fn associate_references(&mut self, root: &Path, id: &str, references: usize, files: usize) -> Result<(), String> {
        self.ensure_settled()?;
        let batch = self.batches.last_mut().ok_or("没有可关联的转换批次")?;
        if batch.entry.id != id || batch.entry.undone || batch.entry.references_changed > 0 {
            return Err("引用只能关联最新且尚未应用引用的转换批次".into());
        }
        batch.entry.references_changed = references;
        batch.entry.files_changed = files;
        batch.references_applying = true;
        batch.reference_phase = Some(ReferencePhase::Prepared);
        self.save(root)
    }

    // Persist after the recovery record, but BEFORE the first TeX write.
    pub fn references_ready(&mut self, root: &Path, id: &str) -> Result<(), String> {
        let batch = self.batches.iter_mut().find(|batch| batch.entry.id == id).ok_or("找不到引用关联批次")?;
        if !matches!(batch.reference_phase, Some(ReferencePhase::Prepared)) || !batch.references_applying {
            return Err("引用写入阶段不一致".into());
        }
        batch.reference_phase = Some(ReferencePhase::Active);
        self.save(root)
    }

    pub fn finish_references(&mut self, root: &Path, id: &str) -> Result<(), String> {
        let batch = self.batches.iter_mut().find(|batch| batch.entry.id == id).ok_or("找不到引用关联批次")?;
        if !matches!(batch.reference_phase, Some(ReferencePhase::Active)) { return Err("引用写入阶段不一致".into()); }
        batch.references_applying = false;
        self.save(root)
    }

    pub fn preflight_references(&self, root: &Path, id: &str) -> Result<(), String> {
        let batch = self.batches.iter().find(|batch| batch.entry.id == id).ok_or("找不到引用关联批次")?;
        if matches!(batch.reference_phase, Some(ReferencePhase::Complete)) && !batch.entry.undone {
            return Err("引用恢复阶段损坏".into());
        }
        let unapplied = matches!(batch.reference_phase, Some(ReferencePhase::Prepared | ReferencePhase::NotApplied));
        let required = batch.entry.references_changed > 0 && !unapplied;
        let restored = unapplied || matches!(batch.reference_phase, Some(ReferencePhase::Restored));
        crate::transaction::preflight_recovery(root, id, required, restored)
    }

    pub fn references_restored(&mut self, root: &Path, id: &str, had_record: bool) -> Result<(), String> {
        self.preflight_references(root, id)?;
        let batch = self.batches.iter_mut().find(|batch| batch.entry.id == id).ok_or("找不到引用关联批次")?;
        if !batch.undoing || batch.entry.undone { return Err("必须先开始批次撤销".into()); }
        if batch.entry.references_changed > 0 {
            batch.reference_phase = Some(if had_record { ReferencePhase::Restored } else { ReferencePhase::NotApplied });
        }
        self.save(root)
    }

    // The durable final journal is the authority, never an unsaved in-memory flag.
    pub fn cleanup_completed_references(&self, root: &Path, id: &str) -> Result<bool, String> {
        let durable = Self::load(root)?;
        let batch = durable.batches.iter().find(|batch| batch.entry.id == id).ok_or("找不到转换批次")?;
        if !batch.entry.undone { return Ok(false); }
        if batch.entry.references_changed > 0 && !matches!(batch.reference_phase, Some(ReferencePhase::Complete) | None) {
            return Err("批次完成标记与引用恢复阶段不一致".into());
        }
        // A previous save may have renamed successfully but failed directory sync.
        crate::workspace::sync_directory(&root.join(".texgo"))?;
        crate::transaction::cleanup_batch_record(root, id)?;
        Ok(true)
    }

    pub fn cleanup_finished_references(&self, root: &Path) -> Result<(), String> {
        for batch in self.batches.iter().filter(|batch| batch.entry.undone) {
            self.cleanup_completed_references(root, &batch.entry.id)?;
        }
        Ok(())
    }

    pub fn latest_batch_id(&self) -> Option<&str> {
        self.batches.last().filter(|batch| !batch.entry.undone).map(|batch| batch.entry.id.as_str())
    }

    pub fn undo_in_progress(&self, id: &str) -> bool {
        self.batches.iter().any(|batch| batch.entry.id == id && batch.undoing && !batch.entry.undone)
    }

    /// Read-only joint PDF + associated TeX validation; no lock acquisition.
    pub fn preflight_undo(&self, root: &Path, id: &str) -> Result<(), String> {
        let index = self.latest().ok_or("No conversion writes to undo")?;
        if self.batches[index].entry.id != id { return Err("Only the latest compatible conversion batch can be undone".into()); }
        self.undo_preflight(root, index)
    }

    /// Persist retry state BEFORE restoring TeX. Caller retains the same lock.
    pub fn begin_undo(&mut self, root: &Path, id: &str) -> Result<(), String> {
        self.preflight_undo(root, id)?;
        let index = self.latest().ok_or("No conversion writes to undo")?;
        self.batches[index].undoing = true;
        self.save(root)
    }

    fn backup(&self, root: &Path, change: &Change) -> Result<Option<Vec<u8>>, String> {
        let Some(backup) = &change.backup else { return Ok(None); };
        let path = root.join(backup);
        safe_path(root, &path)?;
        let bytes = fs::read(path).map_err(|e| format!("Conversion backup unavailable: {e}"))?;
        if change.before.as_ref().is_none_or(|before| before.pdf_hash != digest(&bytes)) { return Err("Conversion backup has been modified".into()); }
        Ok(Some(bytes))
    }

    pub fn history(&self, root: &Path) -> Vec<ConversionHistoryEntry> {
        let latest = self.latest();
        self.batches.iter().enumerate().rev().map(|(index, batch)| {
            let mut entry = batch.entry.clone();
            let status = if entry.undone { Err("此批次已撤销".to_string()) }
                else if batch.changes.is_empty() && entry.references_changed == 0 { Err("此批次未写入新文件".to_string()) }
                else if Some(index) != latest { Err("请先撤销更新的转换批次".to_string()) }
                else { self.undo_preflight(root, index) };
            entry.can_undo = status.is_ok();
            entry.undo_reason = status.err();
            entry
        }).collect()
    }

    pub fn undo(&mut self, root: &Path, id: &str) -> Result<(), String> {
        // TeX recovery persists its own phase through a separate Journal instance.
        *self = Self::load(root)?;
        if self.cleanup_completed_references(root, id)? { return Ok(()); }
        let index = self.latest().ok_or("No conversion writes to undo")?;
        if self.batches[index].entry.id != id { return Err("Only the latest compatible conversion batch can be undone".into()); }
        self.undo_preflight(root, index)?;
        if self.batches[index].entry.references_changed > 0
            && !matches!(self.batches[index].reference_phase, Some(ReferencePhase::Restored | ReferencePhase::NotApplied)) {
            return Err("批次撤销尚未完成引用恢复".into());
        }
        self.batches[index].undoing = true;
        self.save(root)?;
        for change in &self.batches[index].changes {
            // Retained TeX snapshots protect retries and every subsequent PDF write.
            self.preflight_references(root, id)?;
            let path = root.join(&change.output);
            safe_path(root, &path)?;
            let current = read_optional(&path)?;
            let backup = self.backup(root, change)?;
            if current != backup {
                if !current.as_ref().is_some_and(|bytes| digest(bytes) == change.after.pdf_hash) { return Err("Output changed during undo; recovery record retained".into()); }
                safe_path(root, &path)?;
                if read_optional(&path)? != current { return Err("Output changed during undo; recovery record retained".into()); }
                if let Some(bytes) = backup { save_atomic(&path, &bytes)?; }
                else { fs::remove_file(&path).map_err(|e| e.to_string())?; crate::workspace::sync_directory(path.parent().unwrap())?; }
            }
            if let Some(before) = &change.before { self.outputs.insert(change.output.clone(), before.clone()); }
            else { self.outputs.remove(&change.output); }
        }
        self.preflight_references(root, id)?;
        self.batches[index].entry.undone = true;
        self.batches[index].undoing = false;
        self.batches[index].references_applying = false;
        if self.batches[index].entry.references_changed > 0 {
            self.batches[index].reference_phase = Some(ReferencePhase::Complete);
        }
        self.save(root)?;
        self.cleanup_completed_references(root, id).map(|_| ())
    }
}
