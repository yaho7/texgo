import { act, render, screen, waitFor } from "@testing-library/react";
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

it("defaults to the original and compares it alongside the real PDF only on request", async () => {
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
