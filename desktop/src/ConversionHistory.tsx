import { useEffect, useState } from "react";
import { History, RotateCcw } from "lucide-react";
import { Badge } from "@/controls/badge";
import { Button } from "@/controls/button";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/controls/empty";
import type { ConversionHistoryEntry } from "./types";

import { historyCalendarDay, historyTime, renameEffects } from "./historyPresentation";
import ErrorNotice from "./ErrorNotice";
import "./history-diagnostics.css";
interface Props { highlightId?: string | null; entries: (ConversionHistoryEntry & { referencesChanged?: number; filesChanged?: number })[]; busy: boolean; referencesPending?: boolean; onUndo: (entry: ConversionHistoryEntry) => void }

export default function ConversionHistory({ entries, busy, onUndo, highlightId }: Props) {
  const [limit, setLimit] = useState(20);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [fileLimits, setFileLimits] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!highlightId) return;
    const index = entries.findIndex((entry) => entry.id === highlightId);
    if (index >= 0) setLimit((value) => Math.max(value, index + 1));
    setExpanded((previous) => new Set([...previous, highlightId]));
    requestAnimationFrame(() => document.getElementById(`operation-${highlightId}`)?.scrollIntoView?.({ block: "center" }));
  }, [highlightId, entries]);
  return <section className="history-panel page-transition mx-auto w-full max-w-[820px] px-6!" aria-label="操作记录">
    <h2 className="history-title pb-3! text-base!">操作记录</h2>
    {entries.length === 0 ? <Empty><EmptyHeader><EmptyMedia variant="icon"><History aria-hidden="true" /></EmptyMedia><EmptyTitle>暂无操作记录</EmptyTitle></EmptyHeader></Empty> : <ol className="history-list">{entries.slice(0, limit).map((entry, index) => {
      const failed = entry.files.filter((file) => file.error).length;
      const updated = entry.files.filter((file) => !file.error && !file.cached && file.output).length;
      const completed = entry.files.filter((file) => !file.error && file.output).length;
      const date = new Date(entry.createdAt);
      const validDate = Number.isFinite(date.getTime());
      const summary = entry.rename ? "重命名图片" : updated > 0 ? `更新了 ${updated} 张图片` : entry.referencesChanged ? `更新了 ${entry.referencesChanged} 处 LaTeX 引用` : completed ? `${completed} 张图片已是最新` : failed ? `${failed} 张图片更新失败` : "未修改项目文件";
      const day = historyCalendarDay(entry.createdAt);
      const startsDay = index === 0 || day !== historyCalendarDay(entries[index - 1].createdAt);
      return <li id={`operation-${entry.id}`} key={entry.id} className="history-entry" data-highlighted={highlightId === entry.id}>
        {startsDay && <h3 className="history-day">{day}</h3>}
        <header><div><time dateTime={validDate ? date.toISOString() : undefined} title={validDate ? date.toISOString() : undefined}>{historyTime(entry.createdAt)}</time><p className="history-kind">{entry.rename ? "图片重命名" : entry.files.length > 0 ? "图片转换" : entry.referencesChanged ? "引用替换" : "图片检查"}</p><div className="history-summary"><Badge variant={entry.undone ? "secondary" : failed || entry.cancelled ? "warning" : "success"}>{entry.undone ? "已撤销" : entry.cancelled ? "已取消" : failed ? "需要处理" : "已完成"}</Badge><span>{summary}</span></div>{entry.rename && <div className="history-rename"><p>{entry.rename.oldSource} → {entry.rename.newSource}</p><p>{renameEffects(entry.rename)}</p></div>}{!entry.rename && updated > 0 && !!entry.referencesChanged && <p className="history-reference-summary">更新了 {entry.referencesChanged} 处 LaTeX 引用</p>}</div>
          <Button variant="outline" size="sm" disabled={busy || !entry.canUndo} aria-describedby={entry.undoReason && !entry.undone ? `undo-reason-${entry.id}` : undefined} onClick={() => onUndo(entry)}><RotateCcw data-icon="inline-start" aria-hidden="true" />撤销</Button>
        </header>
        {entry.undoReason && !entry.undone && <p id={`undo-reason-${entry.id}`} className="history-directory history-undo-reason">{entry.undoReason}</p>}
        <details open={expanded.has(entry.id)} onToggle={(event) => { const open = event.currentTarget.open; setExpanded((previous) => { const next = new Set(previous); if (open) next.add(entry.id); else next.delete(entry.id); return next; }); }}><summary>详细信息</summary>{expanded.has(entry.id) && <>
          {!entry.rename && entry.files.length > 0 && <p className="history-directory">{entry.dpi} DPI · 质量 {entry.jpegQuality}%</p>}
          {entry.outputDir && <p className="history-directory" title={entry.outputDir}>{entry.outputDir}</p>}
          {!!entry.referencesChanged && <p className="history-directory">涉及 {entry.filesChanged ?? 0} 个 LaTeX 文件</p>}
          <ul>{entry.files.slice(0, fileLimits[entry.id] ?? 40).map((file, index) => <li key={`${file.source}:${index}`}><span title={file.source}>{file.source}</span><span title={file.output}>{file.output || "未生成 PDF"}</span>{file.error ? <ErrorNotice message={file.error} file={file.source} /> : file.cached && <Badge variant="secondary">复用已有 PDF</Badge>}</li>)}</ul>{entry.files.length > (fileLimits[entry.id] ?? 40) && <Button variant="ghost" size="sm" onClick={() => setFileLimits((previous) => ({ ...previous, [entry.id]: (previous[entry.id] ?? 40) + 40 }))}>显示更多文件</Button>}
        </>}</details>
      </li>;
    })}</ol>}
    {entries.length > limit && <Button variant="outline" className="my-4" onClick={() => setLimit((value) => value + 20)}>显示更早记录</Button>}
  </section>;
}
