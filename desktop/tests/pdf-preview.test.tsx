import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { TooltipProvider } from "../src/components/ui/tooltip";
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
