import { lazy, Suspense, useEffect, useState } from "react";
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

function PreviewContent({ asset, converted, revision, pdfPath }: { asset: ImageAsset; converted: boolean; revision: number; pdfPath?: string | null }) {
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
  if (current.preview?.kind === "pdf") return <Suspense fallback={<div className="preview-placeholder" role="status"><LoaderCircle size={23} className="spin" aria-hidden="true" /><span>正在载入 PDF</span></div>}><PdfPreview key={requestKey} data={current.preview.data} label={converted ? pdfPath ?? asset.relativePath : asset.relativePath} /></Suspense>;
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

  return <section className="preview-panel" aria-label="图片预览">
    <div className="preview-heading">
      <div className="preview-heading-copy"><h2>图片预览</h2><div className="preview-filename" title={asset?.path ?? ""}>{asset?.relativePath ?? "未选择图片"}</div></div>
      <ToggleGroup type="single" value={compare ? "compare" : "original"} onValueChange={(value) => { if (value) setMode(value); }} variant="outline" size="sm" aria-label="预览版本">
        <ToggleGroupItem value="original" disabled={!asset}>原图</ToggleGroupItem>
        <ToggleGroupItem value="compare" disabled={!hasConverted}>对比</ToggleGroupItem>
      </ToggleGroup>
    </div>
    <div className={`preview-surface${compare ? " preview-comparison" : ""}`}>
      {unavailable ? <Empty><EmptyHeader><EmptyMedia variant="icon"><FileImage aria-hidden="true" /></EmptyMedia><EmptyTitle>{asset ? asset.message || "此图片暂不可预览" : "未选择图片"}</EmptyTitle></EmptyHeader></Empty> : <>
        <section className="preview-pane" aria-label="原图预览">
          {compare && <h3 className="preview-pane-label">原图</h3>}
          <PreviewContent asset={asset!} converted={false} revision={revision} />
        </section>
        {compare && <section className="preview-pane" aria-label="PDF 对比预览">
          <h3 className="preview-pane-label">PDF</h3>
          <PreviewContent asset={asset!} converted revision={revision} pdfPath={result?.pdfPath} />
        </section>}
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
