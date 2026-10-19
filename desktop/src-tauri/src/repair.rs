//! Reviewed reference repair. Discovery and preparation never write files.
//! Keep the original Scan and Prepared until approval; apply acquires its own
//! project lock, so Workspace must not already hold transaction::lock_project.
//! Uses the standalone (legacy) undo record, not a conversion batch association.
use crate::journal::{self, Journal};
use crate::models::{FileChanges, ImageAsset, MutationResult, Project, ReferenceChange, ReplacementPlan};
use crate::{scanner, transaction};
use serde::Serialize;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

const MAX_ENTRIES: usize = 50_000;
const MAX_CANDIDATES: usize = 512;
const MAX_DEPTH: usize = 64;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Candidate {
    pub path: String,
    pub relative_path: String,
}

fn problem<'a>(project: &'a Project, id: &str) -> Result<&'a ImageAsset, String> {
    if project.mode != "tex" { return Err("只有 TeX 项目的引用可以修复".into()); }
    let asset = project.images.iter().find(|asset| asset.id == id).ok_or("图片不在扫描记录中")?;
    if !matches!(asset.status.as_str(), "missing" | "ambiguous") || asset.references.is_empty() {
        return Err("只能修复缺失或歧义的静态图片引用".into());
    }
    for reference in &asset.references {
        if !static_path(&reference.original) { return Err("动态引用或含 TeX 特殊字符的引用不能自动修复".into()); }
    }
    Ok(asset)
}

fn static_path(value: &str) -> bool {
    !value.trim().is_empty()
        && !value.chars().any(|c| c.is_control() || "\\{}%#$&^~\"".contains(c))
}

fn image_file(path: &Path) -> bool {
    path.extension().and_then(|ext| ext.to_str()).is_some_and(|ext| {
        matches!(ext.to_ascii_lowercase().as_str(), "pdf" | "png" | "jpg" | "jpeg" | "svg" | "webp" | "tif" | "tiff" | "bmp" | "gif")
    })
}

fn root(project: &Project) -> Result<PathBuf, String> {
    let root = PathBuf::from(&project.root);
    journal::safe_path(&root, &root)?;
    if !root.is_dir() { return Err("项目目录不存在".into()); }
    Ok(root)
}

fn excluded(root: &Path) -> Result<Vec<PathBuf>, String> {
    let journal = Journal::load(root)?;
    let mut paths = journal.excluded(root);
    paths.extend(journal.outputs.keys().map(|path| root.join(path)));
    Ok(paths)
}

fn reserved(root: &Path, path: &Path, excluded: &[PathBuf]) -> bool {
    excluded.iter().any(|dir| path.starts_with(dir))
        || path.strip_prefix(root).map_or(true, |relative| relative.components().any(|part| {
            matches!(part.as_os_str().to_str(), Some("texgo-pdf" | ".texgo" | ".git" | "node_modules" | "target" | "dist" | "build"))
        }))
}

fn checked_target(root: &Path, target: &Path, excluded: &[PathBuf]) -> Result<(PathBuf, String), String> {
    let path = if target.is_absolute() { target.to_path_buf() } else { root.join(target) };
    // Check lexical components before canonicalization so in-root links are not accepted.
    journal::safe_path(root, &path)?;
    if reserved(root, &path, excluded) { return Err("不能使用生成目录、输出文件或状态目录中的图片".into()); }
    if !fs::symlink_metadata(&path).map_err(|e| e.to_string())?.is_file() || !image_file(&path) {
        return Err("请选择项目内的普通图片文件或 PDF".into());
    }
    if path.canonicalize().map_err(|e| e.to_string())? != path { return Err("图片路径发生变化，请重新选择".into()); }
    let relative = path.strip_prefix(root).map_err(|e| e.to_string())?.to_str().ok_or("图片路径不是 UTF-8")?.to_string();
    if !static_path(&relative) || relative.trim() != relative {
        return Err("图片路径含有 TeX 特殊字符，请先重命名".into());
    }
    Ok((path, relative))
}

/// Exact stem/extension matches only, in deterministic main-root-relative order.
/// Manual location may choose any supported safe file; candidates are suggestions.
pub(crate) fn candidates(project: &Project, id: &str) -> Result<Vec<Candidate>, String> {
    let asset = problem(project, id)?;
    let root = root(project)?;
    let excluded = excluded(&root)?;
    let requested = Path::new(asset.references[0].original.trim());
    let stem = requested.file_stem().ok_or("引用没有有效文件名")?;
    let extension = requested.extension();
    let mut pending = vec![(root.clone(), 0usize)];
    let mut visited = 0usize;
    let mut found = Vec::new();
    while let Some((directory, depth)) = pending.pop() {
        if depth > MAX_DEPTH { return Err("候选扫描超过 64 层目录，请缩小项目范围".into()); }
        journal::safe_path(&root, &directory)?;
        for entry in fs::read_dir(&directory).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            visited += 1;
            if visited > MAX_ENTRIES { return Err("候选扫描超过 50000 个条目，请缩小项目范围".into()); }
            let path = entry.path();
            if reserved(&root, &path, &excluded) { continue; }
            let kind = entry.file_type().map_err(|e| e.to_string())?;
            if kind.is_symlink() { continue; }
            if kind.is_dir() {
                pending.push((path, depth + 1));
            } else if kind.is_file() && image_file(&path) && path.file_stem() == Some(stem)
                && extension.is_none_or(|ext| path.extension() == Some(ext)) {
                let Ok((path, relative_path)) = checked_target(&root, &path, &excluded) else { continue; };
                found.push(Candidate { path: path.to_string_lossy().into(), relative_path });
                if found.len() > MAX_CANDIDATES { return Err("匹配超过 512 个文件，请手动定位图片".into()); }
            }
        }
    }
    found.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
    Ok(found)
}

/// Returns a normal transaction plan plus exact before/after bytes, without writes.
pub(crate) fn prepare(scan: &scanner::Scan, id: &str, target: &Path) -> Result<transaction::Prepared, String> {
    let asset = problem(&scan.project, id)?;
    let root = root(&scan.project)?;
    let (_, replacement) = checked_target(&root, target, &excluded(&root)?)?;
    for (path, before) in &scan.sources {
        journal::safe_path(&root, path)?;
        if !path.is_file() || fs::read(path).map_err(|e| e.to_string())? != *before {
            return Err(format!("{} 已被编辑，请重新扫描", path.display()));
        }
    }
    // Reparse the source graph, not only edited ranges: input/graphicspath changes
    // and newly resolved assets can invalidate the assumptions of a stale review.
    journal::safe_path(&root, Path::new(&scan.project.main_file))?;
    let current = scanner::scan(Path::new(&scan.project.main_file))?;
    let current_asset = current.project.images.iter().find(|item| item.id == id).ok_or("引用已改变，请重新扫描")?;
    if current.sources != scan.sources
        || serde_json::to_vec(current_asset).map_err(|e| e.to_string())? != serde_json::to_vec(asset).map_err(|e| e.to_string())? {
        return Err("扫描快照已改变，请重新扫描后审核修复".into());
    }
    let mut edits = BTreeMap::<PathBuf, Vec<_>>::new();
    for reference in &asset.references {
        edits.entry(PathBuf::from(&reference.file)).or_default().push(reference);
    }
    let mut prepared = transaction::Prepared {
        plan: ReplacementPlan { files: Vec::new(), reference_count: 0 }, files: Vec::new(),
    };
    for (path, mut references) in edits {
        let before = scan.sources.get(&path).ok_or("引用文件不在扫描记录中")?;
        let source = std::str::from_utf8(before).map_err(|e| e.to_string())?;
        references.sort_by_key(|reference| reference.start);
        let mut last_end = 0;
        let mut changes = Vec::new();
        for reference in &references {
            if reference.start < last_end || source.get(reference.start..reference.end) != Some(reference.original.as_str()) {
                return Err("引用位置已改变，请重新扫描".into());
            }
            last_end = reference.end;
            let leading = reference.original.len() - reference.original.trim_start().len();
            let trailing = reference.original.trim_end().len();
            let after = format!("{}{}{}", &reference.original[..leading], replacement, &reference.original[trailing..]);
            changes.push(ReferenceChange {
                id: format!("{}:{}", reference.file, reference.start),
                line: reference.line, before: reference.original.clone(), after,
            });
        }
        let mut after = source.to_owned();
        for (reference, change) in references.iter().zip(&changes).rev() {
            after.replace_range(reference.start..reference.end, &change.after);
        }
        prepared.plan.reference_count += changes.len();
        prepared.plan.files.push(FileChanges { path: path.to_string_lossy().into(), changes });
        prepared.files.push((path, before.clone(), after.into_bytes()));
    }
    Ok(prepared)
}

/// Call only after human approval of reviewed.plan. No nested project lock.
/// Regeneration must produce the very same bytes the user reviewed.
pub(crate) fn apply(scan: &scanner::Scan, id: &str, target: &Path, reviewed: transaction::Prepared) -> Result<MutationResult, String> {
    let root = root(&scan.project)?;
    let _lock = transaction::lock_project(&root)?;
    let current = prepare(scan, id, target)?;
    if current.files != reviewed.files
        || serde_json::to_vec(&current.plan).map_err(|e| e.to_string())? != serde_json::to_vec(&reviewed.plan).map_err(|e| e.to_string())? {
        return Err("修复计划已改变，请重新审核".into());
    }
    transaction::apply(&scan.project, current)
}
