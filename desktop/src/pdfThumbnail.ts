import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
GlobalWorkerOptions.workerSrc = workerUrl;

/** Render only page one, then release the document; no PDF bytes enter the cache. */
export async function pdfThumbnail(data: string, isCurrent: () => boolean): Promise<string | null> {
  if (data.length > 12 * 1024 * 1024 || !isCurrent()) return null;
  const bytes = Uint8Array.from(atob(data), (character) => character.charCodeAt(0));
  const task = getDocument({ data: bytes, maxImageSize: 16 * 1024 * 1024 });
  try {
    const pdf = await task.promise;
    if (!isCurrent()) return null;
    const page = await pdf.getPage(1);
    const natural = page.getViewport({ scale: 1 });
    if (![natural.width, natural.height].every((value) => Number.isFinite(value) && value > 0)) return null;
    const viewport = page.getViewport({ scale: Math.min(120 / natural.width, 120 / natural.height) });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(viewport.width)); canvas.height = Math.max(1, Math.ceil(viewport.height));
    const canvasContext = canvas.getContext("2d");
    if (!canvasContext) return null;
    await page.render({ canvas, canvasContext, viewport }).promise;
    if (!isCurrent()) return null;
    const result = canvas.toDataURL("image/png");
    return result.startsWith("data:image/png;base64,") && result.length <= 160_000 ? result : null;
  } finally { await task.destroy(); }
}
