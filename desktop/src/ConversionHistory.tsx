import { useEffect, useState } from "react";
import { History, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import type { ConversionHistoryEntry } from "./types";

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

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
    requestAnimationFrame(() => document.getElementById(`batch-${highlightId}`)?.scrollIntoView?.({ block: "center" }));
  }, [highlightId, entries]);
  return <section className="history-panel" aria-label="转换记录">
    {entries.length === 0 ? <Empty><EmptyHeader><EmptyMedia variant="icon"><History aria-hidden="true" /></EmptyMedia><EmptyTitle>暂无转换记录</EmptyTitle></EmptyHeader></Empty> : <ol className="history-list">
      {entries.slice(0, limit).map((entry) => {
        const failed = entry.files.filter((file) => file.error).length;
        const cachedOnly = !entry.referencesChanged && entry.files.length > 0 && entry.files.every((file) => file.cached && !file.error);
        const emptyBatch = entry.files.length === 0 && !entry.referencesChanged;
        const date = new Date(entry.createdAt);
        const validDate = Number.isFinite(date.getTime());
        return <li id={`batch-${entry.id}`} key={entry.id} className="history-entry" data-highlighted={highlightId === entry.id}>
          <header><div><time dateTime={validDate ? date.toISOString() : undefined}>{validDate ? dateFormat.format(date) : "时间未知"}</time><div className="history-summary"><Badge variant={entry.undone || cachedOnly || emptyBatch ? "secondary" : failed || entry.cancelled ? "warning" : "success"}>{entry.undone ? "已撤销" : entry.cancelled ? "已取消" : failed ? `${failed} 个失败` : cachedOnly ? "复用缓存" : emptyBatch ? "未写入文件" : "已完成"}</Badge><span>{entry.files.length} 张 · {entry.dpi} DPI · {entry.jpegQuality}%</span></div></div>
            <Button variant="outline" size="sm" disabled={busy || !entry.canUndo} onClick={() => onUndo(entry)}><RotateCcw data-icon="inline-start" aria-hidden="true" />撤销此批次</Button>
          </header>
          <p className="history-directory" title={entry.outputDir}>{entry.outputDir}</p>
          {!!entry.referencesChanged && <p className="history-directory">更新 {entry.filesChanged ?? 0} 个 TeX 文件中的 {entry.referencesChanged} 处引用</p>}
          {entry.undoReason && !entry.undone && <p className="history-directory">{entry.undoReason}</p>}
          <details open={expanded.has(entry.id)} onToggle={(event) => { const open = event.currentTarget.open; setExpanded((previous) => { const next = new Set(previous); if (open) next.add(entry.id); else next.delete(entry.id); return next; }); }}><summary>文件记录 ({entry.files.length})</summary>{expanded.has(entry.id) && <><ul>{entry.files.slice(0, fileLimits[entry.id] ?? 40).map((file, index) => <li key={`${file.source}:${index}`}><span title={file.source}>{file.source}</span><span title={file.output}>{file.output || "未生成 PDF"}</span>{file.error ? <p className="text-destructive">{file.error}</p> : file.cached && <Badge variant="secondary">复用缓存</Badge>}</li>)}</ul>{entry.files.length > (fileLimits[entry.id] ?? 40) && <Button variant="ghost" size="sm" onClick={() => setFileLimits((previous) => ({ ...previous, [entry.id]: (previous[entry.id] ?? 40) + 40 }))}>显示更多文件</Button>}</>}</details>
        </li>;
      })}
    </ol>}
    {entries.length > limit && <Button variant="outline" className="my-4" onClick={() => setLimit((value) => value + 20)}>显示更早记录</Button>}
  </section>;
}
