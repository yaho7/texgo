export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

export function relativeFile(path: string, root: string): string {
  const normalizedPath = path.replaceAll("\\", "/");
  const prefix = `${root.replaceAll("\\", "/").replace(/\/$/, "")}/`;
  return normalizedPath.startsWith(prefix) ? normalizedPath.slice(prefix.length) : path;
}

const decimalFormat = new Intl.NumberFormat(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const integerFormat = new Intl.NumberFormat();

export function formatBytes(bytes: number | null): string {
  if (bytes === null) return "未知大小";
  if (bytes < 1024) return `${integerFormat.format(bytes)} B`;
  if (bytes < 1024 * 1024) return `${decimalFormat.format(bytes / 1024)} KB`;
  return `${decimalFormat.format(bytes / (1024 * 1024))} MB`;
}

export function errorMessage(error: unknown, fallback = "操作失败，请重试"): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return message.trim().slice(0, 300) || fallback;
}
