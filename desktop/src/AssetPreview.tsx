import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FileImage, LoaderCircle, TriangleAlert } from "lucide-react";
import type { AssetPreviewData, ImageAsset, ImageResult } from "./types";
import { errorMessage, formatBytes } from "./utils";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const PdfPreview = lazy(() => import("./PdfPreview").catch(() => ({ default: () => <p className="preview-error" role="alert">PDF 预览组件加载失败，请更新系统浏览器组件并重启应用</p> })));

interface Props {
  asset: ImageAsset | null;
  result?: ImageResult;
  revision: number;
}

function PreviewContent({ asset, converted, revision, pdfPath, overlay = false }: { asset: ImageAsset; converted: boolean; revision: number; pdfPath?: string | null; overlay?: boolean }) {
  const requestKey = JSON.stringify([asset.id, converted, revision, pdfPath]);
  const [response, setResponse] = useState<{ key: string; preview?: AssetPreviewData; error?: string } | null>(null);
  const current = response?.key === requestKey ? response : null;

  useEffect(() => {
    let disposed = false;
    void invoke<AssetPreviewData>("asset_preview", { imageId: asset.id, converted })
      .then((preview) => {
        if (disposed) return;
        if (converted && preview.kind !== "pdf") {
          setResponse({ key: requestKey, error: "转换结果不是 PDF，无法对比" });
        } else { setResponse({ key: requestKey, preview }); }
      })
      .catch((reason: unknown) => { if (!disposed) setResponse({ key: requestKey, error: errorMessage(reason, "图片预览失败") }); });
    return () => { disposed = true; };
  }, [asset.id, converted, requestKey]);

  if (!current) return <div className="preview-placeholder" role="status"><Skeleton className="h-36 w-4/5" /><span>正在载入{converted ? " PDF" : "原图"}…</span></div>;
  if (current.error) return <div className="preview-placeholder preview-error" role="alert"><TriangleAlert size={24} aria-hidden="true" /><span>{current.error}</span></div>;
  if (current.preview?.kind === "pdf") return <Suspense fallback={<div className="preview-placeholder" role="status"><LoaderCircle size={23} className="spin" aria-hidden="true" /><span>正在载入 PDF</span></div>}><PdfPreview overlay={overlay} key={requestKey} data={current.preview.data} label={converted ? pdfPath ?? asset.relativePath : asset.relativePath} /></Suspense>;
  return <div className="image-stage"><img src={current.preview?.data} width={asset.width ?? 1600} height={asset.height ?? 1000} alt={`原始：${asset.relativePath}`} onError={() => setResponse({ key: requestKey, error: "图片无法显示，请重新扫描后重试" })} /></div>;
}

function PreviewPanel({ asset, result, revision }: Props) {
  const [mode, setMode] = useState("original");
  const unavailable = !asset?.path || ["missing", "ambiguous", "unsupported"].includes(asset.status);
  const hasConverted = Boolean(asset && !unavailable && result?.id === asset.id && result.pdfPath && !result.error && !result.cancelled);
  const compare = mode === "compare" && hasConverted;
  const sourceBytes = asset?.bytes;
  const pdfBytes = result?.bytes;
  const saving = hasConverted && sourceBytes != null && sourceBytes > 0 && pdfBytes != null
    ? (1 - pdfBytes / sourceBytes) * 100 : null;

  const [divider, setDivider] = useState(50);
  const surface = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 480, height: 240 });
  const [naturalAspect, setNaturalAspect] = useState(1.6);
  const aspect = asset?.width && asset.height ? asset.width / asset.height : naturalAspect;
  const width = Math.max(1, Math.min(size.width - 28, (size.height - 28) * aspect));
  useEffect(() => {
    const element = surface.current;
    if (!element) return;
    const update = () => { if (element.clientWidth && element.clientHeight) setSize({ width: element.clientWidth, height: element.clientHeight }); };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update); observer.observe(element);
    return () => observer.disconnect();
  }, []);
  function keydown(event: React.KeyboardEvent<HTMLElement>) {
    if (!hasConverted || event.defaultPrevented || event.repeat || event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, select, button, a, [contenteditable], [role="dialog"], [role="menu"]')) return;
    if (event.key === " " && !event.shiftKey) { event.preventDefault(); setMode(compare ? "original" : "compare"); }
    else if (compare && ["ArrowLeft", "ArrowRight", "0", "Escape"].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      if (event.key === "Escape") setMode("original");
      else if (event.key === "0") setDivider(50);
      else setDivider((value) => Math.max(0, Math.min(100, value + (event.key === "ArrowRight" ? 1 : -1) * (event.shiftKey ? 10 : 1))));
    }
  }
  function moveDivider(event: React.PointerEvent<HTMLElement>) {
    const bounds = surface.current?.getBoundingClientRect();
    if (bounds?.width) setDivider(Math.max(0, Math.min(100, (event.clientX - bounds.left) / bounds.width * 100)));
  }

  return <section className="preview-panel" aria-label="图片预览" tabIndex={0} onKeyDown={keydown}>
    <div className="preview-heading">
      <div className="preview-heading-copy"><h2>图片预览</h2><div className="preview-filename" title={asset?.path ?? ""}>{asset?.relativePath ?? "未选择图片"}</div></div>
      <ToggleGroup type="single" value={compare ? "compare" : "original"} onValueChange={(value) => { if (value) setMode(value); }} variant="outline" size="sm" aria-label="预览版本">
        <ToggleGroupItem value="original" disabled={!asset}>原图</ToggleGroupItem>
        <ToggleGroupItem value="compare" disabled={!hasConverted}>对比</ToggleGroupItem>
      </ToggleGroup>
    </div>
    <div ref={surface} className="preview-surface" onPointerDown={(event) => { if (!(event.target as HTMLElement).closest('button, input, [role="slider"]')) event.currentTarget.closest<HTMLElement>(".preview-panel")?.focus(); }}>
      {unavailable ? <Empty><EmptyHeader><EmptyMedia variant="icon"><FileImage aria-hidden="true" /></EmptyMedia><EmptyTitle>{asset ? asset.message || "此图片暂不可预览" : "未选择图片"}</EmptyTitle></EmptyHeader></Empty> : <>
        <div className="comparison-frame" style={{ width, height: width / aspect }} onLoadCapture={(event) => { const img = event.target; if (img instanceof HTMLImageElement && img.naturalWidth && img.naturalHeight) setNaturalAspect(img.naturalWidth / img.naturalHeight); }}>
          <section className="comparison-layer" aria-label="原图预览"><PreviewContent asset={asset!} converted={false} revision={revision} /></section>
        </div>
        {compare && <>
          <div className="comparison-clip" style={{ clipPath: `inset(0 ${100 - divider}% 0 0)` }}>
            <div className="comparison-frame" style={{ width, height: width / aspect }}><section className="comparison-layer" aria-label="PDF 对比预览"><PreviewContent asset={asset!} converted revision={revision} pdfPath={result?.pdfPath} overlay /></section></div>
          </div>
          <span className="comparison-label comparison-label-left">PDF</span><span className="comparison-label comparison-label-right">原图</span>
          <div role="slider" tabIndex={0} aria-label="原图与 PDF 分隔线" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(divider)} aria-orientation="horizontal" className="comparison-divider" style={{ left: `${divider}%` }}
            onDoubleClick={() => setDivider(50)} onPointerDown={(event) => { event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture?.(event.pointerId); moveDivider(event); }}
            onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture?.(event.pointerId)) moveDivider(event); }}
            onPointerUp={(event) => event.currentTarget.releasePointerCapture?.(event.pointerId)}><span aria-hidden="true">‹ ›</span></div>
        </>}
      </>}
    </div>
    <div className="preview-metadata">
      <Badge variant="outline">{asset?.format.toUpperCase() ?? "无图片"}</Badge>
      {asset?.width && asset.height ? <span>{asset.width} × {asset.height} px</span> : null}
      <span>{asset ? formatBytes(asset.bytes) : ""}{hasConverted ? ` → ${formatBytes(pdfBytes ?? null)}` : ""}</span>
      {saving !== null && <span className="preview-savings">{saving >= 0 ? `节省 ${Number(saving.toFixed(1))}%` : `增大 ${Number((-saving).toFixed(1))}%`}</span>}
    </div>
  </section>;
}

export default function AssetPreview(props: Props) {
  return <PreviewPanel key={`${props.asset?.id}:${props.asset?.path}`} {...props} />;
}
