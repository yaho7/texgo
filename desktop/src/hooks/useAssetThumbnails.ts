import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AssetPreviewData, ImageAsset } from "../types";
import { ThumbnailQueue } from "../thumbnailQueue";

export interface ThumbnailContext { mainFile: string; revision: number; enabled: boolean }
async function loadThumbnail({ imageId, mainFile }: { imageId: string; mainFile: string }, isCurrent: () => boolean) {
  const preview = await invoke<AssetPreviewData>("asset_thumbnail", { imageId, expectedMainFile: mainFile });
  if (!isCurrent()) return null;
  if (preview.kind === "pdf") {
    const { pdfThumbnail } = await import("../pdfThumbnail");
    return isCurrent() ? pdfThumbnail(preview.data, isCurrent) : null;
  }
  return preview.data.startsWith("data:image/png;base64,") && preview.data.length <= 160_000 ? preview.data : null;
}
export function useAssetThumbnails(images: ImageAsset[], context?: ThumbnailContext) {
  const queueRef = useRef<ThumbnailQueue | null>(null);
  if (!queueRef.current) queueRef.current = new ThumbnailQueue(loadThumbnail);
  const queue = queueRef.current;
  const [, update] = useState(0);
  const mainFile = context?.mainFile;
  const revision = context?.revision;
  const enabled = context?.enabled;
  const identity = JSON.stringify(images.map((image) => [image.id, image.path, image.status]));
  const key = (id: string) => JSON.stringify([mainFile, revision, id]);
  useEffect(() => {
    const requests = enabled && mainFile ? images.filter((image) => image.path && ["ready", "pdf"].includes(image.status))
      .map((image) => ({ key: key(image.id), imageId: image.id, mainFile })) : [];
    return queue.set(requests, () => update((value) => value + 1));
  }, [queue, mainFile, revision, enabled, identity]);
  return (id: string) => queue.get(key(id));
}
