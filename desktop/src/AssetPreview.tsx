import { nativeText } from "./nativeText";
import { t } from "./i18n";
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FileImage, TriangleAlert, MoreHorizontal } from "lucide-react";
import type { AssetPreviewData, ImageAsset, ImageResult } from "./types";
import { errorMessage, formatBytes, fileName, relativeFile } from "./utils";
import { motionDuration } from "./motion";
import { Button } from "@/controls/button";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/controls/empty";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/controls/dropdown-menu";
import { Skeleton } from "@/controls/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/controls/toggle-group";
import "./inspector-settings.css";
import "./preview.css";

function PdfUnavailable({ onError }: { onError?: (message: string) => void }) {
  useEffect(() => { onError?.(t("assetPreview.couldNotLoadThePDFViewerUpdateYourSystemWebview")); }, []);
  return <></>;
}
const PdfPreview = lazy(() => import("./PdfPreview").catch(() => ({ default: PdfUnavailable })));

interface Props {
  root?: string;
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
        if (converted && preview.kind !== "pdf") { setError({ key: requestKey, message: t("assetPreview.theProcessedFileIsNotAPDFAndCannotBe") }); return; }
        const next = { key: requestKey, preview, label: converted ? pdfPath ?? asset.relativePath : asset.relativePath, width: asset.width ?? 1600, height: asset.height ?? 1000 };
        if (readyResponse.current?.preview.data === preview.data && readyResponse.current.preview.kind === preview.kind) {
          readyResponse.current = next; setReadyKey(requestKey); setPrevious(null);
        } else { setPrevious(readyResponse.current); }
        displayed.current = next; setResponse(next);
      })
      .catch((reason: unknown) => { if (!disposed) setError({ key: requestKey, message: errorMessage(reason, t("assetPreview.imagePreviewFailed")) }); });
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
    return <div className="image-stage"><img src={item.preview.data} width={item.width} height={item.height} alt={`${pending ? t("assetPreview.original") : t("assetPreview.previous")}${item.label}`} style={item.key !== currentKey.current ? { maxWidth: item.width, maxHeight: item.height, objectFit: "contain" } : undefined} onLoad={(event) => {
      const { naturalWidth, naturalHeight } = event.currentTarget;
      if (item.key === currentKey.current && naturalWidth && naturalHeight) {
        onNaturalSize?.(naturalWidth, naturalHeight);
        markReady(item.key, { width: asset.width ?? naturalWidth, height: asset.height ?? naturalHeight });
      } else markReady(item.key);
    }} onError={() => { if (item.key === currentKey.current) setError({ key: item.key, message: t("assetPreview.cannotDisplayThisImageRescanAndTryAgain") }); }} /></div>;
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
    {!hasFrame && !visibleError && <div className="preview-placeholder" role="status"><Skeleton className="h-36 w-4/5" /><span>{t(converted ? "assetPreview.loadingPdf" : "assetPreview.loadingOriginal")}</span></div>}
    {hasFrame && !loaded && !visibleError && <span className="preview-loading-note" role="status">{t(converted ? "assetPreview.loadingPdf" : "assetPreview.loadingOriginal")}</span>}
    {visibleError && <div className="preview-placeholder preview-error preview-load-error" role="alert"><TriangleAlert size={24} aria-hidden="true" /><span>{nativeText(visibleError)}</span></div>}
  </div>;
}

export default function AssetPreview({ root = "", asset, result, revision, busy = false, ignored, statusLabel, onLocate, onInspect, onIgnore, onRetry, onManualConvert, canConvert = false }: Props) {
  const ignoreMode = asset?.ignoreMode ?? (ignored ? "session" : "none");
  ignored = ignoreMode !== "none";
  const [mode, setMode] = useState("original");
  const [scale, setScale] = useState("fit");
  const unavailable = !asset?.path || ["missing", "ambiguous", "unsupported"].includes(asset.status);
  const hasConverted = Boolean(asset && !unavailable && result?.id === asset.id && result.pdfPath && !result.error && !result.cancelled);
  const visibleMode = hasConverted ? mode : "original";
  const compare = visibleMode === "compare";
  const showPdf = visibleMode !== "original";
  const pdfBytes = result?.bytes;

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
    const update = (width: number, height: number) => {
      // Integer client sizes round fractional pixels up, creating scrollbars that
      // change the fit size again. Round the content box down instead.
      const next = { width: Math.floor(width), height: Math.floor(height) };
      if (next.width > 0 && next.height > 0) setSize(previous => previous.width === next.width && previous.height === next.height ? previous : next);
    };
    const measure = () => {
      const bounds = element.getBoundingClientRect(), style = getComputedStyle(element);
      update(bounds.width - parseFloat(style.borderLeftWidth || "0") - parseFloat(style.borderRightWidth || "0"), bounds.height - parseFloat(style.borderTopWidth || "0") - parseFloat(style.borderBottomWidth || "0"));
    };
    measure();
    if (typeof ResizeObserver === "undefined") { window.addEventListener("resize", measure); return () => window.removeEventListener("resize", measure); }
    const observer = new ResizeObserver(([entry]) => { if (entry) update(entry.contentRect.width, entry.contentRect.height); }); observer.observe(element);
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
  const problem = Boolean(asset && (["missing", "ambiguous", "unsupported"].includes(asset.status) || result?.error || statusLabel === t("assetPreview.needsAttention")));


  const referencesByFile = new Map<string, ImageAsset["references"]>();
  for (const reference of asset?.references ?? []) {
    const references = referencesByFile.get(reference.file) ?? [];
    references.push(reference);
    referencesByFile.set(reference.file, references);
  }

  return <section className="preview-panel" aria-label={t("assetPreview.imagePreview")} tabIndex={0} onKeyDown={keydown}>
    <div className="preview-heading">
      <div className="preview-heading-copy"><h2 title={asset?.relativePath}>{asset ? fileName(asset.relativePath) : t("assetPreview.preview")}</h2>{asset && <p className="mt-1 text-xs text-muted-foreground tabular-nums">{dimensions ? `${dimensions.width} × ${dimensions.height} · ` : ""}{asset.format.toUpperCase()} · {formatBytes(asset.bytes)}</p>}</div>
      {asset && (onManualConvert || onIgnore) && <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={t("assetPreview.currentImageActions")} disabled={busy}><MoreHorizontal aria-hidden="true" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuGroup>
        {onManualConvert && <DropdownMenuItem disabled={!canConvert} onSelect={() => onManualConvert(asset.id)}>{ignored ? t("assetPreview.processOnce") : t("assetPreview.reprocessThisImage")}</DropdownMenuItem>}
        {onManualConvert && onIgnore && <DropdownMenuSeparator />}
        {onIgnore && (ignored ? <DropdownMenuItem onSelect={() => onIgnore(asset.id, "none")}>{t("assetPreview.resumeProcessing")}</DropdownMenuItem> : <DropdownMenuItem onSelect={() => onIgnore(asset.id, "session")}>{t("assetPreview.ignoreThisSession")}</DropdownMenuItem>)}
        {onIgnore && ignoreMode !== "permanent" && <DropdownMenuItem onSelect={() => onIgnore(asset.id, "permanent")}>{t("assetPreview.alwaysIgnore")}</DropdownMenuItem>}
      </DropdownMenuGroup></DropdownMenuContent></DropdownMenu>}

      <ToggleGroup type="single" value={visibleMode} onValueChange={(value) => { if (value) setMode(value); }} variant="outline" size="sm" aria-label={t("assetPreview.previewVersion")}>
        <ToggleGroupItem value="original" disabled={!asset}>{t("assetPreview.original2")}</ToggleGroupItem><ToggleGroupItem value="pdf" disabled={!hasConverted}>PDF</ToggleGroupItem><ToggleGroupItem value="compare" disabled={!hasConverted}>{t("assetPreview.compare")}</ToggleGroupItem>
      </ToggleGroup>
    </div>
    {!sourcePdf && <div className="preview-scale-controls"><ToggleGroup type="single" value={scale} onValueChange={(value) => { if (value) setScale(value); }} variant="outline" size="sm" aria-label={t("assetPreview.previewZoom")}>
      <ToggleGroupItem value="fit" disabled={unavailable}>{t("assetPreview.fitToWindow")}</ToggleGroupItem><ToggleGroupItem value="actual" disabled={unavailable}>100%</ToggleGroupItem>
    </ToggleGroup></div>}
    <div ref={surface} className="preview-surface" data-scale={scale} data-dragging={dragging} data-resetting={resetting} onPointerDown={(event) => { if (!(event.target as HTMLElement).closest('button, input, [role="slider"]')) event.currentTarget.closest<HTMLElement>(".preview-panel")?.focus(); }}>
      {unavailable ? <Empty><EmptyHeader><EmptyMedia variant="icon"><FileImage aria-hidden="true" /></EmptyMedia><EmptyTitle>{asset ? asset.status === "missing" ? t("assetPreview.missingFile") : asset.status === "ambiguous" ? t("assetPreview.multipleCandidateFilesFound") : t("assetPreview.previewUnavailableForThisImage") : t("assetPreview.selectAnImageToPreview")}</EmptyTitle></EmptyHeader></Empty> : <>
        <div ref={artboard} className="preview-artboard" style={{ width: sourcePdf ? size.width : Math.max(size.width, width + 28), height: sourcePdf ? size.height : Math.max(size.height, height + 28) }}>
        <div className="comparison-frame" data-native-known={sourcePdf || Boolean(dimensions)} style={{ width, height, visibility: visibleMode === "pdf" ? "hidden" : undefined }}>
          <section className="comparison-layer" aria-label={t("assetPreview.originalPreview")}><PreviewContent asset={asset!} converted={false} revision={revision} onNaturalSize={(width, height) => setNatural({ key: sourceKey, width, height })} /></section>
        </div>
        {showPdf && <div className="comparison-clip" style={{ clipPath: compare ? `inset(0 0 0 ${divider}%)` : undefined }}>
          <div className="comparison-frame" style={{ width, height }}><section className="comparison-layer" aria-label={compare ? t("assetPreview.pDFComparisonPreview") : t("assetPreview.pDFPreview")}><PreviewContent asset={asset!} converted revision={revision} pdfPath={result?.pdfPath} overlay /></section></div>
        </div>}
        {compare && <>
          <span className="comparison-label comparison-label-left">{t("assetPreview.original2")}</span><span className="comparison-label comparison-label-right">PDF</span>
          <div role="slider" tabIndex={0} aria-label={t("assetPreview.originalAndPDFDivider")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(divider)} aria-valuetext={t("assetPreview.originalValuePDFValue", { arg0: Math.round(divider), arg1: 100 - Math.round(divider) })} aria-orientation="horizontal" className="comparison-divider" style={{ left: `${divider}%` }}
            onDoubleClick={resetDivider} onPointerDown={(event) => { event.preventDefault(); setResetting(false); setDragging(true); event.currentTarget.focus(); event.currentTarget.setPointerCapture?.(event.pointerId); moveDivider(event); }}
            onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture?.(event.pointerId)) moveDivider(event); }}
            onPointerUp={(event) => { setDragging(false); event.currentTarget.releasePointerCapture?.(event.pointerId); }} onPointerCancel={() => setDragging(false)} onLostPointerCapture={() => setDragging(false)}><span aria-hidden="true">‹ ›</span></div>
        </>}
        </div>
      </>}
    </div>
    {asset && (referencesByFile.size > 0 || hasConverted) && <section aria-label={t("assetPreview.referencesAndOutput")} className="preview-details">
      {referencesByFile.size > 0 && <div><h3>{t("assetPreview.references")}</h3><ul>{[...referencesByFile].map(([file, references]) => <li key={file} title={file}><span>{root ? relativeFile(file, root) : file}</span><span className="text-muted-foreground">:{[...new Set(references.map(reference => reference.line))].join(", ")}</span></li>)}</ul></div>}
      {hasConverted && <div><h3>{t("assetPreview.outputFile")}</h3><p className="preview-output" title={result?.pdfPath ?? undefined}>{root ? relativeFile(result?.pdfPath ?? "", root) : result?.pdfPath}<span className="text-muted-foreground"> · {formatBytes(pdfBytes ?? null)}</span></p></div>}
    </section>}
    {asset && problem && <div className="inspector-image-state">
      <p>{nativeText(result?.error ?? asset.message ?? "")}</p>
      {asset.status === "missing" && <p>{t("assetPreview.referencedPath")}<code>{asset.relativePath}</code></p>}
      <div className="inspector-image-actions">
        {asset.status === "ready" && !ignored && onRetry && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => onRetry(asset.id)}>{t("assetPreview.retryThisImage")}</Button>}
        {onLocate && ["missing", "ambiguous"].includes(asset.status) && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => onLocate(asset.id)}>{t("assetPreview.locateFile")}</Button>}
        {onInspect && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => onInspect(asset.id)}>{["missing", "ambiguous"].includes(asset.status) ? t("assetPreview.repair") : t("assetPreview.viewDetails")}</Button>}
      </div>
    </div>}

  </section>;
}
