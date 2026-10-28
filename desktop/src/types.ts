export interface Reference {
  file: string;
  line: number;
  original: string;
  start: number;
  end: number;
}

export type AssetStatus = "ready" | "missing" | "unsupported" | "ambiguous" | "pdf";

export interface ImageAsset {
  ignoreMode?: IgnoreMode;
  canRename?: boolean;
  id: string;
  path: string | null;
  relativePath: string;
  format: string;
  width: number | null;
  height: number | null;
  bytes: number | null;
  status: AssetStatus;
  updateAvailable?: boolean;
  message: string | null;
  references: Reference[];
}

export type NextAction = "reviewReferences" | "convertImages" | "resolveProblems" | "upToDate";
export type IgnoreMode = "none" | "session" | "permanent";
export type ConversionIntent = "pending" | "selected" | "reconvert";

// Rust owns the classification and action priority. React only presents this snapshot.
export interface WorkspaceStatus {
  convertibleImageIds?: string[];
  pendingImages: number;
  pendingReferences: number;
  problemCount: number;
  ignoredCount: number;
  completedImages: number;
  totalImages: number;
  pendingImageIds: string[];
  problemIds: string[];
  ignoredImageIds: string[];
  completedImageIds: string[];
  nextAction: NextAction;
  blockingReason: string | null;
}

export interface Project {
  stateFingerprint?: string;
  status: WorkspaceStatus;
  convertedImages: ConvertedImage[];
  mainFile: string;
  root: string;
  texFiles: string[];
  images: ImageAsset[];
  warnings: string[];
  undoAvailable: boolean;
}

export interface ConversionOptions {
  imageIds: string[];
  quality: "custom";
  dpi: number;
  jpegQuality: number;
  outputDir: string;
}

export interface ConversionHistoryEntry {
  rename?: { oldSource: string; newSource: string; oldPdf?: string | null; newPdf?: string | null; referencesChanged: number; pdfCount?: number; permanentIgnoreMigrated?: boolean } | null;
  id: string;
  createdAt: number;
  outputDir: string;
  dpi: number;
  jpegQuality: number;
  files: { source: string; output: string; cached: boolean; error: string | null }[];
  undone: boolean;
  canUndo: boolean;
  cancelled?: boolean;
  undoReason?: string | null;
  referencesChanged?: number;
  filesChanged?: number;
}

export interface RenamePreview { newRelativePath: string; references: ChangePreview }

export interface RenameResult {
  project: Project;
  oldImageId: string;
  newImageId: string;
}

export interface ConvertedImage {
  id: string;
  pdfPath: string | null;
  bytes: number | null;
  cached: boolean;
  error: string | null;
}

export interface ConversionResult {
  images: ConvertedImage[];
  cancelled: boolean;
}

export interface AssetPreviewData {
  data: string;
  kind: "image" | "pdf";
}

export interface ChangePreview {
  files: { path: string; fingerprint?: string; changes: { id: string; line: number; before: string; after: string }[] }[];
  referenceCount: number;
}

export interface ReplacementResult {
  filesChanged: number;
  referencesChanged: number;
}

export interface ConversionProgress {
  current: number;
  total: number;
  name: string;
  status: string;
}

export interface ImageResult extends ConvertedImage {
  cancelled?: boolean;
}

export interface SmartReport {
  project: Project;
  result: ConversionResult;
  batchIds: string[];
  problemIds: string[];
  pendingReferences: number;
}
export interface NotificationTarget {
  path: string;
  view: "images" | "history" | "problems" | "review";
  batchId: string | null;
  imageId: string | null;
}
