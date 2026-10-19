import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import ConversionPanel from "../src/ConversionPanel";
import Home from "../src/Home";

function props() {
  return { settings: { dpi: "300", jpegQuality: "90", outputDir: "figures-pdf" }, selectedCount: 2, busy: false, converting: false, canReview: false, undoAvailable: false, activeAsset: null, root: "/work", directoryMode: false, onSettings: vi.fn(), onConvert: vi.fn(), onReview: vi.fn(), onUndo: vi.fn() };
}

it("keeps settings collapsed with a compact summary and expands invalid settings before submitting", async () => {
  const p = props();
  const view = render(<ConversionPanel {...p} />);
  const settings = screen.getByText("输出设置").closest("details")!;
  expect(settings).not.toHaveAttribute("open");
  expect(settings.querySelector("summary")).toHaveTextContent("300 DPI · 90% · figures-pdf");
  view.rerender(<ConversionPanel {...p} settings={{ ...p.settings, dpi: "0" }} />);
  let frame: FrameRequestCallback | undefined;
  const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { frame = callback; return 1; });
  await userEvent.click(screen.getByRole("button", { name: "转换 2 张" }));
  expect(settings).toHaveAttribute("open");
  expect(screen.getByLabelText("分辨率 (DPI)")).toBeVisible();
  expect(p.onConvert).not.toHaveBeenCalled();
  act(() => frame!(0));
  expect(p.onConvert).toHaveBeenCalledOnce();
  raf.mockRestore();
});

it("uses one state-driven primary action without a permanent undo action", async () => {
  const p = props();
  const view = render(<ConversionPanel {...p} canReview />);
  await userEvent.click(screen.getByRole("button", { name: "转换 2 张" }));
  expect(p.onConvert).toHaveBeenCalledOnce();
  expect(screen.queryByRole("button", { name: "检查引用变更" })).not.toBeInTheDocument();
  view.rerender(<ConversionPanel {...p} selectedCount={0} canReview />);
  await userEvent.click(screen.getByRole("button", { name: "检查引用变更" }));
  expect(p.onReview).toHaveBeenCalledOnce();
  view.rerender(<ConversionPanel {...p} selectedCount={0} undoAvailable />);
  expect(screen.getByRole("button", { name: "已完成" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "撤销替换" })).not.toBeInTheDocument();
  expect(p.onUndo).not.toHaveBeenCalled();
  view.rerender(<ConversionPanel {...p} selectedCount={0} />);
  expect(screen.getByRole("button", { name: "请选择图片" })).toBeDisabled();
});

it("applies presets and recognizes manual custom values", async () => {
  const p = props();
  function ControlledPanel() {
    const [settings, setSettings] = useState(p.settings);
    return <ConversionPanel {...p} settings={settings} onSettings={setSettings} />;
  }
  render(<ControlledPanel />);
  await userEvent.click(screen.getByText("输出设置"));
  expect(screen.getByRole("radio", { name: "平衡" })).toHaveAttribute("aria-checked", "true");
  expect(screen.queryByLabelText("分辨率 (DPI)")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("radio", { name: "无损" }));
  expect(screen.getByText(/300 DPI · 100%/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("radio", { name: "小体积" }));
  expect(screen.queryByLabelText("质量 (%)")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("radio", { name: "自定义" }));
  expect(screen.getByLabelText("分辨率 (DPI)")).toHaveValue(150);
  expect(screen.getByLabelText("质量 (%)")).toHaveValue(75);
  await userEvent.clear(screen.getByLabelText("分辨率 (DPI)"));
  await userEvent.type(screen.getByLabelText("分辨率 (DPI)"), "300");
  await userEvent.clear(screen.getByLabelText("质量 (%)"));
  await userEvent.type(screen.getByLabelText("质量 (%)"), "90");
  expect(screen.getByRole("radio", { name: "自定义" })).toHaveAttribute("aria-checked", "true");
  expect(screen.getByLabelText("质量 (%)")).toHaveValue(90);
  await userEvent.click(screen.getByRole("radio", { name: "平衡" }));
  expect(screen.queryByLabelText("质量 (%)")).not.toBeInTheDocument();
});

it("opens only the main tex file or image batch entry on Home", async () => {
  const p = { busy: false, onOpenTex: vi.fn(), onOpenDirectory: vi.fn() };
  render(<Home {...p} />);
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "打开 .tex 主文件" }));
  await userEvent.click(screen.getByRole("button", { name: "批量转换图片" }));
  expect(p.onOpenTex).toHaveBeenCalledOnce();
  expect(p.onOpenDirectory).toHaveBeenCalledOnce();
});

it("locks conversion and settings while converting and collapses reference locations", async () => {
  const p = props();
  render(<ConversionPanel {...p} converting activeAsset={{ id: "a", path: "/work/a.png", relativePath: "a.png", format: "png", width: 10, height: 10, bytes: 10, status: "ready", message: null, references: [{ file: "/work/main.tex", line: 7, original: "a", start: 0, end: 1 }] }} />);
  expect(screen.getByRole("button", { name: "正在转换…" })).toBeDisabled();
  await userEvent.click(screen.getByText("输出设置"));
  expect(screen.getByRole("radio", { name: "自定义" })).toBeDisabled();
  const references = screen.getByText("引用位置").closest("details")!;
  expect(references).not.toHaveAttribute("open");
  await userEvent.click(screen.getByText("引用位置"));
  expect(screen.getByText("第 7 行")).toBeVisible();
});
