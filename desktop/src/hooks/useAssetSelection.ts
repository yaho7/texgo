import { useState } from "react";
import type { ConversionHistoryEntry, Project } from "../types";

export function useAssetSelection(project: Project | null) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activeId, activate] = useState<string | null>(null);
  const [search, changeSearch] = useState("");
  const [filter, changeFilter] = useState("all");
  const [selectionMode, setSelectionMode] = useState(false);
  const [renameRequest, setRenameRequest] = useState<{ id: string; token: number }>();
  const pendingIds = new Set(project?.status.pendingImageIds ?? []);
  const convertibleIds = new Set(project?.status.convertibleImageIds ?? project?.status.pendingImageIds ?? []);
  const problemIds = new Set(project?.status.problemIds ?? []);
  const ignored = new Set(project?.status.ignoredImageIds ?? []);
  const completedIds = new Set(project?.status.completedImageIds ?? []);
  const activeAsset = project?.images.find((image) => image.id === activeId) ?? null;
  const visibleImages = (project?.images ?? []).filter((image) => {
    const matches = `${image.relativePath} ${image.format}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
    return matches && (filter === "all" || (filter === "pending" ? pendingIds.has(image.id)
      : filter === "problems" ? problemIds.has(image.id) : filter === "completed" ? completedIds.has(image.id) : filter === "ignored" && ignored.has(image.id)));
  });
  function clearSelection() { setSelected(new Set()); setSelectionMode(false); }
  function reset() { clearSelection(); activate(null); changeSearch(""); changeFilter("all"); setRenameRequest(undefined); }
  function acceptSnapshot(next: Project, same: boolean) {
    const fallback = next.status.pendingImageIds[0] ?? next.images[0]?.id ?? null;
    if (!same) { reset(); activate(fallback); }
    else {
      activate((previous) => next.images.some((image) => image.id === previous) ? previous : fallback);
      setSelected((previous) => new Set([...previous].filter((id) => (next.status.convertibleImageIds ?? next.status.pendingImageIds).includes(id))));
    }
  }
  function migrateIdentity(oldId: string, newId: string) {
    activate(newId);
    setSelected((previous) => new Set([...previous].map((id) => id === oldId ? newId : id)));
  }
  function restoreRename(next: Project, entry: ConversionHistoryEntry) {
    if (!entry.rename || activeAsset?.relativePath !== entry.rename.newSource) return;
    const restored = next.images.find((image) => image.relativePath === entry.rename?.oldSource);
    if (restored) migrateIdentity(activeAsset.id, restored.id);
  }
  function removeSelected(ids: string[]) { setSelected((previous) => new Set([...previous].filter((id) => !ids.includes(id)))); }
  function toggleSelected(id: string) {
    if (!convertibleIds.has(id)) return;
    setSelected((previous) => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }
  function selectMany(ids: string[], select: boolean) {
    setSelected((previous) => { const next = new Set(previous); ids.filter((id) => convertibleIds.has(id)).forEach((id) => { if (select) next.add(id); else next.delete(id); }); return next; });
  }
  function changeSelectionMode(enabled: boolean) { setSelectionMode(enabled); if (!enabled) setSelected(new Set()); }
  function requestRename(id: string) { setRenameRequest({ id, token: Date.now() }); }
  function reconcileBackground(next: Project, completed: string[]) {
    activate((id) => next.images.some((asset) => asset.id === id) ? id : next.images[0]?.id ?? null);
    removeSelected(completed);
  }
  return { selected, activeId, search, filter, selectionMode, renameRequest, activeAsset, visibleImages,
    pendingIds, convertibleIds, problemIds, ignored, completedIds, activate, changeSearch, changeFilter,
    clearSelection, reset, acceptSnapshot, migrateIdentity, restoreRename, removeSelected, toggleSelected,
    selectMany, changeSelectionMode, requestRename, reconcileBackground };
}
