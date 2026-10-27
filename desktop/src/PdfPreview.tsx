import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, LoaderCircle, Maximize, Minus, Plus } from "lucide-react";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import { errorMessage } from "./utils";
import IconButton from "./IconButton";
import { Separator } from "@/controls/separator";
import "./inspector-settings.css";

GlobalWorkerOptions.workerSrc = workerUrl;

export default function PdfPreview({ data, label, overlay = false, onReady, onError }: { data: string; label: string; overlay?: boolean; onReady?: () => void; onError?: (message: string) => void }) {
  const readyCallback = useRef(onReady);
  readyCallback.current = onReady;
  const errorCallback = useRef(onError);
  errorCallback.current = onError;
  const host = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 480, height: 240 });
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [document, setDocument] = useState<{ data: string; pdf: PDFDocumentProxy } | null>(null);

  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const update = () => {
      const { clientWidth: width, clientHeight: height } = element;
      if (width > 0 && height > 0) setSize((previous) => previous.width === width && previous.height === height ? previous : { width, height });
    };
    update();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", update);
      return () => window.removeEventListener("resize", update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let disposed = false;
    let task: ReturnType<typeof getDocument> | undefined;
    setDocument(null);
    setPages(0);
    setPage(1);
    setZoom(1);
    setLoading(true);
    setError(null);
    async function load() {
      try {
        const bytes = Uint8Array.from(atob(data), (character) => character.charCodeAt(0));
        task = getDocument({ data: bytes });
        const pdf = await task.promise;
        if (!disposed) { setPages(pdf.numPages); setDocument({ data, pdf }); }
      } catch (reason) {
        if (!disposed) { const message = errorMessage(reason, "PDF 载入失败"); setError(message); setLoading(false); errorCallback.current?.(message); }
      }
    }
    void load();
    return () => {
      disposed = true;
      if (task) void task.destroy().catch(() => undefined);
    };
  }, [data]);

  useEffect(() => {
    const element = host.current;
    if (!element || !document || document.data !== data) return;
    let disposed = false;
    let renderTask: RenderTask | undefined;
    setLoading(true);
    setError(null);
    // Each render owns its canvas, so cancellation cannot paint onto the next page.
    const canvas = window.document.createElement("canvas");
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", `${label}，第 ${page} 页`);
    canvas.className = "pdf-canvas-enter";
    async function renderPage() {
      try {
        const pdf = document!.pdf;
        if (page > pdf.numPages) { setPage(1); return; }
        const pdfPage = await pdf.getPage(page);
        if (disposed) return;
        const natural = pdfPage.getViewport({ scale: 1 });
        const fit = overlay ? Math.min(size.width / natural.width, size.height / natural.height) : Math.min(Math.max(1, size.width - 48) / natural.width, Math.max(1, size.height - 32) / natural.height);
        const viewport = pdfPage.getViewport({ scale: fit * zoom });
        const ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(16_000_000 / (viewport.width * viewport.height)));
        canvas.width = Math.max(1, Math.floor(viewport.width * ratio));
        canvas.height = Math.max(1, Math.floor(viewport.height * ratio));
        canvas.style.width = overlay ? "100%" : `${viewport.width}px`;
        canvas.style.height = overlay ? "100%" : `${viewport.height}px`;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("无法创建 PDF 画布");
        renderTask = pdfPage.render({ canvas, canvasContext: context, viewport, transform: [ratio, 0, 0, ratio, 0, 0] });
        await renderTask.promise;
        if (!disposed) { element!.replaceChildren(canvas); setLoading(false); readyCallback.current?.(); }
      } catch (reason) {
        if (!disposed) { const message = errorMessage(reason, "PDF 预览失败"); setError(message); setLoading(false); errorCallback.current?.(message); }
      }
    }
    void renderPage();
    return () => {
      disposed = true;
      renderTask?.cancel();
      // Keep the last completed canvas visible until its replacement is ready.
      if (canvas.parentElement !== element) canvas.remove();
    };
  }, [document, data, label, page, size, zoom, overlay]);

  return <div className={overlay ? "pdf-preview pdf-overlay" : "pdf-preview"}>
    {!overlay && <div className="pdf-toolbar" role="group" aria-label="PDF 预览工具">
      <IconButton label="上一页" size="icon-sm" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}><ChevronLeft aria-hidden="true" /></IconButton><span className="page-count">{page} / {pages || "…"}</span><IconButton label="下一页" size="icon-sm" disabled={page >= pages || loading} onClick={() => setPage((value) => value + 1)}><ChevronRight aria-hidden="true" /></IconButton>
      <Separator orientation="vertical" className="mx-1 h-4" />
      <IconButton label="缩小" size="icon-sm" disabled={zoom <= 0.25} onClick={() => setZoom((value) => Math.max(0.25, value - 0.25))}><Minus aria-hidden="true" /></IconButton><span className="zoom-value">{Math.round(zoom * 100)}%</span><IconButton label="放大" size="icon-sm" disabled={zoom >= 4} onClick={() => setZoom((value) => Math.min(4, value + 0.25))}><Plus aria-hidden="true" /></IconButton><IconButton label="适合页面" size="icon-sm" onClick={() => setZoom(1)}><Maximize aria-hidden="true" /></IconButton>
    </div>}
    <div ref={frame} className="pdf-viewport"><div ref={host} className="pdf-canvas-host" aria-busy={loading} />{loading && <div className="pdf-render-status" role="status"><LoaderCircle size={16} className="spin" aria-hidden="true" />正在渲染</div>}{error && <p className="preview-error pdf-error" role="alert">{error}</p>}</div>
  </div>;
}
