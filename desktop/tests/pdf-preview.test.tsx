import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import PdfPreview from "../src/PdfPreview";

const pdf = vi.hoisted(() => ({
  getDocument: vi.fn(),
  getPage: vi.fn(),
  render: vi.fn(),
  destroy: vi.fn(),
}));

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({ getDocument: pdf.getDocument, GlobalWorkerOptions: {} }));

beforeEach(() => {
  pdf.destroy.mockResolvedValue(undefined);
  pdf.getDocument.mockReturnValue({ promise: Promise.resolve({ numPages: 2, getPage: pdf.getPage }), destroy: pdf.destroy });
  pdf.getPage.mockResolvedValue({
    getViewport: ({ scale }: { scale: number }) => ({ width: 100 * scale, height: 60 * scale }),
    render: pdf.render,
  });
  pdf.render.mockReturnValue({ promise: Promise.resolve(), cancel: vi.fn() });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as CanvasRenderingContext2D);
});

it("fits the first page of a PDF without viewer controls", async () => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(648);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(332);
  render(<PdfPreview data="cGRm" label="plot.pdf" />);
  expect(await screen.findByRole("img", { name: "plot.pdf，第 1 页" })).toHaveStyle({ width: "500px", height: "300px" });
  expect(pdf.getPage).toHaveBeenCalledExactlyOnceWith(1);
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

it("destroys the previous document when the data changes", async () => {
  const view = render(<PdfPreview data="cGRm" label="plot.pdf" />);
  await screen.findByRole("img", { name: "plot.pdf，第 1 页" });
  view.rerender(<PdfPreview data="bmV3" label="new.pdf" />);
  await screen.findByRole("img", { name: "new.pdf，第 1 页" });
  expect(pdf.destroy).toHaveBeenCalledTimes(1);
  expect(pdf.getDocument).toHaveBeenCalledTimes(2);
});

it("refits on resize and retains the previous canvas until the next render completes", async () => {
  vi.stubGlobal("ResizeObserver", undefined);
  try {
    const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(648);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(332);
    const { container } = render(<PdfPreview data="cGRm" label="plot.pdf" />);
    const painted = await screen.findByRole("img");
    let resolve!: () => void;
    pdf.render.mockReturnValueOnce({ promise: new Promise<void>((done) => { resolve = done; }), cancel: vi.fn() });
    width.mockReturnValue(248);
    fireEvent.resize(window);
    await waitFor(() => expect(pdf.render).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("img")).toBe(painted);
    await act(async () => resolve());
    expect(screen.getByRole("img")).toHaveStyle({ width: "200px", height: "120px" });
    expect(container.querySelector(".pdf-canvas-host")).toHaveAttribute("aria-busy", "false");
    expect(pdf.getDocument).toHaveBeenCalledTimes(1);
  } finally { vi.unstubAllGlobals(); }
});

it("reports render failure to the retaining inspector", async () => {
  const failed = vi.fn(); pdf.render.mockImplementationOnce(() => ({ promise: Promise.reject(new Error("PDF render failed")), cancel: vi.fn() }));
  render(<PdfPreview data="cGRm" label="plot.pdf" onError={failed} />);
  await waitFor(() => expect(failed).toHaveBeenCalledWith("PDF render failed"));
});

it("renders an overlay in the shared frame", async () => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1200);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(720);
  const ready = vi.fn();
  const { container } = render(<PdfPreview data="cGRm" label="plot.pdf" overlay onReady={ready} />);
  await waitFor(() => expect(ready).toHaveBeenCalled());
  expect(container.querySelector("canvas")).toHaveStyle({ width: "100%", height: "100%" });
  expect(pdf.render).toHaveBeenLastCalledWith(expect.objectContaining({ viewport: { width: 1200, height: 720 } }));
});
