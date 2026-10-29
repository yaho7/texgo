import { invoke } from "@tauri-apps/api/core";

const releasePage = "https://github.com/yaho7/texgo/releases/latest";

/** Open the fixed download page; the app never downloads or installs an update. */
export function openReleasePage(): Promise<void> {
  return invoke("open_release_page", { url: releasePage });
}

/** Background checks only read public stable-release metadata. */
export async function checkApplicationUpdate(current = import.meta.env.VITE_APP_VERSION): Promise<{ stage: "current" | "available"; version: string | null }> {
  const response = await fetch("https://api.github.com/repos/yaho7/texgo/releases/latest", {
    headers: { Accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(`GitHub: ${response.status}`);
  const release = await response.json() as { tag_name?: string; draft?: boolean; prerelease?: boolean };
  const match = /^v(\d+)\.(\d+)\.(\d+)$/.exec(release.tag_name ?? "");
  if (!match || release.draft || release.prerelease) return { stage: "current", version: null };
  const installed = current.split(/[.-]/).slice(0, 3).map(Number);
  const candidate = match.slice(1).map(Number);
  const difference = candidate.map((part, index) => part - installed[index]).find(part => part !== 0) ?? 0;
  return difference > 0 ? { stage: "available", version: match.slice(1).join(".") } : { stage: "current", version: null };
}
