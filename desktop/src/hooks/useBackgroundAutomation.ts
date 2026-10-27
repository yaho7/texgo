import { useWorkspaceGuard } from "./useWorkspaceGuard";
import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ChangePreview, ConversionProgress, ImageResult, NotificationTarget, Project, SmartReport } from "../types";
import type { OperationLease } from "../state/operationMachine";
import type { WorkflowPorts, HistoryDomain, Setter } from "./workflowPorts";
import type { useConversion } from "./useConversion";
import type { useReviewFlow } from "./useReviewFlow";
import type { useOperation } from "./useOperation";
import { errorMessage } from "../utils";
export type Navigation = { project: Project; target: NotificationTarget };
interface Ports extends WorkflowPorts {
  conversion: ReturnType<typeof useConversion>;
  reviewFlow: ReturnType<typeof useReviewFlow>;
  historyDomain: HistoryDomain;
  operationDomain: Pick<ReturnType<typeof useOperation>, "current" | "acquire" | "release">;
  autoWatch: boolean; held: boolean;
  onNavigate: (payload: Navigation) => Promise<void>;
  setRevision: Setter<number>;
}
// Native automation is serial and has no run IDs. Deferred events invalidate snapshots;
// only a fresh native read may reconcile them after foreground ownership is released.
export function useBackgroundAutomation(ports: Ports) {
  const latest = useRef(ports); latest.current = ports;
  const lease = useRef<OperationLease | null>(null);
  const dirty = useRef<number | null>(null);
  const nativeError = useRef<{ generation: number; message: string } | null>(null);
  const navigation = useRef<{ generation: number; payload: Navigation } | null>(null);
  const capture = useWorkspaceGuard(() => ports.workspace.generation.current);
  const refreshing = useRef(false);
  function matches(project: Project) {
    const current = latest.current.workspace.current.current;
    return current?.root === project.root && current.mainFile === project.mainFile;
  }
  function held() {
    const p = latest.current;
    const state = p.operationDomain.current();
    return p.held || p.conversion.completionVisible() || p.reviewFlow.decisionRef.current.kind !== "none" || (state.status === "running" && state.owner === "foreground");
  }
  function defer() { dirty.current = latest.current.workspace.generation.current; }
  function currentContext(generation: number) { return generation === latest.current.workspace.generation.current; }
  function onWorkspace(project: Project) {
    if (!matches(project)) return;
    if (held()) { defer(); return; }
    const generation = latest.current.workspace.generation.current;
    const isCurrent = capture();
    void latest.current.workspace.acceptProject(project, true, "项目状态已更新").catch((reason) => { if (isCurrent() && currentContext(generation)) latest.current.setError(errorMessage(reason)); });
  }
  function onStart(project: Project) {
    if (!matches(project)) return;
    if (held()) { defer(); return; }
    const p = latest.current;
    const acquired = p.operationDomain.acquire("converting", "background");
    if (!acquired) return;
    lease.current = acquired;
    p.workspace.updateSnapshot(project);
    mergeResults(project);
    p.conversion.setProgress(null); p.setError(null);
  }
  function mergeResults(project: Project, images: ImageResult[] = []) {
    latest.current.conversion.setResults((previous) => ({
      ...Object.fromEntries(Object.entries(previous).filter(([id, image]) => (image.error || image.cancelled) && project.images.some((asset) => asset.id === id))),
      ...Object.fromEntries(project.convertedImages.map((image) => [image.id, image])),
      ...Object.fromEntries(images.map((image) => [image.id, image])),
    }));
  }
  async function queuePreview(project: Project, generation: number, ownRead = false) {
    if (!project.status.pendingReferences) return;
    const isCurrent = capture();
    try {
      const preview = await invoke<ChangePreview>("preview_changes");
      if (!isCurrent() || !currentContext(generation)) return;
      const state = latest.current.operationDomain.current();
      if (latest.current.reviewFlow.decisionRef.current.kind !== "none" || (!ownRead && state.status === "running" && state.owner === "foreground")) { defer(); return; }
      if (preview.referenceCount) latest.current.reviewFlow.queueReview(preview);
    } catch (reason) { if (isCurrent() && currentContext(generation)) onNativeError(errorMessage(reason)); }
  }
  function onFinished(report: SmartReport) {
    if (!matches(report.project)) return;
    if (held()) { defer(); return; }
    const p = latest.current;
    const generation = p.workspace.generation.current;
    p.workspace.updateSnapshot(report.project);
    p.selection.reconcileBackground(report.project, report.result.images.map((image) => image.id));
    mergeResults(report.project, report.result.images);
    p.setRevision((value) => value + 1);
    const updated = report.result.images.filter((image) => !image.error).length;
    const status = report.project.status;
    p.setNotice(updated ? `已更新 ${updated} 张图片` : status.pendingReferences ? `${status.pendingReferences} 处引用等待确认` : status.blockingReason ? "项目存在安全问题，请先处理" : status.pendingImages ? `${status.pendingImages} 张图片需要更新` : status.problemCount ? `${status.problemCount} 个问题需要处理` : "项目已是最新状态");
    // Read the preview before showing completion feedback, but never replace an open decision.
    void queuePreview(report.project, generation);
    if (updated) p.conversion.setCompletion(updated);
    void p.historyDomain.load();
  }
  function onIdle() {
    const owned = lease.current;
    if (!owned) return;
    lease.current = null;
    if (latest.current.operationDomain.release(owned)) void latest.current.historyDomain.load();
  }
  function onProgress(progress: ConversionProgress) { if (lease.current && !held()) latest.current.conversion.setProgress(progress); }
  function onResult(image: ImageResult) { if (lease.current && !held()) latest.current.conversion.setResults((previous) => ({ ...previous, [image.id]: image })); }
  function onNativeError(message: string) {
    if (held() || latest.current.currentOperationKind()) {
      nativeError.current = { generation: latest.current.workspace.generation.current, message };
    } else latest.current.setError((previous) => previous ?? message);
  }
  function onNavigate(payload: Navigation) {
    if (held() || latest.current.currentOperationKind()) { navigation.current = { generation: latest.current.workspace.generation.current, payload }; return; }
    void latest.current.execute("opening", () => latest.current.onNavigate(payload));
  }
  useEffect(() => {
    const p = latest.current;
    if (held() || p.currentOperationKind() || refreshing.current) return;
    const generation = p.workspace.generation.current;
    const isCurrent = capture();
    if (dirty.current !== null && dirty.current !== generation) dirty.current = null;
    if (navigation.current && navigation.current.generation !== generation) navigation.current = null;
    if (dirty.current === null && !navigation.current) {
      if (nativeError.current) {
        const pendingError = nativeError.current;
        nativeError.current = null;
        if (pendingError.generation === generation) p.setError((previous) => previous ?? pendingError.message);
      }
      return;
    }
    const pendingNavigation = navigation.current;
    navigation.current = null;
    dirty.current = null;
    refreshing.current = true;
    void p.execute("updating", async () => {
      let fresh = await invoke<Project>("refresh_workspace");
      if (!isCurrent() || !currentContext(generation)) return;
      if (pendingNavigation) {
        if (fresh.mainFile !== pendingNavigation.payload.target.path) {
          fresh = await invoke<Project>("open_project", { mainFile: pendingNavigation.payload.target.path });
          if (!isCurrent() || !currentContext(generation)) return;
        }
        await latest.current.onNavigate({ ...pendingNavigation.payload, project: fresh });
      } else {
        if (fresh.mainFile !== latest.current.workspace.current.current?.mainFile) return;
        await latest.current.workspace.acceptProject(fresh, true);
        if (currentContext(generation)) await queuePreview(fresh, generation, true);
      }
    }).finally(() => { refreshing.current = false; });
  });
  useEffect(() => {
    const p = latest.current;
    if (!p.autoWatch || !p.workspace.project || held() || p.currentOperationKind()) return;
    let disposed = false; let pending = false; let retryAt = 0;
    const generation = p.workspace.generation.current;
    const isCurrent = capture();
    const root = p.workspace.project.root;
    async function poll() {
      if (disposed || pending || document.hidden || held() || latest.current.currentOperationKind() || Date.now() < retryAt) return;
      pending = true;
      try {
        const next = await invoke<Project | null>("poll_workspace", { root });
        if (!next || disposed || !isCurrent() || !currentContext(generation) || next.mainFile !== latest.current.workspace.current.current?.mainFile) return;
        if (held() || latest.current.currentOperationKind()) { defer(); return; }
        await latest.current.workspace.acceptProject(next, true, "检测到图片发生变化，项目状态已更新");
      } catch (reason) { retryAt = Date.now() + 30_000; if (!disposed && currentContext(generation)) latest.current.setError(`自动检测暂不可用：${errorMessage(reason)}`); }
      finally { pending = false; }
    }
    const timer = window.setInterval(() => { void poll(); }, 2500);
    const focus = () => { void poll(); }; window.addEventListener("focus", focus);
    return () => { disposed = true; window.clearInterval(timer); window.removeEventListener("focus", focus); };
  }, [ports.workspace.project?.mainFile, ports.workspace.generation.current, ports.autoWatch, ports.held, ports.currentOperationKind()]);
  return { onWorkspace, onStart, onFinished, onIdle, onProgress, onResult, onNavigate, onNativeError };
}
