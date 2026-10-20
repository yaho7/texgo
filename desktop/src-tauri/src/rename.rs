//! A durable multi-file transaction: every intended byte sequence is recorded before
//! the first write. Recovery validates the complete set before restoring any member.
use crate::{journal::{self, Journal}, models::*, workspace::{digest, save_atomic}};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, fs, io::Write, path::{Path, PathBuf}, time::{SystemTime, UNIX_EPOCH}};

#[derive(Clone, Serialize, Deserialize)]
struct FileState { path: String, before: Option<String>, after: Option<String> }
#[derive(Clone, Serialize, Deserialize)]
struct Record { version: u8, id: String, main_file: String, files: Vec<FileState> }

fn optional(root: &Path, path: &str) -> Result<Option<Vec<u8>>, String> {
    let path = root.join(path); journal::safe_path(root, &path)?;
    match fs::read(path) { Ok(v) => Ok(Some(v)), Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None), Err(e) => Err(e.to_string()) }
}
fn decode(value: &Option<String>) -> Result<Option<Vec<u8>>, String> { value.as_ref().map(|v| STANDARD.decode(v).map_err(|e| e.to_string())).transpose() }
fn state(path: String, before: Option<Vec<u8>>, after: Option<Vec<u8>>) -> FileState {
    FileState { path, before: before.map(|v| STANDARD.encode(v)), after: after.map(|v| STANDARD.encode(v)) }
}
fn record_path(id: &str) -> Result<String, String> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_digit() || c == '-' || c == 'r') { return Err("重命名恢复记录标识无效".into()); }
    Ok(format!(".texgo/rename-undo/{id}.json"))
}
fn read_record(root: &Path, path: &str) -> Result<Record, String> {
    let bytes = optional(root, path)?.ok_or("重命名恢复记录丢失，无法安全继续")?;
    let r: Record = serde_json::from_slice(&bytes).map_err(|_| "重命名恢复记录损坏，无法安全继续")?;
    if r.version != 1 || r.files.is_empty() { return Err("重命名恢复记录版本或内容无效".into()); }
    let mut unique = std::collections::HashSet::new();
    for f in &r.files {
        journal::safe_path(root, &root.join(&f.path))?;
        if !unique.insert(&f.path) || f.path == ".texgo/rename-active.json" || f.path.starts_with(".texgo/rename-undo/") { return Err("重命名恢复记录路径无效".into()); }
        decode(&f.before)?; decode(&f.after)?;
    }
    Ok(r)
}
fn preflight(root: &Path, record: &Record, exact_after: bool) -> Result<(), String> {
    for f in &record.files {
        let current = optional(root, &f.path)?;
        let after = decode(&f.after)?;
        if current != after && (exact_after || current != decode(&f.before)?) {
            return Err(format!("{} 已在外部修改，无法安全恢复；请恢复文件后重新扫描", f.path));
        }
    }
    Ok(())
}
fn write_state(root: &Path, path: &str, expected: &Option<Vec<u8>>, desired: &Option<Vec<u8>>) -> Result<(), String> {
    if optional(root, path)? != *expected { return Err("文件在操作期间被外部修改，恢复记录已保留".into()); }
    if expected == desired { return Ok(()); }
    let real = root.join(path);
    if let Some(bytes) = desired {
        let parent = real.parent().ok_or("文件没有父目录")?;
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        if let Some(ancestor) = parent.parent().filter(|p|p.starts_with(root)) { crate::workspace::sync_directory(ancestor)?; }
        journal::safe_path(root, &real)?;
        if expected.is_none() {
            let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
            temp.write_all(bytes).map_err(|e| e.to_string())?; temp.as_file().sync_all().map_err(|e| e.to_string())?;
            temp.persist_noclobber(&real).map_err(|e| e.to_string())?;
            crate::workspace::sync_directory(parent)?;
        } else { save_atomic(&real, bytes)?; }
    } else { fs::remove_file(&real).map_err(|e| e.to_string())?; crate::workspace::sync_directory(real.parent().unwrap())?; }
    Ok(())
}
fn rollback(root: &Path, record: &Record) -> Result<(), String> {
    preflight(root, record, false)?;
    for f in record.files.iter().rev() {
        let current = optional(root, &f.path)?;
        write_state(root, &f.path, &current, &decode(&f.before)?)?;
    }
    Ok(())
}
fn remove_active(root: &Path) -> Result<(), String> {
    fs::remove_file(root.join(".texgo/rename-active.json")).map_err(|e| e.to_string())?;
    crate::workspace::sync_directory(&root.join(".texgo"))
}
/// Must run under the project lock before scanning. An interrupted operation
/// always restores its starting snapshot; external changes are never overwritten.
pub(crate) fn recover(root: &Path) -> Result<(), String> {
    if optional(root, ".texgo/rename-active.json")?.is_none() { return Ok(()); }
    let record = read_record(root, ".texgo/rename-active.json")?;
    rollback(root, &record)?; remove_active(root)
}
fn commit(root: &Path, record: &Record, keep_undo: bool) -> Result<(), String> {
    preflight(root, record, false)?;
    if record.files.iter().any(|f| optional(root, &f.path).ok() != decode(&f.before).ok()) { return Err("文件状态已经变化，请重新扫描".into()); }
    let bytes = serde_json::to_vec_pretty(record).map_err(|e| e.to_string())?;
    let active = ".texgo/rename-active.json";
    write_state(root, active, &None, &Some(bytes.clone()))?;
    let attempt = (|| {
        if keep_undo { write_state(root, &record_path(&record.id)?, &None, &Some(bytes))?; }
        for f in &record.files {
            preflight(root, record, false)?;
            write_state(root, &f.path, &decode(&f.before)?, &decode(&f.after)?)?;
        }
        preflight(root, record, true)?;
        remove_active(root)
    })();
    if let Err(error) = attempt {
        match rollback(root, record).and_then(|_| remove_active(root)) {
            Ok(()) => return Err(error),
            Err(recovery) => return Err(format!("{error}；事务恢复未完成：{recovery}")),
        }
    }
    Ok(())
}

pub(crate) fn fingerprints(project: &Project, sources: &BTreeMap<PathBuf, Vec<u8>>) -> Result<BTreeMap<String,String>, String> {
    let root = Path::new(&project.root);
    let mut result = BTreeMap::new();
    for (path, bytes) in sources { result.insert(journal::relative(root, path)?, digest(bytes)); }
    for asset in &project.images {
        if let Some(path) = &asset.path {
            let path = Path::new(path);
            // Unsupported/symlink assets remain visible but cannot be renamed.
            if let Ok(relative) = journal::relative(root, path) {
                if let Ok(bytes) = fs::read(path) { result.insert(relative, digest(&bytes)); }
            }
        }
    }
    Ok(result)
}
pub(crate) fn state_fingerprint(project: &Project, fingerprints: &BTreeMap<String,String>) -> Result<String,String> {
    let root = Path::new(&project.root);
    let metadata: Vec<_> = [".texgo/conversions.json", ".texgo/ignore.json", ".texgo/images.json"]
        .iter().map(|p| optional(root,p).map(|v| v.map(|v| digest(&v)))).collect::<Result<_,_>>()?;
    Ok(digest(&serde_json::to_vec(&(project.main_file.as_str(), fingerprints, metadata)).map_err(|e| e.to_string())?))
}
fn valid_name(name: &str) -> Result<(),String> {
    let stem = name.split('.').next().unwrap_or("").to_ascii_lowercase();
    if name.is_empty() || name.trim() != name || matches!(name,"."|"..") || name.ends_with('.') || name.len() > 200
        || name.chars().any(|c| c.is_control() || "/\\<>:\"|?*{}%#$&^~".contains(c))
        || matches!(stem.as_str(),"con"|"prn"|"aux"|"nul")
        || (stem.len()==4 && (stem.starts_with("com")||stem.starts_with("lpt")) && matches!(stem.as_bytes()[3],b'1'..=b'9')) {
        return Err("请输入有效文件名，不能包含路径、特殊字符或系统保留名称".into());
    }
    Ok(())
}
fn move_files(root:&Path, files:&mut Vec<FileState>, old:&str,new:&str)->Result<(),String> {
    let bytes = optional(root,old)?.ok_or("原文件已经丢失，请重新扫描")?;
    if optional(root,new)?.is_some() { return Err(format!("同目录下已经存在 {new}")); }
    // Copy first, then remove: crashes never discard the only durable copy.
    files.push(state(new.into(),None,Some(bytes.clone())));
    files.push(state(old.into(),Some(bytes),None));
    Ok(())
}
pub(crate) fn rename_locked(project:&Project,sources:&BTreeMap<PathBuf,Vec<u8>>,fingerprints:&BTreeMap<String,String>,id:&str,name:&str,expected:&str)->Result<(String,String),String> {
    let root=Path::new(&project.root); valid_name(name)?;
    if expected.is_empty() || expected != project.state_fingerprint || expected != state_fingerprint(project,fingerprints)? { return Err("项目已发生变化，请重新扫描后重试".into()); }
    if optional(root,".texgo/rename-active.json")?.is_some() { return Err("存在未完成的重命名恢复，请重新打开项目".into()); }
    for (path,hash) in fingerprints {
        if optional(root,path)?.as_ref().map(|bytes|digest(bytes)).as_ref()!=Some(hash) { return Err("文件已在外部修改，请重新扫描后重试".into()); }
    }
    let asset=project.images.iter().find(|a|a.id==id).ok_or("找不到图片")?;
    let mut fresh=crate::scanner::scan(Path::new(&project.main_file))?.project;
    let original_targets:BTreeMap<_,_>=fresh.images.iter().flat_map(|asset|asset.references.iter().filter_map(|r|asset.path.as_ref().map(|p|((r.file.clone(),r.start),p.clone())))).collect();
    crate::manifest::restore_sources(&mut fresh);
    let current=fresh.images.iter().find(|a|a.id==id).ok_or("图片解析结果已经变化，请重新扫描")?;
    if current.status!=asset.status || current.relative_path!=asset.relative_path || current.references.len()!=asset.references.len()
        || current.references.iter().zip(&asset.references).any(|(a,b)| a.file!=b.file || a.original!=b.original || a.start!=b.start || a.end!=b.end) {
        return Err("图片引用解析结果已经变化，请重新扫描后重试".into());
    }
    if asset.status!="ready" { return Err("此图片没有明确的源文件，请使用定位或修复".into()); }
    let old=asset.path.as_ref().ok_or("找不到源图片")?; let old=Path::new(old);
    journal::safe_path(root,old)?;
    if !crate::scanner::supported_source(old) { return Err("只能重命名项目内的源图片".into()); }
    let extension=old.extension().and_then(|e|e.to_str()).ok_or("源文件没有扩展名")?;
    let new=old.with_file_name(format!("{name}.{extension}"));
    let old_rel=journal::relative(root,old)?; let new_rel=journal::relative(root,&new)?;
    if old_rel.eq_ignore_ascii_case(&new_rel) { return Err("新文件名与原文件名相同，请使用其他名称".into()); }
    if !fingerprints.contains_key(&old_rel) { return Err("源文件不在扫描记录中，请重新扫描".into()); }
    let journal_before=optional(root,".texgo/conversions.json")?;
    let mut journal=Journal::load(root)?; journal.ensure_settled()?;
    if crate::transaction::standalone_undo_available(root)? { return Err("请先撤销尚未完成的独立引用修改，再重命名图片".into()); }
    let mut moves=vec![(old_rel.clone(),new_rel.clone())];
    for (output,managed) in &journal.outputs {
        if managed.source!=old_rel { continue; }
        if !journal.valid_output(root,output,managed) { return Err("托管 PDF 已在外部修改或丢失，请重新扫描后重试".into()); }
        let target=Path::new(output).with_file_name(format!("{name}.pdf")).to_string_lossy().replace('\\',"/");
        if journal.outputs.contains_key(&target) { return Err("目标 PDF 已属于另一张图片".into()); }
        moves.push((output.clone(),target));
    }
    // SVG resources owned by another managed source need an explicit resource
    // edit operation; moving them here would silently invalidate that source.
    if journal.outputs.values().any(|m|m.source!=old_rel && m.dependencies.iter().any(|(p,_)|p==&old_rel)) { return Err("其他 SVG 依赖此图片，请先调整资源引用后重命名".into()); }
    for (_,new_path) in &moves {
        let target=root.join(new_path);
        let target_name=target.file_name().and_then(|n|n.to_str()).ok_or("文件名不是有效 UTF-8")?;
        for entry in fs::read_dir(target.parent().unwrap()).map_err(|e|e.to_string())? {
            let entry=entry.map_err(|e|e.to_string())?;
            if entry.file_name().to_string_lossy().eq_ignore_ascii_case(target_name) { return Err(format!("同目录下已经存在 {new_path}")); }
        }
    }
    let mut files=Vec::new(); for (old,new) in &moves { move_files(root,&mut files,old,new)?; }
    let mut edits:BTreeMap<PathBuf,Vec<(usize,usize,String,String)>>=BTreeMap::new();
    let mut reference_migrations=Vec::new();
    let mut expected_targets:BTreeMap<(String,usize,String,String),usize>=BTreeMap::new();
    for reference in &asset.references {
        let original=reference.original.trim();
        let original_path=Path::new(original);
        let candidate=root.join(original_path);
        if candidate.symlink_metadata().is_ok() { journal::safe_path(root,&candidate)?; }
        else if original_path.extension().is_none() {
            let candidate=candidate.with_extension(extension);
            if candidate.symlink_metadata().is_ok() { journal::safe_path(root,&candidate)?; }
        }
        if original_path.extension().is_none() && name.contains('.') { return Err("省略扩展名的引用需要不含点号的新名称".into()); }
        let filename=if let Some(ext)=original_path.extension().and_then(|e|e.to_str()) { format!("{name}.{ext}") } else { name.into() };
        let replacement=original_path.with_file_name(filename).to_string_lossy().replace('\\',"/");
        let leading=reference.original.len()-reference.original.trim_start().len();
        let trailing=reference.original.trim_end().len();
        let replacement=format!("{}{}{}",&reference.original[..leading],replacement,&reference.original[trailing..]);
        // with_file_name preserves directory/graphicspath spelling and extensionless style.
        let path=PathBuf::from(&reference.file); journal::safe_path(root,&path)?;
        edits.entry(path.clone()).or_default().push((reference.start,reference.end,reference.original.clone(),replacement.clone()));
        let original_target=original_targets.get(&(reference.file.clone(),reference.start)).ok_or("引用解析记录已变化")?;
        let target=moves.iter().find(|(old,_)|root.join(old)==Path::new(original_target)).map(|(_,new)|root.join(new)).ok_or("引用不属于当前图片或托管 PDF")?;
        *expected_targets.entry((reference.file.clone(),reference.line,replacement.clone(),target.to_string_lossy().into())).or_default()+=1;
        reference_migrations.push((journal::relative(root,&path)?,reference.original.clone(),replacement));
    }
    let reference_count=asset.references.len();
    let tex_count=edits.len();
    for (path,mut changes) in edits {
        let before=sources.get(&path).ok_or("引用文件不在扫描记录中")?;
        let mut after=String::from_utf8(before.clone()).map_err(|_|"TeX 文件不是 UTF-8")?;
        changes.sort_by_key(|c|c.0);
        let mut previous=0;
        for (start,end,original,_) in &changes {
            if *start<previous || *end<*start || after.get(*start..*end)!=Some(original.as_str()) { return Err("LaTeX 引用已变化，请重新扫描后重试".into()); }
            previous=*end;
        }
        for (start,end,_,replacement) in changes.into_iter().rev() { after.replace_range(start..end,&replacement); }
        files.push(state(journal::relative(root,&path)?,Some(before.clone()),Some(after.into_bytes())));
    }
    let tex_overrides=files.iter().filter(|f|Path::new(&f.path).extension().is_some_and(|e|e=="tex"))
        .map(|f|decode(&f.after).map(|bytes|(root.join(&f.path),bytes.unwrap_or_default()))).collect::<Result<BTreeMap<_,_>,_>>()?;
    let preview=crate::scanner::scan_renamed(Path::new(&project.main_file),tex_overrides,moves.iter().map(|(a,b)|(root.join(a),root.join(b))).collect())?;
    let mut actual_targets:BTreeMap<(String,usize,String,String),usize>=BTreeMap::new();
    for preview_asset in &preview.images {
        if !matches!(preview_asset.status.as_str(),"ready"|"pdf") { continue; }
        let Some(path)=&preview_asset.path else { continue; };
        for reference in &preview_asset.references {
            let key=(reference.file.clone(),reference.line,reference.original.clone(),path.clone());
            if expected_targets.contains_key(&key) { *actual_targets.entry(key).or_default()+=1; }
        }
    }
    if actual_targets!=expected_targets { return Err("新名称会使 LaTeX 引用出现歧义或指向其他图片，请使用其他名称".into()); }
    let mut ignores=crate::ignore::IgnoreStore::load(root)?;
    let before_ignores=ignores.serialized()?;
    ignores.migrate_paths(&moves)?; ignores.migrate_references(&reference_migrations)?;
    let after_ignores=ignores.serialized()?;
    if before_ignores!=after_ignores { files.push(state(".texgo/ignore.json".into(),optional(root,".texgo/ignore.json")?,Some(after_ignores))); }
    if let Some(before)=optional(root,".texgo/images.json")? {
        let mut manifest:serde_json::Value=serde_json::from_slice(&before).map_err(|_|"图片映射记录损坏，无法安全重命名")?;
        let images=manifest.get_mut("images").and_then(|v|v.as_object_mut()).ok_or("图片映射记录无效")?;
        for (old,new) in moves.iter().skip(1) {
            if let Some(mut entry)=images.remove(old) { entry["source"]=new_rel.clone().into(); images.insert(new.clone(),entry); }
        }
        for entry in images.values_mut() { if entry.get("source").and_then(|v|v.as_str())==Some(old_rel.as_str()) { entry["source"]=new_rel.clone().into(); } }
        files.push(state(".texgo/images.json".into(),Some(before),Some(serde_json::to_vec_pretty(&manifest).map_err(|e|e.to_string())?)));
    }
    let created_at=SystemTime::now().duration_since(UNIX_EPOCH).map_err(|e|e.to_string())?.as_millis() as u64;
    let record_id=format!("r{}-{}",SystemTime::now().duration_since(UNIX_EPOCH).map_err(|e|e.to_string())?.as_nanos(),journal.history(root).len());
    journal.migrate_asset(&moves,&old_rel,&new_rel)?;
    let rename=RenameHistory { old_source:old_rel.clone(),new_source:new_rel.clone(),old_pdf:moves.get(1).map(|v|v.0.clone()),new_pdf:moves.get(1).map(|v|v.1.clone()),references_changed:reference_count,pdf_count:moves.len()-1 };
    let mut protected=files.clone();
    protected.push(state(".texgo/conversions.json".into(),journal_before.clone(),None));
    let identity=record_fingerprint(&Record{version:1,id:record_id.clone(),main_file:project.main_file.clone(),files:protected})?;
    journal.record_rename(&record_id,created_at,rename,reference_count,tex_count,identity);
    files.push(state(".texgo/conversions.json".into(),journal_before,Some(journal.serialized()?)));
    let record=Record{version:1,id:record_id,main_file:project.main_file.clone(),files};
    commit(root,&record,true)?;
    Ok((id.into(),digest(new.to_string_lossy().as_bytes())))
}
fn record_fingerprint(record:&Record)->Result<String,String> {
    let mut protected=record.clone();
    for file in &mut protected.files { if file.path==".texgo/conversions.json" { file.after=None; } }
    Ok(digest(&serde_json::to_vec(&protected).map_err(|e|e.to_string())?))
}
pub(crate) fn preflight_undo(root:&Path,id:&str)->Result<(),String> {
    let record=read_record(root,&record_path(id)?)?;
    if Journal::load(root)?.rename_fingerprint(id)!=Some(record_fingerprint(&record)?.as_str()) { return Err("重命名恢复记录已被修改，无法安全撤销".into()); }
    // The journal evolves after later operations are undone. Compare file state
    // and ownership against the current LIFO journal separately.
    let mut check=record.clone(); check.files.retain(|f|f.path!=".texgo/conversions.json");
    preflight(root,&check,true)
}
pub(crate) fn undo_locked(project:&Project,id:&str)->Result<(),String> {
    let root=Path::new(&project.root); let journal=Journal::load(root)?;
    if journal.rename_undone(id) { return Ok(()); }
    journal.preflight_undo(root,id)?;
    let old=read_record(root,&record_path(id)?)?;
    if old.main_file!=project.main_file { return Err("重命名记录不属于当前主文件".into()); }
    let journal_state=old.files.iter().find(|f|f.path==".texgo/conversions.json").ok_or("重命名 Journal 恢复记录丢失")?;
    let mut restored=Journal::from_optional_bytes(decode(&journal_state.before)?.as_deref())?;
    restored.append_undone_rename(&journal,id)?;
    let mut files:Vec<_>=old.files.iter().filter(|f|f.path!=".texgo/conversions.json").rev().map(|f|FileState{path:f.path.clone(),before:f.after.clone(),after:f.before.clone()}).collect();
    files.push(state(".texgo/conversions.json".into(),optional(root,".texgo/conversions.json")?,Some(restored.serialized()?)));
    let record=Record{version:1,id:id.into(),main_file:project.main_file.clone(),files};
    commit(root,&record,false)
}

#[cfg(test)]
mod recovery_tests {
    use super::*;
    fn fixture() -> (tempfile::TempDir,PathBuf,Record) {
        let temp=tempfile::tempdir().unwrap(); let root=temp.path().canonicalize().unwrap();
        fs::write(root.join("main.tex"),br"\includegraphics{a.png}").unwrap();
        fs::write(root.join("a.png"),b"source").unwrap();
        let record=Record{version:1,id:"r1-0".into(),main_file:root.join("main.tex").to_string_lossy().into(),files:vec![
            state("b.png".into(),None,Some(b"source".to_vec())),
            state("a.png".into(),Some(b"source".to_vec()),None),
            state("main.tex".into(),Some(br"\includegraphics{a.png}".to_vec()),Some(br"\includegraphics{b.png}".to_vec())),
        ]};
        (temp,root,record)
    }
    #[test]
    fn every_interrupted_prefix_rolls_back_completely_and_recovery_is_idempotent() {
        for applied in 0..=3 {
            let (_temp,root,record)=fixture();
            let bytes=serde_json::to_vec(&record).unwrap();
            write_state(&root,".texgo/rename-active.json",&None,&Some(bytes)).unwrap();
            for f in record.files.iter().take(applied) { write_state(&root,&f.path,&decode(&f.before).unwrap(),&decode(&f.after).unwrap()).unwrap(); }
            recover(&root).unwrap(); recover(&root).unwrap();
            assert_eq!(fs::read(root.join("a.png")).unwrap(),b"source");
            assert!(!root.join("b.png").exists());
            assert_eq!(fs::read(root.join("main.tex")).unwrap(),br"\includegraphics{a.png}");
        }
    }
    #[test]
    fn recovery_preflights_every_member_before_restoring_any() {
        let (_temp,root,record)=fixture();
        write_state(&root,".texgo/rename-active.json",&None,&Some(serde_json::to_vec(&record).unwrap())).unwrap();
        for f in &record.files { write_state(&root,&f.path,&decode(&f.before).unwrap(),&decode(&f.after).unwrap()).unwrap(); }
        fs::write(root.join("main.tex"),b"user edit").unwrap();
        assert!(recover(&root).is_err());
        assert!(!root.join("a.png").exists());
        assert_eq!(fs::read(root.join("b.png")).unwrap(),b"source");
        assert_eq!(fs::read(root.join("main.tex")).unwrap(),b"user edit");
        assert!(root.join(".texgo/rename-active.json").exists());
    }
    #[test]
    fn interrupted_undo_rolls_back_to_the_committed_rename_snapshot() {
        let (_temp,root,mut record)=fixture();
        for f in &record.files { write_state(&root,&f.path,&decode(&f.before).unwrap(),&decode(&f.after).unwrap()).unwrap(); }
        record.files=record.files.into_iter().rev().map(|f|FileState{path:f.path,before:f.after,after:f.before}).collect();
        write_state(&root,".texgo/rename-active.json",&None,&Some(serde_json::to_vec(&record).unwrap())).unwrap();
        let first=&record.files[0]; write_state(&root,&first.path,&decode(&first.before).unwrap(),&decode(&first.after).unwrap()).unwrap();
        recover(&root).unwrap();
        assert!(!root.join("a.png").exists());
        assert!(root.join("b.png").exists());
        assert_eq!(fs::read(root.join("main.tex")).unwrap(),br"\includegraphics{b.png}");
    }
}
