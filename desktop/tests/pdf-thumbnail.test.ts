import { beforeEach, expect, it, vi } from "vitest";
import { pdfThumbnail } from "../src/pdfThumbnail";
const pdf = vi.hoisted(() => ({ getDocument: vi.fn(), getPage: vi.fn(), render: vi.fn(), destroy: vi.fn() }));
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({getDocument: pdf.getDocument, GlobalWorkerOptions: {}}));
beforeEach(() => {
  pdf.getDocument.mockReturnValue({promise: Promise.resolve({getPage: pdf.getPage}),destroy: pdf.destroy});
  pdf.getPage.mockResolvedValue({getViewport: ({scale}: {scale:number}) => ({width: 1000*scale,height:500*scale}),render:pdf.render});
  pdf.render.mockReturnValue({promise:Promise.resolve()}); pdf.destroy.mockResolvedValue(undefined);
  vi.spyOn(HTMLCanvasElement.prototype,"getContext").mockReturnValue({} as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype,"toDataURL").mockReturnValue("data:image/png;base64,thumb");
});
it("renders only the first page at bounded size and releases the document", async () => {
  expect(await pdfThumbnail("cGRm",()=>true)).toBe("data:image/png;base64,thumb");
  expect(pdf.getPage).toHaveBeenCalledExactlyOnceWith(1);
  const args=pdf.render.mock.calls[0][0]; expect([args.canvas.width,args.canvas.height]).toEqual([120,60]);
  expect(pdf.destroy).toHaveBeenCalledOnce();
});
it("releases a failed render and skips a stale or oversized PDF", async () => {
  pdf.render.mockReturnValue({promise:Promise.reject(new Error("render failure"))});
  await expect(pdfThumbnail("cGRm",()=>true)).rejects.toThrow("render failure"); expect(pdf.destroy).toHaveBeenCalledOnce();
  pdf.getDocument.mockClear();
  expect(await pdfThumbnail("cGRm",()=>false)).toBeNull();
  expect(await pdfThumbnail("x".repeat(12*1024*1024+1),()=>true)).toBeNull(); expect(pdf.getDocument).not.toHaveBeenCalled();
});
