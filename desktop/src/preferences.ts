export interface Preferences {
  startup: "home" | "lastWorkspace";
  autoWatch: boolean;
  autoUpdate: boolean;
  dpi: number;
  jpegQuality: number;
  outputDir: string;
  allowUnreviewed: boolean;
  notifySuccess: boolean;
  notifyFailure: boolean;
  notifyUnchanged: boolean;
  shortcutEnabled: boolean;
  shortcut: string;
  closeAction: "background" | "quit";
}
export const defaultPreferences: Preferences = {
  startup: "home", autoWatch: true, autoUpdate: true,
  dpi: 300, jpegQuality: 90, outputDir: "texgo-pdf", allowUnreviewed: false,
  notifySuccess: true, notifyFailure: true, notifyUnchanged: false,
  shortcutEnabled: true, shortcut: "CommandOrControl+Alt+Enter", closeAction: "background",
};

export const conversionPresets = [
  { id: "balanced", label: "平衡", dpi: 300, jpegQuality: 90 },
  { id: "high", label: "高质量", dpi: 300, jpegQuality: 100 },
  { id: "small", label: "小体积", dpi: 150, jpegQuality: 75 },
] as const;

export function conversionPreset(dpi: number, jpegQuality: number) {
  return conversionPresets.find((preset) => preset.dpi === dpi && preset.jpegQuality === jpegQuality);
}
