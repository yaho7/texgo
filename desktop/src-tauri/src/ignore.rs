//! Project-owned persistent ignore rules. Session ignores deliberately live in Workspace.
//! Mutating callers must hold the project lock before loading and saving rules.
use crate::{journal, models::ImageAsset, workspace::save_atomic};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeSet, fs, path::{Path, PathBuf}};

const READ_ERROR: &str = "项目忽略规则无法读取，请修复或重置";
const MAX_CONFIG_BYTES: u64 = 1024 * 1024;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReferenceIdentity {
    tex_file: String,
    reference: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
enum Entry {
    Path {
        path: String,
        // Remember the references that resolved to this source. If it later
        // disappears, these stable identities keep the same asset ignored.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        references: Vec<ReferenceIdentity>,
    },
    Reference {
        #[serde(rename = "texFile")]
        tex_file: String,
        reference: String,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Document {
    version: u8,
    entries: Vec<Entry>,
}

#[derive(Clone, Debug)]
pub(crate) struct IgnoreStore {
    entries: Vec<Entry>,
    baseline: Option<Vec<u8>>,
}

pub(crate) type IgnoreRules = IgnoreStore;

fn config_path(root: &Path) -> PathBuf { root.join(".texgo/ignore.json") }

// Normalize project paths lexically: missing files must never need canonicalize().
fn normalized_path(value: &str) -> Result<String, String> {
    let value = value.replace('\\', "/");
    if value.starts_with('/') || value.contains(':') || value.chars().any(char::is_control) {
        return Err(READ_ERROR.into());
    }
    let mut parts = Vec::new();
    for part in value.split('/') {
        match part {
            "" | "." => (),
            ".." => return Err(READ_ERROR.into()),
            _ => parts.push(part),
        }
    }
    if parts.is_empty() { return Err(READ_ERROR.into()); }
    Ok(parts.join("/"))
}

fn relative(root: &Path, value: &str) -> Result<String, String> {
    // Comparing slash-normalized strings also makes serialized Windows paths
    // stable while retaining the platform's native root spelling/case.
    let root = root.to_string_lossy().replace('\\', "/");
    let value = value.replace('\\', "/");
    let candidate = if value == root { "" } else if let Some(relative) = value.strip_prefix(&(root + "/")) {
        relative
    } else { &value };
    normalized_path(candidate)
}

fn reference_value(value: &str) -> Result<String, String> {
    // Keep raw includegraphics parameters (including macros) as stable identity;
    // only path separator spelling is normalized. Do not parse TeX here.
    if value.is_empty() || value.contains('\0') { return Err(READ_ERROR.into()); }
    Ok(value.replace('\\', "/"))
}

fn identities(root: &Path, asset: &ImageAsset) -> Vec<ReferenceIdentity> {
    asset.references.iter().filter_map(|reference| Some(ReferenceIdentity {
        tex_file: relative(root, &reference.file).ok()?,
        reference: reference_value(&reference.original).ok()?,
    })).collect::<BTreeSet<_>>().into_iter().collect()
}

// A missing managed source can leave a perfectly valid PDF in the scan.
// Only durable ownership evidence may relate that PDF back to a source rule;
// a matching reference alias alone must not ignore an unrelated resolved file.
fn managed_source(root: &Path, asset: &ImageAsset) -> Option<String> {
    if !matches!(asset.status.as_str(), "pdf" | "missing") || asset.format != "pdf" { return None; }
    let output = normalized_path(&asset.relative_path).ok()?;
    if let Ok(journal) = journal::Journal::load(root) {
        if let Some(managed) = journal.outputs.get(&output) {
            return normalized_path(&managed.source).ok();
        }
    }
    #[derive(Deserialize)]
    struct LegacyEntry { source: String }
    #[derive(Deserialize)]
    struct LegacyMapping { version: u8, images: std::collections::BTreeMap<String, LegacyEntry> }
    let path = root.join(".texgo/images.json");
    journal::safe_path(root, &path).ok()?;
    let metadata = fs::symlink_metadata(&path).ok()?;
    if !metadata.is_file() || metadata.len() > MAX_CONFIG_BYTES { return None; }
    let mapping: LegacyMapping = serde_json::from_slice(&fs::read(path).ok()?).ok()?;
    if mapping.version != 1 { return None; }
    normalized_path(&mapping.images.get(&output)?.source).ok()
}

fn normalized_entries(entries: Vec<Entry>) -> Result<Vec<Entry>, String> {
    entries.into_iter().map(|entry| match entry {
        Entry::Path { path, references } => Ok(Entry::Path {
            path: normalized_path(&path)?,
            references: references.into_iter().map(|reference| Ok(ReferenceIdentity {
                tex_file: normalized_path(&reference.tex_file)?,
                reference: reference_value(&reference.reference)?,
            })).collect::<Result<BTreeSet<_>, String>>()?.into_iter().collect(),
        }),
        Entry::Reference { tex_file, reference } => Ok(Entry::Reference {
            tex_file: normalized_path(&tex_file)?, reference: reference_value(&reference)?,
        }),
    }).collect::<Result<BTreeSet<_>, String>>().map(|entries| entries.into_iter().collect())
}

fn read(root: &Path) -> Result<Option<Vec<u8>>, String> {
    let path = config_path(root);
    journal::safe_path(root, &path).map_err(|_| READ_ERROR.to_string())?;
    match fs::symlink_metadata(&path) {
        Ok(metadata) if !metadata.is_file() || metadata.len() > MAX_CONFIG_BYTES => Err(READ_ERROR.into()),
        Ok(_) => fs::read(path).map(Some).map_err(|_| READ_ERROR.into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err(READ_ERROR.into()),
    }
}

impl IgnoreStore {
    pub(crate) fn load(root: &Path) -> Result<Self, String> {
        let baseline = read(root)?;
        let entries = if let Some(bytes) = &baseline {
            let document: Document = serde_json::from_slice(bytes).map_err(|_| READ_ERROR.to_string())?;
            if document.version != 1 { return Err(READ_ERROR.into()); }
            normalized_entries(document.entries)?
        } else { Vec::new() };
        Ok(Self { entries, baseline })
    }

    pub(crate) fn matches(&self, root: &Path, asset: &ImageAsset) -> bool {
        let path = asset.path.as_ref().and_then(|path| relative(root, path).ok())
            .or_else(|| normalized_path(&asset.relative_path).ok());
        let references = identities(root, asset);
        let managed_source = managed_source(root, asset);
        self.entries.iter().any(|entry| match entry {
            Entry::Path { path: saved, references: aliases } => path.as_ref() == Some(saved)
                || managed_source.as_ref() == Some(saved)
                || (asset.path.is_none() && aliases.iter().any(|alias| references.contains(alias))),
            Entry::Reference { tex_file, reference } => references.iter()
                .any(|candidate| &candidate.tex_file == tex_file && &candidate.reference == reference),
        })
    }

    pub(crate) fn set(&mut self, root: &Path, asset: &ImageAsset, ignored: bool) -> Result<(), String> {
        let references = identities(root, asset);
        let source = managed_source(root, asset);
        let path = source.clone().or(asset.path.as_ref().map(|path| relative(root, path)).transpose()?);
        if ignored {
            if let Some(path) = path {
                if let Some(Entry::Path { references: existing, .. }) = self.entries.iter_mut()
                    .find(|entry| matches!(entry, Entry::Path { path: saved, .. } if saved == &path)) {
                    existing.extend(references);
                } else { self.entries.push(Entry::Path { path, references }); }
            } else {
                if references.is_empty() { return Err("无法确定该引用的稳定身份，请重新扫描项目".into()); }
                self.entries.extend(references.into_iter().map(|reference| Entry::Reference {
                    tex_file: reference.tex_file, reference: reference.reference,
                }));
            }
        } else {
            let fallback_path = path.or_else(|| normalized_path(&asset.relative_path).ok());
            self.entries.retain(|entry| match entry {
                Entry::Path { path, references: aliases } => fallback_path.as_ref() != Some(path)
                    && source.as_ref() != Some(path)
                    && !aliases.iter().any(|alias| references.contains(alias)),
                Entry::Reference { tex_file, reference } => !references.iter()
                    .any(|candidate| &candidate.tex_file == tex_file && &candidate.reference == reference),
            });
        }
        self.entries = normalized_entries(std::mem::take(&mut self.entries))?;
        Ok(())
    }

    pub(crate) fn serialized(&self) -> Result<Vec<u8>, String> {
        serde_json::to_vec_pretty(&Document { version: 1, entries: self.entries.clone() }).map_err(|_| READ_ERROR.into())
    }

    /// The caller holds the project lock. Reject edits made after load instead
    /// of accidentally replacing unknown or newly corrupted project settings.
    pub(crate) fn save(&mut self, root: &Path) -> Result<(), String> {
        if read(root)? != self.baseline { return Err("项目忽略规则已在外部修改，请重新扫描后重试".into()); }
        let directory = root.join(".texgo");
        journal::safe_path(root, &directory)?;
        fs::create_dir_all(&directory).map_err(|_| "无法保存项目忽略规则，请检查目录权限".to_string())?;
        let path = config_path(root);
        journal::safe_path(root, &path)?;
        let bytes = self.serialized()?;
        if bytes.len() as u64 > MAX_CONFIG_BYTES { return Err("项目忽略规则过多，无法安全保存".into()); }
        save_atomic(&path, &bytes).map_err(|_| "无法保存项目忽略规则，请检查目录权限".to_string())?;
        self.baseline = Some(bytes);
        Ok(())
    }

    /// Pure migration; the rename transaction writes before/after snapshots.
    pub(crate) fn migrate_paths(&mut self, paths: &[(String, String)]) -> Result<(), String> {
        let paths = paths.iter().map(|(old, new)| Ok((normalized_path(old)?, normalized_path(new)?)))
            .collect::<Result<Vec<_>, String>>()?;
        for entry in &mut self.entries {
            if let Entry::Path { path, .. } = entry {
                if let Some((_, new)) = paths.iter().find(|(old, _)| old.as_str() == path.as_str()) { *path = new.clone(); }
            }
        }
        self.entries = normalized_entries(std::mem::take(&mut self.entries))?;
        Ok(())
    }

    pub(crate) fn migrate_references(&mut self, changes: &[(String, String, String)]) -> Result<(), String> {
        let changes = changes.iter().map(|(file, old, new)| Ok((normalized_path(file)?, reference_value(old)?, reference_value(new)?)))
            .collect::<Result<Vec<_>, String>>()?;
        let migrate = |file: &str, reference: &mut String| {
            if let Some((_, _, new)) = changes.iter().find(|(tex, old, _)| tex == file && old.as_str() == reference.as_str()) {
                *reference = new.clone();
            }
        };
        for entry in &mut self.entries {
            match entry {
                Entry::Path { references, .. } => for identity in references { migrate(&identity.tex_file, &mut identity.reference); },
                Entry::Reference { tex_file, reference } => migrate(tex_file, reference),
            }
        }
        self.entries = normalized_entries(std::mem::take(&mut self.entries))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
use std::fs;
use super::IgnoreStore;
use crate::Workspace;

fn fixture() -> (tempfile::TempDir, std::path::PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().canonicalize().unwrap();
    fs::create_dir(root.join("figures")).unwrap();
    image::RgbImage::new(8, 8).save(root.join("figures/a.png")).unwrap();
    fs::write(root.join("main.tex"), "\\includegraphics{figures/a.png}\n\\includegraphics{figures/missing}\n").unwrap();
    (dir, root)
}

#[test]
fn loading_and_memory_changes_do_not_touch_project_sources_or_create_config() {
    let (_dir, root) = fixture();
    let ws = Workspace::open(&root.join("main.tex")).unwrap();
    let source = fs::read(root.join("figures/a.png")).unwrap();
    let tex = fs::read(root.join("main.tex")).unwrap();
    let mut rules = IgnoreStore::load(&root).unwrap();
    rules.set(&root, &ws.project().images[0], true).unwrap();
    assert!(rules.matches(&root, &ws.project().images[0]));
    assert!(!root.join(".texgo/ignore.json").exists());
    rules.save(&root).unwrap();
    assert_eq!(fs::read(root.join("figures/a.png")).unwrap(), source);
    assert_eq!(fs::read(root.join("main.tex")).unwrap(), tex);
    let bytes = fs::read_to_string(root.join(".texgo/ignore.json")).unwrap();
    assert!(!bytes.contains(&ws.project().images[0].id));
    assert!(bytes.contains("figures/a.png"));
    assert!(IgnoreStore::load(&root).unwrap().matches(&root, &ws.project().images[0]));
}

#[test]
fn missing_reference_identity_ignores_line_number_offsets_and_asset_id() {
    let (_dir, root) = fixture();
    let ws = Workspace::open(&root.join("main.tex")).unwrap();
    let missing = ws.project().images.iter().find(|a| a.status == "missing").unwrap();
    let mut rules = IgnoreStore::load(&root).unwrap();
    rules.set(&root, missing, true).unwrap();
    rules.save(&root).unwrap();
    fs::write(root.join("main.tex"), "\n\n% inserted line\n\\includegraphics{figures/missing}\n").unwrap();
    let reopened = Workspace::open(&root.join("main.tex")).unwrap();
    let mut moved = reopened.project().images[0].clone();
    moved.id = "different-session-id".into();
    assert!(IgnoreStore::load(&root).unwrap().matches(&root, &moved));
}

#[test]
fn resolved_path_rule_remains_effective_when_source_disappears() {
    let (_dir, root) = fixture();
    let ws = Workspace::open(&root.join("main.tex")).unwrap();
    let asset = ws.project().images.iter().find(|a| a.status == "ready").unwrap();
    let mut rules = IgnoreStore::load(&root).unwrap();
    rules.set(&root, asset, true).unwrap();
    rules.save(&root).unwrap();
    fs::remove_file(root.join("figures/a.png")).unwrap();
    let reopened = Workspace::open(&root.join("main.tex")).unwrap();
    let missing = reopened.project().images.iter().find(|a| a.relative_path == "figures/a.png").unwrap();
    assert!(IgnoreStore::load(&root).unwrap().matches(&root, missing));
    rules.set(&root, missing, false).unwrap();
    rules.save(&root).unwrap();
    assert!(!IgnoreStore::load(&root).unwrap().matches(&root, missing));
}

#[test]
fn path_and_reference_separators_are_platform_independent() {
    let (_dir, root) = fixture();
    fs::create_dir_all(root.join(".texgo")).unwrap();
    fs::write(root.join(".texgo/ignore.json"), r#"{"version":1,"entries":[{"kind":"path","path":"figures\\a.png"},{"kind":"reference","texFile":"chapter\\ch1.tex","reference":"figures\\missing"}]}"#).unwrap();
    let ws = Workspace::open(&root.join("main.tex")).unwrap();
    let rules = IgnoreStore::load(&root).unwrap();
    assert!(rules.matches(&root, &ws.project().images[0]));
    let mut missing = ws.project().images[1].clone();
    missing.references[0].file = root.join("chapter/ch1.tex").to_string_lossy().into_owned();
    assert!(rules.matches(&root, &missing));
    let value: serde_json::Value = serde_json::from_slice(&rules.serialized().unwrap()).unwrap();
    assert_eq!(value["entries"][0]["path"], "figures/a.png");
}

#[test]
fn corrupt_unknown_version_and_unsafe_paths_are_never_overwritten() {
    let (_dir, root) = fixture();
    fs::create_dir_all(root.join(".texgo")).unwrap();
    for bytes in [b"broken JSON".as_slice(), br#"{"version":99,"entries":[]}"#, br#"{"version":1,"entries":[{"kind":"path","path":"../outside.png"}]}"#] {
        fs::write(root.join(".texgo/ignore.json"), bytes).unwrap();
        assert!(IgnoreStore::load(&root).is_err());
        assert_eq!(fs::read(root.join(".texgo/ignore.json")).unwrap(), bytes);
    }
}

#[test]
fn stale_loaded_rules_cannot_overwrite_external_edits() {
    let (_dir, root) = fixture();
    let ws = Workspace::open(&root.join("main.tex")).unwrap();
    let mut rules = IgnoreStore::load(&root).unwrap();
    rules.set(&root, &ws.project().images[0], true).unwrap();
    fs::create_dir_all(root.join(".texgo")).unwrap();
    fs::write(root.join(".texgo/ignore.json"), "externally corrupted").unwrap();
    assert!(rules.save(&root).is_err());
    assert_eq!(fs::read_to_string(root.join(".texgo/ignore.json")).unwrap(), "externally corrupted");
}

#[test]
fn migration_is_pure_and_updates_source_and_reference_identities() {
    let (_dir, root) = fixture();
    let ws = Workspace::open(&root.join("main.tex")).unwrap();
    let mut rules = IgnoreStore::load(&root).unwrap();
    for asset in &ws.project().images { rules.set(&root, asset, true).unwrap(); }
    rules.save(&root).unwrap();
    let before = fs::read(root.join(".texgo/ignore.json")).unwrap();
    rules.migrate_paths(&[("figures/a.png".into(), "figures/new.png".into())]).unwrap();
    rules.migrate_references(&[("main.tex".into(), "figures/a.png".into(), "figures/new.png".into()), ("main.tex".into(), "figures/missing".into(), "figures/located".into())]).unwrap();
    let mut asset = ws.project().images[0].clone();
    asset.path = Some(root.join("figures/new.png").to_string_lossy().into_owned());
    asset.relative_path = "figures/new.png".into();
    assert!(rules.matches(&root, &asset));
    let mut missing = ws.project().images[1].clone();
    missing.relative_path = "figures/located".into();
    missing.references[0].original = "figures/located".into();
    assert!(rules.matches(&root, &missing));
    assert_eq!(fs::read(root.join(".texgo/ignore.json")).unwrap(), before);
    rules.save(&root).unwrap();
    rules.set(&root, &asset, false).unwrap();
    assert!(!rules.matches(&root, &asset));
    assert!(rules.matches(&root, &missing));
}

#[cfg(unix)]
#[test]
fn symlinked_config_is_rejected_without_touching_target() {
    use std::os::unix::fs::symlink;
    let (_dir, root) = fixture();
    let outside = tempfile::tempdir().unwrap();
    fs::write(outside.path().join("ignore.json"), r#"{"version":1,"entries":[]}"#).unwrap();
    fs::create_dir(root.join(".texgo")).unwrap();
    symlink(outside.path().join("ignore.json"), root.join(".texgo/ignore.json")).unwrap();
    assert!(IgnoreStore::load(&root).is_err());
    assert_eq!(fs::read_to_string(outside.path().join("ignore.json")).unwrap(), r#"{"version":1,"entries":[]}"#);
}

}
