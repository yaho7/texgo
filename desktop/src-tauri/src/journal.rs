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

#[derive(Serialize, Deserialize)]
struct Batch {
    entry: ConversionHistoryEntry,
    changes: Vec<Change>,
    #[serde(default)]
    undoing: bool,
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
        || normalized.chars().any(|c| c.is_control() || "<>:\"|?*{}%#".contains(c)) {
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

    pub fn directories(&self, root: &Path) -> Vec<(PathBuf, bool)> {
        self.directories.iter().map(|(path, recursive)| (root.join(path), *recursive)).collect()
    }

    pub fn begin(&mut self, root: &Path, options: &ConversionOptions) -> Result<usize, String> {
        self.ensure_settled()?;
        let created_at = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|e| e.to_string())?.as_millis() as u64;
        let id = format!("{created_at}-{}", self.batches.len());
        self.batches.push(Batch {
            entry: ConversionHistoryEntry { id, created_at, output_dir: options.output_dir.clone(),
                dpi: options.dpi, jpeg_quality: options.jpeg_quality, files: Vec::new(), undone: false, can_undo: false, cancelled: false, undo_reason: None },
            changes: Vec::new(), undoing: false,
        });
        self.save(root)?;
        Ok(self.batches.len() - 1)
    }

    pub fn ensure_settled(&self) -> Result<(), String> {
        if self.batches.iter().any(|batch| !batch.entry.undone && (batch.undoing || batch.changes.iter().any(|change| !change.committed))) {
            return Err("请先从转换记录撤销上次中断的文件操作，再开始新操作".into());
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
        let path = root.join(output);
        safe_path(root, &path).is_ok()
            && fs::read(&path).is_ok_and(|bytes| digest(&bytes) == managed.pdf_hash)
            && self.valid_sources(root, managed).is_ok()
            && lopdf::Document::load(path).is_ok_and(|doc| doc.get_pages().len() == 1)
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
        self.batches.iter().rposition(|batch| !batch.entry.undone && !batch.changes.is_empty())
    }

    fn undo_preflight(&self, root: &Path, index: usize) -> Result<(), String> {
        if crate::transaction::undo_available(root) { return Err("请先撤销引用替换，再撤销图片转换".into()); }
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
                else if batch.changes.is_empty() { Err("此批次未写入新文件".to_string()) }
                else if Some(index) != latest { Err("请先撤销更新的转换批次".to_string()) }
                else { self.undo_preflight(root, index) };
            entry.can_undo = status.is_ok();
            entry.undo_reason = status.err();
            entry
        }).collect()
    }

    pub fn undo(&mut self, root: &Path, id: &str) -> Result<(), String> {
        let index = self.latest().ok_or("No conversion writes to undo")?;
        if self.batches[index].entry.id != id { return Err("Only the latest compatible conversion batch can be undone".into()); }
        self.undo_preflight(root, index)?;
        self.batches[index].undoing = true;
        self.save(root)?;
        for change in &self.batches[index].changes {
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
        self.batches[index].entry.undone = true;
        self.batches[index].undoing = false;
        self.save(root)
    }
}
