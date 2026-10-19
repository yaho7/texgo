import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import AssetPreview from "../src/AssetPreview";
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

it("defaults to the original and compares it overlaid on the real PDF only on request", async () => {
  const user = userEvent.setup();
  render(<AssetPreview asset={asset} result={result} revision={1} />);
  expect(await screen.findByAltText("原始：a.png")).toBeInTheDocument();
  expect(ipc.invoke).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("radio", { name: "对比" }));
  expect(await screen.findByLabelText("真实 PDF")).toHaveTextContent("pdf-a");
  expect(screen.getByAltText("原始：a.png")).toBeInTheDocument();
  expect(screen.getByText(/节省 50%/)).toBeInTheDocument();
});

it("does not enable comparison for failed, cancelled, or mismatched results", () => {
  const view = render(<AssetPreview asset={asset} result={{ ...result, error: "failed" }} revision={1} />);
  expect(screen.getByRole("radio", { name: "对比" })).toBeDisabled();
  view.rerender(<AssetPreview asset={asset} result={{ ...result, cancelled: true }} revision={1} />);
  expect(screen.getByRole("radio", { name: "对比" })).toBeDisabled();
  view.rerender(<AssetPreview asset={asset} result={{ ...result, id: "other" }} revision={1} />);
  expect(screen.getByRole("radio", { name: "对比" })).toBeDisabled();
});

it("ignores a late response and resets comparison when changing assets", async () => {
  let resolve!: (data: AssetPreviewData) => void;
  ipc.invoke.mockImplementationOnce(() => new Promise<AssetPreviewData>((done) => { resolve = done; }));
  const view = render(<AssetPreview asset={asset} result={result} revision={1} />);
  const next = { ...asset, id: "b", path: "/b.png", relativePath: "b.png" };
  view.rerender(<AssetPreview asset={next} revision={1} />);
  await screen.findByAltText("原始：b.png");
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
  await screen.findByAltText("原始：a.png");
  await userEvent.click(screen.getByRole("radio", { name: "对比" }));
  expect(screen.getByAltText("原始：a.png")).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("正在载入 PDF");
  await act(async () => reject(new Error("PDF unavailable")));
  expect(screen.getByRole("alert")).toHaveTextContent("PDF unavailable");
  expect(screen.getByAltText("原始：a.png")).toBeVisible();
});

it("resets a selected comparison on asset change and ignores its late PDF", async () => {
  let resolve!: (value: AssetPreviewData) => void;
  ipc.invoke.mockImplementation((_command, { converted }) => converted
    ? new Promise<AssetPreviewData>((done) => { resolve = done; })
    : Promise.resolve({ kind: "image", data: "data:image/png;base64,YQ==" }));
  const view = render(<AssetPreview asset={asset} result={result} revision={1} />);
  await screen.findByAltText("原始：a.png");
  await userEvent.click(screen.getByRole("radio", { name: "对比" }));
  view.rerender(<AssetPreview asset={{ ...asset, id: "b", path: "/b.png", relativePath: "b.png" }} result={{ ...result, id: "b", pdfPath: "/b.pdf" }} revision={1} />);
  await screen.findByAltText("原始：b.png");
  await act(async () => resolve({ kind: "pdf", data: "stale-pdf-a" }));
  expect(screen.queryByLabelText("真实 PDF")).not.toBeInTheDocument();
  expect(screen.getByRole("radio", { name: "原图" })).toHaveAttribute("aria-checked", "true");
});

it("toggles comparison with Space only after a successful result", async () => {
  const view = render(<AssetPreview asset={asset} revision={1} />);
  await screen.findByAltText("原始：a.png");
  expect(fireEvent.keyDown(screen.getByRole("region", { name: "图片预览" }), { key: " ", code: "Space" })).toBe(true);
  expect(screen.getByRole("radio", { name: "原图" })).toHaveAttribute("aria-checked", "true");
  view.rerender(<AssetPreview asset={asset} result={result} revision={1} />);
  expect(fireEvent.keyDown(screen.getByRole("region", { name: "图片预览" }), { key: " ", code: "Space" })).toBe(false);
  expect(await screen.findByLabelText("真实 PDF")).toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole("region", { name: "图片预览" }), { key: " ", code: "Space", repeat: true });
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
  render(<><AssetPreview asset={asset} result={result} revision={1} />{control}</>);
  await screen.findByAltText("原始：a.png");
  const focus = screen.getByLabelText("protected");
  focus.focus();
  expect(fireEvent.keyDown(focus, { key: " ", code: "Space" })).toBe(true);
  expect(screen.getByRole("radio", { name: "原图" })).toHaveAttribute("aria-checked", "true");
});


it("drags and resets a shared comparison divider and scopes keyboard input to preview", async () => {
  render(<AssetPreview asset={asset} result={result} revision={1} />);
  await screen.findByAltText("原始：a.png");
  fireEvent.keyDown(document.body, { key: " " });
  expect(screen.queryByRole("slider")).not.toBeInTheDocument();
  const preview = screen.getByRole("region", { name: "图片预览" });
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
