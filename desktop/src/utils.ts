import { nativeText } from "./nativeText";
import { t, getLocale } from "./i18n";
export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

export function relativeFile(path: string, root: string): string {
  const normalizedPath = path.replaceAll("\\", "/");
  const prefix = `${root.replaceAll("\\", "/").replace(/\/$/, "")}/`;
  return normalizedPath.startsWith(prefix) ? normalizedPath.slice(prefix.length) : path;
}



export function formatBytes(bytes: number | null): string {
  const decimalFormat = new Intl.NumberFormat(getLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const integerFormat = new Intl.NumberFormat(getLocale());
  if (bytes === null) return t("utils.unknownSize");
  if (bytes < 1024) return `${integerFormat.format(bytes)} B`;
  if (bytes < 1024 * 1024) return `${decimalFormat.format(bytes / 1024)} KB`;
  return `${decimalFormat.format(bytes / (1024 * 1024))} MB`;
}

export function errorMessage(error: unknown, fallback = t("utils.operationFailedTryAgain")): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return message.trim() ? nativeText(message) : fallback;
}
