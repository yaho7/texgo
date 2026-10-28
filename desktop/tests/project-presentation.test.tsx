import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import AssetList from "../src/AssetList";
import ConversionHistory from "../src/ConversionHistory";
import Home from "../src/Home";
import WorkspaceSidebar from "../src/WorkspaceSidebar";
import WorkbenchMenu from "../src/WorkbenchMenu";
import { TooltipProvider } from "../src/controls/tooltip";
import type { ConversionHistoryEntry, ImageAsset, WorkspaceStatus } from "../src/types";

const pending: ImageAsset = { id: "pending", path: "/paper/plot.png", relativePath: "plot.png", format: "png", width: 2400, height: 1600, bytes: 100, status: "ready", message: null, references: [] };
const missing: ImageAsset = { ...pending, id: "missing", path: null, relativePath: "missing.png", status: "missing" };
function listProps() {
  return { images: [pending, missing], allImages: [pending, missing], selectionMode: false, pendingIds: new Set([pending.id]), problemIds: new Set([missing.id]), completedIds: new Set<string>(), total: 2, selected: new Set<string>(), activeId: pending.id, results: {}, busy: false, search: "", filter: "pending", onSearch: vi.fn(), onFilter: vi.fn(), onSelect: vi.fn(), onSelectAll: vi.fn(), onActivate: vi.fn(), onInspect: vi.fn() };
}

it("exposes a single LaTeX opening flow and recent projects", async () => {
  const user = userEvent.setup(); const open = vi.fn(); const recent = vi.fn();
  render(<Home busy={false} onOpenTex={open} recents={[{ path: "/paper/main.tex", openedAt: 1 }]} onRecent={recent} />);
  expect(screen.queryByText("批量转换图片")).not.toBeInTheDocument();
  expect(screen.getByText("或拖入 .tex 主文件")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "打开项目" })); expect(open).toHaveBeenCalledOnce();
  await user.click(screen.getByRole("button", { name: /main.tex/ })); expect(recent).toHaveBeenCalledWith({ path: "/paper/main.tex", openedAt: 1 });
});

it("keeps native recent paths and opening times readable while busy", () => {
  const entry = { path: "C:\\papers\\main.tex", openedAt: Date.now() - 5 * 60_000 };
  const view = render(<Home busy onOpenTex={vi.fn()} recents={[entry]} onRecent={vi.fn()} />);
  expect(screen.getByText("C:\\papers")).toBeInTheDocument();
  expect(screen.getByText("main.tex")).toBeInTheDocument();
  const time = view.container.querySelector("time")!;
  expect(time).toHaveAttribute("datetime", new Date(entry.openedAt).toISOString());
  expect(time).toHaveAttribute("title", new Date(entry.openedAt).toISOString());
  expect(screen.getAllByRole("button").every((button) => button.hasAttribute("disabled"))).toBe(true);
  view.rerender(<Home busy={false} onOpenTex={vi.fn()} recents={[{ ...entry, openedAt: NaN }]} onRecent={vi.fn()} />);
  expect(view.container.querySelector("time")).toBeNull();
  expect(screen.getByText("时间未知")).toBeInTheDocument();
});

it("preserves removal of a failed recent project after shared formatting", async () => {
  const entry = { path: "/main.tex", openedAt: 1 };
  const remove = vi.fn(); const open = vi.fn(); const user = userEvent.setup();
  render(<TooltipProvider><WorkspaceSidebar busy={false} activeKey={null} projectPath={null} view="assets" recents={[entry]} failedRecent="tex:/main.tex" onView={vi.fn()} onSettings={vi.fn()} onOpenTex={vi.fn()} onRecent={open} onRemove={remove} /></TooltipProvider>);
  expect(screen.getByText("/")).toBeInTheDocument();
  expect(screen.getByText("无法打开，请重新选择")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "移除最近记录 /main.tex" }));
  expect(remove).toHaveBeenCalledWith(entry); expect(open).not.toHaveBeenCalled();
});

it("only exposes checkboxes inside temporary selection mode and selects pending images", async () => {
  const user = userEvent.setup(); const props = listProps(); const view = render(<AssetList {...props} />);
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  expect(within(screen.getByRole("radiogroup", { name: "图片状态摘要" })).getAllByRole("radio")).toHaveLength(4);
  view.rerender(<AssetList {...props} selectionMode />);
  await user.click(screen.getByRole("checkbox", { name: "选择当前列表" }));
  expect(props.onSelectAll).toHaveBeenCalledWith([pending.id], true);
  expect(screen.getByRole("checkbox", { name: "选择 missing.png" })).toBeDisabled();
});

it("activates problem rows without starting repair", async () => {
  const user = userEvent.setup(); const props = listProps(); render(<AssetList {...props} />);
  await user.click(screen.getByRole("button", { name: "预览 missing.png" }));
  expect(props.onActivate).toHaveBeenCalledWith(missing.id); expect(props.onInspect).not.toHaveBeenCalled();
});

it("preserves row identity when a refreshed backend snapshot marks an image complete", () => {
  const props = listProps(); const view = render(<AssetList {...props} />);
  const original = screen.getByRole("button", { name: "预览 plot.png" }).closest("tr");
  view.rerender(<AssetList {...props} pendingIds={new Set()} completedIds={new Set([pending.id])} />);
  expect(screen.getByRole("button", { name: "预览 plot.png" }).closest("tr")).toBe(original);
  expect(original).toHaveAttribute("data-highlight", "success");
  expect(within(original!).getByText("已完成")).toBeInTheDocument();
});

it("navigates images and operation history in the sidebar without a home action", async () => {
  const user = userEvent.setup(); const onView = vi.fn(); const settings = vi.fn();
  render(<WorkspaceSidebar busy={false} activeKey="tex:/paper/main.tex" projectPath="/paper/main.tex" view="assets" recents={[]} failedRecent={null} onView={onView} onSettings={settings} onOpenTex={vi.fn()} onRecent={vi.fn()} onRemove={vi.fn()} />);
  expect(screen.queryByRole("button", { name: "主页" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "操作记录" })); expect(onView).toHaveBeenCalledWith("history");
  await user.click(screen.getByRole("button", { name: "图片" })); expect(onView).toHaveBeenCalledWith("assets");
  await user.click(screen.getByRole("button", { name: "设置" })); expect(settings).toHaveBeenCalledOnce();
});

it("shows reference-only operations without zero images or technical parameters", async () => {
  const user = userEvent.setup();
  const entry: ConversionHistoryEntry = { id: "refs", createdAt: Date.now(), outputDir: "pdf", dpi: 300, jpegQuality: 90, files: [], undone: false, canUndo: true, referencesChanged: 18, filesChanged: 2 };
  const undo = vi.fn(); render(<ConversionHistory entries={[entry]} busy={false} onUndo={undo} />);
  expect(screen.getByText("更新了 18 处 LaTeX 引用")).toBeInTheDocument();
  expect(screen.queryByText(/0 张|300 DPI|批次/)).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "撤销" })); expect(undo).toHaveBeenCalledWith(entry);
});

it("closes a project only through an explicit project menu action", async () => {
  const user = userEvent.setup(); const close = vi.fn();
  render(<WorkbenchMenu busy={false} hasProject canUndo={false} onOpen={vi.fn()} onClose={close} onRefresh={vi.fn()} onUndo={vi.fn()} onUpdate={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: "更多操作" }));
  expect(screen.queryByRole("menuitem", { name: /批量转换|添加图片目录/ })).not.toBeInTheDocument();
  await user.click(screen.getByRole("menuitem", { name: "关闭当前项目" })); expect(close).toHaveBeenCalledOnce();
});

it("retains a disappearing project image just long enough to fade out", () => {
  vi.useFakeTimers();
  try {
    const props = listProps(); const view = render(<AssetList {...props} />);
    const row = screen.getByRole("button", { name: "预览 missing.png" }).closest("tr");
    view.rerender(<AssetList {...props} images={[pending]} allImages={[pending]} problemIds={new Set()} total={1} />);
    expect(row).toHaveAttribute("data-exiting", "true");
    expect(row).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(300));
    expect(row).not.toBeInTheDocument();
  } finally { vi.useRealTimers(); }
});

it("projects backend problems for ready assets even without an error result", () => {
  const props = listProps();
  const blocked = { ...pending, message: "输出文件已被外部修改，无法安全覆盖" };
  render(<AssetList {...props} images={[blocked]} allImages={[blocked]} pendingIds={new Set()} problemIds={new Set([blocked.id])} total={1} />);
  const row = screen.getByRole("button", { name: "预览 plot.png" }).closest("tr")!;
  const badge = within(row).getByText("需要处理");
  expect(badge).toHaveAttribute("data-variant", "destructive");
  expect(within(row).queryByText("待处理")).not.toBeInTheDocument();
  expect(badge).toHaveAttribute("title", blocked.message);
  expect(within(row).getByRole("button", { name: "更多操作 plot.png" })).toBeInTheDocument();
});


it("summarizes a rename and synchronized references without conversion parameters", async () => {
  const entry: ConversionHistoryEntry = { id: "rename", createdAt: Date.now(), outputDir: "pdf", dpi: 300, jpegQuality: 90, files: [], undone: false, canUndo: true, rename: { oldSource: "figures/plot.png", newSource: "figures/pressure-map.png", oldPdf: "pdf/plot.pdf", newPdf: "pdf/pressure-map.pdf", referencesChanged: 3 } };
  const undo = vi.fn(); render(<ConversionHistory entries={[entry]} busy={false} onUndo={undo} />);
  expect(screen.getByText("重命名图片")).toBeInTheDocument();
  expect(screen.getByText("figures/plot.png → figures/pressure-map.png")).toBeInTheDocument();
  expect(screen.getByText("同步更新：1 张源图片、1 个 PDF、3 处 LaTeX 引用")).toBeInTheDocument();
  expect(screen.queryByText(/300 DPI|未修改项目文件/)).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "撤销" })); expect(undo).toHaveBeenCalledWith(entry);
});


it("keeps native sidebar filters tied to backend counts and returns from history without opening a project", async () => {
  const onView = vi.fn(); const onFilter = vi.fn(); const onOpen = vi.fn();
  const status: WorkspaceStatus = { totalImages: 26, pendingImages: 3, pendingReferences: 4, problemCount: 1, ignoredCount: 2, completedImages: 20, pendingImageIds: [], problemIds: [], ignoredImageIds: [], completedImageIds: [], nextAction: "convertImages", blockingReason: null };
  render(<WorkspaceSidebar busy={false} activeKey={null} projectPath="/paper/main.tex" view="history" recents={[]} failedRecent={null} onView={onView} onSettings={vi.fn()} onOpenTex={onOpen} onRecent={vi.fn()} onRemove={vi.fn()} status={status} filter="pending" onFilter={onFilter} />);
  const filters = within(screen.getByRole("radiogroup", { name: "图片状态摘要" }));
  expect(filters.getByRole("radio", { name: "已完成 20" })).toHaveAttribute("aria-checked", "false");
  await userEvent.click(filters.getByRole("radio", { name: "已忽略 2" }));
  expect(onView).toHaveBeenCalledWith("assets"); expect(onFilter).toHaveBeenCalledWith("ignored"); expect(onOpen).not.toHaveBeenCalled();
});

it("lets the workspace move search and filters out of the library while retaining the accessible table", () => {
  render(<AssetList {...listProps()} showSearchAndFilters={false} />);
  expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
  expect(screen.getByRole("table", { name: "项目图片及处理状态" })).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "格式" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "预览 plot.png" })).toBeInTheDocument();
});
