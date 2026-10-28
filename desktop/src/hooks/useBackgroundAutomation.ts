import { t } from "./../i18n";
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
export type ObservationIdentity = { root: string; mainFile: string; session: number };
export type ObservationUpdate = { project: Project; session: number };
export type Navigation = { project: Project; target: NotificationTarget };
interface Ports extends Pick<WorkflowPorts, "execute" | "currentOperationKind" | "setError" | "setNotice"> {
  workspace: Pick<WorkflowPorts["workspace"], "project" | "current" | "generation" | "acceptProject" | "updateSnapshot">;
  selection: Pick<WorkflowPorts["selection"], "reconcileBackground">;
  conversion: Pick<ReturnType<typeof useConversion>, "completionVisible" | "setResults" | "setProgress" | "setCompletion">;
  reviewFlow: Pick<ReturnType<typeof useReviewFlow>, "decisionRef" | "queueReview">;
  historyDomain: Pick<HistoryDomain, "load">;
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
  const observation = useRef<{ generation: number; identity: ObservationIdentity } | null>(null);
  const observationUnavailable = useRef<number | null>(null);
  const pendingObservation = useRef<{ generation: number; payload: ObservationUpdate } | null>(null);
  function matches(project: Pick<Project, "root" | "mainFile">) {
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
  function onWorkspace(project: Project, quiet = false) {
    if (!matches(project)) return;
    if (held()) { defer(); return; }
    const generation = latest.current.workspace.generation.current;
    const isCurrent = capture();
    void latest.current.workspace.acceptProject(project, true, "").catch((reason) => { if (isCurrent() && currentContext(generation)) { if (quiet) latest.current.setNotice(t("backgroundAutomation.fileMonitoringIsTemporarilyUnavailable")); else latest.current.setError(errorMessage(reason)); } });
  }
  function matchesObservation(identity: ObservationIdentity) {
    const p = latest.current;
    const current = observation.current;
    return p.autoWatch && current?.generation === p.workspace.generation.current
      && current.identity.session === identity.session && current.identity.root === identity.root
      && current.identity.mainFile === identity.mainFile;
  }
  function onObserved(payload: ObservationUpdate) {
    const generation = latest.current.workspace.generation.current;
    // The identity read can queue behind a conversion. Retain one update until
    // that read identifies its session; an older session can never replace it.
    if (latest.current.autoWatch && matches(payload.project) && observation.current?.generation !== generation) {
      const pending = pendingObservation.current;
      if (!pending || pending.generation !== generation || pending.payload.session <= payload.session) {
        pendingObservation.current = { generation, payload };
      }
      return;
    }
    if (!matchesObservation({ ...payload.project, session: payload.session }) || !matches(payload.project)) return;
    if (held() || latest.current.currentOperationKind() || document.hidden) { defer(); return; }
    onWorkspace(payload.project, true);
  }
  function onObservationUnavailable(identity: ObservationIdentity) {
    if (!matchesObservation(identity)) return;
    if (held() || latest.current.currentOperationKind() || document.hidden) {
      observationUnavailable.current = latest.current.workspace.generation.current;
    } else latest.current.setNotice(t("backgroundAutomation.fileMonitoringIsTemporarilyUnavailable"));
  }
  useEffect(() => {
    observation.current = null;
    const p = latest.current;
    if (!p.autoWatch || !p.workspace.project) return;
    let active = true;
    const generation = p.workspace.generation.current;
    const isCurrent = capture();
    void invoke<ObservationIdentity | null>("observation_identity").then((identity) => {
      if (active && isCurrent() && identity && matches(identity)) {
        observation.current = { generation, identity };
        const pending = pendingObservation.current;
        pendingObservation.current = null;
        if (pending?.generation === generation) onObserved(pending.payload);
      }
    }).catch(() => {});
    return () => { active = false; };
  }, [ports.workspace.project?.mainFile, ports.workspace.generation.current, ports.autoWatch]);
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
    } catch (reason) { if (isCurrent() && currentContext(generation)) { if (ownRead) latest.current.setNotice(t("backgroundAutomation.fileMonitoringIsTemporarilyUnavailable")); else onNativeError(errorMessage(reason)); } }
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
    p.setNotice(updated ? t("backgroundAutomation.updatedValueImages", { arg0: updated }) : status.pendingReferences ? t("backgroundAutomation.valueReferencesAwaitApproval", { arg0: status.pendingReferences }) : status.blockingReason ? t("backgroundAutomation.resolveTheProjectSafetyIssueFirst") : status.pendingImages ? t("backgroundAutomation.valueImagesNeedUpdating", { arg0: status.pendingImages }) : status.problemCount ? t("backgroundAutomation.valueProblemsNeedAttention", { arg0: status.problemCount }) : "");
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
    if (document.hidden || held() || p.currentOperationKind() || refreshing.current) return;
    const generation = p.workspace.generation.current;
    const isCurrent = capture();
    if (observationUnavailable.current !== null) {
      if (observationUnavailable.current === generation) p.setNotice(t("backgroundAutomation.fileMonitoringIsTemporarilyUnavailable"));
      observationUnavailable.current = null;
    }
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
      let fresh = await invoke<Project>("refresh_workspace").catch((reason) => {
        if (pendingNavigation) throw reason;
        if (isCurrent() && currentContext(generation)) latest.current.setNotice(t("backgroundAutomation.fileMonitoringIsTemporarilyUnavailable"));
        return null;
      });
      if (!fresh) return;
      if (!isCurrent() || !currentContext(generation)) return;
      if (document.hidden) {
        defer();
        if (pendingNavigation) navigation.current = pendingNavigation;
        return;
      }
      if (pendingNavigation) {
        if (fresh.mainFile !== pendingNavigation.payload.target.path) {
          fresh = await invoke<Project>("open_project", { mainFile: pendingNavigation.payload.target.path });
          if (!isCurrent() || !currentContext(generation)) return;
        }
        await latest.current.onNavigate({ ...pendingNavigation.payload, project: fresh });
      } else {
        if (fresh.mainFile !== latest.current.workspace.current.current?.mainFile) return;
        await latest.current.workspace.acceptProject(fresh, true, "");
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
        if (document.hidden || held() || latest.current.currentOperationKind()) { defer(); return; }
        await latest.current.workspace.acceptProject(next, true, "");
      } catch { retryAt = Date.now() + 30_000; if (!disposed && currentContext(generation)) latest.current.setNotice(t("backgroundAutomation.fileMonitoringIsTemporarilyUnavailable")); }
      finally { pending = false; }
    }
    const timer = window.setInterval(() => { void poll(); }, 30_000);
    const focus = () => { if (dirty.current === generation || observationUnavailable.current === generation) latest.current.setRevision((value) => value + 1); void poll(); }; window.addEventListener("focus", focus);
    return () => { disposed = true; window.clearInterval(timer); window.removeEventListener("focus", focus); };
  }, [ports.workspace.project?.mainFile, ports.workspace.generation.current, ports.autoWatch, ports.held, ports.currentOperationKind()]);
  return { onObserved, onObservationUnavailable, onWorkspace, onStart, onFinished, onIdle, onProgress, onResult, onNavigate, onNativeError };
}
