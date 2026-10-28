import { act, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import AssetPreview from "../src/AssetPreview";
import previewCss from "../src/preview.css?raw";
import type { AssetPreviewData, ImageAsset, ImageResult } from "../src/types";

const ipc = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: ipc.invoke }));
vi.mock("../src/PdfPreview", () => ({ default: ({ data }: { data: string }) => <div aria-label="真实 PDF">{data}</div> }));

const asset: ImageAsset = { id: "a", path: "/a.png", relativePath: "a.png", format: "png", width: 100, height: 80, bytes: 1000, status: "ready", message: null, references: [] };
const result: ImageResult = { id: "a", pdfPath: "/a.pdf", bytes: 500, cached: false, error: null };

beforeEach(() => {
  ipc.invoke.mockReset();
  ipc.invoke.mockImplementation((_command, { converted }) => Promise.resolve({ kind: converted ? "pdf" : "image", data: converted ? "pdf-a" : "data:image/png;base64,YQ==" }));
});


async function loadOriginal(name: string) {
  const image = await screen.findByAltText(`原始：${name}`);
  fireEvent.load(image);
  return image;
}

it("defaults to the original and compares it overlaid on the real PDF only on request", async () => {
  const user = userEvent.setup();
  render(<AssetPreview asset={asset} result={result} revision={1} />);
  expect(await loadOriginal("a.png")).toBeInTheDocument();
  expect(ipc.invoke).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("radio", { name: "对比" }));
  expect(await screen.findByLabelText("真实 PDF")).toHaveTextContent("pdf-a");
  expect(screen.getByAltText("原始：a.png")).toBeInTheDocument();
  expect(screen.queryByText(/节省 50%/)).not.toBeInTheDocument();
});

it("does not enable comparison for failed, cancelled, or mismatched results", () => {
  const view = render(<AssetPreview asset={asset} result={{ ...result, error: "failed" }} revision={1} />);
  expect(screen.getByRole("radio", { name: "对比" })).toBeDisabled();
  expect(screen.getByRole("radio", { name: "PDF" })).toBeDisabled();
  view.rerender(<AssetPreview asset={asset} result={{ ...result, cancelled: true }} revision={1} />);
  expect(screen.getByRole("radio", { name: "对比" })).toBeDisabled();
  expect(screen.getByRole("radio", { name: "PDF" })).toBeDisabled();
  view.rerender(<AssetPreview asset={asset} result={{ ...result, id: "other" }} revision={1} />);
  expect(screen.getByRole("radio", { name: "对比" })).toBeDisabled();
  expect(screen.getByRole("radio", { name: "PDF" })).toBeDisabled();
});

it("ignores a late response when changing assets", async () => {
  let resolve!: (data: AssetPreviewData) => void;
  ipc.invoke.mockImplementationOnce(() => new Promise<AssetPreviewData>((done) => { resolve = done; }));
  const view = render(<AssetPreview asset={asset} result={result} revision={1} />);
  const next = { ...asset, id: "b", path: "/b.png", relativePath: "b.png" };
  view.rerender(<AssetPreview asset={next} revision={1} />);
  await loadOriginal("b.png");
  await act(async () => resolve({ kind: "image", data: "stale-a" }));
  expect(screen.getByAltText("原始：b.png")).not.toHaveAttribute("src", "stale-a");
  await waitFor(() => expect(screen.getByRole("radio", { name: "原图" })).toHaveAttribute("data-state", "on"));
});

it("keeps the original visible during a pending or failed PDF request", async () => {
  let reject!: (error: Error) => void;
  ipc.invoke.mockImplementation((_command, { converted }) => converted
    ? new Promise((_resolve, fail) => { reject = fail; })
    : Promise.resolve({ kind: "image", data: "data:image/png;base64,YQ==" }));
  render(<AssetPreview asset={asset} result={result} revision={1} />);
  await loadOriginal("a.png");
  await userEvent.click(screen.getByRole("radio", { name: "对比" }));
  expect(screen.getByAltText("原始：a.png")).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("正在载入 PDF");
  await act(async () => reject(new Error("PDF unavailable")));
  expect(screen.getByRole("alert")).toHaveTextContent("PDF unavailable");
  expect(screen.getByAltText("原始：a.png")).toBeVisible();
});

it("preserves comparison mode and divider across image changes and refresh", async () => {
  const view = render(<AssetPreview asset={asset} result={result} revision={1} />);
  await loadOriginal("a.png");
  await userEvent.click(screen.getByRole("radio", { name: "对比" }));
  const preview = screen.getByRole("region", { name: "图片预览" });
  fireEvent.keyDown(preview, { key: "ArrowRight", shiftKey: true });
  expect(screen.getByRole("slider")).toHaveAttribute("aria-valuenow", "60");
  const next = { ...asset, id: "b", path: "/b.png", relativePath: "b.png" };
  view.rerender(<AssetPreview asset={next} result={{ ...result, id: "b", pdfPath: "/b.pdf" }} revision={2} />);
  await loadOriginal("b.png");
  expect(screen.getByRole("radio", { name: "对比" })).toHaveAttribute("aria-checked", "true");
  expect(screen.getByRole("slider")).toHaveAttribute("aria-valuenow", "60");
  view.rerender(<AssetPreview asset={{ ...next }} result={{ ...result, id: "b", pdfPath: "/b.pdf" }} revision={3} />);
  expect(screen.getByRole("slider")).toHaveAttribute("aria-valuenow", "60");
});

it("cycles original, PDF, comparison with Space only after a successful result", async () => {
  const view = render(<AssetPreview asset={asset} revision={1} />);
  await loadOriginal("a.png");
  expect(fireEvent.keyDown(screen.getByRole("region", { name: "图片预览" }), { key: " ", code: "Space" })).toBe(true);
  expect(screen.getByRole("radio", { name: "原图" })).toHaveAttribute("aria-checked", "true");
  view.rerender(<AssetPreview asset={asset} result={result} revision={1} />);
  expect(fireEvent.keyDown(screen.getByRole("region", { name: "图片预览" }), { key: " ", code: "Space" })).toBe(false);
  expect(await screen.findByLabelText("真实 PDF")).toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole("region", { name: "图片预览" }), { key: " ", code: "Space", repeat: true });
  expect(screen.getByRole("radio", { name: "PDF" })).toHaveAttribute("aria-checked", "true");
  expect(screen.queryByRole("slider")).not.toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole("region", { name: "图片预览" }), { key: " ", code: "Space" });
  expect(screen.getByRole("radio", { name: "对比" })).toHaveAttribute("aria-checked", "true");
  fireEvent.keyDown(screen.getByRole("region", { name: "图片预览" }), { key: " ", code: "Space" });
  expect(screen.queryByLabelText("真实 PDF")).not.toBeInTheDocument();
});

it.each([
  ["input", <input aria-label="protected" />],
  ["textarea", <textarea aria-label="protected" />],
  ["select", <select aria-label="protected"><option>A</option></select>],
  ["button", <button aria-label="protected">A</button>],
  ["editable descendant", <div contentEditable suppressContentEditableWarning><span tabIndex={0} aria-label="protected">A</span></div>],
  ["dialog", <div role="dialog"><div tabIndex={0} aria-label="protected" /></div>],
  ["menu", <div role="menu"><div tabIndex={0} aria-label="protected" /></div>],
])("does not consume Space while focused in %s", async (_name, control) => {
  render(<AssetPreview asset={asset} result={result} revision={1} />);
  const protectedControl = render(control);
  screen.getByRole("region", { name: "图片预览" }).appendChild(protectedControl.container);
  await loadOriginal("a.png");
  const focus = screen.getByLabelText("protected");
  focus.focus();
  expect(fireEvent.keyDown(focus, { key: " ", code: "Space" })).toBe(true);
  expect(screen.getByRole("radio", { name: "原图" })).toHaveAttribute("aria-checked", "true");
});


it("drags and resets a shared comparison divider and scopes keyboard input to preview", async () => {
  render(<AssetPreview asset={asset} result={result} revision={1} />);
  await loadOriginal("a.png");
  fireEvent.keyDown(document.body, { key: " " });
  expect(screen.queryByRole("slider")).not.toBeInTheDocument();
  const preview = screen.getByRole("region", { name: "图片预览" });
  fireEvent.keyDown(preview, { key: " " });
  fireEvent.keyDown(preview, { key: " " });
  const slider = screen.getByRole("slider", { name: "原图与 PDF 分隔线" });
  expect(slider).toHaveAttribute("aria-valuenow", "50");
  fireEvent.keyDown(slider, { key: "ArrowRight" });
  expect(slider).toHaveAttribute("aria-valuenow", "51");
  fireEvent.keyDown(slider, { key: "ArrowLeft", shiftKey: true });
  expect(slider).toHaveAttribute("aria-valuenow", "41");
  fireEvent.keyDown(slider, { key: "0" });
  expect(slider).toHaveAttribute("aria-valuenow", "50");
  vi.spyOn(slider.parentElement!, "getBoundingClientRect").mockReturnValue({ left: 0, width: 200 } as DOMRect);
  let captured = false;
  slider.setPointerCapture = () => { captured = true; };
  slider.hasPointerCapture = () => captured;
  slider.releasePointerCapture = () => { captured = false; };
  fireEvent.pointerDown(slider, { clientX: 160, pointerId: 1 });
  expect(slider).toHaveAttribute("aria-valuenow", "80");
  fireEvent.pointerMove(slider, { clientX: 40, pointerId: 1 });
  expect(slider).toHaveAttribute("aria-valuenow", "20");
  fireEvent.pointerUp(slider, { pointerId: 1 });
  fireEvent.pointerMove(slider, { clientX: 100, pointerId: 1 });
  expect(slider).toHaveAttribute("aria-valuenow", "20");
  fireEvent.doubleClick(slider);
  expect(slider).toHaveAttribute("aria-valuenow", "50");
  fireEvent.keyDown(preview, { key: "Escape" });
  expect(screen.queryByRole("slider")).not.toBeInTheDocument();
});

it("places the original on the left and clips the PDF on the right", async () => {
  const { container } = render(<AssetPreview asset={asset} result={result} revision={1} />);
  await loadOriginal("a.png");
  await userEvent.click(screen.getByRole("radio", { name: "对比" }));
  expect(container.querySelector(".comparison-label-left")).toHaveTextContent("原图");
  expect(container.querySelector(".comparison-label-right")).toHaveTextContent("PDF");
  fireEvent.keyDown(screen.getByRole("slider"), { key: "ArrowRight", shiftKey: true });
  expect(container.querySelector(".comparison-clip")).toHaveStyle({ clipPath: "inset(0 0 0 60%)" });
});

it("keeps a dimmed previous image until the next source has loaded", async () => {
  let resolve!: (value: AssetPreviewData) => void;
  const view = render(<AssetPreview asset={asset} revision={1} />);
  await loadOriginal("a.png");
  ipc.invoke.mockImplementationOnce(() => new Promise<AssetPreviewData>((done) => { resolve = done; }));
  view.rerender(<AssetPreview asset={{ ...asset, id: "b", path: "/b.png", relativePath: "b.png" }} revision={1} />);
  expect(screen.getByAltText("原始：a.png").closest(".preview-content-frame")).toHaveAttribute("data-stale", "true");
  expect(screen.queryByText("正在载入原图…")?.closest(".preview-placeholder")).toBeFalsy();
  await act(async () => resolve({ kind: "image", data: "data:image/png;base64,Yg==" }));
  expect(screen.getByAltText("上一张：a.png")).toBeInTheDocument();
  await loadOriginal("b.png");
  expect(screen.queryByAltText("上一张：a.png")).not.toBeInTheDocument();
});

it("shows reference locations directly without a disclosure", async () => {
  render(<AssetPreview root="/project" asset={{ ...asset, references: [{ file: "/project/chapter1.tex", line: 128, original: "a.png", start: 0, end: 5 }] }} revision={1} />);
  expect(await screen.findByText("chapter1.tex")).toBeInTheDocument();
  expect(screen.getByText(":128")).toBeInTheDocument();
});

it("only enters repair after an explicit inspector action", async () => {
  const locate = vi.fn(); const ignore = vi.fn();
  render(<AssetPreview asset={{ ...asset, path: null, status: "missing", message: "源文件不存在" }} revision={1} onLocate={locate} onIgnore={ignore} />);
  expect(locate).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "定位文件" }));
  expect(locate).toHaveBeenCalledWith("a");
  await userEvent.click(screen.getByRole("button", { name: "当前图片操作" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "忽略本次" }));
  expect(ignore).toHaveBeenCalledWith("a", "session");
});

it("disables inspector mutations while the project is busy", () => {
  render(<AssetPreview asset={{ ...asset, status: "missing", path: null }} revision={1} busy onLocate={vi.fn()} onIgnore={vi.fn()} />);
  expect(screen.getByRole("button", { name: "定位文件" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "当前图片操作" })).toBeDisabled();
});


it("retains permanent ignore while explicitly requesting one manual conversion", async () => {
  const convert = vi.fn(); const ignore = vi.fn();
  render(<AssetPreview asset={{ ...asset, ignoreMode: "permanent" }} revision={1} onIgnore={ignore} onManualConvert={convert} canConvert />);
  await userEvent.click(screen.getByRole("button", { name: "当前图片操作" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "手动处理一次" }));
  expect(convert).toHaveBeenCalledWith("a"); expect(ignore).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "当前图片操作" }));
  expect(screen.getByRole("menuitem", { name: "恢复处理" })).toBeInTheDocument();
  expect(screen.queryByRole("menuitem", { name: "始终忽略" })).not.toBeInTheDocument();
});


it("shows PDF alone and falls back safely when its matching result becomes invalid", async () => {
  const view = render(<AssetPreview asset={asset} result={result} revision={1} />);
  await loadOriginal("a.png");
  await userEvent.click(screen.getByRole("radio", { name: "PDF" }));
  expect(await screen.findByLabelText("真实 PDF")).toBeVisible();
  expect(screen.queryByRole("slider")).not.toBeInTheDocument();
  expect(screen.getByLabelText("原图预览")).not.toBeVisible();
  view.rerender(<AssetPreview asset={asset} result={{ ...result, cancelled: true }} revision={1} />);
  expect(screen.getByRole("radio", { name: "PDF" })).toBeDisabled();
  expect(screen.getByRole("radio", { name: "原图" })).toHaveAttribute("aria-checked", "true");
  expect(screen.getByLabelText("原图预览")).toBeVisible();
});

it("fits without enlarging a small source and uses native pixels at 100%", async () => {
  const { container } = render(<AssetPreview asset={asset} revision={1} />);
  await loadOriginal("a.png");
  expect(container.querySelector(".comparison-frame")).toHaveStyle({ width: "100px", height: "80px" });
  await userEvent.click(screen.getByRole("radio", { name: "100%" }));
  expect(container.querySelector(".comparison-frame")).toHaveStyle({ width: "100px", height: "80px" });
});

it("caps fit using natural image dimensions when metadata is unknown", async () => {
  const { container } = render(<AssetPreview asset={{ ...asset, width: null, height: null }} revision={1} />);
  const image = await screen.findByAltText("原始：a.png");
  Object.defineProperties(image, { naturalWidth: { value: 24 }, naturalHeight: { value: 16 } });
  fireEvent.load(image);
  expect(container.querySelector(".comparison-frame")).toHaveStyle({ width: "24px", height: "16px" });
});

it("uses one scrollable geometry for oversized sources and PDF comparison", async () => {
  const { container } = render(<AssetPreview asset={{ ...asset, width: 1200, height: 800 }} result={result} revision={1} />);
  await loadOriginal("a.png");
  await userEvent.click(screen.getByRole("radio", { name: "100%" }));
  await userEvent.click(screen.getByRole("radio", { name: "对比" }));
  const frames = container.querySelectorAll(".comparison-frame");
  expect(frames).toHaveLength(2);
  for (const frame of frames) expect(frame).toHaveStyle({ width: "1200px", height: "800px" });
  expect(frames[0].parentElement).toHaveClass("preview-artboard");
  expect(container.querySelector(".comparison-clip")?.parentElement).toBe(frames[0].parentElement);
  expect(container.querySelector(".preview-surface")).toHaveAttribute("data-scale", "actual");
});

it.each([{ altKey: true }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { isComposing: true }])("does not cycle with guarded key input %j", async (modifiers) => {
  render(<AssetPreview asset={asset} result={result} revision={1} />);
  await loadOriginal("a.png");
  fireEvent.keyDown(screen.getByRole("region", { name: "图片预览" }), { key: " ", ...modifiers });
  expect(screen.getByRole("radio", { name: "原图" })).toHaveAttribute("aria-checked", "true");
});


it("uses original metadata pixels for 100% even when the preview bitmap is a thumbnail", async () => {
  const { container } = render(<AssetPreview asset={{ ...asset, width: 2400, height: 1600 }} revision={1} />);
  const image = await screen.findByAltText("原始：a.png");
  Object.defineProperties(image, { naturalWidth: { value: 1200 }, naturalHeight: { value: 800 } });
  fireEvent.load(image);
  await userEvent.click(screen.getByRole("radio", { name: "100%" }));
  expect(container.querySelector(".comparison-frame")).toHaveStyle({ width: "2400px", height: "1600px" });
});

it("keeps PDF mode through refresh and rename, and Escape returns to original", async () => {
  const view = render(<AssetPreview asset={asset} result={result} revision={1} />);
  await loadOriginal("a.png");
  await userEvent.click(screen.getByRole("radio", { name: "PDF" }));
  view.rerender(<AssetPreview asset={{ ...asset, relativePath: "renamed.png", path: "/renamed.png" }} result={result} revision={2} />);
  expect(screen.getByRole("radio", { name: "PDF" })).toHaveAttribute("aria-checked", "true");
  fireEvent.keyDown(screen.getByRole("region", { name: "图片预览" }), { key: "Escape" });
  expect(screen.getByRole("radio", { name: "原图" })).toHaveAttribute("aria-checked", "true");
});


it("keeps native PDF sources in a useful standalone frame without competing raster zoom controls", async () => {
  ipc.invoke.mockResolvedValue({ kind: "pdf", data: "native-pdf" });
  const { container } = render(<AssetPreview asset={{ ...asset, format: "pdf", status: "pdf", width: null, height: null }} revision={1} />);
  expect(await screen.findByLabelText("真实 PDF")).toHaveTextContent("native-pdf");
  expect(container.querySelector(".comparison-frame")).toHaveStyle({ width: "480px", height: "240px" });
  expect(screen.queryByRole("radiogroup", { name: "预览缩放" })).not.toBeInTheDocument();
});

it("keeps loading and failure messages readable before unknown image dimensions arrive", async () => {
  ipc.invoke.mockRejectedValue(new Error("source unreadable"));
  const { container } = render(<AssetPreview asset={{ ...asset, width: null, height: null }} revision={1} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("source unreadable");
  expect(container.querySelector(".comparison-frame")).toHaveStyle({ width: "452px", height: "212px" });
});


it.each([false, true])("retains the previous bitmap and its size while an unknown-size source is pending or fails (reject=%s)", async (rejectRequest) => {
  let reject!: (reason: Error) => void;
  const view = render(<><style>{previewCss}</style><AssetPreview asset={asset} revision={1} /></>);
  await loadOriginal("a.png");
  ipc.invoke.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  const next = { ...asset, id: "b", path: "/b.png", relativePath: "b.png", width: null, height: null };
  view.rerender(<><style>{previewCss}</style><AssetPreview asset={next} revision={1} /></>);
  const previous = screen.getByAltText("原始：a.png");
  expect(previous).toBeVisible();
  expect(previous).toHaveStyle({ maxWidth: "100px", maxHeight: "80px", objectFit: "contain" });
  if (rejectRequest) {
    await act(async () => reject(new Error("new source unreadable")));
    expect(screen.getByRole("alert")).toHaveTextContent("new source unreadable");
    expect(previous).toBeVisible();
  }
});

it("centers an explicit switch to 100% and keeps the pan position on refresh", async () => {
  const view = render(<AssetPreview asset={{ ...asset, width: 1200, height: 800 }} revision={1} />);
  await loadOriginal("a.png");
  const surface = view.container.querySelector<HTMLDivElement>(".preview-surface")!;
  Object.defineProperties(surface, { scrollWidth: { value: 1228 }, scrollHeight: { value: 828 }, clientWidth: { value: 480 }, clientHeight: { value: 240 } });
  await userEvent.click(screen.getByRole("radio", { name: "100%" }));
  expect(surface.scrollLeft).toBe(374);
  expect(surface.scrollTop).toBe(294);
  surface.scrollLeft = 200; surface.scrollTop = 150;
  view.rerender(<AssetPreview asset={{ ...asset, width: 1200, height: 800, relativePath: "renamed.png" }} revision={2} />);
  expect(surface.scrollLeft).toBe(200);
  expect(surface.scrollTop).toBe(150);
});

it("retains natural dimensions for the prior unknown-size source while hiding the incoming bitmap", async () => {
  let resolve!: (value: AssetPreviewData) => void;
  const view = render(<AssetPreview asset={{ ...asset, width: null, height: null }} revision={1} />);
  const original = await screen.findByAltText("原始：a.png");
  Object.defineProperties(original, { naturalWidth: { value: 24 }, naturalHeight: { value: 16 } });
  fireEvent.load(original);
  ipc.invoke.mockImplementationOnce(() => new Promise<AssetPreviewData>((done) => { resolve = done; }));
  view.rerender(<AssetPreview asset={{ ...asset, id: "b", path: "/b.png", relativePath: "b.png", width: null, height: null }} revision={1} />);
  expect(screen.getByAltText("原始：a.png")).toHaveStyle({ maxWidth: "24px", maxHeight: "16px" });
  await act(async () => resolve({ kind: "image", data: "data:image/png;base64,Yg==" }));
  const previous = screen.getByAltText("上一张：a.png");
  expect(previous).toHaveStyle({ maxWidth: "24px", maxHeight: "16px" });
  const hiddenIncoming = view.container.querySelector('.comparison-frame[data-native-known="false"] .preview-content-frame[data-stale="false"] .image-stage img');
  expect(hiddenIncoming).toBe(screen.getByAltText("原始：b.png"));
  expect(previous).not.toBe(hiddenIncoming);
});


it("groups references by full file path without losing line locations or inventing output for a failed conversion", async () => {
  render(<AssetPreview asset={{ ...asset, references: [
    { file: "/paper/a/chapter.tex", line: 2, original: "a.png", start: 0, end: 5 },
    { file: "/paper/a/chapter.tex", line: 20, original: "a.png", start: 10, end: 15 },
    { file: "/paper/b/chapter.tex", line: 9, original: "a.png", start: 0, end: 5 },
  ] }} revision={1} result={{ ...result, error: "conversion failed" }} />);
  const references = screen.getByRole("region", { name: "引用与输出" });
  expect(within(references).getByText("/paper/a/chapter.tex")).toBeInTheDocument();
  expect(within(references).getByText("/paper/b/chapter.tex")).toBeInTheDocument();
  expect(within(references).getByText(":2, 20")).toBeInTheDocument();
  expect(within(references).getByText(":9")).toBeInTheDocument();
  expect(screen.queryByText("输出")).not.toBeInTheDocument();
});


it("leads inspector details with the filename and compact metadata", () => {
  render(<AssetPreview asset={{ ...asset, width: 2400, height: 1600 }} revision={1} />);
  expect(screen.getByText(/2400 × 1600 · PNG/)).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "预览" })).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "a.png" })).toBeInTheDocument();
  expect(screen.queryByText("PNG")).not.toBeInTheDocument();
});

it("keeps fractional fit viewports inside their content box without introducing scrollbars", async () => {
  let resized: ResizeObserverCallback = () => {};
  const observer: ResizeObserver = { observe() {}, unobserve() {}, disconnect() {} };
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: ResizeObserverCallback) { resized = callback; }
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  try {
    const { container } = render(<AssetPreview asset={asset} result={result} revision={1} />);
    await loadOriginal("a.png");
    const surface = container.querySelector(".preview-surface")!;
    act(() => resized([{ target: surface, contentRect: new DOMRect(0, 0, 417.5, 389.5), borderBoxSize: [], contentBoxSize: [], devicePixelContentBoxSize: [] }], observer));
    expect(container.querySelector(".preview-artboard")).toHaveStyle({ width: "417px", height: "389px" });
  } finally { vi.unstubAllGlobals(); }
});


it("keeps preview versions and zoom in the same viewer toolbar", () => {
  const {container} = render(<AssetPreview asset={asset} revision={1} result={result} />);
  const toolbar = container.querySelector(".preview-controls")!;
  expect(within(toolbar as HTMLElement).getByRole("radio", {name:"原图", exact:true})).toBeInTheDocument();
  expect(within(toolbar as HTMLElement).getByRole("radio", {name:"适应窗口", exact:true})).toBeInTheDocument();
  expect(within(toolbar as HTMLElement).getByRole("radio", {name:"100%", exact:true})).toBeInTheDocument();
  expect(toolbar.parentElement).toBe(container.querySelector(".preview-surface")?.parentElement);
  expect(toolbar.querySelector('[aria-hidden="true"]')).toHaveTextContent("|");
});
