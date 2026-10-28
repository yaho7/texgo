import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import CommandBar from "../src/CommandBar";
import type { WorkspaceStatus } from "../src/types";

const status: WorkspaceStatus = { pendingImages: 2, pendingReferences: 0, problemCount: 0, ignoredCount: 0, completedImages: 0, totalImages: 2, pendingImageIds: ["a", "b"], problemIds: [], ignoredImageIds: [], completedImageIds: [], nextAction: "convertImages", blockingReason: null };
const defaults = { status, settings: { dpi: "300", jpegQuality: "90", outputDir: "texgo-pdf" }, selectionMode: false, selectedCount: 0, busy: false, converting: false, progress: null, completion: null, cancelRequested: false, onAction: vi.fn(), onSettings: vi.fn(), onSelectionMode: vi.fn(), onCancel: vi.fn() };
afterEach(() => vi.useRealTimers());

it("keeps a single primary action while status and button labels transition", () => {
  vi.useFakeTimers();
  const view = render(<CommandBar {...defaults} />);
  view.rerender(<CommandBar {...defaults} busy converting progress={{ current: 0, total: 2, name: "first.png", status: "converting" }} />);
  expect(screen.getByRole("button", { name: "取消处理" })).toBeEnabled();
  expect(document.querySelectorAll(".command-action")).toHaveLength(0);
  expect(screen.getByRole("status")).toHaveTextContent("正在处理 0 / 2");
  expect(screen.getByRole("status")).toHaveTextContent("first.png");
  expect(document.querySelector(".command-message-exit")).toBeNull();
  view.rerender(<CommandBar {...defaults} busy converting progress={{ current: 1, total: 2, name: "second.png", status: "converting" }} />);
  act(() => vi.advanceTimersByTime(300));
  expect(document.querySelector(".command-message-exit")).not.toBeInTheDocument();
  expect(document.querySelector(".command-action-label-exit")).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("正在处理 1 / 2");
  expect(screen.queryByRole("button", { name: /正在更新/ })).not.toBeInTheDocument();
  view.rerender(<CommandBar {...defaults} completion={2} status={{ ...status, pendingReferences: 2, nextAction: "reviewReferences" }} />);
  expect(screen.getByRole("status")).toHaveTextContent("已处理 2 张图片");
  expect(document.querySelectorAll(".command-action")).toHaveLength(0);
  view.rerender(<CommandBar {...defaults} status={{ ...status, pendingReferences: 2, nextAction: "reviewReferences" }} />);
  expect(screen.getByRole("button", { name: "检查 2 处引用" })).toBeEnabled();
  expect(document.querySelectorAll(".command-action")).toHaveLength(1);
});

it("offers three presets, infers custom parameters, and keeps errors inline", async () => {
  const user = userEvent.setup();
  const onSettings = vi.fn(); const onAction = vi.fn();
  const view = render(<CommandBar {...defaults} onSettings={onSettings} onAction={onAction} />);
  await user.click(screen.getByRole("button", { name: "输出参数：平衡 · 300 DPI" }));
  expect(screen.queryByRole("radio", { name: "自定义" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("radio", { name: "小体积" }));
  expect(onSettings).toHaveBeenLastCalledWith({ dpi: "150", jpegQuality: "75", outputDir: "texgo-pdf" });
  view.rerender(<CommandBar {...defaults} onSettings={onSettings} onAction={onAction} settings={{ dpi: "450", jpegQuality: "88", outputDir: "../unsafe" }} />);
  expect(screen.getByRole("button", { name: "输出参数：自定义 · 450 DPI" })).toBeInTheDocument();
  expect(screen.getByLabelText("输出目录")).toHaveAttribute("aria-invalid", "true");
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button", { name: "处理 2 张图片" }));
  expect(onAction).not.toHaveBeenCalled();
  expect(await screen.findByLabelText("输出目录")).toHaveAttribute("aria-invalid", "true");
});

it("keeps manual conversion available without a redundant primary button when up to date", () => {
  render(<CommandBar {...defaults} status={{ ...status, pendingImages: 0, pendingImageIds: [], completedImageIds: ["a", "b"], completedImages: 2, nextAction: "upToDate" }} />);
  expect(screen.getByRole("status")).toBeEmptyDOMElement();
  expect(document.querySelector(".command-action")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "处理图片…" })).toBeEnabled();
});


it("exposes pending, selected, current, and all conversion intents in the split menu", async () => {
  const user = userEvent.setup(); const convert = vi.fn(); const selection = vi.fn();
  render(<CommandBar {...defaults} onConvert={convert} onSelectionMode={selection} currentImageId="a" convertibleIds={["a", "b", "completed"]} />);
  await user.click(screen.getByRole("button", { name: "处理 2 张图片" })); expect(convert).toHaveBeenLastCalledWith("pending", undefined);
  await user.click(screen.getByRole("button", { name: "更多处理操作" })); await user.click(screen.getByRole("menuitem", { name: "重新处理当前图片" })); expect(convert).toHaveBeenLastCalledWith("reconvert", ["a"]);
  await user.click(screen.getByRole("button", { name: "更多处理操作" })); await user.click(screen.getByRole("menuitem", { name: "重新处理全部图片" })); expect(convert).toHaveBeenLastCalledWith("reconvert", ["a", "b", "completed"]);
  await user.click(screen.getByRole("button", { name: "更多处理操作" })); await user.click(screen.getByRole("menuitem", { name: "选择图片…" })); expect(selection).toHaveBeenCalledWith(true);
});
it.each(["reviewReferences", "resolveProblems", "upToDate"] as const)("keeps manual conversion available when recommendation is %s", async (nextAction) => {
  const user = userEvent.setup(); const convert = vi.fn();
  render(<CommandBar {...defaults} status={{ ...status, pendingImages: 0, pendingImageIds: [], nextAction }} currentImageId="completed" convertibleIds={["completed"]} onConvert={convert} />);
  await user.click(screen.getByRole("button", { name: "处理图片…" }));
  expect(screen.getByRole("menuitem", { name: "重新处理当前图片" })).toBeEnabled();
  await user.click(screen.getByRole("menuitem", { name: "重新处理当前图片" })); expect(convert).toHaveBeenCalledWith("reconvert", ["completed"]);
  expect(document.querySelectorAll(".command-action").length).toBeLessThanOrEqual(1);
});
it("converts a temporary selection even when the project is otherwise up to date", async () => {
  const user = userEvent.setup(); const convert = vi.fn();
  render(<CommandBar {...defaults} selectionMode selectedCount={1} onConvert={convert} status={{ ...status, pendingImages: 0, nextAction: "upToDate" }} />);
  expect(screen.getByRole("status")).toHaveTextContent("选择要处理的图片");
  await user.click(screen.getByRole("button", { name: "处理 1 张图片" })); expect(convert).toHaveBeenCalledWith("selected", undefined);
});


it("checks the manual conversion guard before opening its dropdown", async () => {
  const user = userEvent.setup(); const guard = vi.fn(() => false);
  render(<CommandBar {...defaults} status={{ ...status, nextAction: "reviewReferences", pendingReferences: 18 }} onManualOpen={guard} />);
  await user.click(screen.getByRole("button", { name: "处理图片…" }));
  expect(guard).toHaveBeenCalledOnce(); expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "处理图片…" })).toBeEnabled();
});
it("explains a safety block in the status and disables all conversion choices", async () => {
  const user = userEvent.setup(); const convert = vi.fn();
  render(<CommandBar {...defaults} status={{ ...status, blockingReason: "输出文件已被外部修改" }} convertibleIds={["a"]} currentImageId="a" onConvert={convert} />);
  await user.click(screen.getByRole("button", { name: "处理图片…" }));
  expect(screen.getByRole("status")).toHaveTextContent("操作已暂停");
  expect(screen.getByText("操作已暂停")).toHaveAttribute("title", "输出文件已被外部修改");
  for (const item of screen.getAllByRole("menuitem")) expect(item).toHaveAttribute("aria-disabled", "true"); expect(convert).not.toHaveBeenCalled();
});

const conversionChoices = ["处理待更新图片", "选择图片…", "重新处理当前图片", "重新处理全部图片"];
it.each(["convertImages", "reviewReferences", "resolveProblems", "upToDate"] as const)("offers exactly the same four conversion choices for %s", async (nextAction) => {
  const user = userEvent.setup();
  render(<CommandBar {...defaults} status={{ ...status, nextAction }} currentImageId="a" convertibleIds={["a"]} />);
  expect(screen.getAllByRole("button", { name: /输出参数：/ })).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: nextAction === "convertImages" ? "更多处理操作" : "处理图片…" }));
  expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(conversionChoices);
  expect(screen.queryByRole("radiogroup", { name: "转换范围" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "开始转换" })).not.toBeInTheDocument();
  expect(screen.queryByRole("menuitem", { name: "转换设置…" })).not.toBeInTheDocument();
});
it("checks the pending split menu guard before it opens", async () => {
  const user = userEvent.setup(); const guard = vi.fn(() => false);
  render(<CommandBar {...defaults} onManualOpen={guard} />);
  await user.click(screen.getByRole("button", { name: "更多处理操作" }));
  expect(guard).toHaveBeenCalledOnce();
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
});
it("keeps selection cancellation explicit and routes only authoritative convertible IDs", async () => {
  const user = userEvent.setup(); const selection = vi.fn(); const convert = vi.fn();
  const view = render(<CommandBar {...defaults} currentImageId="unsafe" convertibleIds={["ignored"]} onConvert={convert} />);
  await user.click(screen.getByRole("button", { name: "更多处理操作" }));
  expect(screen.getByRole("menuitem", { name: "重新处理当前图片" })).toHaveAttribute("aria-disabled", "true");
  await user.click(screen.getByRole("menuitem", { name: "重新处理全部图片" }));
  expect(convert).toHaveBeenCalledWith("reconvert", ["ignored"]);
  view.rerender(<CommandBar {...defaults} selectionMode selectedCount={1} onSelectionMode={selection} />);
  await user.click(screen.getByRole("button", { name: "取消选择" }));
  expect(selection).toHaveBeenCalledWith(false);
});

it.each(["converting", "completion", "busy", "selection"] as const)("closes the conversion menu across %s and never reopens without a guarded user action", async (transition) => {
  const user = userEvent.setup(); const guard = vi.fn(() => true);
  const view = render(<CommandBar {...defaults} onManualOpen={guard} />);
  await user.click(screen.getByRole("button", { name: "更多处理操作" }));
  expect(screen.getByRole("menu")).toBeInTheDocument();
  expect(guard).toHaveBeenCalledOnce();
  view.rerender(<CommandBar {...defaults} onManualOpen={guard} busy={transition === "busy" || transition === "converting"} converting={transition === "converting"} completion={transition === "completion" ? 2 : null} selectionMode={transition === "selection"} />);
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  view.rerender(<CommandBar {...defaults} onManualOpen={guard} completion={2} />);
  view.rerender(<CommandBar {...defaults} onManualOpen={guard} status={{ ...status, nextAction: "reviewReferences", pendingReferences: 2 }} />);
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(guard).toHaveBeenCalledOnce();
  guard.mockReturnValue(false);
  await user.click(screen.getByRole("button", { name: "处理图片…" }));
  expect(guard).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
});
