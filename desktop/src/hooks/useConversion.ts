import { useWorkspaceGuard } from "./useWorkspaceGuard";
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ChangePreview, ConversionIntent, ConversionProgress, ConversionResult, ImageResult, Project } from "../types";
import type { Preferences } from "../preferences";
import { conversionOptions, settingsIssues } from "../settings";
import { errorMessage } from "../utils";
import type { WorkflowPorts, HistoryDomain, Setter } from "./workflowPorts";
import type { useReviewFlow } from "./useReviewFlow";
interface Ports extends WorkflowPorts {
  preferences: Preferences;
  reviewFlow: ReturnType<typeof useReviewFlow>;
  loadHistory: HistoryDomain["load"];
  setHighlightBatch: Setter<string | null>;
}
export function useConversion(ports: Ports) {
  const { workspace, selection, execute, currentOperationKind, setError, setNotice, rememberFocus, preferences, reviewFlow, loadHistory, setHighlightBatch } = ports;
  const { project, settings, acceptProject, refresh } = workspace;
  const { selectionMode, selected, convertibleIds } = selection;
  const { setReview, setConversionBlocked } = reviewFlow;
  const canReview = (project?.status.pendingReferences ?? 0) > 0;
  const [completion, updateCompletion] = useState<number | null>(null);
  const completionRef = useRef<number | null>(null);
  function setCompletion(value: number | null) { completionRef.current = value; updateCompletion(value); }
  function completionVisible() { return completionRef.current !== null; }
  const [results, setResults] = useState<Record<string, ImageResult>>({});
  const [progress, setProgress] = useState<ConversionProgress | null>(null);
  const [cancelRequested, setCancelRequested] = useState(false);
  const cancelRef = useRef(false);
  const capture = useWorkspaceGuard(() => workspace.generation.current);
  const subscriptions = useRef(new Set<() => void>());
  useEffect(() => () => { subscriptions.current.forEach((stop) => stop()); subscriptions.current.clear(); }, []);
  useEffect(() => { if (completion === null) return; const timer = window.setTimeout(() => setCompletion(null), 650); return () => window.clearTimeout(timer); }, [completion]);
  function reset() { setResults({}); setCompletion(null); setProgress(null); }
  function allowManualConversionPanel() {
    if (currentOperationKind() || reviewFlow.decisionRef.current.kind !== "none") return false;
    if (canReview && !preferences.allowUnreviewed) { rememberFocus(); setConversionBlocked(true); return false; }
    return true;
  }

  function convert(intent: ConversionIntent = selectionMode ? "selected" : "pending", explicitIds?: string[]) {
    if (!project || currentOperationKind() || reviewFlow.decisionRef.current.kind !== "none" || project.status.blockingReason) return;
    if (canReview && !preferences.allowUnreviewed) { rememberFocus(); setConversionBlocked(true); return; }
    const issues = settingsIssues(settings);
    const first = (["dpi", "jpegQuality", "outputDir"] as const).find((key) => issues[key]);
    if (first) {
      document.getElementById({ dpi: "conversion-dpi", jpegQuality: "conversion-quality", outputDir: "conversion-output" }[first])?.focus();
      return;
    }
    const imageIds = intent === "pending" ? project.status.pendingImageIds : (explicitIds ?? [...selected]).filter((id) => convertibleIds.has(id));
    if (!imageIds.length) return;
    const isCurrent = capture();
    void execute("converting", async () => {
      setReview(null);
      setHighlightBatch(null);
      setProgress(null);
      cancelRef.current = false;
      setCancelRequested(false);
      setResults((previous) => Object.fromEntries(Object.entries(previous).filter(([id]) => !imageIds.includes(id))));
      let acceptingEvents = true;
      const stops: (() => void)[] = [];
      function dispose() { acceptingEvents = false; stops.forEach((stop) => { try { stop(); } catch { /* already detached */ } }); }
      subscriptions.current.add(dispose);
      function keep(stop: () => void) { if (!isCurrent()) { stop(); return; } stops.push(stop); }
      try {
        keep(await listen<ConversionProgress>("conversion-progress", ({ payload }) => { if (acceptingEvents && isCurrent()) setProgress(payload); }));
        if (!isCurrent()) return;
        keep(await listen<ImageResult>("conversion-result", ({ payload }) => {
          if (acceptingEvents && isCurrent() && imageIds.includes(payload.id)) setResults((previous) => ({ ...previous, [payload.id]: payload }));
        }));
        if (!isCurrent()) return;
        if (cancelRef.current) { setNotice("已取消：0 张已完成"); return; }
        const result = await invoke<ConversionResult>("convert_images", { options: conversionOptions(settings, imageIds), intent });
        if (!isCurrent()) return;
        const next: Record<string, ImageResult> = {};
        for (const image of result.images) next[image.id] = { ...image, error: image.error || (!image.pdfPath ? "未生成 PDF" : null) };
        for (const id of imageIds) {
          if (!next[id]) next[id] = { id, pdfPath: null, bytes: null, cached: false, error: result.cancelled ? null : "未返回转换结果", cancelled: result.cancelled };
        }
        setResults((previous) => ({ ...previous, ...next }));
        selection.clearSelection();
        const succeeded = result.images.filter((image) => image.pdfPath && !image.error).length;
        const failed = Object.values(next).filter((image) => image.error).length;
        setNotice(result.cancelled ? `已取消：${succeeded} 张已完成` : `已更新 ${succeeded} 张图片${failed ? `，${failed} 张需要处理` : ""}`);
        const fresh = await invoke<Project>("refresh_workspace");
        if (!isCurrent() || fresh.mainFile !== project.mainFile) return;
        await acceptProject(fresh, true, result.cancelled ? `已取消：${succeeded} 张已完成` : `已更新 ${succeeded} 张图片${failed ? `，${failed} 张需要处理` : ""}`);
        if (!isCurrent()) return;
        if (succeeded > 0) setCompletion(succeeded);
        if (fresh.status.pendingReferences > 0) {
          const preview = await invoke<ChangePreview>("preview_changes");
          if (!isCurrent()) return;
          if (preview.referenceCount > 0) reviewFlow.queueReview(preview);
        }
      } catch (reason) {
        if (!isCurrent()) return;
        // A multi-destination update may have partially completed before returning an error.
        try { await refresh("更新中断，已重新读取项目状态"); }
        catch (recovery) { if (!isCurrent()) return; workspace.discardProject(); throw new Error(`${errorMessage(reason)}；重新扫描失败：${errorMessage(recovery)}`); }
        throw reason;
      } finally {
        dispose();
        subscriptions.current.delete(dispose);
        if (isCurrent()) {
          cancelRef.current = false;
          setCancelRequested(false);
          await loadHistory();
        }
      }
    });
  }

  async function cancelConversion() {
    if (currentOperationKind() !== "converting" || cancelRef.current) return;
    const isCurrent = capture();
    cancelRef.current = true;
    setCancelRequested(true);
    try { await invoke("cancel_conversion"); }
    catch (reason) {
      if (isCurrent() && currentOperationKind() === "converting") {
        cancelRef.current = false;
        setCancelRequested(false);
        setError(errorMessage(reason, "取消失败，请重试"));
      }
    }
  }

  return { completionVisible, completion, results, progress, cancelRequested, setCompletion, setResults, setProgress, reset, convert, cancelConversion, allowManualConversionPanel };
}
