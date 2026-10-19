import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockIPC } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import * as events from "@tauri-apps/api/event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import type { ConversionResult, Project } from "../src/types";

vi.mock("@tauri-apps/api/event", async (importOriginal) => ({
  ...await importOriginal<typeof events>(), listen: vi.fn(),
}));

// PDF rendering has its own canvas tests; this suite covers App IPC and modes.
vi.mock("../src/PdfPreview", () => ({ default: () => <div aria-label="PDF 预览测试替身" /> }));

const imageData = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
const secondImageData = "data:image/png;base64,c2Vjb25k";
const reference = { file: "/paper/main.tex", line: 8, original: "figures/alpha.png", start: 40, end: 57 };
const project: Project = {
  mode: "tex",
  recursive: true,
  convertedImages: [],
  mainFile: "/paper/main.tex",
  root: "/paper",
  texFiles: ["/paper/main.tex", "/paper/chapter.tex"],
  warnings: ["第 12 行的图片引用未找到文件"],
  undoAvailable: false,
  images: [
    { id: "a", path: "/paper/figures/alpha.png", relativePath: "figures/alpha.png", format: "png", width: 1200, height: 800, bytes: 120000, status: "ready", message: null, references: [reference] },
    { id: "b", path: "/paper/figures/beta.jpg", relativePath: "figures/beta.jpg", format: "jpeg", width: 900, height: 600, bytes: 80000, status: "ready", message: null, references: [{ ...reference, line: 10, original: "figures/beta.jpg" }] },
    { id: "missing", path: null, relativePath: "figures/lost.png", format: "png", width: null, height: null, bytes: null, status: "missing", message: "文件不存在", references: [{ ...reference, line: 12 }] },
    { id: "unsupported", path: "/paper/animation.gif", relativePath: "animation.gif", format: "gif", width: 20, height: 20, bytes: 500, status: "unsupported", message: "不支持此格式", references: [] },
    { id: "pdf", path: "/paper/plot.pdf", relativePath: "plot.pdf", format: "pdf", width: null, height: null, bytes: 4000, status: "pdf", message: null, references: [] },
  ],
};

const success: ConversionResult = {
  images: [{ id: "a", pdfPath: "/paper/figures/alpha.pdf", bytes: 50000, cached: false, error: null }],
  cancelled: false,
};

const batch = { id: "batch-1", createdAt: 1700000000000, outputDir: "ready-pdf", dpi: 300, jpegQuality: 90, undone: false, canUndo: true, files: [{ source: "figures/alpha.png", output: "ready-pdf/figures/alpha.pdf", cached: false, error: null }] };

type Handler = (args: Record<string, unknown>) => unknown;
let handlers: Record<string, Handler>;
let calls: { command: string; args: Record<string, unknown> }[];
let backendProject: Project;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeEach(async () => {
  const original = await vi.importActual<typeof events>("@tauri-apps/api/event");
  vi.mocked(events.listen).mockImplementation(original.listen);
  localStorage.clear();
  calls = [];
  backendProject = structuredClone(project);
  handlers = {
    "plugin:dialog|open": () => "/paper/main.tex",
    open_project: () => structuredClone(backendProject),
    refresh_workspace: () => structuredClone(backendProject),
    conversion_history: () => backendProject.undoAvailable ? [batch] : [],
    asset_preview: ({ converted }) => converted ? { data: "cGRm", kind: "pdf" } : { data: imageData, kind: "image" },
    convert_images: () => success,
    cancel_conversion: () => undefined,
    poll_workspace: () => null,
    preview_changes: () => ({ files: [{ path: "/paper/main.tex", changes: [{ id: "change-a", line: 8, before: "\\includegraphics{figures/alpha.png}", after: "\\includegraphics{figures/alpha.pdf}" }] }], referenceCount: 1 }),
    apply_replacements: () => { backendProject.undoAvailable = true; return { filesChanged: 1, referencesChanged: 1 }; },
    undo_replacements: () => { backendProject.undoAvailable = false; return { filesChanged: 1, referencesChanged: 1 }; },
    undo_conversion: () => { backendProject.undoAvailable = false; return structuredClone(backendProject); },
  };
  mockIPC((command, payload) => {
    const args = (payload ?? {}) as Record<string, unknown>;
    calls.push({ command, args });
    const handler = handlers[command];
    if (!handler) throw new Error(`Unexpected IPC command: ${command}`);
    return handler(args);
  }, { shouldMockEvents: true });
});

async function openProject() {
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole("button", { name: "打开 .tex 主文件" }));
  await screen.findByRole("button", { name: "预览 figures/alpha.png" });
  return user;
}

async function convertFirst(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("checkbox", { name: "选择 figures/alpha.png" }));
  await user.click(screen.getByRole("button", { name: /转换 \d+ 张/ }));
  await waitFor(() => expect(screen.getByRole("button", { name: "检查引用变更" })).toBeEnabled());
}

async function chooseMenu(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole("button", { name: "更多操作" }));
  await user.click(await screen.findByRole("menuitem", { name: new RegExp(`^${name}`) }));
}

async function customSettings(user: ReturnType<typeof userEvent.setup>) {
  const summary = screen.getByText("输出设置");
  if (!summary.closest("details")!.open) await user.click(summary);
  await user.click(screen.getByRole("radio", { name: "自定义" }));
}

describe("LaTeX 图片工作流", () => {
  it("filters changed source images and clears their update badge after conversion", async () => {
    backendProject.images[0] = { ...backendProject.images[0], updateAvailable: true };
    const user = await openProject();
    const status = screen.getByRole("combobox", { name: "筛选状态" });
    await user.selectOptions(status, "updatable");
    const preview = screen.getByRole("button", { name: "预览 figures/alpha.png" });
    expect(within(preview.closest("tr")!).getByText("可更新")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "预览 figures/beta.jpg" })).not.toBeInTheDocument();
    await convertFirst(user);
    expect(screen.queryByRole("button", { name: "预览 figures/alpha.png" })).not.toBeInTheDocument();
    await user.selectOptions(status, "all");
    expect(within(screen.getByRole("button", { name: "预览 figures/alpha.png" }).closest("tr")!).getByText("已转换")).toBeInTheDocument();
  });

  it("detects updated images on rescan and keeps failed updates in the update filter", async () => {
    const user = await openProject();
    backendProject.images[0] = { ...backendProject.images[0], updateAvailable: true };
    await chooseMenu(user, "重新扫描");
    await user.selectOptions(screen.getByRole("combobox", { name: "筛选状态" }), "updatable");
    await user.click(screen.getByRole("checkbox", { name: "选择 figures/alpha.png" }));
    handlers.convert_images = () => ({ images: [{ id: "a", pdfPath: null, bytes: null, cached: false, error: "转换失败" }], cancelled: false });
    await user.click(screen.getByRole("button", { name: /转换 \d+ 张/ }));
    await screen.findByText("转换完成：0 成功，1 失败");
    expect(screen.getByRole("button", { name: "预览 figures/alpha.png" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "检查引用变更" })).not.toBeInTheDocument();
  });

  it("keeps the current workspace intact when its sidebar recent entry is clicked", async () => {
    const user = await openProject();
    await user.click(screen.getByRole("checkbox", { name: "选择 figures/alpha.png" }));
    const recent = screen.getByRole("button", { name: "打开最近项目 /paper/main.tex" });
    expect(recent).toHaveAttribute("aria-current", "page");
    await user.click(recent);
    expect(calls.filter(({ command }) => command === "open_project")).toHaveLength(1);
    expect(screen.getByRole("checkbox", { name: "选择 figures/alpha.png" })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "收起侧栏" }));
    expect(screen.queryByRole("navigation", { name: "项目导航" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "展开侧栏" }));
    expect(screen.getByRole("navigation", { name: "项目导航" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "选择 figures/alpha.png" })).toBeChecked();
  });

  it("offers only main-file and batch-image entries on Home without recursive options", () => {
    render(<App />);
    const home = within(screen.getByRole("main"));
    expect(home.getByRole("button", { name: "打开 .tex 主文件" })).toBeEnabled();
    expect(home.getByRole("button", { name: "批量转换图片" })).toBeEnabled();
    expect(screen.queryByText(/包含子目录/)).not.toBeInTheDocument();
    expect(home.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("keeps selection separate from preview and supports keyboard preview", async () => {
    const user = await openProject();
    const preview = screen.getByRole("button", { name: "预览 figures/beta.jpg" });
    const checkbox = screen.getByRole("checkbox", { name: "选择 figures/beta.jpg" });
    await user.click(checkbox.closest("label")!);
    expect(checkbox).toBeChecked();
    expect(preview).toHaveAttribute("aria-pressed", "false");
    preview.focus();
    await user.keyboard("{Enter}");
    expect(preview).toHaveAttribute("aria-pressed", "true");
    expect(checkbox).toBeChecked();
  });

  it("opens an image directory without a TeX file and can reopen it from recents", async () => {
    handlers["plugin:dialog|open"] = () => "/images";
    handlers.open_directory = () => ({ ...project, mode: "directory", mainFile: "", root: "/images", texFiles: [], warnings: [], images: [{ ...project.images[0], references: [] }] });
    const user = userEvent.setup();
    render(<App />);
    await user.click(within(screen.getByRole("main")).getByRole("button", { name: "批量转换图片" }));
    await screen.findByRole("button", { name: "预览 figures/alpha.png" });
    expect(calls).toContainEqual({ command: "open_directory", args: { directory: "/images", recursive: true } });
    expect(screen.queryByRole("button", { name: "检查引用变更" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "返回首页" }));
    await user.click(screen.getByRole("button", { name: "打开最近目录 /images" }));
    await screen.findByRole("button", { name: "预览 figures/alpha.png" });
    expect(calls.filter(({ command }) => command === "open_directory")).toHaveLength(2);
  });

  it("shows persistent conversion history and requires confirmation before undo", async () => {
    handlers.conversion_history = () => [{ id: "batch-1", createdAt: 1700000000000, outputDir: "ready-pdf", dpi: 300, jpegQuality: 90, undone: false, canUndo: true, files: [{ source: "figures/alpha.png", output: "ready-pdf/figures/alpha.pdf", cached: false, error: null }] }];
    handlers.undo_conversion = () => structuredClone(backendProject);
    const user = await openProject();
    await user.click(screen.getByRole("tab", { name: /转换记录/ }));
    await user.click(screen.getByText("文件记录 (1)"));
    await screen.findByText("ready-pdf/figures/alpha.pdf");
    await user.click(screen.getByRole("button", { name: "撤销此批次" }));
    const dialog = await screen.findByRole("dialog", { name: "撤销此批次？" });
    expect(calls.some(({ command }) => command === "undo_conversion")).toBe(false);
    await user.click(within(dialog).getByRole("button", { name: "确认撤销" }));
    await waitFor(() => expect(calls).toContainEqual({ command: "undo_conversion", args: { entryId: "batch-1" } }));
  });

  it("starts empty and leaves the workspace unchanged when the file dialog is cancelled", async () => {
    handlers["plugin:dialog|open"] = () => null;
    const user = userEvent.setup();
    render(<App />);
    expect(screen.queryByRole("checkbox", { name: "选择当前列表" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "打开 .tex 主文件" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "打开 .tex 主文件" })).toBeEnabled());
    expect(calls.some(({ command }) => command === "open_project")).toBe(false);
    expect(screen.getByRole("heading", { name: "打开 .tex 主文件" })).toBeInTheDocument();
    expect(calls[0]).toMatchObject({ command: "plugin:dialog|open", args: { options: { multiple: false, filters: [{ name: "LaTeX", extensions: ["tex"] }] } } });
  });

  it("scans the chosen main file, warns about missing references, filters and selects only ready images", async () => {
    const user = await openProject();
    expect(calls).toContainEqual({ command: "open_project", args: { mainFile: "/paper/main.tex" } });
    expect(screen.getByText("2 个问题需要处理")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "选择 figures/lost.png" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "选择 plot.pdf" })).toBeDisabled();
    await user.type(screen.getByRole("searchbox", { name: "搜索图片" }), "beta");
    expect(screen.queryByRole("button", { name: "预览 figures/alpha.png" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "选择当前列表" }));
    await user.clear(screen.getByRole("searchbox", { name: "搜索图片" }));
    expect(screen.getByRole("checkbox", { name: "选择 figures/beta.jpg" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "选择 figures/alpha.png" })).not.toBeChecked();
    await user.selectOptions(screen.getByRole("combobox", { name: "筛选状态" }), "missing");
    expect(screen.getByRole("button", { name: "预览 figures/lost.png" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "预览 figures/beta.jpg" })).not.toBeInTheDocument();
  });

  it("uses shadcn controls and collapsed reference and output sections", async () => {
    const user = await openProject();
    const checkbox = screen.getByRole("checkbox", { name: "选择 figures/alpha.png" });
    expect(checkbox).toHaveAttribute("data-slot", "checkbox");
    await user.click(checkbox);
    expect(screen.getByRole("checkbox", { name: "选择当前列表" })).toBePartiallyChecked();
    expect(screen.getByText("引用位置").closest("details")).not.toHaveAttribute("open");
    await user.click(screen.getByText("引用位置"));
    expect(screen.getByRole("region", { name: "图片引用位置" })).toHaveTextContent("第 8 行");
    expect(screen.getByText("输出设置").closest("details")).not.toHaveAttribute("open");
    await customSettings(user);
    expect(screen.getByRole("spinbutton", { name: "分辨率 (DPI)" })).toHaveValue(300);
    expect(screen.queryByText(/参考宽度/)).not.toBeInTheDocument();
  });

  it("waits for conversion completion even after the final progress event and sends custom settings", async () => {
    const pending = deferred<ConversionResult>();
    handlers.convert_images = () => pending.promise;
    const user = await openProject();
    await user.click(screen.getByRole("checkbox", { name: "选择 figures/alpha.png" }));
    await customSettings(user);
    await user.clear(screen.getByRole("spinbutton", { name: "分辨率 (DPI)" }));
    await user.type(screen.getByRole("spinbutton", { name: "分辨率 (DPI)" }), "240");
    await user.clear(screen.getByRole("spinbutton", { name: "质量 (%)" }));
    await user.type(screen.getByRole("spinbutton", { name: "质量 (%)" }), "85");
    await user.click(screen.getByRole("button", { name: /转换 \d+ 张/ }));
    await waitFor(() => expect(calls.some(({ command }) => command === "convert_images")).toBe(true));
    await act(async () => { await emit("conversion-progress", { current: 1, total: 1, name: "alpha.png", status: "完成" }); });
    expect(screen.getByRole("button", { name: "正在转换…" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "更多操作" }));
    expect(screen.getByRole("menuitem", { name: /^重新扫描/ })).toHaveAttribute("aria-disabled", "true");
    await user.keyboard("{Escape}");
    expect(screen.getByRole("checkbox", { name: "选择 figures/alpha.png" })).toBeDisabled();
    const preview = screen.getByRole("button", { name: "预览 figures/beta.jpg" });
    expect(preview).toBeEnabled();
    await user.click(preview);
    expect(preview).toHaveAttribute("aria-pressed", "true");
    await screen.findByRole("img", { name: "原始：figures/beta.jpg" });
    expect(screen.getByRole("spinbutton", { name: "分辨率 (DPI)" })).toBeDisabled();
    expect(calls).toContainEqual({ command: "convert_images", args: { options: { imageIds: ["a"], quality: "custom", dpi: 240, jpegQuality: 85, outputDir: "texgo-pdf" } } });
    await act(async () => { pending.resolve(success); });
    await waitFor(() => expect(screen.getByRole("button", { name: "检查引用变更" })).toBeEnabled());
    expect(screen.getByText("转换完成：1 成功，0 失败")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "选择 figures/alpha.png" })).not.toBeChecked();
    const row = screen.getByRole("button", { name: "预览 figures/alpha.png" }).closest("tr")!;
    expect(within(row).getByText("已转换")).toBeInTheDocument();
  });

  it("validates custom settings before any conversion command", async () => {
    const user = await openProject();
    await user.click(screen.getByRole("checkbox", { name: "选择 figures/alpha.png" }));
    await customSettings(user);
    await user.clear(screen.getByRole("spinbutton", { name: "分辨率 (DPI)" }));
    await user.click(screen.getByRole("button", { name: /转换 \d+ 张/ }));
    await waitFor(() => expect(screen.getByRole("spinbutton", { name: "分辨率 (DPI)" })).toHaveFocus());
    expect(screen.getByText("DPI 需为 72–1200 的整数")).toBeInTheDocument();
    expect(calls.some(({ command }) => command === "convert_images")).toBe(false);
  });

  it("reopens collapsed invalid output settings and focuses the input before retry", async () => {
    const user = await openProject();
    await user.click(screen.getByRole("checkbox", { name: "选择 figures/alpha.png" }));
    await customSettings(user);
    await user.clear(screen.getByRole("spinbutton", { name: "分辨率 (DPI)" }));
    await user.click(screen.getByText("输出设置"));
    await user.click(screen.getByText("引用位置"));
    await user.click(screen.getByRole("button", { name: /转换 \d+ 张/ }));
    await waitFor(() => expect(screen.getByRole("spinbutton", { name: "分辨率 (DPI)" })).toHaveFocus());
    expect(calls.some(({ command }) => command === "convert_images")).toBe(false);
    await user.type(screen.getByRole("spinbutton", { name: "分辨率 (DPI)" }), "300");
    await user.click(screen.getByText("输出设置"));
    await user.click(screen.getByRole("button", { name: /转换 \d+ 张/ }));
    await waitFor(() => expect(calls.some(({ command }) => command === "convert_images")).toBe(true));
  });

  it("keeps conversion locked until cancellation finishes and preserves completed image results", async () => {
    const pending = deferred<ConversionResult>();
    handlers.convert_images = () => pending.promise;
    const user = await openProject();
    await user.click(screen.getByRole("checkbox", { name: "选择当前列表" }));
    await user.click(screen.getByRole("button", { name: /转换 \d+ 张/ }));
    await waitFor(() => expect(calls.some(({ command }) => command === "convert_images")).toBe(true));
    await user.click(screen.getByRole("button", { name: "取消转换" }));
    expect(calls.some(({ command }) => command === "cancel_conversion")).toBe(true);
    expect(screen.getByRole("button", { name: "打开 LaTeX 项目" })).toBeDisabled();
    await act(async () => { pending.resolve({ ...success, cancelled: true }); });
    await waitFor(() => expect(screen.getByRole("button", { name: "打开 LaTeX 项目" })).toBeEnabled());
    expect(screen.getByText("已取消：1 张已完成")).toBeInTheDocument();
    const row = screen.getByRole("button", { name: "预览 figures/beta.jpg" }).closest("tr")!;
    expect(within(row).getByText("已取消")).toBeInTheDocument();
  });

  it("honors cancellation while the progress listener is still starting", async () => {
    const pending = deferred<() => void>();
    const unlisten = vi.fn();
    const original = await vi.importActual<typeof events>("@tauri-apps/api/event");
    vi.mocked(events.listen).mockImplementation((name, callback, options) => name === "conversion-progress" ? pending.promise : original.listen(name, callback, options));
    const user = await openProject();
    await user.click(screen.getByRole("checkbox", { name: "选择 figures/alpha.png" }));
    await user.click(screen.getByRole("button", { name: /转换 \d+ 张/ }));
    await user.click(screen.getByRole("button", { name: "取消转换" }));
    await act(async () => { pending.resolve(unlisten); });
    await waitFor(() => expect(screen.getByRole("button", { name: /转换 \d+ 张/ })).toBeEnabled());
    expect(calls.some(({ command }) => command === "convert_images")).toBe(false);
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("shows individual failures and excludes failed conversions from replacement eligibility", async () => {
    handlers.convert_images = () => ({ images: [{ id: "a", pdfPath: null, bytes: null, cached: false, error: "无法解码图片" }], cancelled: false });
    const user = await openProject();
    await user.click(screen.getByRole("checkbox", { name: "选择 figures/alpha.png" }));
    await user.click(screen.getByRole("button", { name: /转换 \d+ 张/ }));
    await screen.findByText("转换完成：0 成功，1 失败");
    expect(screen.getByText("无法解码图片")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "检查引用变更" })).not.toBeInTheDocument();
  });

  it("requires reviewing the diff before applying, then supports undo", async () => {
    const user = await openProject();
    await convertFirst(user);
    await user.click(screen.getByRole("button", { name: "检查引用变更" }));
    const dialog = await screen.findByRole("dialog", { name: "检查引用变更" });
    expect(within(dialog).getByText("\\includegraphics{figures/alpha.png}")).toBeInTheDocument();
    expect(within(dialog).getByText("\\includegraphics{figures/alpha.pdf}")).toBeInTheDocument();
    expect(calls.some(({ command }) => command === "apply_replacements")).toBe(false);
    await user.click(within(dialog).getByRole("button", { name: "更新 1 处引用" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByText("已替换 1 个文件中的 1 处引用")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "选择 figures/alpha.png" })).not.toBeChecked();
    expect(screen.queryByRole("button", { name: "检查引用变更" })).not.toBeInTheDocument();
    expect(calls).toContainEqual({ command: "apply_replacements", args: { selection: ["change-a"], expected: handlers.preview_changes({}), repair: false } });
    expect(calls.filter(({ command }) => command === "refresh_workspace")).toHaveLength(1);
    await chooseMenu(user, "撤销最近任务");
    const undo = await screen.findByRole("dialog", { name: "撤销此批次？" });
    expect(calls.some(({ command }) => command === "undo_conversion")).toBe(false);
    await user.click(within(undo).getByRole("button", { name: "确认撤销" }));
    await screen.findByText("已撤销此次转换");
    expect(calls).toContainEqual({ command: "undo_conversion", args: { entryId: "batch-1" } });
    expect(calls.some(({ command }) => command === "undo_replacements")).toBe(false);
    await user.click(screen.getByRole("button", { name: "更多操作" }));
    expect(screen.getByRole("menuitem", { name: "撤销最近任务" })).toHaveAttribute("aria-disabled", "true");
    await user.keyboard("{Escape}");
  });

  it("dismisses the review with Escape without mutating files", async () => {
    const user = await openProject();
    await convertFirst(user);
    await user.click(screen.getByRole("button", { name: "检查引用变更" }));
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(calls.some(({ command }) => command === "apply_replacements")).toBe(false);
  });

  it("rescans after a partial apply failure and exposes the recovery action", async () => {
    handlers.apply_replacements = () => { backendProject.undoAvailable = true; throw new Error("替换未全部完成，已保留恢复记录"); };
    const user = await openProject();
    await convertFirst(user);
    await user.click(screen.getByRole("button", { name: "检查引用变更" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "更新 1 处引用" }));
    await screen.findByText("替换未全部完成，已保留恢复记录");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(calls.some(({ command }) => command === "refresh_workspace")).toBe(true);
    await chooseMenu(user, "撤销最近任务");
    const recovery = await screen.findByRole("dialog", { name: "撤销此批次？" });
    expect(calls.some(({ command }) => command === "undo_conversion")).toBe(false);
    await user.click(within(recovery).getByRole("button", { name: "确认撤销" }));
    await screen.findByText("已撤销此次转换");
  });

  it("reloads conversion history even when the conversion command rejects", async () => {
    handlers.convert_images = () => { throw new Error("保存转换记录失败"); };
    const user = await openProject();
    const historyReads = calls.filter(({ command }) => command === "conversion_history").length;
    await user.click(screen.getByRole("checkbox", { name: "选择 figures/alpha.png" }));
    await user.click(screen.getByRole("button", { name: /转换 \d+ 张/ }));
    await screen.findByText("保存转换记录失败");
    expect(calls.filter(({ command }) => command === "conversion_history")).toHaveLength(historyReads + 1);
    expect(screen.queryByRole("button", { name: "检查引用变更" })).not.toBeInTheDocument();
  });

  it("rescans an open directory through the menu without a recursive control", async () => {
    handlers["plugin:dialog|open"] = () => "/images";
    const directory = { ...structuredClone(project), mode: "directory", mainFile: "", root: "/images", texFiles: [], warnings: [], images: project.images.slice(0, 2) };
    handlers.open_directory = () => directory;
    handlers.refresh_workspace = () => ({ ...directory, images: [project.images[1]] });
    const user = userEvent.setup();
    render(<App />);
    await user.click(within(screen.getByRole("main")).getByRole("button", { name: "批量转换图片" }));
    await screen.findByRole("button", { name: "预览 figures/beta.jpg" });
    expect(screen.queryByText(/包含子目录/)).not.toBeInTheDocument();
    await chooseMenu(user, "重新扫描");
    await waitFor(() => expect(screen.queryByRole("button", { name: "预览 figures/alpha.png" })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "预览 figures/beta.jpg" })).toBeEnabled();
    expect(calls).toContainEqual({ command: "open_directory", args: { directory: "/images", recursive: true } });
    expect(calls.filter(({ command }) => command === "refresh_workspace")).toHaveLength(1);
  });

  it("rescans the current main file and clears stale selection and conversion state", async () => {
    const user = await openProject();
    await convertFirst(user);
    handlers.refresh_workspace = () => ({ ...structuredClone(project), images: [project.images[1]], warnings: [] });
    await chooseMenu(user, "重新扫描");
    await waitFor(() => expect(screen.queryByRole("button", { name: "预览 figures/alpha.png" })).not.toBeInTheDocument());
    expect(screen.getByRole("checkbox", { name: "选择 figures/beta.jpg" })).not.toBeChecked();
    expect(screen.queryByRole("button", { name: "检查引用变更" })).not.toBeInTheDocument();
    expect(calls.filter(({ command }) => command === "refresh_workspace")).toHaveLength(1);
    expect(calls.filter(({ command }) => command === "plugin:dialog|open")).toHaveLength(1);
  });

  it("does not let a late original preview replace the newly selected image", async () => {
    const oldPreview = deferred<{ data: string; kind: string }>();
    handlers.asset_preview = ({ imageId }) => imageId === "a" ? oldPreview.promise : { data: secondImageData, kind: "image" };
    const user = await openProject();
    await waitFor(() => expect(calls.some(({ command, args }) => command === "asset_preview" && args.imageId === "a")).toBe(true));
    await user.click(screen.getByRole("button", { name: "预览 figures/beta.jpg" }));
    const image = await screen.findByRole("img", { name: "原始：figures/beta.jpg" });
    expect(image).toHaveAttribute("src", secondImageData);
    await act(async () => { oldPreview.resolve({ data: imageData, kind: "image" }); });
    expect(screen.getByRole("img", { name: "原始：figures/beta.jpg" })).toHaveAttribute("src", secondImageData);
    expect(screen.queryByRole("img", { name: "原始：figures/alpha.png" })).not.toBeInTheDocument();
  });

  it("requests the PDF only after success and choosing comparison while retaining the original", async () => {
    const user = await openProject();
    expect(screen.getByRole("radio", { name: "对比" })).toBeDisabled();
    await convertFirst(user);
    expect(calls.some(({ command, args }) => command === "asset_preview" && args.converted)).toBe(false);
    await user.click(screen.getByRole("radio", { name: "对比" }));
    await waitFor(() => expect(calls).toContainEqual({ command: "asset_preview", args: { imageId: "a", converted: true } }));
    expect(screen.getByRole("radio", { name: "对比" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("img", { name: "原始：figures/alpha.png" })).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "原图" }));
    expect(screen.getByRole("radio", { name: "原图" })).toHaveAttribute("aria-checked", "true");
  });

  it("polls on focus and refreshes source state without clearing search, filter or selection", async () => {
    const user = await openProject();
    await user.click(screen.getByRole("checkbox", { name: "选择 figures/alpha.png" }));
    const search = screen.getByRole("searchbox", { name: "搜索图片" });
    const filter = screen.getByRole("combobox", { name: "筛选状态" });
    await user.type(search, "alpha");
    await user.selectOptions(filter, "ready");
    backendProject.images[0].updateAvailable = true;
    handlers.poll_workspace = () => structuredClone(backendProject);
    await act(async () => { fireEvent.focus(window); });
    await screen.findByText("已自动更新图片状态");
    expect(calls).toContainEqual({ command: "poll_workspace", args: { root: "/paper" } });
    const row = screen.getByRole("button", { name: "预览 figures/alpha.png" }).closest("tr")!;
    expect(within(row).getByText("可更新")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "选择 figures/alpha.png" })).toBeChecked();
    expect(search).toHaveValue("alpha");
    expect(filter).toHaveValue("ready");
    expect(screen.queryByRole("button", { name: "预览 figures/beta.jpg" })).not.toBeInTheDocument();
    expect(calls.some(({ command }) => command === "refresh_workspace")).toBe(false);
  });

  it("does not poll on focus while conversion is in flight", async () => {
    const pending = deferred<ConversionResult>();
    handlers.convert_images = () => pending.promise;
    const user = await openProject();
    await user.click(screen.getByRole("checkbox", { name: "选择 figures/alpha.png" }));
    await user.click(screen.getByRole("button", { name: "转换 1 张" }));
    await waitFor(() => expect(calls.some(({ command }) => command === "convert_images")).toBe(true));
    const pollCount = calls.filter(({ command }) => command === "poll_workspace").length;
    await act(async () => { fireEvent.focus(window); });
    expect(calls.filter(({ command }) => command === "poll_workspace")).toHaveLength(pollCount);
    expect(screen.getByRole("button", { name: "正在转换…" })).toBeDisabled();
    await act(async () => pending.resolve(success));
    await screen.findByRole("button", { name: "检查引用变更" });
    await act(async () => { fireEvent.focus(window); });
    await waitFor(() => expect(calls.filter(({ command }) => command === "poll_workspace")).toHaveLength(pollCount + 1));
  });

  it("enables comparison from per-image results before the batch completes and keeps source browsing available", async () => {
    const pending = deferred<ConversionResult>();
    handlers.convert_images = () => pending.promise;
    const user = await openProject();
    await user.click(screen.getByRole("checkbox", { name: "选择当前列表" }));
    await user.click(screen.getByRole("button", { name: "转换 2 张" }));
    await waitFor(() => expect(calls.some(({ command }) => command === "convert_images")).toBe(true));
    expect(screen.getByRole("radio", { name: "对比" })).toBeDisabled();
    await act(async () => { await emit("conversion-result", success.images[0]); });
    expect(screen.getByRole("button", { name: "正在转换…" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "对比" })).toBeEnabled();
    await user.click(screen.getByRole("radio", { name: "对比" }));
    await waitFor(() => expect(calls).toContainEqual({ command: "asset_preview", args: { imageId: "a", converted: true } }));
    expect(screen.getByRole("img", { name: "原始：figures/alpha.png" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "预览 figures/beta.jpg" }));
    await screen.findByRole("img", { name: "原始：figures/beta.jpg" });
    expect(screen.getByRole("radio", { name: "对比" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "选择 figures/beta.jpg" })).toBeDisabled();
    await act(async () => pending.resolve(success));
    await screen.findByText("转换完成：1 成功，1 失败");
  });

  it("opens the main-file dialog with Ctrl+O", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.keyboard("{Control>}o{/Control}");
    await screen.findByRole("button", { name: "预览 figures/alpha.png" });
    expect(calls.filter(({ command }) => command === "plugin:dialog|open")).toHaveLength(1);
    expect(calls).toContainEqual({ command: "open_project", args: { mainFile: "/paper/main.tex" } });
  });

  it("focuses search with slash and navigates previews with arrows without changing selection", async () => {
    const user = await openProject();
    await user.click(screen.getByRole("checkbox", { name: "选择 figures/alpha.png" }));
    screen.getByRole("main").focus();
    await user.keyboard("/");
    const search = screen.getByRole("searchbox", { name: "搜索图片" });
    expect(search).toHaveFocus();
    await user.type(search, "beta");
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("button", { name: "预览 figures/beta.jpg" })).toHaveAttribute("aria-pressed", "false");
    await user.clear(search);
    screen.getByRole("main").focus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("button", { name: "预览 figures/beta.jpg" })).toHaveAttribute("aria-pressed", "true");
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("button", { name: "预览 figures/alpha.png" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("checkbox", { name: "选择 figures/alpha.png" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "选择 figures/beta.jpg" })).not.toBeChecked();
  });

  it("submits only checked reference IDs after manual review", async () => {
    handlers.preview_changes = () => ({ files: [{ path: "/paper/main.tex", changes: [
      { id: "change-a", line: 8, before: "alpha.png", after: "alpha.pdf" },
      { id: "change-b", line: 10, before: "beta.jpg", after: "beta.pdf" },
    ] }], referenceCount: 2 });
    const user = await openProject();
    await convertFirst(user);
    expect(calls.some(({ command }) => command === "apply_replacements")).toBe(false);
    await user.click(screen.getByRole("button", { name: "检查引用变更" }));
    const dialog = await screen.findByRole("dialog", { name: "检查引用变更" });
    expect(within(dialog).getByRole("button", { name: "更新 2 处引用" })).toBeEnabled();
    await user.click(within(dialog).getByRole("checkbox", { name: "第 10 行" }));
    await user.click(within(dialog).getByRole("button", { name: "更新 1 处引用" }));
    await screen.findByText("已替换 1 个文件中的 1 处引用");
    expect(calls.find(({ command }) => command === "apply_replacements")?.args.selection).toEqual(["change-a"]);
  });

  it("keeps converted results reviewable when loading conversion history fails", async () => {
    const user = await openProject();
    handlers.conversion_history = () => { throw new Error("记录不可读"); };
    await convertFirst(user);
    await screen.findByText("无法读取转换记录，请重新扫描后重试：记录不可读");
    expect(screen.getByRole("button", { name: "检查引用变更" })).toBeEnabled();
    expect(calls.some(({ command }) => command === "apply_replacements")).toBe(false);
    await user.click(screen.getByRole("tab", { name: /转换记录/ }));
    expect(screen.getByText("暂无转换记录")).toBeInTheDocument();
  });

  it("refreshes recovery history after an interrupted batch undo", async () => {
    handlers.conversion_history = () => [{ id: "batch-1", createdAt: 1700000000000, outputDir: "pdf", dpi: 300, jpegQuality: 90, undone: false, canUndo: true, referencesChanged: 1, filesChanged: 1, files: [] }];
    handlers.undo_conversion = () => { throw new Error("撤销中断，保留恢复记录"); };
    const user = await openProject();
    await user.click(screen.getByRole("tab", { name: /转换记录/ }));
    await user.click(screen.getByRole("button", { name: "撤销此批次" }));
    await user.click(within(screen.getByRole("dialog", { name: "撤销此批次？" })).getByRole("button", { name: "确认撤销" }));
    await screen.findByText("撤销中断，保留恢复记录");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(calls.filter(({ command }) => command === "refresh_workspace")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "撤销此批次" })).toBeEnabled();
  });

  it("keeps comparison selected when a background scan refreshes the current asset", async () => {
    backendProject.convertedImages = success.images;
    const user = await openProject();
    await user.click(screen.getByRole("radio", { name: "对比" }));
    handlers.poll_workspace = () => structuredClone(backendProject);
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await screen.findByText("已自动更新图片状态");
    expect(screen.getByRole("radio", { name: "对比" })).toHaveAttribute("aria-checked", "true");
  });

  it("discards the stale workspace when recovery refresh also fails after a partial apply", async () => {
    const user = await openProject();
    await convertFirst(user);
    handlers.apply_replacements = () => { throw new Error("部分写入失败"); };
    handlers.refresh_workspace = () => { throw new Error("源文件已移走"); };
    await user.click(screen.getByRole("button", { name: "检查引用变更" }));
    const dialog = await screen.findByRole("dialog", { name: "检查引用变更" });
    await user.click(within(dialog).getByRole("button", { name: "更新 1 处引用" }));
    await screen.findByText("部分写入失败；重新扫描失败，请重新打开工作区：源文件已移走");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "打开 .tex 主文件" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "检查引用变更" })).not.toBeInTheDocument();
  });
});

it("keeps ignored assets visible, filters them, restores them and never applies TeX", async () => {
  handlers.ignore_asset = () => undefined;
  const user = await openProject();
  await user.click(screen.getByRole("button", { name: "更多操作 figures/lost.png" }));
  await user.click(screen.getByRole("menuitem", { name: "忽略本次" }));
  const row = screen.getByRole("button", { name: "预览 figures/lost.png" }).closest("tr")!;
  expect(within(row).getByText("已忽略")).toBeInTheDocument();
  expect(screen.getByText(/1 张已忽略 · 共 5 张/)).toBeInTheDocument();
  await user.selectOptions(screen.getByRole("combobox", { name: "筛选状态" }), "ignored");
  expect(screen.queryByRole("button", { name: "预览 figures/alpha.png" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "更多操作 figures/lost.png" }));
  await user.click(screen.getByRole("menuitem", { name: "恢复处理" }));
  expect(screen.queryByRole("button", { name: "预览 figures/lost.png" })).not.toBeInTheDocument();
  expect(calls.filter(({ command }) => command === "apply_replacements")).toHaveLength(0);
});

it("prioritizes review over a new selected batch and the convert accelerator", async () => {
  const user = await openProject();
  await convertFirst(user);
  await user.click(screen.getByRole("checkbox", { name: "选择 figures/beta.jpg" }));
  expect(screen.getByRole("button", { name: "检查引用变更" })).toBeEnabled();
  await user.keyboard("{Control>}{Enter}{/Control}");
  await screen.findByRole("dialog", { name: "检查引用变更" });
  expect(calls.filter(({ command }) => command === "convert_images")).toHaveLength(1);
});
