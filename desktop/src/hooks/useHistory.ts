import { useWorkspaceGuard } from "./useWorkspaceGuard";
import type { DecisionAction } from "../state/businessDecision";
import { useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ConversionHistoryEntry, Project } from "../types";
import type { Operation } from "../state/operationMachine";
import { errorMessage } from "../utils";

interface HistoryPorts {
  currentProject: () => Project | null;
  generation: () => number;
  execute: (kind: Operation, action: () => Promise<void>, decisionAction?: DecisionAction) => Promise<void>;
  acceptProject: (project: Project, preserve: boolean, message?: string) => Promise<void>;
  refresh: (message?: string) => Promise<void>;
  discardProject: () => void;
  restoreRename: (project: Project, entry: ConversionHistoryEntry) => void;
  restoreFocus: () => void;
  onError: (message: string) => void;
  undoEntry: () => ConversionHistoryEntry | null;
  requestUndo: (entry: ConversionHistoryEntry) => void;
  dismissUndo: () => void;
}
export function useHistory(ports: HistoryPorts) {
  const latest = useRef(ports); latest.current = ports;
  const capture = useWorkspaceGuard(ports.generation);
  const request = useRef(0);
  const [history, setHistory] = useState<ConversionHistoryEntry[]>([]);
  const undoEntry = ports.undoEntry();
  const setUndoEntry = (entry: ConversionHistoryEntry | null) => entry ? latest.current.requestUndo(entry) : latest.current.dismissUndo();
  function reset() { request.current++; setHistory([]); setUndoEntry(null); }
  async function load() {
    const isMountedContext = capture();
    const key = latest.current.currentProject()?.mainFile;
    const generation = latest.current.generation();
    const id = ++request.current;
    if (!key) return;
    const isCurrent = () => isMountedContext() && id === request.current && generation === latest.current.generation() && key === latest.current.currentProject()?.mainFile;
    try {
      const entries = await invoke<ConversionHistoryEntry[]>("conversion_history");
      if (isCurrent()) setHistory(entries);
    } catch (reason) {
      if (isCurrent()) { setHistory([]); latest.current.onError(`无法读取操作记录，请重新扫描后重试：${errorMessage(reason)}`); }
    }
  }
  function requestUndo(entry: ConversionHistoryEntry) { setUndoEntry(entry); }
  function dismissUndo() { setUndoEntry(null); }
  function undoConversion() {
    if (!undoEntry) return;
    const entry = undoEntry;
    const generation = latest.current.generation();
    const isMountedContext = capture();
    const key = latest.current.currentProject()?.mainFile;
    const isCurrent = () => isMountedContext() && generation === latest.current.generation() && key === latest.current.currentProject()?.mainFile;
    void latest.current.execute("undoing", async () => {
      let next: Project;
      try { next = await invoke<Project>("undo_conversion", { entryId: entry.id }); }
      catch (reason) {
        if (!isCurrent()) return;
        setUndoEntry(null);
        try { await latest.current.refresh("撤销未全部完成，已重新读取恢复记录"); }
        catch (refreshError) {
          if (!isCurrent()) return;
          latest.current.discardProject(); throw new Error(`${errorMessage(reason)}；重新扫描失败：${errorMessage(refreshError)}`);
        }
        if (!isCurrent()) return;
        latest.current.restoreFocus();
        throw reason;
      }
      if (!isCurrent()) return;
      latest.current.restoreRename(next, entry);
      setUndoEntry(null);
      await latest.current.acceptProject(next, true, "已撤销此次操作");
    }, "confirm-undo");
  }
  return { history, undoEntry, load, reset, requestUndo, dismissUndo, undoConversion };
}
