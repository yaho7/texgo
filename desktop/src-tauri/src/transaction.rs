use crate::models::{FileChanges, MutationResult, ReferenceChange, ReplacementPlan};
use crate::workspace::{digest, save_atomic, StoredConversion};
use crate::Project;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

pub(crate) struct Prepared {
    pub plan: ReplacementPlan,
    pub files: Vec<(PathBuf, Vec<u8>, Vec<u8>)>,
}

#[derive(Serialize, Deserialize)]
struct Undo {
    version: u8,
    main_file: String,
    references_changed: usize,
    files: Vec<UndoFile>,
    #[serde(default)]
    batch_id: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct UndoFile {
    path: String,
    before: String,
    after_hash: String,
}

pub(crate) fn prepare(project: &Project, sources: &BTreeMap<PathBuf, Vec<u8>>, converted: &BTreeMap<String, StoredConversion>) -> Result<Prepared, String> {
    prepare_selected(project, sources, converted, None)
}

pub(crate) fn prepare_selected(project: &Project, sources: &BTreeMap<PathBuf, Vec<u8>>, converted: &BTreeMap<String, StoredConversion>, selection: Option<&HashSet<String>>) -> Result<Prepared, String> {
    let root = Path::new(&project.root);
    let mut found = HashSet::new();
    let mut edits: BTreeMap<PathBuf, Vec<(usize, usize, usize, String, String)>> = BTreeMap::new();
    for asset in &project.images {
        if asset.references.is_empty() { continue; }
        let Some(output) = converted.get(&asset.id) else { continue; };
        let original = asset.path.as_ref().ok_or("找不到原图片")?;
        if digest(&fs::read(original).map_err(|e| e.to_string())?) != output.source_hash {
            return Err(format!("图片已被修改，请重新转换：{}", asset.relative_path));
        }
        for (path, hash) in &output.dependencies {
            if digest(&fs::read(path).map_err(|e| e.to_string())?) != *hash { return Err("SVG 的引用资源已修改，请重新转换".into()); }
        }
        let real = output.path.canonicalize().map_err(|e| format!("转换文件已丢失：{e}"))?;
        if !real.starts_with(root) || digest(&fs::read(&real).map_err(|e| e.to_string())?) != output.pdf_hash {
            return Err("转换文件已被修改，请重新转换".into());
        }
        // TeX resolves includegraphics relative to the main compilation directory.
        let relative = pathdiff::diff_paths(&real, root).ok_or("无法生成相对图片路径")?.to_string_lossy().replace('\\', "/");
        if relative.contains(['{', '}', '%', '#', '$', '&', '^', '~', '\n', '\r']) { return Err("输出目录含有 TeX 特殊字符，请调整图片目录名称".into()); }
        for reference in &asset.references {
            if reference.original == relative { continue; }
            let id = reference_id(&reference.file, reference.start);
            if selection.is_some_and(|ids| !ids.contains(&id)) { continue; }
            found.insert(id);
            edits.entry(PathBuf::from(&reference.file)).or_default().push((reference.start, reference.end, reference.line, reference.original.clone(), relative.clone()));
        }
    }
    let mut plan = ReplacementPlan { files: Vec::new(), reference_count: 0 };
    let mut files = Vec::new();
    for (path, mut changes) in edits {
        let before = sources.get(&path).ok_or("TeX 文件不在扫描记录中")?;
        ensure_current(root, &path, before)?;
        let mut after = String::from_utf8(before.clone()).map_err(|e| e.to_string())?;
        changes.sort_by_key(|entry| entry.0);
        let mut last_end = 0;
        for (start, end, _, original, _) in &changes {
            if start < &last_end || after.get(*start..*end) != Some(original.as_str()) { return Err("引用位置已改变，请重新扫描".into()); }
            last_end = *end;
        }
        for (start, end, _, _, replacement) in changes.iter().rev() { after.replace_range(*start..*end, replacement); }
        let count = changes.len();
        plan.files.push(FileChanges {
            path: path.to_string_lossy().into(),
            changes: changes.into_iter().map(|(start, _, line, before, after)| ReferenceChange { id: reference_id(&path.to_string_lossy(), start), line, before, after }).collect(),
        });
        plan.reference_count += count;
        files.push((path, before.clone(), after.into_bytes()));
    }
    if selection.is_some_and(|ids| ids != &found) { return Err("审核的引用已改变，请重新检查引用变更".into()); }
    Ok(Prepared { plan, files })
}

fn reference_id(path: &str, start: usize) -> String { format!("{path}:{start}") }

// Compare the complete freshly prepared plan before filtering selected IDs.
pub(crate) fn verify_review(current: &ReplacementPlan, expected: &ReplacementPlan) -> Result<(), String> {
    if current != expected { return Err("引用变更与审核内容不一致，请重新检查引用变更".into()); }
    Ok(())
}

pub(crate) fn prepare_reviewed(project: &Project, sources: &BTreeMap<PathBuf, Vec<u8>>, converted: &BTreeMap<String, StoredConversion>, selection: &HashSet<String>, expected: &ReplacementPlan) -> Result<Prepared, String> {
    let current = prepare(project, sources, converted)?;
    verify_review(&current.plan, expected)?;
    prepare_selected(project, sources, converted, Some(selection))
}

pub(crate) fn apply(project: &Project, prepared: Prepared) -> Result<MutationResult, String> {
    apply_linked(project, prepared, None)
}

// Caller holds the project lock. Association is durable before any TeX writes.
pub(crate) fn apply_linked(project: &Project, prepared: Prepared, batch_id: Option<&str>) -> Result<MutationResult, String> {
    if prepared.files.is_empty() { return Err("没有可替换的引用，请先转换图片".into()); }
    let root = Path::new(&project.root);
    // Workspace holds the project lock from validation through the final write.
    archive_linked_legacy(root)?;
    let record_path = match batch_id {
        Some(id) => {
            if legacy_undo_available(root) { return Err("存在旧版独立引用恢复记录，请先单独恢复".into()); }
            batch_undo_path(root, id)?
        }
        None => {
            if undo_available(root) { return Err("已有引用恢复记录，独立操作不会覆盖批次恢复记录".into()); }
            undo_path(root)?
        }
    };
    if fs::symlink_metadata(&record_path).is_ok() { return Err("此批次已有引用恢复记录".into()); }
    ensure_record_directory(root, &record_path)?;
    let record = Undo {
        version: 1,
        main_file: project.main_file.clone(),
        references_changed: prepared.plan.reference_count,
        batch_id: batch_id.map(str::to_owned),
        files: prepared.files.iter().map(|(path, before, after)| UndoFile {
            path: path.strip_prefix(root).unwrap().to_string_lossy().into(),
            before: STANDARD.encode(before), after_hash: digest(after),
        }).collect(),
    };
    for (path, before, _) in &prepared.files { ensure_current(root, path, before)?; }
    if let Some(id) = batch_id {
        let mut journal = crate::journal::Journal::load(root)?;
        journal.associate_references(root, id, prepared.plan.reference_count, prepared.files.len())?;
    }
    save_atomic(&record_path, &serde_json::to_vec_pretty(&record).map_err(|e| e.to_string())?)?;
    for (path, before, after) in &prepared.files {
        // Recheck immediately before each write. A partial operation retains its recovery record.
        ensure_current(root, path, before).and_then(|_| save_atomic(path, after))
            .map_err(|e| format!("替换未全部完成：{e}。已保留恢复记录，可使用撤销"))?;
    }
    if let Some(id) = batch_id {
        let mut journal = crate::journal::Journal::load(root)?;
        journal.finish_references(root, id)?;
    }
    Ok(MutationResult { files_changed: prepared.files.len(), references_changed: prepared.plan.reference_count })
}

pub(crate) fn undo(project: &Project) -> Result<MutationResult, String> {
    let root = Path::new(&project.root);
    let _lock = lock_project(root)?;
    undo_locked(project, None)
}

fn read_record(path: &Path) -> Result<Undo, String> {
    let record: Undo = serde_json::from_slice(&fs::read(path).map_err(|_| "没有可撤销的替换记录")?).map_err(|e| format!("恢复记录损坏：{e}"))?;
    if record.version != 1 { return Err("不支持的引用恢复记录版本".into()); }
    Ok(record)
}

fn read_undo(root: &Path) -> Result<Undo, String> { read_record(&undo_path(root)?) }

pub(crate) fn legacy_undo_available(root: &Path) -> bool {
    fs::symlink_metadata(root.join(".texgo/undo.json")).is_ok()
}

pub(crate) fn standalone_undo_available(root: &Path) -> Result<bool, String> {
    if !legacy_undo_available(root) { return Ok(false); }
    read_undo(root).map(|record| record.batch_id.is_none())
}

fn batch_undo_path(root: &Path, id: &str) -> Result<PathBuf, String> {
    let path = root.join(".texgo/reference-undo").join(format!("{}.json", digest(id.as_bytes())));
    crate::journal::safe_path(root, &path)?;
    Ok(path)
}

fn ensure_record_directory(root: &Path, path: &Path) -> Result<(), String> {
    crate::journal::safe_path(root, path)?;
    fs::create_dir_all(path.parent().ok_or("缺少恢复目录")?).map_err(|e| e.to_string())?;
    crate::journal::safe_path(root, path)?;
    crate::workspace::sync_directory(&root.join(".texgo"))
}

// Copy first, then unlink: interruption at either boundary preserves recovery.
pub(crate) fn archive_linked_legacy(root: &Path) -> Result<(), String> {
    if !legacy_undo_available(root) { return Ok(()); }
    let legacy = undo_path(root)?;
    let record = read_record(&legacy)?;
    let Some(id) = &record.batch_id else { return Ok(()); };
    let path = batch_undo_path(root, id)?;
    ensure_record_directory(root, &path)?;
    let bytes = fs::read(&legacy).map_err(|e| e.to_string())?;
    match fs::read(&path) {
        Ok(existing) if existing != bytes => return Err("批次引用恢复记录冲突，已保留两份记录".into()),
        Ok(_) => (),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => save_atomic(&path, &bytes)?,
        Err(error) => return Err(error.to_string()),
    }
    fs::remove_file(&legacy).map_err(|e| e.to_string())?;
    crate::workspace::sync_directory(&root.join(".texgo"))
}

fn batch_record(root: &Path, batch_id: &str) -> Result<Option<Undo>, String> {
    if legacy_undo_available(root) {
        let legacy = read_undo(root)?;
        if legacy.batch_id.as_deref() != Some(batch_id) {
            return Err("存在其他批次或旧版独立引用恢复记录，请先单独处理".into());
        }
        restore_files(root, &legacy)?;
    }
    let path = batch_undo_path(root, batch_id)?;
    if fs::symlink_metadata(&path).is_ok() {
        let record = read_record(&path)?;
        if record.batch_id.as_deref() != Some(batch_id) { return Err("批次引用恢复记录归属不一致".into()); }
        return Ok(Some(record));
    }
    if legacy_undo_available(root) { return read_undo(root).map(Some); }
    Ok(None)
}

pub(crate) fn preflight_for_batch(root: &Path, batch_id: &str) -> Result<(), String> {
    let Some(record) = batch_record(root, batch_id)? else { return Ok(()); };
    restore_files(root, &record).map(|_| ())
}

/// Atomic workflow boundary: caller holds ONE lock for this entire operation.
pub(crate) fn undo_batch_locked(project: &Project, batch_id: &str) -> Result<(), String> {
    let root = Path::new(&project.root);
    archive_linked_legacy(root)?;
    if let Some(record) = batch_record(root, batch_id)? {
        if record.main_file != project.main_file { return Err("撤销记录不属于当前主文件".into()); }
    }
    let mut journal = crate::journal::Journal::load(root)?;
    journal.begin_undo(root, batch_id)?;
    undo_locked(project, Some(batch_id))?;
    journal.undo(root, batch_id)
}

fn restore_files(root: &Path, record: &Undo) -> Result<Vec<(PathBuf, Vec<u8>, Vec<u8>)>, String> {
    let mut restore = Vec::new();
    for entry in &record.files {
        let file = root.join(&entry.path);
        crate::journal::safe_path(root, &file)?;
        let real = file.canonicalize().map_err(|e| e.to_string())?;
        let before = STANDARD.decode(&entry.before).map_err(|e| e.to_string())?;
        let current = fs::read(&real).map_err(|e| e.to_string())?;
        if current == before { continue; }
        if digest(&current) != entry.after_hash { return Err(format!("{} 已被编辑，撤销不会覆盖修改", file.display())); }
        restore.push((real, before, current));
    }
    Ok(restore)
}

// None is deliberately legacy-only: linked references require the batch workflow.
pub(crate) fn undo_locked(project: &Project, batch_id: Option<&str>) -> Result<MutationResult, String> {
    let root = Path::new(&project.root);
    archive_linked_legacy(root)?;
    let (path, record) = if let Some(id) = batch_id {
        let Some(record) = batch_record(root, id)? else { return Ok(MutationResult { files_changed: 0, references_changed: 0 }); };
        (batch_undo_path(root, id)?, record)
    } else { (undo_path(root)?, read_undo(root)?) };
    if record.batch_id.as_deref() != batch_id { return Err("引用恢复记录与请求批次不一致；关联记录必须通过撤销批次恢复".into()); }
    if let Some(id) = batch_id {
        if !crate::journal::Journal::load(root)?.undo_in_progress(id) { return Err("必须先预检并开始批次撤销".into()); }
    }
    if record.version != 1 || record.main_file != project.main_file { return Err("撤销记录不属于当前主文件".into()); }
    let restore = restore_files(root, &record)?;
    for (file, before, expected) in &restore {
        ensure_current(root, file, expected)?;
        save_atomic(file, before)?;
    }
    fs::remove_file(&path).map_err(|e| e.to_string())?;
    crate::workspace::sync_directory(path.parent().unwrap())?;
    Ok(MutationResult { files_changed: restore.len(), references_changed: record.references_changed })
}

pub(crate) fn undo_available(root: &Path) -> bool {
    legacy_undo_available(root) || fs::read_dir(root.join(".texgo/reference-undo")).is_ok_and(|mut entries| entries.next().is_some())
}

pub(crate) fn batch_undo_available(root: &Path, id: &str) -> Result<bool, String> { batch_record(root, id).map(|record| record.is_some()) }

fn undo_path(root: &Path) -> Result<PathBuf, String> {
    let dir = root.join(".texgo");
    crate::journal::safe_path(root, &dir.join("undo.json"))?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    crate::journal::safe_path(root, &dir.join("undo.json"))?;
    crate::workspace::sync_directory(root)?;
    Ok(dir.join("undo.json"))
}

pub(crate) fn lock_project(root: &Path) -> Result<fs::File, String> {
    let path = undo_path(root)?.with_file_name("write.lock");
    if fs::symlink_metadata(&path).is_ok_and(|metadata| metadata.file_type().is_symlink()) { return Err("项目锁文件不能是符号链接".into()); }
    let file = fs::OpenOptions::new().read(true).write(true).create(true).truncate(false).open(path).map_err(|e| e.to_string())?;
    fs2::FileExt::try_lock_exclusive(&file).map_err(|_| "另一个 Texgo 实例正在修改项目，请稍后重试".to_string())?;
    Ok(file)
}

fn ensure_current(root: &Path, path: &Path, expected: &[u8]) -> Result<(), String> {
    let real = path.canonicalize().map_err(|e| e.to_string())?;
    if !real.starts_with(root) || real != path { return Err("文件路径发生变化，请重新扫描".into()); }
    if fs::read(&real).map_err(|e| e.to_string())? != expected { return Err(format!("{} 已被编辑，请重新扫描", path.display())); }
    Ok(())
}

#[cfg(test)]
mod batch_workflow {
    use super::*;
    use crate::journal::{Journal, Managed};
    use crate::models::ConversionOptions;

    fn fixture() -> (tempfile::TempDir, Project, Journal, String) {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        fs::write(root.join("main.tex"), b"old").unwrap();
        fs::write(root.join("a.png"), b"source").unwrap();
        let project = Project { mode: "tex".into(), recursive: false, converted_images: vec![], main_file: root.join("main.tex").to_string_lossy().into(), root: root.to_string_lossy().into(), tex_files: vec![], images: vec![], warnings: vec![], undo_available: false };
        let _lock = lock_project(&root).unwrap();
        let mut journal = Journal::load(&root).unwrap();
        let batch = journal.begin(&root, &ConversionOptions { image_ids: vec![], quality: "custom".into(), dpi: 150, jpeg_quality: 100, output_dir: "out".into() }).unwrap();
        journal.write(&root, batch, "out/a.pdf", Managed { source: "a.png".into(), source_hash: digest(b"source"), pdf_hash: digest(b"pdf"), key: "key".into(), dependencies: vec![] }, b"pdf").unwrap();
        let id = journal.latest_batch_id().unwrap().to_owned();
        (dir, project, journal, id)
    }

    fn prepared(project: &Project) -> Prepared {
        Prepared { plan: ReplacementPlan { files: vec![], reference_count: 1 }, files: vec![(Path::new(&project.root).join("main.tex"), b"old".to_vec(), b"new".to_vec())] }
    }

    #[test]
    fn joint_preflight_protects_both_kinds_of_files_and_retries_after_tex_restore() {
        let (_dir, project, _, id) = fixture();
        let root = Path::new(&project.root);
        let _lock = lock_project(root).unwrap();
        apply_linked(&project, prepared(&project), Some(&id)).unwrap();
        let mut journal = Journal::load(root).unwrap();
        fs::write(root.join("out/a.pdf"), b"edited").unwrap();
        assert!(journal.begin_undo(root, &id).is_err());
        assert_eq!(fs::read(root.join("main.tex")).unwrap(), b"new");
        fs::write(root.join("out/a.pdf"), b"pdf").unwrap();
        fs::write(root.join("main.tex"), b"edited").unwrap();
        assert!(journal.begin_undo(root, &id).is_err());
        assert_eq!(fs::read(root.join("out/a.pdf")).unwrap(), b"pdf");
        fs::write(root.join("main.tex"), b"new").unwrap();
        assert!(undo_locked(&project, Some(&id)).is_err());
        journal.begin_undo(root, &id).unwrap();
        undo_locked(&project, Some(&id)).unwrap();
        // Simulate restart after TeX recovery, before PDF recovery.
        let mut journal = Journal::load(root).unwrap();
        journal.begin_undo(root, &id).unwrap();
        undo_locked(&project, Some(&id)).unwrap();
        journal.undo(root, &id).unwrap();
        assert_eq!(fs::read(root.join("main.tex")).unwrap(), b"old");
        assert!(!root.join("out/a.pdf").exists());
        assert!(journal.history(root)[0].undone);
    }

    #[test]
    fn legacy_and_other_batch_records_never_unlock_batch_undo() {
        let (_dir, project, _, id) = fixture();
        let root = Path::new(&project.root);
        let _lock = lock_project(root).unwrap();
        apply(&project, prepared(&project)).unwrap();
        assert!(Journal::load(root).unwrap().preflight_undo(root, &id).is_err());
        assert!(undo_locked(&project, Some(&id)).is_err());
        undo_locked(&project, None).unwrap();
        apply_linked(&project, prepared(&project), Some(&id)).unwrap();
        assert!(undo_batch_locked(&project, "another-batch").is_err());
        assert!(undo_locked(&project, None).is_err());
    }

    #[test]
    fn consecutive_batches_keep_independent_reference_recovery_and_undo_lifo() {
        let (_dir, project, _, a) = fixture();
        let root = Path::new(&project.root);
        let _lock = lock_project(root).unwrap();
        apply_linked(&project, prepared(&project), Some(&a)).unwrap();
        let mut journal = Journal::load(root).unwrap();
        let b_index = journal.begin(root, &ConversionOptions { image_ids: vec![], quality: "custom".into(), dpi: 300, jpeg_quality: 100, output_dir: "out".into() }).unwrap();
        journal.write(root, b_index, "out/a.pdf", Managed { source: "a.png".into(), source_hash: digest(b"source"), pdf_hash: digest(b"pdf-B"), key: "B".into(), dependencies: vec![] }, b"pdf-B").unwrap();
        let b = journal.latest_batch_id().unwrap().to_owned();
        let mut next = prepared(&project);
        next.files[0].1 = b"new".to_vec();
        next.files[0].2 = b"new-B".to_vec();
        apply_linked(&project, next, Some(&b)).unwrap();
        assert!(undo_batch_locked(&project, &a).is_err());
        assert_eq!(fs::read(root.join("main.tex")).unwrap(), b"new-B");
        undo_batch_locked(&project, &b).unwrap();
        assert_eq!(fs::read(root.join("main.tex")).unwrap(), b"new");
        assert_eq!(fs::read(root.join("out/a.pdf")).unwrap(), b"pdf");
        assert!(batch_undo_available(root, &a).unwrap());
        undo_batch_locked(&project, &a).unwrap();
        assert_eq!(fs::read(root.join("main.tex")).unwrap(), b"old");
        assert!(!root.join("out/a.pdf").exists());
        assert!(!undo_available(root));
    }

    #[test]
    fn interrupted_archive_copy_is_idempotent_and_preserves_the_batch_record() {
        let (_dir, project, _, id) = fixture();
        let root = Path::new(&project.root);
        let _lock = lock_project(root).unwrap();
        apply_linked(&project, prepared(&project), Some(&id)).unwrap();
        let archived = batch_undo_path(root, &id).unwrap();
        // Both copies exist if migration stopped after durable copy, before unlink.
        fs::copy(&archived, undo_path(root).unwrap()).unwrap();
        archive_linked_legacy(root).unwrap();
        assert!(!legacy_undo_available(root));
        assert!(batch_undo_available(root, &id).unwrap());
        undo_batch_locked(&project, &id).unwrap();
    }

    #[test]
    fn reviewed_plan_and_selection_reject_unknown_or_changed_edits() {
        let (_dir, project, _, _) = fixture();
        let empty = prepare(&project, &BTreeMap::new(), &BTreeMap::new()).unwrap();
        let ids = HashSet::from(["unknown:0".into()]);
        assert!(prepare_selected(&project, &BTreeMap::new(), &BTreeMap::new(), Some(&ids)).is_err());
        assert!(verify_review(&empty.plan, &ReplacementPlan { files: vec![], reference_count: 1 }).is_err());
        assert!(prepare_reviewed(&project, &BTreeMap::new(), &BTreeMap::new(), &HashSet::new(), &empty.plan).is_ok());
    }

    #[test]
    fn selection_changes_only_reviewed_occurrences_and_same_offset_changes_fail() {
        let (_dir, mut project, _, _) = fixture();
        let root = PathBuf::from(&project.root);
        let tex = root.join("main.tex");
        fs::write(&tex, b"old old").unwrap();
        let sources = BTreeMap::from([(tex.clone(), b"old old".to_vec())]);
        project.images.push(crate::models::ImageAsset {
            id: "a".into(), path: Some(root.join("a.png").to_string_lossy().into()), relative_path: "a.png".into(), format: "png".into(), width: None, height: None, bytes: None, status: "ready".into(), update_available: false, message: None,
            references: [0, 4].into_iter().map(|start| crate::models::Reference { file: tex.to_string_lossy().into(), line: 1, original: "old".into(), start, end: start + 3 }).collect(),
        });
        let converted = BTreeMap::from([("a".into(), StoredConversion { path: root.join("out/a.pdf"), source_hash: digest(b"source"), pdf_hash: digest(b"pdf"), dependencies: vec![] })]);
        let expected = prepare(&project, &sources, &converted).unwrap().plan;
        let selected = HashSet::from([expected.files[0].changes[1].id.clone()]);
        let prepared = prepare_reviewed(&project, &sources, &converted, &selected, &expected).unwrap();
        assert_eq!(prepared.plan.reference_count, 1);
        assert_eq!(prepared.files[0].2, b"old out/a.pdf");
        let mut stale = expected.clone();
        stale.files[0].changes[1].before = "new".into();
        assert!(prepare_reviewed(&project, &sources, &converted, &selected, &stale).is_err());
        let mut unreviewed = expected.clone();
        unreviewed.files[0].changes.pop();
        unreviewed.reference_count -= 1;
        assert!(prepare_reviewed(&project, &sources, &converted, &selected, &unreviewed).is_err());
    }
}
