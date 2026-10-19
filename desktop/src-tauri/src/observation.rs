use std::{collections::BTreeMap, fs, path::{Path, PathBuf}, time::SystemTime};

pub(crate) type Snapshot = BTreeMap<PathBuf, (u64, Option<SystemTime>)>;

pub(crate) fn snapshot(root: &Path) -> Result<Snapshot, String> {
    let mut result = BTreeMap::new();
    let mut pending = vec![(root.to_path_buf(), 0usize)];
    let mut visited = 0usize;
    while let Some((directory, depth)) = pending.pop() {
        if depth > 64 { return Err("项目目录层级过深，无法自动检测变化".into()); }
        for entry in fs::read_dir(&directory).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            visited += 1;
            if visited > 50_000 { return Err("项目文件过多，无法自动检测变化".into()); }
            if matches!(entry.file_name().to_str(), Some(".git" | "node_modules" | "target" | "dist")) { continue; }
            let kind = entry.file_type().map_err(|e| e.to_string())?;
            if kind.is_symlink() { continue; }
            let path = entry.path();
            // Journal writes, SVG dependencies and managed PDFs are included. No file contents are read here.
            if kind.is_dir() { pending.push((path, depth + 1)); }
            else if kind.is_file() && path.extension().and_then(|ext| ext.to_str()).is_some_and(|ext| matches!(ext.to_ascii_lowercase().as_str(),
                "tex" | "bib" | "sty" | "cls" | "cfg" | "png" | "jpg" | "jpeg" | "svg" | "webp" | "tif" | "tiff" | "bmp" | "gif" | "eps" | "ps" | "pdf" | "json" | "ttf" | "otf" | "woff" | "woff2")) {
                let metadata = entry.metadata().map_err(|e| e.to_string())?;
                result.insert(path, (metadata.len(), metadata.modified().ok()));
            }
        }
    }
    Ok(result)
}
