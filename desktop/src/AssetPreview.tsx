import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FileImage, TriangleAlert, MoreHorizontal } from "lucide-react";
import type { AssetPreviewData, ImageAsset, ImageResult } from "./types";
import { errorMessage, formatBytes } from "./utils";
import { motionDuration } from "./motion";
import { Badge } from "@/controls/badge";
import { Button } from "@/controls/button";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/controls/empty";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/controls/dropdown-menu";
import { Skeleton } from "@/controls/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/controls/toggle-group";
import "./inspector-settings.css";
import "./preview.css";

function PdfUnavailable({ onError }: { onError?: (message: string) => void }) {
  useEffect(() => { onError?.("PDF 预览组件加载失败，请更新系统浏览器组件并重启应用"); }, []);
  return <></>;
}
const PdfPreview = lazy(() => import("./PdfPreview").catch(() => ({ default: PdfUnavailable })));

interface Props {
  asset: ImageAsset | null;
  result?: ImageResult;
  revision: number;
  busy?: boolean;
  ignored?: boolean;
  statusLabel?: string;
  onLocate?: (id: string) => void;
  onInspect?: (id: string) => void;
  onRetry?: (id: string) => void;
  onIgnore?: (id: string, mode: "none" | "session" | "permanent") => void;
  onManualConvert?: (id: string) => void;
  canConvert?: boolean;
}
interface PreviewResponse { key: string; preview: AssetPreviewData; label: string; width: number; height: number }

function PreviewContent({ asset, converted, revision, pdfPath, overlay = false, onNaturalSize }: { asset: ImageAsset; converted: boolean; revision: number; pdfPath?: string | null; overlay?: boolean; onNaturalSize?: (width: number, height: number) => void }) {
  const requestKey = JSON.stringify([asset.id, asset.path, converted, revision, pdfPath]);
  const [response, setResponse] = useState<PreviewResponse | null>(null);
  const [previous, setPrevious] = useState<PreviewResponse | null>(null);
  const [readyKey, setReadyKey] = useState<string | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const currentKey = useRef(requestKey);
  currentKey.current = requestKey;
  const displayed = useRef<PreviewResponse | null>(null);
  const readyResponse = useRef<PreviewResponse | null>(null);

  useEffect(() => {
    let disposed = false;
    setError(null);
    void invoke<AssetPreviewData>("asset_preview", { imageId: asset.id, converted })
      .then((preview) => {
        if (disposed) return;
        if (converted && preview.kind !== "pdf") { setError({ key: requestKey, message: "转换结果不是 PDF，无法对比" }); return; }
        const next = { key: requestKey, preview, label: converted ? pdfPath ?? asset.relativePath : asset.relativePath, width: asset.width ?? 1600, height: asset.height ?? 1000 };
        if (readyResponse.current?.preview.data === preview.data && readyResponse.current.preview.kind === preview.kind) {
          readyResponse.current = next; setReadyKey(requestKey); setPrevious(null);
        } else { setPrevious(readyResponse.current); }
        displayed.current = next; setResponse(next);
      })
      .catch((reason: unknown) => { if (!disposed) setError({ key: requestKey, message: errorMessage(reason, "图片预览失败") }); });
    return () => { disposed = true; };
  }, [asset.id, asset.path, asset.relativePath, asset.width, asset.height, converted, pdfPath, requestKey]);

  function markReady(key: string, dimensions?: { width: number; height: number }) {
    if (key !== currentKey.current || displayed.current?.key !== key) return;
    const ready = dimensions ? { ...displayed.current, ...dimensions } : displayed.current;
    displayed.current = ready;
    readyResponse.current = ready;
    if (dimensions) setResponse(ready);
    setReadyKey(key); setPrevious(null);
  }
  function content(item: PreviewResponse, pending: boolean) {
    if (item.preview.kind === "pdf") return <Suspense fallback={null}><PdfPreview overlay={overlay} data={item.preview.data} label={item.label} onReady={() => markReady(item.key)} onError={(message) => { if (item.key === currentKey.current) setError({ key: item.key, message }); }} /></Suspense>;
    return <div className="image-stage"><img src={item.preview.data} width={item.width} height={item.height} alt={`${pending ? "原始：" : "上一张："}${item.label}`} style={item.key !== currentKey.current ? { maxWidth: item.width, maxHeight: item.height, objectFit: "contain" } : undefined} onLoad={(event) => {
      const { naturalWidth, naturalHeight } = event.currentTarget;
      if (item.key === currentKey.current && naturalWidth && naturalHeight) {
        onNaturalSize?.(naturalWidth, naturalHeight);
        markReady(item.key, { width: asset.width ?? naturalWidth, height: asset.height ?? naturalHeight });
      } else markReady(item.key);
    }} onError={() => { if (item.key === currentKey.current) setError({ key: item.key, message: "图片无法显示，请重新扫描后重试" }); }} /></div>;
  }
  const current = response?.key === requestKey;
  const loaded = current && readyKey === requestKey;
  const hasFrame = Boolean(response || previous);
  const visibleError = error?.key === requestKey ? error.message : null;
  return <div className="preview-content-stack" data-loading={!loaded} aria-busy={!loaded && !visibleError}>
    {previous && !loaded && <div className="preview-content-frame preview-retained" aria-hidden="true">{content(previous, false)}</div>}
    {response && <div key={response.key} className="preview-content-frame" data-ready={loaded || (!current && !previous)} data-stale={!current}>
      {content(response, true)}
    </div>}
    {!hasFrame && !visibleError && <div className="preview-placeholder" role="status"><Skeleton className="h-36 w-4/5" /><span>正在载入{converted ? " PDF" : "原图"}…</span></div>}
    {hasFrame && !loaded && !visibleError && <span className="preview-loading-note" role="status">正在载入{converted ? " PDF" : "原图"}…</span>}
    {visibleError && <div className="preview-placeholder preview-error preview-load-error" role="alert"><TriangleAlert size={24} aria-hidden="true" /><span>{visibleError}</span></div>}
  </div>;
}

export default function AssetPreview({ asset, result, revision, busy = false, ignored, statusLabel, onLocate, onInspect, onIgnore, onRetry, onManualConvert, canConvert = false }: Props) {
  const ignoreMode = asset?.ignoreMode ?? (ignored ? "session" : "none");
  ignored = ignoreMode !== "none";
  const [mode, setMode] = useState("original");
  const [scale, setScale] = useState("fit");
  const unavailable = !asset?.path || ["missing", "ambiguous", "unsupported"].includes(asset.status);
  const hasConverted = Boolean(asset && !unavailable && result?.id === asset.id && result.pdfPath && !result.error && !result.cancelled);
  const visibleMode = hasConverted ? mode : "original";
  const compare = visibleMode === "compare";
  const showPdf = visibleMode !== "original";
  const sourceBytes = asset?.bytes;
  const pdfBytes = result?.bytes;
  const saving = hasConverted && sourceBytes != null && sourceBytes > 0 && pdfBytes != null ? (1 - pdfBytes / sourceBytes) * 100 : null;
  const [divider, setDivider] = useState(50);
  const [dragging, setDragging] = useState(false);
  const [resetting, setResetting] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const surface = useRef<HTMLDivElement>(null);
  const artboard = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 480, height: 240 });
  const sourceKey = JSON.stringify([asset?.id, asset?.path]);
  const [natural, setNatural] = useState<{ key: string; width: number; height: number } | null>(null);
  const dimensions = asset?.width && asset.height ? { width: asset.width, height: asset.height } : natural?.key === sourceKey ? natural : null;
  const sourcePdf = asset?.format.toLowerCase() === "pdf" || asset?.status === "pdf";
  const availableWidth = Math.max(1, size.width - 28);
  const availableHeight = Math.max(1, size.height - 28);
  const nativeWidth = dimensions?.width ?? availableWidth;
  const aspect = dimensions ? dimensions.width / dimensions.height : availableWidth / availableHeight;
  const width = sourcePdf ? size.width : scale === "actual" ? nativeWidth : Math.max(1, Math.min(nativeWidth, availableWidth, availableHeight * aspect));
  const height = sourcePdf ? size.height : dimensions ? width / aspect : availableHeight;
  useLayoutEffect(() => {
    const element = surface.current;
    if (!element) return;
    element.scrollLeft = scale === "actual" ? Math.max(0, element.scrollWidth - element.clientWidth) / 2 : 0;
    element.scrollTop = scale === "actual" ? Math.max(0, element.scrollHeight - element.clientHeight) / 2 : 0;
  }, [scale]);
  useEffect(() => () => { if (resetTimer.current) clearTimeout(resetTimer.current); }, []);
  useEffect(() => {
    const element = surface.current;
    if (!element) return;
    const update = () => { if (element.clientWidth && element.clientHeight) setSize({ width: element.clientWidth, height: element.clientHeight }); };
    update();
    if (typeof ResizeObserver === "undefined") { window.addEventListener("resize", update); return () => window.removeEventListener("resize", update); }
    const observer = new ResizeObserver(update); observer.observe(element);
    return () => observer.disconnect();
  }, []);
  function resetDivider() { setResetting(true); setDivider(50); if (resetTimer.current) clearTimeout(resetTimer.current); resetTimer.current = setTimeout(() => setResetting(false), motionDuration("slow")); }
  function keydown(event: React.KeyboardEvent<HTMLElement>) {
    if (!hasConverted || event.defaultPrevented || event.repeat || event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, select, button, a, [contenteditable], [role="dialog"], [role="menu"]')) return;
    if (event.key === " " && !event.shiftKey) { event.preventDefault(); setMode(visibleMode === "original" ? "pdf" : visibleMode === "pdf" ? "compare" : "original"); }
    else if ((compare || event.key === "Escape" && showPdf) && ["ArrowLeft", "ArrowRight", "0", "Escape"].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      if (event.key === "Escape") setMode("original");
      else if (event.key === "0") resetDivider();
      else { setResetting(false); setDivider((value) => Math.max(0, Math.min(100, value + (event.key === "ArrowRight" ? 1 : -1) * (event.shiftKey ? 10 : 1)))); }
    }
  }
  function moveDivider(event: React.PointerEvent<HTMLElement>) {
    const bounds = artboard.current?.getBoundingClientRect();
    if (bounds?.width) setDivider(Math.max(0, Math.min(100, (event.clientX - bounds.left) / bounds.width * 100)));
  }
  const problem = Boolean(asset && (["missing", "ambiguous", "unsupported"].includes(asset.status) || result?.error || statusLabel === "需要处理"));
  const state = statusLabel ?? (ignored ? "已忽略" : problem ? "需要处理" : asset?.updateAvailable ? "有更新" : hasConverted || asset?.status === "pdf" ? "已完成" : "待转换");

  const referencesByFile = new Map<string, ImageAsset["references"]>();
  for (const reference of asset?.references ?? []) {
    const references = referencesByFile.get(reference.file) ?? [];
    references.push(reference);
    referencesByFile.set(reference.file, references);
  }

  return <section className="preview-panel" aria-label="图片预览" tabIndex={0} onKeyDown={keydown}>
    <div className="preview-heading">
      <div className="preview-heading-copy"><h2 title={asset?.relativePath}>{asset?.relativePath.split(/[\\/]/).pop() ?? "未选择图片"}</h2><div className="preview-filename" title={asset?.path ?? ""}>{asset ? `${asset.format.toUpperCase()}${asset.width && asset.height ? ` · ${asset.width} × ${asset.height}` : ""} · ${formatBytes(asset.bytes)}` : "选择图片查看详情"}</div></div>
      {asset && onManualConvert && <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="当前图片操作" disabled={busy}><MoreHorizontal aria-hidden="true" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuGroup><DropdownMenuItem disabled={!canConvert} onSelect={() => onManualConvert(asset.id)}>{ignored ? "手动转换一次" : "重新转换此图片"}</DropdownMenuItem></DropdownMenuGroup></DropdownMenuContent></DropdownMenu>}
      <ToggleGroup type="single" value={visibleMode} onValueChange={(value) => { if (value) setMode(value); }} variant="outline" size="sm" aria-label="预览版本">
        <ToggleGroupItem value="original" disabled={!asset}>原图</ToggleGroupItem><ToggleGroupItem value="pdf" disabled={!hasConverted}>PDF</ToggleGroupItem><ToggleGroupItem value="compare" disabled={!hasConverted}>对比</ToggleGroupItem>
      </ToggleGroup>
    </div>
    {!sourcePdf && <div className="preview-scale-controls"><ToggleGroup type="single" value={scale} onValueChange={(value) => { if (value) setScale(value); }} variant="outline" size="sm" aria-label="预览缩放">
      <ToggleGroupItem value="fit" disabled={unavailable}>适应窗口</ToggleGroupItem><ToggleGroupItem value="actual" disabled={unavailable}>100%</ToggleGroupItem>
    </ToggleGroup></div>}
    <div ref={surface} className="preview-surface" data-scale={scale} data-dragging={dragging} data-resetting={resetting} onPointerDown={(event) => { if (!(event.target as HTMLElement).closest('button, input, [role="slider"]')) event.currentTarget.closest<HTMLElement>(".preview-panel")?.focus(); }}>
      {unavailable ? <Empty><EmptyHeader><EmptyMedia variant="icon"><FileImage aria-hidden="true" /></EmptyMedia><EmptyTitle>{asset ? asset.status === "missing" ? "文件缺失" : asset.status === "ambiguous" ? "找到多个候选文件" : "此图片暂不可预览" : "选择图片查看预览"}</EmptyTitle></EmptyHeader></Empty> : <>
        <div ref={artboard} className="preview-artboard" style={{ width: sourcePdf ? size.width : Math.max(size.width, width + 28), height: sourcePdf ? size.height : Math.max(size.height, height + 28) }}>
        <div className="comparison-frame" data-native-known={sourcePdf || Boolean(dimensions)} style={{ width, height, visibility: visibleMode === "pdf" ? "hidden" : undefined }}>
          <section className="comparison-layer" aria-label="原图预览"><PreviewContent asset={asset!} converted={false} revision={revision} onNaturalSize={(width, height) => setNatural({ key: sourceKey, width, height })} /></section>
        </div>
        {showPdf && <div className="comparison-clip" style={{ clipPath: compare ? `inset(0 0 0 ${divider}%)` : undefined }}>
          <div className="comparison-frame" style={{ width, height }}><section className="comparison-layer" aria-label={compare ? "PDF 对比预览" : "PDF 预览"}><PreviewContent asset={asset!} converted revision={revision} pdfPath={result?.pdfPath} overlay /></section></div>
        </div>}
        {compare && <>
          <span className="comparison-label comparison-label-left">原图</span><span className="comparison-label comparison-label-right">PDF</span>
          <div role="slider" tabIndex={0} aria-label="原图与 PDF 分隔线" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(divider)} aria-valuetext={`原图 ${Math.round(divider)}%，PDF ${100 - Math.round(divider)}%`} aria-orientation="horizontal" className="comparison-divider" style={{ left: `${divider}%` }}
            onDoubleClick={resetDivider} onPointerDown={(event) => { event.preventDefault(); setResetting(false); setDragging(true); event.currentTarget.focus(); event.currentTarget.setPointerCapture?.(event.pointerId); moveDivider(event); }}
            onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture?.(event.pointerId)) moveDivider(event); }}
            onPointerUp={(event) => { setDragging(false); event.currentTarget.releasePointerCapture?.(event.pointerId); }} onPointerCancel={() => setDragging(false)} onLostPointerCapture={() => setDragging(false)}><span aria-hidden="true">‹ ›</span></div>
        </>}
        </div>
      </>}
    </div>
    <div className="preview-metadata">
      {hasConverted && <span>PDF {formatBytes(pdfBytes ?? null)}</span>}
      {saving !== null && <span className="preview-savings">{saving >= 0 ? `节省 ${Number(saving.toFixed(1))}%` : `增大 ${Number((-saving).toFixed(1))}%`}</span>}
    </div>
    {asset && <section aria-label="引用与输出" className="mx-[18px] mb-3 shrink-0 border-t border-border text-xs">
      <details className="group border-b border-border py-2">
        <summary className="cursor-pointer rounded px-1 py-1.5 font-medium focus-visible:outline-2 focus-visible:outline-primary">引用位置（{asset.references.length}）</summary>
        <ul className="max-h-36 overflow-auto px-1">{[...referencesByFile].map(([file, references]) => <li key={file} className="flex items-center justify-between gap-3 border-t border-border/50 py-2"><span className="min-w-0 truncate" title={file}>{file.split(/[\\/]/).pop()}</span><span className="max-w-[55%] text-right text-muted-foreground" title={`${references.length} 处引用`}>{references.map((reference) => `第 ${reference.line} 行`).join("、")}</span></li>)}</ul>
        {!asset.references.length && <p className="px-1 py-2 text-muted-foreground">未发现 LaTeX 引用</p>}
      </details>
      {hasConverted && <div className="px-1 py-3"><h3 className="mb-1 font-medium">PDF 输出</h3><p className="break-all leading-relaxed text-muted-foreground">{result?.pdfPath}</p></div>}
    </section>}
    {asset && <div className="inspector-image-state"><Badge variant={problem && !ignored ? "destructive" : "secondary"} title={ignored ? ignoreMode === "permanent" ? "始终忽略" : "仅本次忽略" : undefined}>{state}</Badge>{problem && <><p>{result?.error ?? asset.message}</p>{asset.status === "missing" && <p>LaTeX 引用了：<code>{asset.relativePath}</code></p>}</>}<div className="inspector-image-actions">{problem && asset.status === "ready" && !ignored && onRetry && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => onRetry(asset.id)}>重试此图片</Button>}{problem && onLocate && ["missing", "ambiguous"].includes(asset.status) && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => onLocate(asset.id)}>定位文件</Button>}{problem && onInspect && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => onInspect(asset.id)}>{["missing", "ambiguous"].includes(asset.status) ? "修复" : "查看详情"}</Button>}{onIgnore && <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => onIgnore(asset.id, ignored ? "none" : "session")}>{ignored ? "恢复处理" : "忽略本次"}</Button>}{onIgnore && ignoreMode !== "permanent" && <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => onIgnore(asset.id, "permanent")}>始终忽略</Button>}</div></div>}
  </section>;
}
