import { t } from "./i18n";
import type { ConversionOptions } from "./types";

export interface ConversionSettings {
  dpi: string;
  jpegQuality: string;
  outputDir: string;
}

export const defaultSettings: ConversionSettings = { dpi: "300", jpegQuality: "90", outputDir: "texgo-pdf" };
export type SettingsIssues = Partial<Record<keyof ConversionSettings, string>>;

export function settingsIssues(settings: ConversionSettings): SettingsIssues {
  const errors: SettingsIssues = {};
  const dpi = Number(settings.dpi);
  const quality = Number(settings.jpegQuality);
  if (!settings.dpi.trim() || !Number.isInteger(dpi) || dpi < 72 || dpi > 1200) errors.dpi = t("validation.dPIMustBeAnIntegerFrom72To1200");
  if (!settings.jpegQuality.trim() || !Number.isInteger(quality) || quality < 1 || quality > 100) errors.jpegQuality = t("validation.qualityMustBeAnIntegerFrom1To100");
  const directory = settings.outputDir.trim().replaceAll("\\", "/");
  const parts = directory.split("/");
  if (!directory || directory.startsWith("/") || /^[a-z]:/i.test(directory)
    || parts.some((part) => !part || part === "." || part === ".." || [".texgo", ".git", "node_modules"].includes(part.toLowerCase()))
    || /[<>:"|?*\x00-\x1f{}%#$&^~]/.test(directory)
    || parts.some((part) => /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
    errors.outputDir = t("validation.enterADirectoryInsideTheWorkspaceSuchAsFiguresPdf");
  }
  return errors;
}

export function conversionOptions(settings: ConversionSettings, imageIds: string[]): ConversionOptions {
  return { imageIds, quality: "custom", dpi: Number(settings.dpi), jpegQuality: Number(settings.jpegQuality), outputDir: settings.outputDir.trim().replaceAll("\\", "/") };
}
