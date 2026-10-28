use crate::models::{ImageAsset, Project};
use crate::workspace::digest;

pub(crate) const MISSING_OUTPUT_NOTICE: &str = "托管 PDF 已丢失，请重新生成";
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

#[derive(Default, Serialize, Deserialize)]
struct Manifest {
    version: u8,
    images: BTreeMap<String, Entry>,
}

#[derive(Serialize, Deserialize)]
struct Entry {
    source: String,
}

pub(crate) fn restore_sources(project: &mut Project) {
    let root = std::path::PathBuf::from(&project.root);
    let path = root.join(".texgo/images.json");
    if crate::journal::safe_path(&root, &path).is_err() {
        project.warnings.push("图片映射记录位于项目之外，已忽略".into());
        return;
    }
    let mut manifest = if path.exists() {
        match fs::read(&path).ok().and_then(|bytes| serde_json::from_slice::<Manifest>(&bytes).ok()).filter(|manifest| manifest.version == 1) {
            Some(manifest) => manifest,
            None => { project.warnings.push("图片映射记录不可读取，已有 PDF 将按独立图片处理".into()); Manifest::default() }
        }
    } else { Manifest::default() };
    if let Ok(journal) = crate::journal::Journal::load(&root) {
        for (output, entry) in journal.outputs { manifest.images.insert(output, Entry { source: entry.source }); }
    }
    let mut assets: Vec<ImageAsset> = Vec::new();
    for mut asset in std::mem::take(&mut project.images) {
        if asset.status == "pdf" || (asset.status == "missing" && asset.format == "pdf") {
            if let Some(entry) = manifest.images.get(&asset.relative_path) {
                let missing_output = asset.status == "missing";
                let candidate = root.join(&entry.source);
                // Check the stored source spelling before canonicalize can hide
                // a symlink. Keep its source identity visible as a problem.
                let source_safe = crate::journal::safe_path(&root, &candidate).is_ok();
                let source = source_safe.then(|| candidate.canonicalize().ok()).flatten()
                    .filter(|path| path.starts_with(&root) && path.is_file());
                if !source_safe || crate::journal::safe_path(&root, &candidate).is_err() {
                    asset.id = digest(candidate.to_string_lossy().as_bytes());
                    asset.path = None;
                    asset.relative_path = entry.source.clone();
                    asset.status = "unsupported".into();
                    asset.can_rename = false;
                    asset.message = Some("原图片路径包含符号链接或不安全路径，请引用项目内的真实文件".into());
                    project.warnings.push(format!("转换 PDF 的原图片路径不安全：{}", entry.source));
                } else if let Some(source) = source {
                    let format = source.extension().and_then(|ext| ext.to_str()).unwrap_or("").to_lowercase();
                    if matches!(format.as_str(), "png" | "jpg" | "jpeg" | "svg" | "webp" | "tif" | "tiff" | "bmp" | "gif") {
                        asset.id = digest(source.to_string_lossy().as_bytes());
                        asset.path = Some(source.to_string_lossy().into());
                        asset.relative_path = entry.source.clone();
                        asset.format = format;
                        let dimensions = image::image_dimensions(&source).ok();
                        asset.width = dimensions.map(|size| size.0);
                        asset.height = dimensions.map(|size| size.1);
                        asset.bytes = fs::metadata(&source).ok().map(|metadata| metadata.len());
                        asset.status = "ready".into();
                        asset.message = Some(if missing_output { MISSING_OUTPUT_NOTICE } else { "已关联原图片，重新转换可更新 PDF" }.into());
                    }
                } else {
                    project.warnings.push(format!("转换 PDF 的原图片已丢失：{}", entry.source));
                    asset.message = Some("已找不到原图片，保留现有 PDF".into());
                }
            }
        }
        if let Some(existing) = assets.iter_mut().find(|existing| existing.id == asset.id) {
            if asset.message.as_deref() == Some(MISSING_OUTPUT_NOTICE) { existing.message = asset.message.clone(); }
            existing.references.extend(asset.references);
        } else { assets.push(asset); }
    }
    project.images = assets;
}
