import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import AssetList from "../src/AssetList";
import ConversionHistory from "../src/ConversionHistory";
import Home from "../src/Home";
import WorkspaceSidebar from "../src/WorkspaceSidebar";
import WorkbenchMenu from "../src/WorkbenchMenu";
import type { ConversionHistoryEntry, ImageAsset } from "../src/types";

const pending: ImageAsset = { id: "pending", path: "/paper/plot.png", relativePath: "plot.png", format: "png", width: 2400, height: 1600, bytes: 100, status: "ready", message: null, references: [] };
const missing: ImageAsset = { ...pending, id: "missing", path: null, relativePath: "missing.png", status: "missing" };
function listProps() {
  return { images: [pending, missing], allImages: [pending, missing], selectionMode: false, pendingIds: new Set([pending.id]), problemIds: new Set([missing.id]), completedIds: new Set<string>(), total: 2, selected: new Set<string>(), activeId: pending.id, results: {}, busy: false, search: "", filter: "pending", onSearch: vi.fn(), onFilter: vi.fn(), onSelect: vi.fn(), onSelectAll: vi.fn(), onActivate: vi.fn(), onInspect: vi.fn() };
}

it("exposes a single LaTeX opening flow and recent projects", async () => {
  const user = userEvent.setup(); const open = vi.fn(); const recent = vi.fn();
  render(<Home busy={false} onOpenTex={open} recents={[{ path: "/paper/main.tex", openedAt: 1 }]} onRecent={recent} />);
  expect(screen.queryByText("批量转换图片")).not.toBeInTheDocument();
  expect(screen.getByText("拖入 main.tex 开始")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "打开 LaTeX 项目" })); expect(open).toHaveBeenCalledOnce();
  await user.click(screen.getByRole("button", { name: /main.tex/ })); expect(recent).toHaveBeenCalledWith({ path: "/paper/main.tex", openedAt: 1 });
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
  expect(within(row).queryByText("待转换")).not.toBeInTheDocument();
  expect(within(row).getByText(blocked.message)).toBeInTheDocument();
  expect(within(row).getByRole("button", { name: "更多操作 plot.png" })).toBeInTheDocument();
});
