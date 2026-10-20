import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockIPC } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultPreferences } from "../src/preferences";
import App from "../src/App";
import type { ChangePreview, ConversionHistoryEntry, ConversionOptions, ConversionResult, Project, WorkspaceStatus } from "../src/types";

vi.mock("../src/PdfPreview", () => ({ default: () => <div aria-label="PDF 预览测试替身" /> }));
const imageData = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
const reference = { file: "/paper/main.tex", line: 8, original: "figures/alpha.png", start: 40, end: 57 };
const initial: Project = {
  stateFingerprint: "scan-state", mainFile: "/paper/main.tex", root: "/paper", texFiles: ["/paper/main.tex"], warnings: ["有图片引用未找到文件"], undoAvailable: false, convertedImages: [],
  status: { convertibleImageIds: ["a", "b"], pendingImages: 2, pendingReferences: 0, problemCount: 2, ignoredCount: 0, completedImages: 1, totalImages: 5,
    pendingImageIds: ["a", "b"], problemIds: ["missing", "unsupported"], ignoredImageIds: [], completedImageIds: ["pdf"], nextAction: "convertImages", blockingReason: null },
  images: [
    { id: "a", path: "/paper/figures/alpha.png", relativePath: "figures/alpha.png", format: "png", width: 1200, height: 800, bytes: 120000, status: "ready", canRename: true, ignoreMode: "none", message: null, references: [reference] },
    { id: "b", path: "/paper/figures/beta.jpg", relativePath: "figures/beta.jpg", format: "jpeg", width: 900, height: 600, bytes: 80000, status: "ready", canRename: true, ignoreMode: "none", message: null, references: [{ ...reference, line: 10, original: "figures/beta.jpg" }] },
    { id: "missing", path: null, relativePath: "figures/lost.png", format: "png", width: null, height: null, bytes: null, status: "missing", message: "文件不存在", references: [{ ...reference, line: 12 }] },
    { id: "unsupported", path: "/paper/animation.gif", relativePath: "animation.gif", format: "gif", width: 20, height: 20, bytes: 500, status: "unsupported", message: "不支持此格式", references: [] },
    { id: "pdf", path: "/paper/plot.pdf", relativePath: "plot.pdf", format: "pdf", width: null, height: null, bytes: 4000, status: "pdf", message: null, references: [] },
  ],
};
const record: ConversionHistoryEntry = { id: "operation-1", createdAt: 1700000000000, outputDir: "texgo-pdf", dpi: 300, jpegQuality: 90, undone: false, canUndo: true, files: [{ source: "figures/alpha.png", output: "texgo-pdf/figures/alpha.pdf", cached: false, error: null }] };
type Handler = (args: Record<string, unknown>) => unknown;
let handlers: Record<string, Handler>;
let calls: { command: string; args: Record<string, unknown> }[];
let backend: Project;
let changes: ChangePreview;
let entries: ConversionHistoryEntry[];

// IPC snapshots explicitly model responses from Rust, never production-side JS classification.
function setStatus(update: Partial<WorkspaceStatus>) {
  const s = { ...backend.status, ...update };
  s.pendingImages = s.pendingImageIds.length; s.problemCount = s.problemIds.length;
  s.completedImages = s.completedImageIds.length; s.ignoredCount = s.ignoredImageIds.length;
  backend.status = s;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}
function convertResponse(ids: string[], references = true): ConversionResult {
  const images = ids.map((id) => ({ id, pdfPath: `/paper/texgo-pdf/${id}.pdf`, bytes: 5000, cached: false, error: null }));
  backend.convertedImages = images; entries = [record];
  setStatus({ pendingImageIds: backend.status.pendingImageIds.filter((id) => !ids.includes(id)), completedImageIds: ["pdf", ...ids], pendingReferences: references ? ids.length : 0, nextAction: references ? "reviewReferences" : "resolveProblems" });
  changes = { files: references ? [{ path: "/paper/main.tex", changes: ids.map((id, index) => ({ id: `change-${id}`, line: 8 + index * 2, before: `${id}.png`, after: `texgo-pdf/${id}.pdf` })) }] : [], referenceCount: references ? ids.length : 0 };
  return { images, cancelled: false };
}
beforeEach(() => {
  localStorage.clear(); calls = []; backend = structuredClone(initial); entries = []; changes = { files: [], referenceCount: 0 };
  handlers = {
    desktop_status: () => ({ error: null }), get_preferences: () => ({ ...defaultPreferences, autoUpdate: false }),
    close_workspace: () => undefined, set_shortcut_recording: () => undefined, "plugin:dialog|open": () => "/paper/main.tex",
    open_project: () => structuredClone(backend), refresh_workspace: () => structuredClone(backend),
    conversion_history: () => entries, poll_workspace: () => null,
    asset_preview: ({ converted }) => converted ? { data: "cGRm", kind: "pdf" } : { data: imageData, kind: "image" },
    convert_images: ({ options }) => convertResponse((options as ConversionOptions).imageIds), cancel_conversion: () => undefined,
    preview_changes: () => structuredClone(changes),
    apply_replacements: ({ selection }) => {
      const ids = selection as string[];
      changes.files = changes.files.map((file) => ({ ...file, changes: file.changes.filter((change) => !ids.includes(change.id)) })).filter((file) => file.changes.length > 0);
      changes.referenceCount -= ids.length; backend.undoAvailable = true;
      setStatus({ pendingReferences: changes.referenceCount, nextAction: changes.referenceCount ? "reviewReferences" : backend.status.pendingImages ? "convertImages" : "resolveProblems" });
      return { filesChanged: 1, referencesChanged: ids.length };
    },
    undo_replacements: () => { backend.undoAvailable = false; return { filesChanged: 1, referencesChanged: 1 }; },
    undo_conversion: () => { backend = structuredClone(initial); entries = [{ ...record, undone: true, canUndo: false }]; return structuredClone(backend); },
    repair_candidates: () => [],
    ignore_asset: ({ imageId, mode }) => {
      const id = imageId as string;
      const ignored = mode !== "none";
      const asset = backend.images.find((image) => image.id === id); if (asset) asset.ignoreMode = mode as "none" | "session" | "permanent";
      setStatus({ ignoredImageIds: ignored ? [...backend.status.ignoredImageIds, id] : backend.status.ignoredImageIds.filter((value) => value !== id), problemIds: ignored ? backend.status.problemIds.filter((value) => value !== id) : [...backend.status.problemIds, id] });
      return structuredClone(backend);
    },
  };
  mockIPC((command, payload) => {
    const args = (payload ?? {}) as Record<string, unknown>; calls.push({ command, args });
    if (!handlers[command]) throw new Error(`Unexpected IPC command: ${command}`);
    return handlers[command](args);
  }, { shouldMockEvents: true });
});
async function openProject() {
  const user = userEvent.setup(); render(<App />);
  await user.click(screen.getByRole("button", { name: "打开 LaTeX 项目" }));
  await screen.findByRole("button", { name: "预览 figures/alpha.png" }); return user;
}
async function menu(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole("button", { name: "更多操作" }));
  await user.click(await screen.findByRole("menuitem", { name: new RegExp(`^${name}`) }));
}
async function selectPartial(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "更多转换操作" }));
  await user.click(await screen.findByRole("menuitem", { name: "选择图片转换…" }));
}
async function convertAndReview(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "转换 2 张图片" }));
  return screen.findByRole("dialog", { name: "检查引用变更" }, { timeout: 3000 });
}

describe("LaTeX 项目唯一工作流", () => {
  it("has no standalone image-directory entry, Home navigation or default checkboxes", async () => {
    const user = await openProject();
    expect(screen.queryByRole("button", { name: /批量转换|图片目录|返回首页|主页/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    await menu(user, "关闭当前项目");
    expect(await screen.findByText("拖入 main.tex 开始")).toBeInTheDocument();
    expect(calls.filter((call) => call.command === "close_workspace")).toHaveLength(1);
    expect(calls.some((call) => call.command === "open_directory")).toBe(false);
  });
  it("updates all backend pending images without a selection and automatically opens reference review", async () => {
    const user = await openProject();
    const dialog = await convertAndReview(user);
    expect(calls.find((call) => call.command === "convert_images")?.args.options).toMatchObject({ imageIds: ["a", "b"], dpi: 300, jpegQuality: 90 });
    expect(within(dialog).getByRole("button", { name: "更新 2 处引用" })).toBeEnabled();
    expect(calls.some((call) => call.command === "apply_replacements")).toBe(false);
  });
  it("uses the Rust pending snapshot instead of inferring candidates from image format", async () => {
    setStatus({ pendingImageIds: ["b"] });
    const user = await openProject();
    await user.click(screen.getByRole("button", { name: "转换 1 张图片" }));
    await screen.findByRole("dialog", { name: "检查引用变更" });
    expect(calls.find((call) => call.command === "convert_images")?.args.options).toMatchObject({ imageIds: ["b"] });
  });
  it("supports a temporary partial selection mode and Esc exits it without resetting search", async () => {
    const user = await openProject();
    await selectPartial(user);
    expect(screen.getByRole("checkbox", { name: "选择当前列表" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "转换 0 张图片" })).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: "选择 figures/beta.jpg" }));
    await user.click(screen.getByRole("button", { name: "转换 1 张图片" }));
    await screen.findByRole("dialog", { name: "检查引用变更" });
    expect(calls.find((call) => call.command === "convert_images")?.args.options).toMatchObject({ imageIds: ["b"] });
    await user.click(screen.getByRole("button", { name: "返回" }));
    await user.click(screen.getByRole("button", { name: "检查 1 处引用" }));
    expect(screen.queryByRole("checkbox", { name: "选择 figures/beta.jpg" })).not.toBeInTheDocument();
  });
  it("selects only visible pending images and Escape preserves the search and filter", async () => {
    const user = await openProject();
    const search = screen.getByRole("searchbox", { name: "搜索图片" });
    await user.type(search, "alpha");
    await user.click(screen.getByRole("radio", { name: "待处理 2" }));
    await selectPartial(user);
    await user.click(screen.getByRole("checkbox", { name: "选择当前列表" }));
    expect(screen.getByRole("button", { name: "转换 1 张图片" })).toBeEnabled();
    screen.getByRole("main").focus(); await user.keyboard("{Escape}");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(search).toHaveValue("alpha");
    expect(screen.getByRole("radio", { name: "待处理 2" })).toHaveAttribute("aria-checked", "true");
  });
  it("Escape exits selection even when the comparison Inspector has keyboard focus", async () => {
    backend.convertedImages = [{ id: "a", pdfPath: "/paper/pdf/a.pdf", bytes: 10, cached: true, error: null }];
    const user = await openProject();
    await selectPartial(user);
    await user.click(screen.getByRole("radio", { name: "对比" }));
    screen.getByRole("region", { name: "图片预览" }).focus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "对比" })).toHaveAttribute("aria-checked", "true");
  });
  it("does not open ReviewDialog when an update keeps the same PDF references", async () => {
    handlers.convert_images = ({ options }) => convertResponse((options as ConversionOptions).imageIds, false);
    const user = await openProject();
    await user.click(screen.getByRole("button", { name: "转换 2 张图片" }));
    await screen.findByRole("button", { name: "处理问题" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(calls.some((call) => call.command === "preview_changes")).toBe(false);
    expect(screen.getByRole("button", { name: "图片" })).toHaveAttribute("aria-current", "page");
  });
  it("prioritizes pending references for both the Command Bar and convert accelerator", async () => {
    convertResponse(["a"]);
    const user = await openProject();
    expect(screen.getByRole("button", { name: "检查 1 处引用" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "转换 1 张图片" })).not.toBeInTheDocument();
    await user.keyboard("{Control>}{Enter}{/Control}");
    await screen.findByRole("dialog", { name: "检查引用变更" });
    expect(calls.some((call) => call.command === "convert_images")).toBe(false);
  });
  it("only applies explicitly checked reference IDs and preserves the reviewed snapshot", async () => {
    const user = await openProject(); const dialog = await convertAndReview(user);
    await user.click(within(dialog).getByRole("checkbox", { name: "第 10 行" }));
    await user.click(within(dialog).getByRole("button", { name: "更新 1 处引用" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const apply = calls.find((call) => call.command === "apply_replacements")!;
    expect(apply.args.selection).toEqual(["change-a"]);
    expect((apply.args.expected as ChangePreview).referenceCount).toBe(2);
    expect(screen.getByRole("button", { name: "检查 1 处引用" })).toBeEnabled();
  });
  it("clicking a problem row only selects it; repair starts through an explicit action", async () => {
    const user = await openProject();
    await user.click(screen.getByRole("button", { name: "预览 figures/lost.png" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(calls.some((call) => call.command === "repair_candidates")).toBe(false);
    expect(screen.getByRole("button", { name: "定位文件" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "修复" }));
    expect(await screen.findByRole("dialog", { name: "图片引用问题" })).toBeInTheDocument();
  });
  it("keeps ordinary missing/unsupported issues out of permanent top alerts", async () => {
    await openProject(); expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "问题 2" })).toBeInTheDocument();
  });
  it("surfaces a backend safety block and disables the only primary action", async () => {
    setStatus({ blockingReason: "输出文件已被外部修改" }); await openProject();
    expect(screen.getByRole("alert")).toHaveTextContent("输出文件已被外部修改");
    expect(screen.getByRole("button", { name: "请先解决安全问题" })).toBeDisabled();
  });
  it("ignores only through Rust, keeps ignored assets in All, and can restore them", async () => {
    const user = await openProject();
    await user.click(screen.getByRole("button", { name: "更多操作 figures/lost.png" }));
    await user.click(screen.getByRole("menuitem", { name: "忽略本次" }));
    await screen.findByRole("radio", { name: "问题 1" });
    await user.click(screen.getByRole("button", { name: "更多筛选" }));
    await user.click(screen.getByRole("menuitem", { name: "已忽略 1" }));
    expect(screen.getByRole("button", { name: "预览 figures/lost.png" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "预览 figures/alpha.png" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "更多操作 figures/lost.png" }));
    await user.click(screen.getByRole("menuitem", { name: "恢复处理" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "预览 figures/lost.png" })).not.toBeInTheDocument());
    expect(calls.some((call) => call.command === "apply_replacements")).toBe(false);
  });
  it("refresh preserves active image, filter, search and scroll", async () => {
    const user = await openProject();
    await user.click(screen.getByRole("button", { name: "预览 figures/beta.jpg" }));
    await user.type(screen.getByRole("searchbox", { name: "搜索图片" }), "beta");
    await user.click(screen.getByRole("radio", { name: "待处理 2" }));
    const scroll = document.querySelector<HTMLElement>(".asset-scroll")!; scroll.scrollTop = 48;
    await menu(user, "重新扫描");
    await waitFor(() => expect(calls.some((call) => call.command === "refresh_workspace")).toBe(true));
    expect(screen.getByRole("button", { name: "预览 figures/beta.jpg" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("searchbox", { name: "搜索图片" })).toHaveValue("beta");
    expect(screen.getByRole("radio", { name: "待处理 2" })).toHaveAttribute("aria-checked", "true");
    expect(document.querySelector(".asset-scroll")).toBe(scroll); expect(scroll.scrollTop).toBe(48);
  });
  it("falls back only when the active image disappeared", async () => {
    const user = await openProject(); backend.images = backend.images.filter((image) => image.id !== "a");
    setStatus({ pendingImageIds: ["b"], totalImages: 4 }); await menu(user, "重新扫描");
    await waitFor(() => expect(screen.queryByRole("button", { name: "预览 figures/alpha.png" })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "预览 figures/beta.jpg" })).toHaveAttribute("aria-pressed", "true");
  });
  it("sidebar switches images/operation records/settings without closing the native project", async () => {
    entries = [{ ...record, files: [], referencesChanged: 18, filesChanged: 2 }];
    const user = await openProject();
    await user.click(screen.getByRole("button", { name: "操作记录" }));
    expect(screen.getByRole("button", { name: "操作记录" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("更新了 18 处 LaTeX 引用")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "操作记录" })).queryByText(/0 张|300 DPI/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "设置" }));
    await screen.findByRole("main", { name: "设置" });
    await user.click(screen.getByRole("button", { name: "图片" }));
    expect(screen.getByRole("button", { name: "预览 figures/alpha.png" })).toHaveAttribute("aria-pressed", "true");
    expect(calls.some((call) => call.command === "close_workspace")).toBe(false);
  });
  it("polls silently and preserves partial selection and context", async () => {
    const user = await openProject();
    await selectPartial(user);
    await user.click(screen.getByRole("checkbox", { name: "选择 figures/alpha.png" }));
    await user.type(screen.getByRole("searchbox", { name: "搜索图片" }), "alpha");
    backend.images[0].updateAvailable = true; handlers.poll_workspace = () => structuredClone(backend);
    await act(async () => { fireEvent.focus(window); });
    await screen.findAllByText("有更新");
    expect(screen.getByRole("checkbox", { name: "选择 figures/alpha.png" })).toBeChecked();
    expect(screen.getByRole("searchbox", { name: "搜索图片" })).toHaveValue("alpha");
    expect(screen.queryByText("正在扫描…")).not.toBeInTheDocument();
  });
  it("keeps browsing enabled during updates, streams progress, and can cancel", async () => {
    const pending = deferred<ConversionResult>(); handlers.convert_images = () => pending.promise;
    const user = await openProject(); await user.click(screen.getByRole("button", { name: "转换 2 张图片" }));
    await waitFor(() => expect(calls.some((call) => call.command === "convert_images")).toBe(true));
    await act(async () => { await emit("conversion-progress", { current: 1, total: 2, name: "alpha.png", status: "done" }); });
    expect(screen.getByRole("button", { name: "正在更新 1 / 2" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "预览 figures/beta.jpg" }));
    await act(async () => { fireEvent.focus(window); });
    expect(calls.some((call) => call.command === "poll_workspace")).toBe(false);
    await user.click(screen.getByRole("button", { name: "取消更新" }));
    expect(calls.some((call) => call.command === "cancel_conversion")).toBe(true);
    await act(async () => pending.resolve({ images: [], cancelled: true }));
    await screen.findByRole("button", { name: "转换 2 张图片" });
  });
  it("the Command Bar follows background Smart Convert status and does not steal active selection", async () => {
    const user = await openProject();
    await user.click(screen.getByRole("button", { name: "预览 figures/beta.jpg" }));
    await act(async () => { await emit("background-start", structuredClone(backend)); });
    const result = convertResponse(["a", "b"], false);
    await act(async () => { await emit("background-finished", { project: structuredClone(backend), result, batchIds: [record.id], problemIds: backend.status.problemIds, pendingReferences: 0 }); await emit("background-idle", null); });
    await screen.findByRole("button", { name: "处理问题" });
    expect(screen.getByRole("radio", { name: "已完成 3" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "预览 figures/beta.jpg" })).toHaveAttribute("aria-pressed", "true");
  });
  it("problem notifications select the Inspector rather than launching a repair dialog", async () => {
    await openProject();
    await act(async () => { await emit("notification-navigate", { project: structuredClone(backend), target: { path: backend.mainFile, view: "problems", batchId: null, imageId: "missing" } }); });
    await waitFor(() => expect(screen.getByRole("button", { name: "预览 figures/lost.png" })).toHaveAttribute("aria-pressed", "true"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("notification links open the exact operation record", async () => {
    entries = [record]; await openProject();
    await act(async () => { await emit("notification-navigate", { project: structuredClone(backend), target: { path: backend.mainFile, view: "history", batchId: record.id, imageId: null } }); });
    await waitFor(() => expect(document.getElementById(`operation-${record.id}`)).toHaveAttribute("data-highlighted", "true"));
  });
  it("requires undo confirmation and refreshes recovery state after an interrupted undo", async () => {
    entries = [record]; handlers.undo_conversion = () => { throw new Error("撤销中断，保留恢复记录"); };
    const user = await openProject(); await user.click(screen.getByRole("button", { name: "操作记录" }));
    await user.click(screen.getByRole("button", { name: "撤销" }));
    expect(calls.some((call) => call.command === "undo_conversion")).toBe(false);
    await user.click(within(screen.getByRole("dialog", { name: "撤销此次操作？" })).getByRole("button", { name: "确认撤销" }));
    await screen.findByText("撤销中断，保留恢复记录");
    expect(calls.some((call) => call.command === "refresh_workspace")).toBe(true);
    expect(screen.getByRole("button", { name: "撤销" })).toBeEnabled();
  });
  it("drops a stale workspace if safety recovery refresh also fails after partial apply", async () => {
    const user = await openProject(); const dialog = await convertAndReview(user);
    handlers.apply_replacements = () => { throw new Error("部分写入失败"); };
    handlers.refresh_workspace = () => { throw new Error("源文件已移走"); };
    await user.click(within(dialog).getByRole("button", { name: "更新 2 处引用" }));
    await screen.findByText(/部分写入失败；重新扫描失败/);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("拖入 main.tex 开始")).toBeInTheDocument();
  });
  it("continues to show the reviewable result when history loading fails", async () => {
    const user = await openProject(); handlers.conversion_history = () => { throw new Error("记录不可读"); };
    const dialog = await convertAndReview(user);
    expect(within(dialog).getByRole("button", { name: "更新 2 处引用" })).toBeEnabled();
    expect(calls.some((call) => call.command === "apply_replacements")).toBe(false);
  });
  it("offers an explicit safe retry for a failed source without writing immediately", async () => {
    backend.images[0].message = "输出目录暂不可写";
    setStatus({ pendingImageIds: ["b"], problemIds: ["missing", "unsupported", "a"] });
    handlers.retry_asset = ({ imageId }) => {
      expect(imageId).toBe("a");
      setStatus({ pendingImageIds: ["a", "b"], problemIds: ["missing", "unsupported"], nextAction: "convertImages" });
      backend.images[0].message = null; return structuredClone(backend);
    };
    const user = await openProject();
    await user.click(screen.getByRole("button", { name: "预览 figures/alpha.png" }));
    await user.click(screen.getByRole("button", { name: "重试此图片" }));
    await screen.findByRole("button", { name: "转换 2 张图片" });
    expect(calls.some((call) => call.command === "convert_images")).toBe(false);
  });
  it("reconciles partial background writes from a recovery snapshot when watcher is disabled", async () => {
    handlers.get_preferences = () => ({ ...defaultPreferences, autoWatch: false, autoUpdate: false });
    await openProject();
    await act(async () => { await emit("background-start", structuredClone(backend)); });
    backend.convertedImages = [{ id: "a", pdfPath: "/paper/pdf/a.pdf", bytes: 123, cached: false, error: null }];
    setStatus({ pendingImageIds: ["b"], completedImageIds: ["pdf", "a"], nextAction: "convertImages" });
    await act(async () => { await emit("workspace-updated", structuredClone(backend)); await emit("background-idle", null); });
    expect(await screen.findByRole("button", { name: "转换 1 张图片" })).toBeEnabled();
    expect(screen.getByRole("radio", { name: "已完成 2" })).toBeInTheDocument();
  });
  it("retains queued automatic review while settings is open", async () => {
    const user = await openProject();
    await user.click(screen.getByRole("button", { name: "转换 2 张图片" }));
    await user.click(screen.getByRole("button", { name: "设置" }));
    await screen.findByRole("main", { name: "设置" });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 750)); });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "图片" }));
    expect(await screen.findByRole("dialog", { name: "检查引用变更" })).toBeInTheDocument();
  });
  it("restores a project using persisted global conversion defaults", async () => {
    localStorage.setItem("texgo.recents.v1", JSON.stringify([{ path: backend.mainFile, openedAt: Date.now() }]));
    handlers.get_preferences = () => ({ ...defaultPreferences, startup: "lastWorkspace", autoUpdate: false, dpi: 450, jpegQuality: 88, outputDir: "paper-pdf" });
    render(<App />);
    expect(await screen.findByRole("button", { name: "输出参数：自定义 · 450 DPI" })).toBeInTheDocument();
    expect(calls.find((call) => call.command === "open_project")?.args).toEqual({ mainFile: backend.mainFile });
  });
  it("opens project by shortcut and ignores invalid drops", async () => {
    const user = userEvent.setup(); render(<App />);
    await act(async () => { await emit("tauri://drag-drop", { paths: ["/paper/figures/alpha.png"] }); });
    expect(calls.some((call) => call.command === "open_project")).toBe(false);
    await user.keyboard("{Control>}o{/Control}");
    await screen.findByRole("button", { name: "预览 figures/alpha.png" });
    expect(calls.find((call) => call.command === "open_project")?.args).toEqual({ mainFile: "/paper/main.tex" });
  });
  it("opens settings and returns to the preserved project with keyboard shortcuts", async () => {
    const user = await openProject(); await user.keyboard("{Control>}f{/Control}");
    await waitFor(() => expect(screen.getByRole("searchbox", { name: "搜索图片" })).toHaveFocus());
    await user.keyboard("{Control>},{/Control}"); await screen.findByRole("main", { name: "设置" });
    await user.keyboard("{Escape}");
    expect(screen.getByRole("searchbox", { name: "搜索图片" })).toBeInTheDocument();
    expect(calls.some((call) => call.command === "close_workspace")).toBe(false);
  });
});

describe("explicit asset control", () => {
  it("keeps manual conversion available when up to date and sends reconvert intent", async () => {
    setStatus({ pendingImageIds: [], problemIds: [], ignoredImageIds: ["missing", "unsupported"], completedImageIds: ["a", "b", "pdf"], nextAction: "upToDate" });
    handlers.convert_images = ({ options }) => convertResponse((options as ConversionOptions).imageIds, false);
    const user = await openProject();
    await user.click(screen.getByRole("button", { name: "转换…" }));
    await user.click(screen.getByRole("button", { name: "开始转换" }));
    await waitFor(() => expect(calls.find((call) => call.command === "convert_images")?.args).toMatchObject({ intent: "reconvert", options: { imageIds: ["a"] } }));
    await waitFor(() => expect(calls.some((call) => call.command === "refresh_workspace")).toBe(true));
    expect(screen.queryByRole("dialog", { name: "检查引用变更" })).not.toBeInTheDocument();
  });
  it("explains pending-reference safety when a user explicitly asks to convert", async () => {
    convertResponse(["a", "b"]);
    const user = await openProject();
    await user.click(screen.getByRole("button", { name: "转换…" }));
    await user.click(screen.getByRole("button", { name: "开始转换" }));
    const dialog = await screen.findByRole("dialog", { name: "请先审核引用" });
    expect(within(dialog).getByText(/当前有 2 处引用尚未审核/)).toBeInTheDocument();
    expect(calls.some((call) => call.command === "convert_images")).toBe(false);
    await user.click(within(dialog).getByRole("button", { name: "检查引用" }));
    expect(await screen.findByRole("dialog", { name: "检查引用变更" })).toBeInTheDocument();
  });
  it("allows explicit reconversion with pending references when the advanced policy is enabled", async () => {
    convertResponse(["a", "b"]);
    handlers.get_preferences = () => ({ ...defaultPreferences, autoUpdate: false, allowUnreviewed: true });
    const user = await openProject();
    await user.click(screen.getByRole("button", { name: "转换…" }));
    await user.click(screen.getByRole("button", { name: "开始转换" }));
    await waitFor(() => expect(calls.some((call) => call.command === "convert_images" && call.args.intent === "reconvert")).toBe(true));
    expect(screen.queryByRole("dialog", { name: "请先审核引用" })).not.toBeInTheDocument();
  });
  it("persists explicit ignore mode and retains the manual conversion fallback", async () => {
    const user = await openProject();
    await user.click(screen.getByRole("button", { name: "更多操作 figures/alpha.png" }));
    await user.click(await screen.findByRole("menuitem", { name: "始终忽略" }));
    await waitFor(() => expect(calls.find((call) => call.command === "ignore_asset")?.args).toMatchObject({ imageId: "a", mode: "permanent" }));
    await user.click(screen.getByRole("button", { name: "更多操作 figures/alpha.png" }));
    await user.click(await screen.findByRole("menuitem", { name: "手动转换一次" }));
    await waitFor(() => expect(calls.some((call) => call.command === "convert_images" && call.args.intent === "reconvert")).toBe(true));
    expect(calls.filter((call) => call.command === "ignore_asset")).toHaveLength(1);
  });
  it("migrates the active image ID after backend rename while keeping search and preview context", async () => {
    handlers.rename_asset = ({ imageId, newBaseName, expectedFingerprint }) => {
      expect(imageId).toBe("a"); expect(expectedFingerprint).toBe("scan-state");
      const asset = backend.images.find((image) => image.id === "a")!;
      asset.id = "a-renamed"; asset.relativePath = `figures/${newBaseName}.png`; asset.path = `/paper/${asset.relativePath}`;
      setStatus({ pendingImageIds: ["a-renamed", "b"], convertibleImageIds: ["a-renamed", "b"] });
      return { oldImageId: "a", newImageId: "a-renamed", project: structuredClone(backend) };
    };
    const user = await openProject();
    await user.type(screen.getByRole("searchbox"), "figures");
    await user.dblClick(screen.getByText("alpha.png"));
    const input = await screen.findByRole("textbox", { name: "图片新名称" });
    await user.clear(input); await user.type(input, "pressure-map{Enter}");
    expect(await screen.findByRole("button", { name: "预览 figures/pressure-map.png" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("searchbox")).toHaveValue("figures");
    expect(screen.queryByRole("textbox", { name: "图片新名称" })).not.toBeInTheDocument();
  });
  it("F2 requests rename only outside text fields and errors remain inline", async () => {
    handlers.rename_asset = () => { throw new Error("该文件名已存在"); };
    const user = await openProject();
    const search = screen.getByRole("searchbox"); await user.click(search); fireEvent.keyDown(search, { key: "F2" });
    expect(screen.queryByRole("textbox", { name: "图片新名称" })).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: "F2" });
    const input = await screen.findByRole("textbox", { name: "图片新名称" });
    await user.clear(input); await user.type(input, "duplicate{Enter}");
    expect(await screen.findByText("该文件名已存在")).toBeInTheDocument();
    expect(input).toHaveValue("duplicate");
    expect(screen.queryByText("操作未完成")).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("textbox", { name: "图片新名称" })).not.toBeInTheDocument();
  });
});
