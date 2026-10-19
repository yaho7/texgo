use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub mode: String,
    pub recursive: bool,
    pub converted_images: Vec<ConvertedImage>,
    pub main_file: String,
    pub root: String,
    pub tex_files: Vec<String>,
    pub images: Vec<ImageAsset>,
    pub warnings: Vec<String>,
    pub undo_available: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageAsset {
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
