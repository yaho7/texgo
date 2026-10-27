import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { TooltipProvider } from "../src/controls/tooltip";
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

it("parses the document once while zooming and switching pages", async () => {
  const user = userEvent.setup();
  render(<TooltipProvider><PdfPreview data="cGRm" label="plot.pdf" /></TooltipProvider>);
  await waitFor(() => expect(screen.getByRole("button", { name: "下一页" })).toBeEnabled());
  await user.click(screen.getByRole("button", { name: "放大" }));
  await waitFor(() => expect(pdf.render).toHaveBeenCalledTimes(2));
  await user.click(screen.getByRole("button", { name: "下一页" }));
  await waitFor(() => expect(pdf.getPage).toHaveBeenLastCalledWith(2));
  expect(pdf.getDocument).toHaveBeenCalledTimes(1);
});

it("destroys the previous document and resets the page when the data changes", async () => {
  const user = userEvent.setup();
  const view = render(<TooltipProvider><PdfPreview data="cGRm" label="plot.pdf" /></TooltipProvider>);
  await waitFor(() => expect(screen.getByRole("button", { name: "下一页" })).toBeEnabled());
  await user.click(screen.getByRole("button", { name: "下一页" }));
  await waitFor(() => expect(screen.getByText("2 / 2")).toBeInTheDocument());
  view.rerender(<TooltipProvider><PdfPreview data="bmV3" label="plot.pdf" /></TooltipProvider>);
  await waitFor(() => expect(screen.getByText("1 / 2")).toBeInTheDocument());
  expect(pdf.destroy).toHaveBeenCalledTimes(1);
  expect(pdf.getDocument).toHaveBeenCalledTimes(2);
});

it("retains the last painted canvas until the next render completes", async () => {
  const user = userEvent.setup(); const ready = vi.fn();
  const { container } = render(<TooltipProvider><PdfPreview data="cGRm" label="plot.pdf" onReady={ready} /></TooltipProvider>);
  await waitFor(() => expect(ready).toHaveBeenCalled());
  const painted = container.querySelector("canvas");
  let resolve!: () => void;
  pdf.render.mockReturnValueOnce({ promise: new Promise<void>((done) => { resolve = done; }), cancel: vi.fn() });
  await user.click(screen.getByRole("button", { name: "放大" }));
  await waitFor(() => expect(container.querySelector(".pdf-canvas-host")).toHaveAttribute("aria-busy", "true"));
  expect(container.querySelector("canvas")).toBe(painted);
  await act(async () => resolve());
  await waitFor(() => expect(container.querySelector(".pdf-canvas-host")).toHaveAttribute("aria-busy", "false"));
  expect(container.querySelector("canvas")).not.toBe(painted);
});

it("reports render failure to the retaining inspector", async () => {
  const failed = vi.fn(); pdf.render.mockImplementationOnce(() => ({ promise: Promise.reject(new Error("PDF render failed")), cancel: vi.fn() }));
  render(<TooltipProvider><PdfPreview data="cGRm" label="plot.pdf" onError={failed} /></TooltipProvider>);
  await waitFor(() => expect(failed).toHaveBeenCalledWith("PDF render failed"));
});


it("renders an overlay in the shared frame without adding standalone zoom controls", async () => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1200);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(720);
  const ready = vi.fn();
  const { container } = render(<PdfPreview data="cGRm" label="plot.pdf" overlay onReady={ready} />);
  await waitFor(() => expect(ready).toHaveBeenCalled());
  expect(screen.queryByRole("group", { name: "PDF 预览工具" })).not.toBeInTheDocument();
  expect(container.querySelector("canvas")).toHaveStyle({ width: "100%", height: "100%" });
  expect(pdf.render).toHaveBeenLastCalledWith(expect.objectContaining({ viewport: { width: 1200, height: 720 } }));
});
