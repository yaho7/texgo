import { useState } from "react";
import { act, renderHook } from "@testing-library/react";
import { mockIPC } from "@tauri-apps/api/mocks";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAssetSelection } from "../src/hooks/useAssetSelection";
import { useWorkspace } from "../src/hooks/useWorkspace";
import { useHistory } from "../src/hooks/useHistory";
import { defaultPreferences } from "../src/preferences";
import type { ConversionHistoryEntry, Project } from "../src/types";

const project: Project = {
  mainFile: "/paper/main.tex", root: "/paper", texFiles: [], warnings: [], convertedImages: [], undoAvailable: false,
  status: { pendingImageIds: ["a", "b"], convertibleImageIds: ["a", "b"], completedImageIds: [], problemIds: [], ignoredImageIds: [], pendingImages: 2, totalImages: 2, pendingReferences: 0, completedImages: 0, problemCount: 0, ignoredCount: 0, nextAction: "convertImages", blockingReason: null },
  images: ["a", "b"].map((id) => ({ id, relativePath: `${id}.png`, path: `/paper/${id}.png`, format: "png", status: "ready", width: 10, height: 10, bytes: 10, message: null, references: [] })),
};
const entry: ConversionHistoryEntry = { id: "old", createdAt: 1, outputDir: "pdf", dpi: 300, jpegQuality: 90, files: [], canUndo: true, undone: false };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => localStorage.clear());

describe("asset selection domain", () => {
  it("preserves context across refresh, migrates selected rename identities, and resets for another project", () => {
    const { result } = renderHook(() => useAssetSelection(project));
    act(() => { result.current.acceptSnapshot(project, false); });
    act(() => {
      result.current.activate("b"); result.current.changeSearch("png"); result.current.changeFilter("pending");
      result.current.changeSelectionMode(true); result.current.toggleSelected("b");
    });
    const renamed = structuredClone(project);
    renamed.images[1].id = "renamed";
    renamed.status.pendingImageIds = ["a", "renamed"]; renamed.status.convertibleImageIds = ["a", "renamed"];
    act(() => { result.current.migrateIdentity("b", "renamed"); result.current.acceptSnapshot(renamed, true); });
    expect(result.current.activeId).toBe("renamed");
    expect([...result.current.selected]).toEqual(["renamed"]);
    expect(result.current.search).toBe("png"); expect(result.current.filter).toBe("pending");
    expect(result.current.selectionMode).toBe(true);
    act(() => result.current.acceptSnapshot(project, false));
    expect(result.current.activeId).toBe("a"); expect(result.current.selected.size).toBe(0);
    expect(result.current.search).toBe(""); expect(result.current.filter).toBe("all");
  });
});

describe("workspace and history lifecycle", () => {
  function useDomains() {
    const [undoEntry, setUndoEntry] = useState<ConversionHistoryEntry | null>(null);
    const [errors] = useState(() => vi.fn());
    const execute = async (_kind: string, action: () => Promise<void>) => {
      try { await action(); } catch (reason) { errors(reason); }
    };
    const workspace = useWorkspace({
      preferences: () => defaultPreferences, execute,
      isBusy: () => false, onAccept: (next, same) => { if (!same) history.reset(); selection.acceptSnapshot(next, same); },
      onReset: () => { history.reset(); selection.reset(); }, loadHistory: () => history.load(), onNotice: vi.fn(),
    });
    const selection = useAssetSelection(workspace.project);
    const history = useHistory({
      currentProject: () => workspace.current.current, generation: () => workspace.generation.current,
      execute, acceptProject: workspace.acceptProject,
      refresh: workspace.refresh, discardProject: workspace.discardProject,
      restoreRename: selection.restoreRename, restoreFocus: vi.fn(), onError: errors,
      undoEntry: () => undoEntry, requestUndo: setUndoEntry, dismissUndo: () => setUndoEntry(null),
    });
    return { workspace, history, selection, errors };
  }
  it("restores the active and selected rename identity through the native Undo contract", async () => {
    let undoArgs: object | undefined;
    mockIPC((command, payload) => {
      if (command === "undo_conversion") { undoArgs = payload; return project; }
      return [];
    });
    const renamed = structuredClone(project);
    renamed.images[1].id = "renamed"; renamed.images[1].relativePath = "renamed.png";
    renamed.status.pendingImageIds = ["a", "renamed"]; renamed.status.convertibleImageIds = ["a", "renamed"];
    const { result } = renderHook(useDomains);
    await act(async () => { await result.current.workspace.acceptProject(renamed, false); });
    act(() => {
      result.current.selection.activate("renamed"); result.current.selection.changeSearch("png");
      result.current.selection.changeFilter("pending"); result.current.selection.changeSelectionMode(true);
      result.current.selection.toggleSelected("renamed");
      result.current.history.requestUndo({ ...entry, rename: { oldSource: "b.png", newSource: "renamed.png", referencesChanged: 1 } });
    });
    await act(async () => { result.current.history.undoConversion(); });
    expect(undoArgs).toEqual({ entryId: entry.id });
    expect(result.current.selection.activeId).toBe("b");
    expect([...result.current.selection.selected]).toEqual(["b"]);
    expect(result.current.selection.search).toBe("png"); expect(result.current.selection.filter).toBe("pending");
    expect(result.current.history.undoEntry).toBeNull();
  });
  it("does not accept a late refresh after switching away and back to the same path", async () => {
    const pending = deferred<Project>();
    mockIPC((command) => command === "refresh_workspace" ? pending.promise : []);
    const { result } = renderHook(useDomains);
    await act(async () => { await result.current.workspace.acceptProject(project, false); });
    let refreshing!: Promise<void>;
    act(() => { refreshing = result.current.workspace.refresh(); });
    await act(async () => {
      await result.current.workspace.acceptProject({ ...project, mainFile: "/other/main.tex" }, false);
      await result.current.workspace.acceptProject({ ...project, stateFingerprint: "new-session" }, false);
    });
    await act(async () => { pending.resolve({ ...project, stateFingerprint: "stale-session" }); await refreshing; });
    expect(result.current.workspace.project?.stateFingerprint).toBe("new-session");
  });
  it("ignores a late refresh rejection after changing projects", async () => {
    let reject!: (reason: Error) => void;
    const pending = new Promise<Project>((_resolve, no) => { reject = no; });
    mockIPC((command) => command === "refresh_workspace" ? pending : []);
    const { result } = renderHook(useDomains);
    await act(async () => { await result.current.workspace.acceptProject(project, false); });
    let refreshing!: Promise<void>;
    act(() => { refreshing = result.current.workspace.refresh(); });
    await act(async () => { await result.current.workspace.acceptProject({ ...project, mainFile: "/other/main.tex" }, false); });
    await act(async () => {
      reject(new Error("old refresh failure"));
      await expect(refreshing).resolves.toBeUndefined();
    });
  });
  it.each(["failure", "success"])("ignores Undo recovery %s after switching projects", async (outcome) => {
    let resolve!: (next: Project) => void;
    let reject!: (reason: Error) => void;
    const recovery = new Promise<Project>((yes, no) => { resolve = yes; reject = no; });
    mockIPC((command) => {
      if (command === "undo_conversion") throw new Error("old undo failure");
      if (command === "refresh_workspace") return recovery;
      return [];
    });
    const { result } = renderHook(useDomains);
    await act(async () => { await result.current.workspace.acceptProject(project, false); });
    act(() => result.current.history.requestUndo(entry));
    await act(async () => { result.current.history.undoConversion(); });
    await act(async () => { await result.current.workspace.acceptProject({ ...project, mainFile: "/other/main.tex" }, false); });
    await act(async () => { if (outcome === "failure") reject(new Error("old recovery failure")); else resolve(project); });
    expect(result.current.workspace.project?.mainFile).toBe("/other/main.tex");
    expect(result.current.errors).not.toHaveBeenCalled();
  });
  it("does not apply a late Undo result to another project", async () => {
    const pending = deferred<Project>();
    mockIPC((command) => command === "undo_conversion" ? pending.promise : []);
    const { result } = renderHook(useDomains);
    await act(async () => { await result.current.workspace.acceptProject(project, false); });
    act(() => result.current.history.requestUndo(entry));
    act(() => result.current.history.undoConversion());
    await act(async () => { await result.current.workspace.acceptProject({ ...project, mainFile: "/other/main.tex" }, false); });
    await act(async () => { pending.resolve(project); });
    expect(result.current.workspace.project?.mainFile).toBe("/other/main.tex");
  });
  it("rejects history from an earlier project even after closing and reopening the same path", async () => {
    const pending = deferred<ConversionHistoryEntry[]>(); let loads = 0;
    mockIPC((command) => command === "conversion_history" ? ++loads === 1 ? pending.promise : [] : undefined);
    const { result } = renderHook(useDomains);
    let accepting!: Promise<void>;
    act(() => { accepting = result.current.workspace.acceptProject(project, false); });
    expect(result.current.workspace.current.current?.mainFile).toBe(project.mainFile);
    await act(async () => { result.current.workspace.closeProject(); });
    expect(result.current.workspace.current.current).toBeNull();
    await act(async () => { await result.current.workspace.acceptProject(project, false); });
    await act(async () => { pending.resolve([entry]); await accepting; });
    expect(result.current.history.history).toEqual([]);
  });
  it("keeps the newest history load when requests for the same project complete out of order", async () => {
    const pending = deferred<ConversionHistoryEntry[]>(); let loads = 0;
    mockIPC((command) => command === "conversion_history" ? ++loads === 2 ? pending.promise : loads === 3 ? [{ ...entry, id: "newest" }] : [] : undefined);
    const { result } = renderHook(useDomains);
    await act(async () => { await result.current.workspace.acceptProject(project, false); });
    let older!: Promise<void>;
    act(() => { older = result.current.history.load(); });
    await act(async () => { await result.current.history.load(); });
    await act(async () => { pending.resolve([entry]); await older; });
    expect(result.current.history.history.map((item) => item.id)).toEqual(["newest"]);
  });
  it("clears records synchronously on a project switch and rejects late errors", async () => {
    let reject!: (reason: Error) => void;
    let loads = 0;
    const pending = new Promise<ConversionHistoryEntry[]>((_resolve, no) => { reject = no; });
    mockIPC((command) => command === "conversion_history" ? ++loads === 1 ? [entry] : loads === 2 ? pending : [] : undefined);
    const { result } = renderHook(useDomains);
    await act(async () => { await result.current.workspace.acceptProject(project, false); });
    expect(result.current.history.history).toEqual([entry]);
    let loading!: Promise<void>;
    act(() => { loading = result.current.history.load(); });
    await act(async () => { await result.current.workspace.acceptProject({ ...project, mainFile: "/other/main.tex" }, true); });
    expect(result.current.history.history).toEqual([]);
    await act(async () => { reject(new Error("old history error")); await loading; });
    expect(result.current.errors).not.toHaveBeenCalled();
  });
  it("does not accept a native refresh for a different project while the frontend generation remains unchanged", async () => {
    const other = { ...project, root: "/other", mainFile: "/other/main.tex" };
    mockIPC((command) => command === "refresh_workspace" ? other : []);
    const { result } = renderHook(useDomains);
    await act(async () => { await result.current.workspace.acceptProject(project, false); });
    await act(async () => { await result.current.workspace.refresh(); });
    expect(result.current.workspace.project?.mainFile).toBe(project.mainFile);
  });

});

it("records user activity without advancing recent times during background snapshots", async () => {
  const now = vi.spyOn(Date, "now").mockReturnValue(1000);
  try {
    const { result } = renderHook(() => useWorkspace({ preferences: () => defaultPreferences,
      execute: async (_kind, action) => { await action(); }, isBusy: () => false,
      onAccept: vi.fn(), onReset: vi.fn(), loadHistory: async () => {}, onNotice: vi.fn() }));
    await act(async () => result.current.acceptProject(project, false));
    expect(result.current.recents[0].openedAt).toBe(1000);
    now.mockReturnValue(2000);
    await act(async () => result.current.acceptProject(project, true));
    expect(result.current.recents[0].openedAt).toBe(1000);
    act(() => result.current.recordActivity());
    expect(result.current.recents[0].openedAt).toBe(2000);
  } finally { now.mockRestore(); }
});
