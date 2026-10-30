import { t } from "./../i18n";
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
  const [directReview, setDirectReview] = useState(false);
  const [decision, updateDecision] = useState<BusinessDecision>({ kind: "none" });
  const decisionRef = useRef(decision);
  function decide(next: BusinessDecision) { decisionRef.current = next; updateDecision(next); }
  const review = decision.kind === "review" ? decision.preview : null;
  const reviewKind = decision.kind === "review" && decision.repair ? "repair" : "conversion";
  const problemId = decision.kind === "problem" ? decision.imageId : null;
  const undoEntry = decision.kind === "undo" ? decision.entry : null;
  const conversionBlocked = decision.kind === "manual-block";
  const [repairCandidates, setRepairCandidates] = useState<RepairCandidate[]>([]);
  const [queuedReview, setQueuedReview] = useState<{ generation: number; preview: ChangePreview; originals?: boolean } | null>(null);
  const reviewOriginals = useRef(false);
  function setReview(preview: ChangePreview | null) { if (preview) showReview(preview); else if (decisionRef.current.kind === "review") decide({ kind: "none" }); }
  function showReview(preview: ChangePreview, kind: "conversion" | "repair" = "conversion", repairContext?: { imageId: string; target: string }, originals = false) { reviewOriginals.current = originals; setDirectReview(false); decide({ kind: "review", preview, repair: kind === "repair", repairContext }); }
  function setProblemId(imageId: string | null) { if (imageId) decide({ kind: "problem", imageId }); else if (decisionRef.current.kind === "problem") decide({ kind: "none" }); }
  function setConversionBlocked(blocked: boolean) { if (blocked) decide({ kind: "manual-block" }); else if (decisionRef.current.kind === "manual-block") decide({ kind: "none" }); }
  function requestUndo(entry: ConversionHistoryEntry) { if (!currentOperationKind() && decisionRef.current.kind === "none") decide({ kind: "undo", entry }); }
  function dismissUndo() { if (decisionRef.current.kind === "undo") decide({ kind: "none" }); }
  function queueReview(preview: ChangePreview, originals = false, explicit = false) { setQueuedReview(previous => previous?.originals && !originals && !explicit && previous.generation === workspace.generation.current ? previous : { generation: workspace.generation.current, preview, originals }); }
  function reset() { decide({ kind: "none" }); setQueuedReview(null); setRepairCandidates([]); }
  const pendingPreview = queuedReview?.generation === workspace.generation.current ? queuedReview.preview : null;
  const pendingRestore = Boolean(pendingPreview && queuedReview?.originals);
  const preparingPreview = useRef(false);
  useEffect(() => {
    if (queuedReview && queuedReview.generation !== workspace.generation.current) { setQueuedReview(null); return; }
    if (pendingRestore) return;
    if (!project?.status.pendingReferences) { if (queuedReview) setQueuedReview(null); return; }
    if (pendingPreview || preparingPreview.current || currentOperationKind() || decision.kind !== "none") return;
    const isCurrent = capture();
    preparingPreview.current = true;
    void invoke<ChangePreview>("preview_changes").then(preview => {
      if (isCurrent() && preview.referenceCount) queueReview(preview);
    }).catch(reason => { if (isCurrent()) ports.setError(errorMessage(reason)); })
      .finally(() => { preparingPreview.current = false; });
  }, [project?.stateFingerprint, project?.status.pendingReferences, pendingPreview, decision.kind, currentOperationKind()]);
  function updateReferences() {
    if (currentOperationKind() || decisionRef.current.kind !== "none") return;
    if (!pendingPreview) { prepareReferences(false, true); return; }
    const ids = pendingPreview.files.flatMap(file => file.changes.map(change => change.id)).filter(Boolean);
    if (!ids.length) return;
    rememberFocus(); showReview(pendingPreview, "conversion", undefined, pendingRestore); setDirectReview(true);
  }
  function confirmReferences() {
    if (currentOperationKind() || decisionRef.current.kind !== "review" || decisionRef.current.conflict) return;
    const expected = decisionRef.current.preview;
    const ids = expected.files.flatMap(file => file.changes.map(change => change.id)).filter(Boolean);
    if (ids.length) replace(false, ids, expected, true);
  }
  function prepareReferences(originals: boolean, confirmAfter = false) {
    if (!project || currentOperationKind() || decisionRef.current.kind !== "none") return;
    const isCurrent = capture();
    void execute("reviewing", async () => {
      const preview = await invoke<ChangePreview>("preview_changes", originals ? {restoreOriginals:true} : undefined);
      if (!isCurrent()) return;
      if (preview.referenceCount) {
        queueReview(preview, originals, true);
        if (confirmAfter) { rememberFocus(); showReview(preview, "conversion", undefined, originals); setDirectReview(true); }
      }
      else { setQueuedReview(null); setNotice(t("reviewDialog.noReferenceChangesAvailable")); }
    });
  }
  function reviewChanges() {
    if (!project || currentOperationKind() || decisionRef.current.kind !== "none") return;
    if (pendingPreview) { rememberFocus(); showReview(pendingPreview, "conversion", undefined, pendingRestore); return; }
    rememberFocus(); setQueuedReview(null);

    const isCurrent = capture();
    void execute("reviewing", async () => {
      const preview = await invoke<ChangePreview>("preview_changes");
      if (!isCurrent()) return;
      if (preview.referenceCount > 0) showReview(preview);
      else await refresh();
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
      if (isCurrent()) showReview(preview, "repair", { imageId, target });
    }, "repair");
  }

  function locateRepair(imageId: string) {
    const isCurrent = capture();
    void execute("opening", async () => {
      const target = await open({ multiple: false, directory: false, title: t("reviewFlow.locateAnImageInsideTheProject"), defaultPath: project?.root, filters: [{ name: t("reviewFlow.imagesOrPDFs"), extensions: ["png", "jpg", "jpeg", "svg", "webp", "tif", "tiff", "bmp", "pdf"] }] });
      if (!isCurrent() || typeof target !== "string") return;
      const preview = await invoke<ChangePreview>("preview_repair", { imageId, target });
      if (isCurrent()) showReview(preview, "repair", { imageId, target });
    }, "repair");
  }

  function replace(undo: boolean, selection: string[] = [], approved?: ChangePreview, refreshReferences = false) {
    let expected = approved ?? review;
    if (!project || (!undo && (!expected || (decisionRef.current.kind === "review" && decisionRef.current.conflict)))) return;
    const isCurrent = capture();
    const originals = reviewOriginals.current;
    void execute(undo ? "undoing" : "applying", async () => {
      if (refreshReferences) {
        // Confirmation approves the reference update intent. Saved edits can move
        // references, so rebuild their locations before submitting the checked write.
        await refresh();
        if (!isCurrent()) return;
        expected = await invoke<ChangePreview>("preview_changes", originals ? {restoreOriginals:true} : undefined);
        if (!isCurrent()) return;
        selection = expected.files.flatMap(file => file.changes.map(change => change.id)).filter(Boolean);
        if (!selection.length) {
          setReview(null); setQueuedReview(null);
          setNotice(t("reviewDialog.noReferenceChangesAvailable"));
          restoreFocus();
          return;
        }
        showReview(expected, "conversion", undefined, originals); setDirectReview(true);
      }
      let result: ReplacementResult;
      try { result = await invoke<ReplacementResult>(undo ? "undo_replacements" : "apply_replacements", undo ? undefined : { selection, expected, repair: approved ? false : reviewKind === "repair", ...(originals ? {restoreOriginals:true} : {}) }); }
      catch (reason) {
        if (!isCurrent()) return;
        if (!undo && isReviewConflict(reason) && decisionRef.current.kind === "review") {
          setQueuedReview(null);
          decide({ ...decisionRef.current, conflict: { path: reason.path, message: reason.message } });
          return;
        }
        // A failed write may still have created an undo record or changed some files.
        setReview(null); setQueuedReview(null);
        try { await refresh(t("reviewFlow.operationInterruptedWorkspaceHasBeenReloaded")); }
        catch (refreshError) {
          if (!isCurrent()) return;
          workspace.discardProject();
          throw new Error(t("reviewFlow.valueRescanFailedReopenTheWorkspaceValue", { arg0: reviewErrorMessage(reason), arg1: errorMessage(refreshError) }));
        }
        restoreFocus();
        throw new Error(reviewErrorMessage(reason));
      }
      if (!isCurrent()) return;
      setReview(null); setQueuedReview(null);
      const message = t("reviewFlow.valueValueReferencesInValueFiles", { arg0: undo ? t("reviewFlow.restored") : t("reviewFlow.replaced"), arg1: result.filesChanged, arg2: result.referencesChanged });
      setNotice(message);
      try { await refresh(message); }
      catch (reason) {
        if (!isCurrent()) return; workspace.discardProject(); throw new Error(t("reviewFlow.valueButRescanningFailedReopenTheWorkspaceValue", { arg0: message, arg1: errorMessage(reason) })); }
    }, undo ? undefined : "apply-review");
  }

  function rescanReview() {
    const stale = decisionRef.current;
    const compact = directReview;
    if (!project || currentOperationKind() || stale.kind !== "review" || !stale.conflict) return;
    const isCurrent = capture();
    void execute("reviewing", async () => {
      await refresh(t("reviewFlow.rescannedReviewTheReferenceChangesAgain"));
      if (!isCurrent()) return;
      if (stale.repair) {
        const context = stale.repairContext;
        if (!context) { decide({ kind: "none" }); setNotice(t("reviewFlow.repairPreviewExpiredLocateTheFileAgain")); return; }
        try {
          const preview = await invoke<ChangePreview>("preview_repair", context);
          if (isCurrent()) showReview(preview, "repair", context);
        } catch (reason) {
          if (!isCurrent()) return;
          // A changed reference can have a new asset identity. Never reuse its
          // previous repair plan; return to an explicit problem selection.
          if (workspace.current.current?.images.some((image) => image.id === context.imageId)) {
            setRepairCandidates([]); decide({ kind: "problem", imageId: context.imageId });
          } else decide({ kind: "none" });
          throw new Error(t("reviewFlow.repairPreviewExpiredLocateTheFileAgainValue", { arg0: errorMessage(reason) }));
        }
      } else {
        const preview = await invoke<ChangePreview>("preview_changes", reviewOriginals.current ? {restoreOriginals:true} : undefined);
        if (isCurrent()) { showReview(preview, "conversion", undefined, reviewOriginals.current); setDirectReview(compact); }
      }
    }, "rescan-review");
  }

  return { confirmReferences, confirmingOriginals: reviewOriginals.current, prepareReferences, restoreReferences: () => prepareReferences(true), pendingRestore, directReview, pendingPreview, updateReferences, decision, decisionRef, review, reviewKind, problemId, undoEntry, conversionBlocked, repairCandidates,
    setReview, showReview, setProblemId, setConversionBlocked, requestUndo, dismissUndo, queueReview, reset,
    clearQueue: () => setQueuedReview(null), reviewChanges, inspectProblem, chooseRepair, locateRepair, replace, rescanReview };
}

function isReviewConflict(reason: unknown): reason is { kind: "reviewConflict"; path: string; message: string } {
  return typeof reason === "object" && reason !== null && "kind" in reason && reason.kind === "reviewConflict"
    && "path" in reason && typeof reason.path === "string" && "message" in reason && typeof reason.message === "string";
}
function reviewErrorMessage(reason: unknown) {
  return typeof reason === "object" && reason !== null && "message" in reason && typeof reason.message === "string" ? reason.message : errorMessage(reason);
}
