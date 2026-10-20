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
  expect(screen.getByRole("button", { name: "正在更新 0 / 2" })).toBeDisabled();
  expect(document.querySelectorAll(".command-action")).toHaveLength(1);
  expect(document.querySelector(".command-message-exit")).toHaveTextContent("2 张图片需要更新");
  view.rerender(<CommandBar {...defaults} busy converting progress={{ current: 1, total: 2, name: "second.png", status: "converting" }} />);
  act(() => vi.advanceTimersByTime(300));
  expect(document.querySelector(".command-message-exit")).not.toBeInTheDocument();
  expect(document.querySelector(".command-action-label-exit")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "正在更新 1 / 2" })).toBeDisabled();
  view.rerender(<CommandBar {...defaults} completion={2} status={{ ...status, pendingReferences: 2, nextAction: "reviewReferences" }} />);
  expect(screen.getByRole("button", { name: "已更新 2 张" })).toBeDisabled();
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
  await user.click(screen.getByRole("button", { name: "转换 2 张图片" }));
  expect(onAction).not.toHaveBeenCalled();
  expect(await screen.findByLabelText("输出目录")).toHaveAttribute("aria-invalid", "true");
});

it("keeps manual conversion available without a redundant primary button when up to date", () => {
  render(<CommandBar {...defaults} status={{ ...status, pendingImages: 0, pendingImageIds: [], completedImageIds: ["a", "b"], completedImages: 2, nextAction: "upToDate" }} />);
  expect(screen.getByRole("status")).toHaveTextContent("项目已是最新状态");
  expect(document.querySelector(".command-action")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "转换…" })).toBeEnabled();
});


it("exposes pending, selected, current, and all conversion intents in the split menu", async () => {
  const user = userEvent.setup(); const convert = vi.fn(); const selection = vi.fn();
  render(<CommandBar {...defaults} onConvert={convert} onSelectionMode={selection} currentImageId="a" convertibleIds={["a", "b", "completed"]} />);
  await user.click(screen.getByRole("button", { name: "转换 2 张图片" })); expect(convert).toHaveBeenLastCalledWith("pending", undefined);
  await user.click(screen.getByRole("button", { name: "更多转换操作" })); await user.click(screen.getByRole("menuitem", { name: "重新转换当前图片" })); expect(convert).toHaveBeenLastCalledWith("reconvert", ["a"]);
  await user.click(screen.getByRole("button", { name: "更多转换操作" })); await user.click(screen.getByRole("menuitem", { name: "重新转换全部图片" })); expect(convert).toHaveBeenLastCalledWith("reconvert", ["a", "b", "completed"]);
  await user.click(screen.getByRole("button", { name: "更多转换操作" })); await user.click(screen.getByRole("menuitem", { name: "选择图片转换…" })); expect(selection).toHaveBeenCalledWith(true);
});
it.each(["reviewReferences", "resolveProblems", "upToDate"] as const)("keeps manual conversion available when recommendation is %s", async (nextAction) => {
  const user = userEvent.setup(); const convert = vi.fn();
  render(<CommandBar {...defaults} status={{ ...status, pendingImages: 0, pendingImageIds: [], nextAction }} currentImageId="completed" convertibleIds={["completed"]} onConvert={convert} />);
  await user.click(screen.getByRole("button", { name: "转换…" }));
  expect(screen.getByRole("radio", { name: "当前图片" })).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "开始转换" })); expect(convert).toHaveBeenCalledWith("reconvert", ["completed"]);
  expect(document.querySelectorAll(".command-action").length).toBeLessThanOrEqual(1);
});
it("converts a temporary selection even when the project is otherwise up to date", async () => {
  const user = userEvent.setup(); const convert = vi.fn();
  render(<CommandBar {...defaults} selectionMode selectedCount={1} onConvert={convert} status={{ ...status, pendingImages: 0, nextAction: "upToDate" }} />);
  expect(screen.getByRole("status")).toHaveTextContent("已选择 1 张");
  await user.click(screen.getByRole("button", { name: "转换 1 张图片" })); expect(convert).toHaveBeenCalledWith("selected", undefined);
});
