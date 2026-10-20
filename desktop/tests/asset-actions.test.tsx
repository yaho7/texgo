import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import AssetList from "../src/AssetList";
import type { ImageAsset } from "../src/types";

const image: ImageAsset = { id: "plot", path: "/paper/plot.png", relativePath: "figures/plot.png", format: "png", width: 100, height: 100, bytes: 100, status: "ready", message: null, references: [], canRename: true, ignoreMode: "none" };
function props(asset = image) { return { images: [asset], allImages: [asset], selectionMode: false, pendingIds: new Set<string>(), problemIds: new Set<string>(), completedIds: new Set([asset.id]), convertibleIds: new Set([asset.id]), total: 1, selected: new Set<string>(), activeId: asset.id, results: {}, busy: false, search: "", filter: "all", onSearch: vi.fn(), onFilter: vi.fn(), onSelect: vi.fn(), onSelectAll: vi.fn(), onActivate: vi.fn(), onInspect: vi.fn(), onIgnore: vi.fn(), onRename: vi.fn().mockResolvedValue(undefined), onManualConvert: vi.fn() }; }

it("edits only the basename on filename double click and submits Enter", async () => {
  const user = userEvent.setup(); const p = props(); render(<AssetList {...p} />);
  await user.dblClick(screen.getByText("plot.png"));
  const input = screen.getByRole("textbox", { name: "图片新名称" });
  expect(input).toHaveValue("plot"); expect((input as HTMLInputElement).selectionStart).toBe(0); expect((input as HTMLInputElement).selectionEnd).toBe(4);
  expect(screen.getByText(".png")).toBeInTheDocument();
  await user.keyboard("pressure-map"); await user.keyboard("{Enter}");
  expect(p.onRename).toHaveBeenCalledWith("plot", "pressure-map");
});
it("cancels inline rename on Escape and blur, and does not rename problem assets", async () => {
  const user = userEvent.setup(); const p = props(); const view = render(<AssetList {...p} />);
  await user.dblClick(screen.getByText("plot.png")); await user.keyboard("{Escape}");
  expect(screen.queryByRole("textbox", { name: "图片新名称" })).not.toBeInTheDocument();
  await user.dblClick(screen.getByText("plot.png")); await user.click(screen.getByRole("searchbox"));
  expect(p.onRename).not.toHaveBeenCalled();
  view.rerender(<AssetList {...props({ ...image, status: "missing", path: null, canRename: false })} />);
  await user.dblClick(screen.getByText("plot.png")); expect(screen.queryByRole("textbox", { name: "图片新名称" })).not.toBeInTheDocument();
});
it("keeps failed rename inline and uses one state for menu and keyboard requests", async () => {
  const user = userEvent.setup(); const p = props(); p.onRename.mockRejectedValue(new Error("同目录下已经存在 pressure-map.png"));
  const view = render(<AssetList {...p} renameRequest={{ id: "plot", token: 1 }} />);
  await user.keyboard("pressure-map"); await user.keyboard("{Enter}");
  expect(await screen.findByRole("alert")).toHaveTextContent("已经存在"); expect(screen.getByRole("textbox", { name: "图片新名称" })).toHaveValue("pressure-map");
  await user.keyboard("{Escape}");
  view.rerender(<AssetList {...p} renameRequest={{ id: "plot", token: 1 }} />);
  await user.click(screen.getByRole("button", { name: "更多操作 figures/plot.png" })); await user.click(screen.getByRole("menuitem", { name: "重命名" }));
  expect(screen.getByRole("textbox", { name: "图片新名称" })).toHaveValue("plot");
});
it("offers distinct session/permanent ignore and keeps explicit conversion available while ignored", async () => {
  const user = userEvent.setup(); const p = props(); const view = render(<AssetList {...p} />);
  await user.click(screen.getByRole("button", { name: "更多操作 figures/plot.png" })); await user.click(screen.getByRole("menuitem", { name: "始终忽略" })); expect(p.onIgnore).toHaveBeenCalledWith("plot", "permanent");
  view.rerender(<AssetList {...p} images={[{ ...image, ignoreMode: "permanent" }]} allImages={[{ ...image, ignoreMode: "permanent" }]} ignored={new Set(["plot"])} />);
  expect(screen.getByText("已忽略").closest("span")).toHaveAttribute("title", "始终忽略");
  await user.click(screen.getByRole("button", { name: "更多操作 figures/plot.png" }));
  expect(screen.queryByRole("menuitem", { name: "忽略本次" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("menuitem", { name: "手动转换一次" })); expect(p.onManualConvert).toHaveBeenCalledWith("plot"); expect(p.onIgnore).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "更多操作 figures/plot.png" })); await user.click(screen.getByRole("menuitem", { name: "恢复处理" })); expect(p.onIgnore).toHaveBeenLastCalledWith("plot", "none");
});
it("allows selecting completed and ignored convertible images without selecting unsafe rows", async () => {
  const user = userEvent.setup(); const p = props({ ...image, ignoreMode: "permanent" }); render(<AssetList {...p} ignored={new Set(["plot"])} selectionMode />);
  await user.click(screen.getByRole("checkbox", { name: "选择当前列表" })); expect(p.onSelectAll).toHaveBeenCalledWith(["plot"], true);
  expect(within(screen.getByRole("row", { name: /plot.png/ })).getByRole("checkbox")).toBeEnabled();
});

it("keeps the same row in place when a rename returns a new asset ID", async () => {
  const user = userEvent.setup(); const p = props();
  const renamed = { ...image, id: "pressure", path: "/paper/figures/pressure-map.png", relativePath: "figures/pressure-map.png" };
  const view = render(<AssetList {...p} />);
  const row = screen.getByRole("button", { name: "预览 figures/plot.png" }).closest("tr");
  p.onRename.mockImplementation(async () => { view.rerender(<AssetList {...p} images={[renamed]} allImages={[renamed]} activeId={renamed.id} />); });
  view.rerender(<AssetList {...p} />);
  await user.dblClick(screen.getByText("plot.png")); await user.keyboard("pressure-map{Enter}");
  expect(await screen.findByRole("button", { name: "预览 figures/pressure-map.png" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "预览 figures/pressure-map.png" }).closest("tr")).toBe(row);
  expect(screen.getAllByRole("row")).toHaveLength(2);
});
