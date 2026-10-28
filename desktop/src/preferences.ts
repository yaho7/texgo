import { t } from "./i18n";
export interface Preferences {
  language: "zh-CN" | "en-US";
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
  debugLogging: boolean;
  closeAction: "background" | "quit";
}
export const defaultPreferences: Preferences = {
  language: "zh-CN", startup: "home", autoWatch: true, autoUpdate: true,
  dpi: 300, jpegQuality: 100, outputDir: "texgo-pdf", allowUnreviewed: false,
  notifySuccess: true, notifyFailure: true, notifyUnchanged: false,
  shortcutEnabled: true, shortcut: "CommandOrControl+Alt+Enter", closeAction: "background", debugLogging: false,
};

export const conversionPresets = [
  { id: "high", get label() { return t("presets.highQuality"); }, dpi: 300, jpegQuality: 100 },
  { id: "balanced", get label() { return t("presets.balanced"); }, dpi: 300, jpegQuality: 90 },
  { id: "small", get label() { return t("presets.smallFileSize"); }, dpi: 150, jpegQuality: 75 },
] as const;

export function conversionPreset(dpi: number, jpegQuality: number) {
  return conversionPresets.find((preset) => preset.dpi === dpi && preset.jpegQuality === jpegQuality);
}
