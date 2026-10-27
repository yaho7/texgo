use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub state_fingerprint: String,
    pub status: WorkspaceStatus,
    pub converted_images: Vec<ConvertedImage>,
    pub main_file: String,
    pub root: String,
    pub tex_files: Vec<String>,
    pub images: Vec<ImageAsset>,
    pub warnings: Vec<String>,
    pub undo_available: bool,
}

/// The single project-level decision used by the window and background adapters.
#[derive(Clone, Debug, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceStatus {
    pub convertible_image_ids: Vec<String>,
    pub pending_images: usize,
    pub pending_references: usize,
    pub problem_count: usize,
    pub ignored_count: usize,
    pub completed_images: usize,
    pub completed_image_ids: Vec<String>,
    pub total_images: usize,
    pub next_action: NextAction,
    pub pending_image_ids: Vec<String>,
    pub problem_ids: Vec<String>,
    pub ignored_image_ids: Vec<String>,
    pub blocking_reason: Option<String>,
}

#[derive(Clone, Copy, Debug, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum NextAction {
    ReviewReferences,
    ConvertImages,
    ResolveProblems,
    #[default]
    UpToDate,
}

impl WorkspaceStatus {
    /// Pure classification shared by raw scans (including build-only CLI use)
    /// and a Workspace with journal-backed conversion evidence.
    pub(crate) fn classify(images: &[ImageAsset], completed: &HashSet<String>, problems: &HashSet<String>, ignored: &HashSet<String>,
        pending_references: usize, blocking_reason: Option<String>) -> Self {
        let mut status = Self { total_images: images.len(), pending_references, blocking_reason, ..Default::default() };
        for asset in images {
            if ignored.contains(&asset.id) { status.ignored_image_ids.push(asset.id.clone()); }
            else if matches!(asset.status.as_str(), "missing" | "ambiguous" | "unsupported" | "error") || problems.contains(&asset.id) {
                status.problem_ids.push(asset.id.clone());
            } else if asset.status == "ready" && (asset.update_available || !completed.contains(&asset.id)) {
                status.pending_image_ids.push(asset.id.clone());
            } else if asset.status == "pdf" || completed.contains(&asset.id) {
                status.completed_images += 1;
                status.completed_image_ids.push(asset.id.clone());
            }
        }
        status.finish()
    }

    pub(crate) fn for_scan(images: &[ImageAsset]) -> Self {
        Self::classify(images, &HashSet::new(), &HashSet::new(), &HashSet::new(), 0, None)
    }

    fn decide(&mut self) {
        self.pending_images = self.pending_image_ids.len();
        self.problem_count = self.problem_ids.len();
        self.ignored_count = self.ignored_image_ids.len();
        self.next_action = if self.pending_references > 0 { NextAction::ReviewReferences }
            else if self.pending_images > 0 { NextAction::ConvertImages }
            else if self.problem_count > 0 || self.blocking_reason.is_some() { NextAction::ResolveProblems }
            else { NextAction::UpToDate };
    }
    pub(crate) fn finish(mut self) -> Self { self.decide(); self }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageAsset {
    pub ignore_mode: IgnoreMode,
    pub can_rename: bool,
    pub id: String,
    pub path: Option<String>,
    pub relative_path: String,
    pub format: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub bytes: Option<u64>,
    pub status: String,
    pub update_available: bool,
    pub message: Option<String>,
    pub references: Vec<Reference>,
}

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum IgnoreMode {
    #[default]
    None,
    Session,
    Permanent,
}

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ConversionIntent {
    #[default]
    Pending,
    Selected,
    Reconvert,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameResult {
    pub project: Project,
    pub old_image_id: String,
    pub new_image_id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameHistory {
    pub old_source: String,
    pub new_source: String,
    pub old_pdf: Option<String>,
    pub new_pdf: Option<String>,
    pub references_changed: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pdf_count: Option<usize>,
    #[serde(default)]
    pub permanent_ignore_migrated: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Reference {
    pub file: String,
    pub line: usize,
    pub original: String,
    pub start: usize,
    pub end: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversionOptions {
    pub image_ids: Vec<String>,
    #[serde(default = "default_quality")]
    pub quality: String,
    pub dpi: u32,
    pub jpeg_quality: u8,
    #[serde(default = "default_output_dir")]
    pub output_dir: String,
}

pub(crate) fn default_quality() -> String { "custom".into() }
pub(crate) fn default_output_dir() -> String { "texgo-pdf".into() }

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversionHistoryEntry {
    #[serde(default)]
    pub rename: Option<RenameHistory>,
    pub id: String,
    pub created_at: u64,
    pub output_dir: String,
    pub dpi: u32,
    pub jpeg_quality: u8,
    pub files: Vec<ConversionHistoryFile>,
    pub undone: bool,
    pub can_undo: bool,
    #[serde(default)]
    pub cancelled: bool,
    #[serde(default)]
    pub undo_reason: Option<String>,
    #[serde(default)]
    pub references_changed: usize,
    #[serde(default)]
    pub files_changed: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversionHistoryFile {
    pub source: String,
    #[serde(default)]
    pub source_hash: Option<String>,
    pub output: String,
    pub cached: bool,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertedImage {
    pub id: String,
    pub pdf_path: Option<String>,
    pub bytes: Option<u64>,
    pub cached: bool,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversionResult {
    pub images: Vec<ConvertedImage>,
    pub cancelled: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub current: usize,
    pub total: usize,
    pub name: String,
    pub status: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReplacementPlan {
    pub files: Vec<FileChanges>,
    pub reference_count: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileChanges {
    pub path: String,
    pub changes: Vec<ReferenceChange>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceChange {
    pub id: String,
    pub line: usize,
    pub before: String,
    pub after: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MutationResult {
    pub files_changed: usize,
    pub references_changed: usize,
}

#[derive(Serialize)]
pub struct AssetPreview {
    pub data: String,
    pub kind: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartReport {
    pub project: Project,
    pub result: ConversionResult,
    pub batch_ids: Vec<String>,
    pub problem_ids: Vec<String>,
    pub pending_references: usize,
}
