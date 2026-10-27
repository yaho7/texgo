import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useBackgroundAutomation } from "../src/hooks/useBackgroundAutomation";
import type { Project } from "../src/types";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
type Ports = Parameters<typeof useBackgroundAutomation>[0];
const project: Project = {
  root: "/paper", mainFile: "/paper/main.tex", texFiles: ["/paper/main.tex"], images: [], convertedImages: [], warnings: [], undoAvailable: false,
  status: { pendingImages: 0, pendingReferences: 0, problemCount: 0, ignoredCount: 0, completedImages: 0, totalImages: 0,
    pendingImageIds: [], problemIds: [], ignoredImageIds: [], completedImageIds: [], nextAction: "upToDate", blockingReason: null },
};
function ports(): Ports {
  return {
    workspace: { project, current: { current: project }, generation: { current: 1 }, acceptProject: vi.fn(async () => {}), updateSnapshot: vi.fn() },
    selection: { reconcileBackground: vi.fn() }, conversion: { completionVisible: () => false, setResults: vi.fn(), setProgress: vi.fn(), setCompletion: vi.fn() },
    reviewFlow: { decisionRef: { current: { kind: "none" } }, queueReview: vi.fn() },
    operationDomain: { current: () => ({ status: "idle" }), acquire: vi.fn(() => null), release: vi.fn(() => false) },
    historyDomain: { load: vi.fn(async () => {}) }, currentOperationKind: () => null,
    execute: vi.fn(async (_kind: string, action: () => Promise<void>) => { await action(); }),
    setError: vi.fn(), setNotice: vi.fn(), setRevision: vi.fn(), autoWatch: true, held: false, onNavigate: vi.fn(async () => {}),
  } satisfies Ports;
}
beforeEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async (command) => command === "observation_identity" ? { root: project.root, mainFile: project.mainFile, session: 8 } : command === "refresh_workspace" ? project : null);
});
afterEach(() => { vi.restoreAllMocks(); });
it("replaces frequent polling with a thirty-second fallback and retains focus checks", async () => {
  const interval = vi.spyOn(window, "setInterval"); const p = ports();
  renderHook(() => useBackgroundAutomation(p)); await act(async () => {});
  expect(interval.mock.calls.map((call) => call[1])).toEqual([30_000]);
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  expect(invoke).toHaveBeenCalledWith("poll_workspace", { root: project.root });
});
it("accepts only observation events from the current native session", async () => {
  const p = ports(); const { result } = renderHook(() => useBackgroundAutomation(p)); await act(async () => {});
  await act(async () => {
    result.current.onObserved({ project, session: 7 });
    result.current.onObserved({ project: { ...project, root: "/other" }, session: 8 });
  });
  expect(p.workspace.acceptProject).not.toHaveBeenCalled();
  await act(async () => { result.current.onObserved({ project, session: 8 }); });
  expect(p.workspace.acceptProject).toHaveBeenCalledWith(project, true, "项目状态已更新");
});
it("defers native observations while a decision or foreground surface is held", async () => {
  const p = ports(); p.held = true;
  const { result, rerender } = renderHook(() => useBackgroundAutomation(p)); await act(async () => {});
  await act(async () => { result.current.onObserved({ project, session: 8 }); });
  expect(p.workspace.acceptProject).not.toHaveBeenCalled(); p.held = false;
  await act(async () => { rerender(); });
  expect(invoke).toHaveBeenCalledWith("refresh_workspace");
  expect(p.workspace.acceptProject).toHaveBeenCalledWith(project, true, "项目状态已更新");
});
it("does not let a delayed identity request revive a closed and reopened path", async () => {
  let resolve!: (value: unknown) => void; const oldIdentity = new Promise((yes) => { resolve = yes; });
  vi.mocked(invoke).mockImplementationOnce(async () => oldIdentity);
  const p = ports(); const { result, rerender } = renderHook(() => useBackgroundAutomation(p));
  p.workspace.generation.current = 2; await act(async () => { rerender(); });
  await act(async () => { resolve({ root: project.root, mainFile: project.mainFile, session: 7 }); });
  await act(async () => { result.current.onObserved({ project, session: 7 }); });
  expect(p.workspace.acceptProject).not.toHaveBeenCalled();
  await act(async () => { result.current.onObserved({ project, session: 8 }); });
  expect(p.workspace.acceptProject).toHaveBeenCalledTimes(1);
});
it("shows a generic observation notice without opening an error modal", async () => {
  const p = ports(); const { result } = renderHook(() => useBackgroundAutomation(p)); await act(async () => {});
  await act(async () => { result.current.onObservationUnavailable({ root: project.root, mainFile: project.mainFile, session: 8 }); });
  expect(p.setError).not.toHaveBeenCalled(); expect(p.setNotice).toHaveBeenCalledWith("自动检测暂不可用");
});
it("defers hidden-window projection until focus wakes the existing reconciliation gate", async () => {
  const p = ports(); const { result, rerender } = renderHook(() => useBackgroundAutomation(p)); await act(async () => {});
  const visibility = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  await act(async () => { result.current.onObserved({ project, session: 8 }); });
  expect(p.workspace.acceptProject).not.toHaveBeenCalled();
  visibility.mockReturnValue(false);
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  expect(p.setRevision).toHaveBeenCalled();
  await act(async () => { rerender(); });
  expect(invoke).toHaveBeenCalledWith("refresh_workspace");
});
it("reconciles a native update that arrives before the current identity query resolves", async () => {
  let resolve!: (value: unknown) => void; const identity = new Promise((yes) => { resolve = yes; });
  vi.mocked(invoke).mockImplementationOnce(async () => identity);
  const p = ports(); const { result } = renderHook(() => useBackgroundAutomation(p));
  await act(async () => { result.current.onObserved({ project, session: 8 }); });
  expect(p.workspace.acceptProject).not.toHaveBeenCalled();
  await act(async () => { resolve({ root: project.root, mainFile: project.mainFile, session: 8 }); });
  expect(p.workspace.acceptProject).toHaveBeenCalledWith(project, true, "项目状态已更新");
});

it("keeps hidden native invalidation queued through unrelated rerenders", async () => {
  const p = ports(); const { result, rerender } = renderHook(() => useBackgroundAutomation(p)); await act(async () => {});
  const visibility = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  await act(async () => { result.current.onObserved({ project, session: 8 }); rerender(); });
  expect(invoke).not.toHaveBeenCalledWith("refresh_workspace");
  expect(p.workspace.acceptProject).not.toHaveBeenCalled();
  visibility.mockReturnValue(false);
  await act(async () => { window.dispatchEvent(new Event("focus")); rerender(); });
  expect(p.workspace.acceptProject).toHaveBeenCalledWith(project, true, "项目状态已更新");
});
it("defers a poll response when the window becomes hidden before it resolves", async () => {
  let resolve!: (value: Project) => void; const pending = new Promise<Project>((yes) => { resolve = yes; });
  const p = ports(); const { rerender } = renderHook(() => useBackgroundAutomation(p)); await act(async () => {});
  vi.mocked(invoke).mockImplementationOnce(async () => pending);
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  const visibility = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  await act(async () => { resolve(project); rerender(); });
  expect(p.workspace.acceptProject).not.toHaveBeenCalled();
  expect(invoke).not.toHaveBeenCalledWith("refresh_workspace");
  visibility.mockReturnValue(false);
  await act(async () => { window.dispatchEvent(new Event("focus")); rerender(); });
  expect(p.workspace.acceptProject).toHaveBeenCalledWith(project, true, "项目状态已更新");
});
