import { act, renderHook } from "@testing-library/react";
import { mockIPC } from "@tauri-apps/api/mocks";
import { expect, it, vi } from "vitest";
import { useAssetFileActions } from "../src/hooks/useAssetFileActions";
import type { Project } from "../src/types";

const project: Project = { root: "/paper", mainFile: "/paper/main.tex", texFiles: [], images: [{ id: "plot", path: "/paper/图像.png", relativePath: "图像.png", format: "png", width: 2, height: 2, bytes: 12, status: "ready", message: null, references: [] }], warnings: [], convertedImages: [], undoAvailable: false,
  status: { pendingImages: 1, pendingReferences: 0, problemCount: 0, ignoredCount: 0, completedImages: 0, totalImages: 1, pendingImageIds: ["plot"], problemIds: [], ignoredImageIds: [], completedImageIds: [], nextAction: "convertImages", blockingReason: null } };
function ports() {
  return { currentProject: () => project, isBusy: () => false, captureWorkspace: () => () => true,
    execute: vi.fn(async (_kind: string, action: () => Promise<void>) => { await action(); }), onNotice: vi.fn() };
}
it("uses foreground updating ownership and sends only an ID and expected project identity", async () => {
  const calls: { command: string; args: unknown }[] = [];
  mockIPC((command, args) => { calls.push({ command, args }); });
  const p = ports(); const { result } = renderHook(() => useAssetFileActions(p));
  await act(async () => result.current.copyAssetPath("plot"));
  expect(p.execute).toHaveBeenCalledWith("updating", expect.any(Function));
  expect(calls).toEqual([{ command: "asset_file_action", args: { imageId: "plot", action: "copyPath", expectedMainFile: "/paper/main.tex" } }]);
  expect(p.onNotice).toHaveBeenCalledWith("已复制路径");
});
it("rejects busy, missing, and unknown sources before invoking IPC", async () => {
  const invoke = vi.fn(); mockIPC(invoke); const p = ports(); p.isBusy = () => true;
  const { result, rerender } = renderHook(() => useAssetFileActions(p));
  await act(async () => result.current.revealAsset("plot"));
  p.isBusy = () => false; p.currentProject = () => ({ ...project, images: [{ ...project.images[0], path: null }] }); rerender();
  await act(async () => result.current.revealAsset("plot")); await act(async () => result.current.copyAssetPath("unknown"));
  expect(invoke).not.toHaveBeenCalled(); expect(p.execute).not.toHaveBeenCalled();
});
it("does not publish a late success notice into a changed workspace", async () => {
  let finish!: () => void; const response = new Promise<void>((resolve) => { finish = resolve; });
  mockIPC(() => response); let current = true; const p = ports(); p.captureWorkspace = () => () => current;
  const { result } = renderHook(() => useAssetFileActions(p));
  act(() => result.current.copyAssetPath("plot")); current = false;
  await act(async () => { finish(); await response; });
  expect(p.onNotice).not.toHaveBeenCalled();
});
it("leaves platform failures with the execute error owner", async () => {
  const failure = new Error("无法复制图片路径：clipboard unavailable"); mockIPC(() => { throw failure; });
  const p = ports(); const onError = vi.fn(); p.execute.mockImplementation(async (_kind, action) => { try { await action(); } catch (error) { onError(error); } });
  const { result } = renderHook(() => useAssetFileActions(p));
  await act(async () => result.current.copyAssetPath("plot"));
  expect(onError).toHaveBeenCalledWith(failure); expect(p.onNotice).not.toHaveBeenCalled();
});

it("does not report a late platform error after the workspace is closed", async () => {
  let fail!: (reason: Error) => void; const response = new Promise<void>((_resolve, reject) => { fail = reject; });
  mockIPC(() => response); let current = true; const p = ports(); p.captureWorkspace = () => () => current;
  const onError = vi.fn(); p.execute.mockImplementation(async (_kind, action) => { try { await action(); } catch (error) { onError(error); } });
  const { result } = renderHook(() => useAssetFileActions(p));
  act(() => result.current.revealAsset("plot")); current = false;
  await act(async () => { fail(new Error("file manager unavailable")); });
  expect(onError).not.toHaveBeenCalled(); expect(p.onNotice).not.toHaveBeenCalled();
});

it("reveals the managed PDF by identity without accepting a caller-supplied path", async () => {
  const invoke = vi.fn(); mockIPC(invoke);
  const p = ports(); p.currentProject = () => ({ ...project, convertedImages: [{ id: "plot", pdfPath: "/paper/pdf/图像.pdf", bytes: 20, cached: true, error: null }] });
  const { result } = renderHook(() => useAssetFileActions(p));
  await act(async () => result.current.revealPdf("plot"));
  expect(invoke).toHaveBeenCalledWith("asset_file_action", { imageId: "plot", action: "revealPdf", expectedMainFile: "/paper/main.tex" });
  expect(p.onNotice).not.toHaveBeenCalled();
});

it("reveals the original without a redundant success notice", async () => {
  const invoke = vi.fn(); mockIPC(invoke); const p = ports();
  const { result } = renderHook(() => useAssetFileActions(p));
  await act(async () => result.current.revealAsset("plot"));
  expect(invoke).toHaveBeenCalledWith("asset_file_action", {imageId:"plot",action:"reveal",expectedMainFile:"/paper/main.tex"});
  expect(p.onNotice).not.toHaveBeenCalled();
});
