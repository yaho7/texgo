import type { ConversionSettings } from "./settings";

export interface RecentWorkspace {
  mode: "tex" | "directory";
  path: string;
  recursive: boolean;
  openedAt: number;
}

const recentKey = "texgo.recents.v1";
const settingsKey = "texgo.settings.v1";

function read(key: string): unknown {
  try { return JSON.parse(localStorage.getItem(key) ?? "null") as unknown; }
  catch { return null; }
}

function write(key: string, value: unknown): boolean {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { return false; }
}

export function workspaceKey(entry: Pick<RecentWorkspace, "mode" | "path">): string {
  return `${entry.mode}:${entry.path}`;
}

export function readRecents(): RecentWorkspace[] {
  const value = read(recentKey);
  if (!Array.isArray(value)) return [];
  return value.filter((entry: unknown): entry is RecentWorkspace => {
    if (!entry || typeof entry !== "object") return false;
    const item = entry as Record<string, unknown>;
    return (item.mode === "tex" || item.mode === "directory") && typeof item.path === "string" && Boolean(item.path)
      && typeof item.recursive === "boolean" && typeof item.openedAt === "number" && Number.isFinite(new Date(item.openedAt).getTime());
  }).slice(0, 12);
}

export function rememberWorkspace(entry: Omit<RecentWorkspace, "openedAt">): boolean {
  const next = { ...entry, openedAt: Date.now() };
  return write(recentKey, [next, ...readRecents().filter((item) => workspaceKey(item) !== workspaceKey(entry))].slice(0, 12));
}

export function removeRecent(entry: RecentWorkspace): boolean {
  return write(recentKey, readRecents().filter((item) => workspaceKey(item) !== workspaceKey(entry)));
}

function storedSettings(): Record<string, unknown> {
  const value = read(settingsKey);
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function readSettings(key: string): ConversionSettings | null {
  const value = storedSettings()[key];
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  return typeof item.dpi === "string" && typeof item.jpegQuality === "string" && typeof item.outputDir === "string"
    ? { dpi: item.dpi, jpegQuality: item.jpegQuality, outputDir: item.outputDir } : null;
}

export function storeSettings(key: string, settings: ConversionSettings): boolean {
  const entries = Object.entries(storedSettings()).filter(([name]) => name !== key).slice(-49);
  return write(settingsKey, Object.fromEntries([...entries, [key, settings]]));
}
