import { useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { defaultSettings } from "../settings";
import type { ConversionSettings } from "../settings";
import type { Preferences } from "../preferences";
import { readRecents, readSettings, rememberWorkspace, removeRecent, storeSettings, workspaceKey } from "../recents";
import type { RecentWorkspace } from "../recents";
import type { Project } from "../types";
import type { Operation } from "../state/operationMachine";

interface WorkspacePorts {
  preferences: () => Preferences;
  execute: (kind: Operation, action: () => Promise<void>) => Promise<void>;
  isBusy: () => boolean;
  onAccept: (next: Project, same: boolean) => void;
  onReset: () => void;
  loadHistory: () => Promise<void>;
  onNotice: (message: string) => void;
}
export function useWorkspace(ports: WorkspacePorts) {
  const latest = useRef(ports); latest.current = ports;
  const [project, setProject] = useState<Project | null>(null);
  const current = useRef<Project | null>(null);
  const generation = useRef(0);
  const [recents, setRecents] = useState(readRecents);
  const [failedRecent, setFailedRecent] = useState<string | null>(null);
  const [settings, setSettings] = useState<ConversionSettings>(defaultSettings);
  const contextKey = project ? workspaceKey({ path: project.mainFile }) : null;
  function updateSnapshot(next: Project) {
    if (current.current?.mainFile !== next.mainFile) generation.current++;
    current.current = next; setProject(next);
  }
  function discardProject() {
    generation.current++; current.current = null; setProject(null); latest.current.onReset();
  }
  async function acceptProject(next: Project, preserveContext: boolean, message?: string) {
    const same = preserveContext && current.current?.mainFile === next.mainFile;
    if (!same) {
      if (current.current?.mainFile === next.mainFile) generation.current++;
      const defaults = latest.current.preferences();
      setSettings(readSettings(workspaceKey({ path: next.mainFile })) ?? { dpi: String(defaults.dpi), jpegQuality: String(defaults.jpegQuality), outputDir: defaults.outputDir });
    }
    // Publish the current identity before callbacks or asynchronous history reads.
    updateSnapshot(next);
    latest.current.onAccept(next, same);
    setFailedRecent(null);
    const saved = rememberWorkspace({ path: next.mainFile });
    setRecents(readRecents());
    latest.current.onNotice(saved ? message ?? `已识别 ${next.status.totalImages} 张项目图片` : "项目已打开，最近记录暂未保存");
    await latest.current.loadHistory();
  }
  async function refresh(message?: string) {
    const key = current.current?.mainFile;
    const started = generation.current;
    if (!key) return;
    const isCurrent = () => generation.current === started && current.current?.mainFile === key;
    try {
      const next = await invoke<Project>("refresh_workspace");
      if (isCurrent()) await acceptProject(next, true, message);
    } catch (reason) { if (isCurrent()) throw reason; }
  }
  function openProject() {
    void latest.current.execute("opening", async () => {
      const mainFile = await open({ multiple: false, directory: false, title: "打开 .tex 主文件", filters: [{ name: "LaTeX", extensions: ["tex"] }] });
      if (typeof mainFile === "string") await acceptProject(await invoke<Project>("open_project", { mainFile }), false);
    });
  }
  function openRecent(entry: RecentWorkspace) {
    if (current.current?.mainFile === entry.path) return;
    void latest.current.execute("opening", async () => {
      try { await acceptProject(await invoke<Project>("open_project", { mainFile: entry.path }), false); }
      catch (reason) { setFailedRecent(workspaceKey(entry)); throw reason; }
    });
  }
  function openPath(mainFile: string) { return latest.current.execute("opening", async () => acceptProject(await invoke<Project>("open_project", { mainFile }), false)); }
  function closeProject() {
    if (latest.current.isBusy()) return;
    void latest.current.execute("opening", async () => {
      await invoke("close_workspace"); discardProject(); latest.current.onNotice("已关闭当前项目");
    });
  }
  function updateSettings(next: ConversionSettings) {
    setSettings(next);
    if (current.current && !storeSettings(workspaceKey({ path: current.current.mainFile }), next)) latest.current.onNotice("设置仅保留在本次会话中，请检查应用存储权限");
  }
  function forgetRecent(entry: RecentWorkspace) {
    const saved = removeRecent(entry); setRecents(readRecents());
    latest.current.onNotice(saved ? "已移除最近记录，文件未删除" : "无法移除记录，请检查应用存储权限");
  }
  return { project, current, generation, contextKey, recents, failedRecent, settings,
    acceptProject, refresh, openProject, openRecent, openPath, closeProject, updateSettings, forgetRecent, discardProject, updateSnapshot };
}
