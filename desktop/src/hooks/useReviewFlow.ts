import { hasTransientOverlay } from "./useTransientOverlay";
import { useWorkspaceGuard } from "./useWorkspaceGuard";
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { ChangePreview, ConversionHistoryEntry, ReplacementResult } from "../types";
import type { RepairCandidate } from "../AssetProblems";
import { errorMessage } from "../utils";
import type { WorkflowPorts, Setter } from "./workflowPorts";
import type { BusinessDecision } from "../state/businessDecision";
interface Ports extends WorkflowPorts {
  setView: Setter<"assets" | "history">;
  completionVisible: () => boolean;
  automaticReviewAllowed: boolean;
}
export function useReviewFlow(ports: Ports) {
  const { workspace, selection, execute, currentOperationKind, setNotice, rememberFocus, restoreFocus, setView } = ports;
  const { project, refresh } = workspace;
  const capture = useWorkspaceGuard(() => workspace.generation.current);
  const { activate: setActiveId } = selection;
  const [decision, updateDecision] = useState<BusinessDecision>({ kind: "none" });
  const decisionRef = useRef(decision);
  function decide(next: BusinessDecision) { decisionRef.current = next; updateDecision(next); }
  const review = decision.kind === "review" ? decision.preview : null;
  const reviewKind = decision.kind === "review" && decision.repair ? "repair" : "conversion";
  const problemId = decision.kind === "problem" ? decision.imageId : null;
  const undoEntry = decision.kind === "undo" ? decision.entry : null;
  const conversionBlocked = decision.kind === "manual-block";
  const [repairCandidates, setRepairCandidates] = useState<RepairCandidate[]>([]);
  const [queuedReview, setQueuedReview] = useState<{ generation: number; preview: ChangePreview } | null>(null);
  function setReview(preview: ChangePreview | null) { if (preview) showReview(preview); else if (decisionRef.current.kind === "review") decide({ kind: "none" }); }
  function showReview(preview: ChangePreview, kind: "conversion" | "repair" = "conversion") { decide({ kind: "review", preview, repair: kind === "repair" }); }
  function setProblemId(imageId: string | null) { if (imageId) decide({ kind: "problem", imageId }); else if (decisionRef.current.kind === "problem") decide({ kind: "none" }); }
  function setConversionBlocked(blocked: boolean) { if (blocked) decide({ kind: "manual-block" }); else if (decisionRef.current.kind === "manual-block") decide({ kind: "none" }); }
  function requestUndo(entry: ConversionHistoryEntry) { if (!currentOperationKind() && decisionRef.current.kind === "none") decide({ kind: "undo", entry }); }
  function dismissUndo() { if (decisionRef.current.kind === "undo") decide({ kind: "none" }); }
  function queueReview(preview: ChangePreview) { setQueuedReview({ generation: workspace.generation.current, preview }); }
  function reset() { decide({ kind: "none" }); setQueuedReview(null); setRepairCandidates([]); }
  useEffect(() => {
    if (!queuedReview) return;
    if (queuedReview.generation !== workspace.generation.current) { setQueuedReview(null); return; }
    if (currentOperationKind() || ports.completionVisible() || !ports.automaticReviewAllowed || hasTransientOverlay() || decision.kind !== "none") return;
    rememberFocus(); showReview(queuedReview.preview); setQueuedReview(null);
  });
  function reviewChanges() {
    if (!project || currentOperationKind() || decisionRef.current.kind !== "none") return;
    rememberFocus(); setQueuedReview(null);

    const isCurrent = capture();
    void execute("reviewing", async () => {
      const preview = await invoke<ChangePreview>("preview_changes");
      if (!isCurrent()) return;
      if (preview.referenceCount > 0) showReview(preview);
      else await refresh("引用已是最新状态");
    });
  }

  function inspectProblem(imageId: string) {
    if (!project || currentOperationKind() || decisionRef.current.kind !== "none") return;
    setView("assets"); setActiveId(imageId); setProblemId(imageId); setRepairCandidates([]); rememberFocus();
    const isCurrent = capture();
    const asset = project.images.find((image) => image.id === imageId);
    if (asset && ["missing", "ambiguous"].includes(asset.status)) void execute("reviewing", async () => { const candidates = await invoke<RepairCandidate[]>("repair_candidates", { imageId }); if (isCurrent()) setRepairCandidates(candidates); }, "repair");
  }

  function chooseRepair(imageId: string, target: string) {
    const isCurrent = capture();
    void execute("reviewing", async () => {
      const preview = await invoke<ChangePreview>("preview_repair", { imageId, target });
      if (isCurrent()) showReview(preview, "repair");
    }, "repair");
  }

  function locateRepair(imageId: string) {
    const isCurrent = capture();
    void execute("opening", async () => {
      const target = await open({ multiple: false, directory: false, title: "定位项目内的图片", defaultPath: project?.root, filters: [{ name: "图片或 PDF", extensions: ["png", "jpg", "jpeg", "svg", "webp", "tif", "tiff", "bmp", "pdf"] }] });
      if (!isCurrent() || typeof target !== "string") return;
      const preview = await invoke<ChangePreview>("preview_repair", { imageId, target });
      if (isCurrent()) showReview(preview, "repair");
    }, "repair");
  }

  function replace(undo: boolean, selection: string[] = []) {
    if (!project || (!undo && !review)) return;
    const isCurrent = capture();
    void execute(undo ? "undoing" : "applying", async () => {
      let result: ReplacementResult;
      try { result = await invoke<ReplacementResult>(undo ? "undo_replacements" : "apply_replacements", undo ? undefined : { selection, expected: review, repair: reviewKind === "repair" }); }
      catch (reason) {
        if (!isCurrent()) return;
        // A failed write may still have created an undo record or changed some files.
        setReview(null);
        try { await refresh("操作中断，已重新读取工作区"); }
        catch (refreshError) {
          if (!isCurrent()) return;
          workspace.discardProject();
          throw new Error(`${errorMessage(reason)}；重新扫描失败，请重新打开工作区：${errorMessage(refreshError)}`);
        }
        restoreFocus();
        throw reason;
      }
      if (!isCurrent()) return;
      setReview(null);
      const message = `${undo ? "已恢复" : "已替换"} ${result.filesChanged} 个文件中的 ${result.referencesChanged} 处引用`;
      setNotice(message);
      try { await refresh(message); }
      catch (reason) {
        if (!isCurrent()) return; workspace.discardProject(); throw new Error(`${message}，但重新扫描失败，请重新打开工作区：${errorMessage(reason)}`); }
    }, undo ? undefined : "apply-review");
  }

  return { decision, decisionRef, review, reviewKind, problemId, undoEntry, conversionBlocked, repairCandidates,
    setReview, showReview, setProblemId, setConversionBlocked, requestUndo, dismissUndo, queueReview, reset,
    clearQueue: () => setQueuedReview(null), reviewChanges, inspectProblem, chooseRepair, locateRepair, replace };
}
