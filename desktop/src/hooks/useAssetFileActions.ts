import { t } from "./../i18n";
import { useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Project } from "../types";
import type { Operation } from "../state/operationMachine";

interface Ports {
  currentProject: () => Project | null;
  isBusy: () => boolean;
  captureWorkspace: () => () => boolean;
  execute: (kind: Operation, action: () => Promise<void>) => Promise<void>;
  onNotice: (notice: string) => void;
}
export function useAssetFileActions(ports: Ports) {
  const latest = useRef(ports); latest.current = ports;
  async function perform(imageId: string, action: "reveal" | "revealPdf" | "copyPath") {
    const current = latest.current;
    const project = current.currentProject();
    if (!project || current.isBusy()) return;
    const asset = project.images.find(asset => asset.id === imageId);
    if (!asset || (action === "revealPdf" ? !project.convertedImages.some(image => image.id === imageId && image.pdfPath) : !asset.path || ["missing", "ambiguous"].includes(asset.status))) return;
    const isCurrent = current.captureWorkspace();
    await current.execute("updating", async () => {
      if (!isCurrent() || current.currentProject()?.mainFile !== project.mainFile) return;
      try { await invoke("asset_file_action", { imageId, action, expectedMainFile: project.mainFile }); }
      catch (error) { if (isCurrent()) throw error; return; }
      if (isCurrent() && action === "copyPath") current.onNotice(t("assetFileActions.copiedTheFullImagePath"));
    });
  }
  return { revealPdf: (id: string) => { void perform(id, "revealPdf"); }, revealAsset: (id: string) => { void perform(id, "reveal"); }, copyAssetPath: (id: string) => { void perform(id, "copyPath"); } };
}
