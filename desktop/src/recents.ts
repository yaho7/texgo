import type { ConversionSettings } from "./settings";

export interface RecentWorkspace {
  path: string;
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

export function workspaceKey(entry: Pick<RecentWorkspace, "path">): string {
  return `tex:${entry.path}`;
}

export function readRecents(): RecentWorkspace[] {
  const value = read(recentKey);
  if (!Array.isArray(value)) return [];
  const normalized = value.flatMap((entry: unknown): RecentWorkspace[] => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    if (item.mode !== undefined && item.mode !== "tex") return [];
    if (typeof item.path !== "string" || !item.path.trim() || !item.path.toLowerCase().endsWith(".tex")
      || typeof item.openedAt !== "number" || !Number.isFinite(new Date(item.openedAt).getTime())) return [];
    return [{ path: item.path, openedAt: item.openedAt }];
  });
  const unique = normalized.filter((entry, index) => normalized.findIndex((item) => item.path === entry.path) === index).slice(0, 12);
  // Persist migration so obsolete independent directory workspaces cannot return.
  if (JSON.stringify(value) !== JSON.stringify(unique)) write(recentKey, unique);
  return unique;
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
