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
  async function perform(imageId: string, action: "reveal" | "copyPath") {
    const current = latest.current;
    const project = current.currentProject();
    if (!project || current.isBusy() || !project.images.some((asset) => asset.id === imageId && asset.path && !["missing", "ambiguous"].includes(asset.status))) return;
    const isCurrent = current.captureWorkspace();
    await current.execute("updating", async () => {
      if (!isCurrent() || current.currentProject()?.mainFile !== project.mainFile) return;
      try { await invoke("asset_file_action", { imageId, action, expectedMainFile: project.mainFile }); }
      catch (error) { if (isCurrent()) throw error; return; }
      if (isCurrent()) current.onNotice(action === "copyPath" ? "已复制图片完整路径" : "已在文件管理器中显示图片");
    });
  }
  return { revealAsset: (id: string) => { void perform(id, "reveal"); }, copyAssetPath: (id: string) => { void perform(id, "copyPath"); } };
}
