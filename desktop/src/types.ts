export interface Reference {
  file: string;
  line: number;
  original: string;
  start: number;
  end: number;
}

export type AssetStatus = "ready" | "missing" | "unsupported" | "ambiguous" | "pdf";

export interface ImageAsset {
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

export interface Project {
  mode: "tex" | "directory";
  recursive: boolean;
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
  files: { path: string; changes: { id: string; line: number; before: string; after: string }[] }[];
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
