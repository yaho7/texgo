import type { ConversionOptions } from "./types";

export interface ConversionSettings {
  dpi: string;
  jpegQuality: string;
  outputDir: string;
}

export const defaultSettings: ConversionSettings = { dpi: "300", jpegQuality: "100", outputDir: "texgo-pdf" };
export type SettingsIssues = Partial<Record<keyof ConversionSettings, string>>;

export function settingsIssues(settings: ConversionSettings): SettingsIssues {
  const errors: SettingsIssues = {};
  const dpi = Number(settings.dpi);
  const quality = Number(settings.jpegQuality);
  if (!settings.dpi.trim() || !Number.isInteger(dpi) || dpi < 72 || dpi > 1200) errors.dpi = "DPI 需为 72–1200 的整数";
  if (!settings.jpegQuality.trim() || !Number.isInteger(quality) || quality < 1 || quality > 100) errors.jpegQuality = "质量需为 1–100 的整数";
  const directory = settings.outputDir.trim().replaceAll("\\", "/");
  const parts = directory.split("/");
  if (!directory || directory.startsWith("/") || /^[a-z]:/i.test(directory)
    || parts.some((part) => !part || part === "." || part === ".." || [".texgo", ".git", "node_modules"].includes(part.toLowerCase()))
    || /[<>:"|?*\x00-\x1f{}%#]/.test(directory)
    || parts.some((part) => /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
    errors.outputDir = "请输入工作区内的目录名，例如 figures-pdf；不能使用上级路径或保留名称";
  }
  return errors;
}

export function conversionOptions(settings: ConversionSettings, imageIds: string[]): ConversionOptions {
  return { imageIds, quality: "custom", dpi: Number(settings.dpi), jpegQuality: Number(settings.jpegQuality), outputDir: settings.outputDir.trim().replaceAll("\\", "/") };
}
