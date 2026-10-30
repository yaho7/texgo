import { nativeText } from "./nativeText";
import { t } from "./i18n";
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
    requestAnimationFrame(() => document.getElementById(`operation-${highlightId}`)?.scrollIntoView?.({ block: "center" }));
  }, [highlightId, entries]);
  return <section className="history-panel page-transition" aria-label={t("conversionHistory.history")}>
    <h2 className="history-title">{t("conversionHistory.history")}</h2>
    {entries.length === 0 ? <Empty><EmptyHeader><EmptyMedia variant="icon"><History aria-hidden="true" /></EmptyMedia><EmptyTitle>{t("conversionHistory.noOperationsYet")}</EmptyTitle></EmptyHeader></Empty> : <ol className="history-list">{entries.slice(0, limit).map((entry, index) => {
      const failed = entry.files.filter((file) => file.error).length;
      const updated = entry.files.filter((file) => !file.error && !file.cached && file.output).length;
      const completed = entry.files.filter((file) => !file.error && file.output).length;
      const date = new Date(entry.createdAt);
      const validDate = Number.isFinite(date.getTime());
      const summary = entry.rename ? t("conversionHistory.renameImage") : updated > 0 ? t("conversionHistory.updatedValueImages", { arg0: updated }) : entry.referencesChanged ? t("conversionHistory.updatedValueLaTeXReferences", { arg0: entry.referencesChanged }) : completed ? t("conversionHistory.valueImagesAlreadyUpToDate", { arg0: completed }) : failed ? t("conversionHistory.valueImageUpdatesFailed", { arg0: failed }) : t("conversionHistory.noProjectFilesChanged");
      const day = historyCalendarDay(entry.createdAt);
      const startsDay = index === 0 || day !== historyCalendarDay(entries[index - 1].createdAt);
      return <li id={`operation-${entry.id}`} key={entry.id} className="history-entry" data-highlighted={highlightId === entry.id}>
        {startsDay && <h3 className="history-day">{day}</h3>}
        <article className="history-record" aria-label={summary}>
        <div className="history-record-header">
          <div className="history-record-copy">
            <h4 className="history-result">{summary}</h4>
            <div className="history-meta"><time dateTime={validDate ? date.toISOString() : undefined} title={validDate ? date.toISOString() : undefined}>{historyTime(entry.createdAt)}</time>{(entry.undone || failed > 0 || entry.cancelled) && <Badge variant={entry.undone ? "secondary" : "warning"}>{entry.undone ? t("conversionHistory.undone") : entry.cancelled ? t("conversionHistory.cancelled") : failed ? t("conversionHistory.needsAttention") : t("conversionHistory.completed")}</Badge>}</div>
          </div>
          <Button variant="outline" size="sm" disabled={busy || !entry.canUndo} aria-describedby={entry.undoReason && !entry.undone ? `undo-reason-${entry.id}` : undefined} onClick={() => onUndo(entry)}><RotateCcw data-icon="inline-start" aria-hidden="true" />{t("conversionHistory.undo")}</Button>
        </div>
        {entry.rename && <div className="history-rename"><p>{entry.rename.oldSource} → {entry.rename.newSource}</p><p>{renameEffects(entry.rename)}</p></div>}
        {!entry.rename && updated > 0 && !!entry.referencesChanged && <p className="history-reference-summary">{t("conversionHistory.referencesUpdated", {count:entry.referencesChanged})}</p>}
        {entry.undoReason && !entry.undone && <p id={`undo-reason-${entry.id}`} className="history-directory history-undo-reason">{nativeText(entry.undoReason)}</p>}
        <details open={expanded.has(entry.id)} onToggle={(event) => { const open = event.currentTarget.open; setExpanded((previous) => { const next = new Set(previous); if (open) next.add(entry.id); else next.delete(entry.id); return next; }); }}><summary>{t("conversionHistory.details")}</summary>{expanded.has(entry.id) && <div className="history-details-content">
          <p className="history-kind">{entry.rename ? t("conversionHistory.imageRename") : entry.files.length > 0 ? t("conversionHistory.imageProcessing") : entry.referencesChanged ? t("conversionHistory.referenceChanges") : t("conversionHistory.imageCheck")}</p>
          {!entry.rename && entry.files.length > 0 && <p className="history-directory">{entry.dpi} {t("conversionHistory.dPIQuality")}{entry.jpegQuality}%</p>}
          {entry.outputDir && <p className="history-directory" title={entry.outputDir}>{entry.outputDir}</p>}
          {!!entry.referencesChanged && <p className="history-directory">{t("conversionHistory.filesAffected", {count:entry.filesChanged ?? 0})}</p>}
          <ul>{entry.files.slice(0, fileLimits[entry.id] ?? 40).map((file, index) => <li key={`${file.source}:${index}`}><span title={file.source}>{file.source}</span><span title={file.output}>{file.output || t("conversionHistory.noPDFGenerated")}</span>{file.error ? <ErrorNotice message={file.error} file={file.source} /> : file.cached && <Badge variant="secondary">{t("conversionHistory.reusedExistingPDF")}</Badge>}</li>)}</ul>{entry.files.length > (fileLimits[entry.id] ?? 40) && <Button variant="ghost" size="sm" onClick={() => setFileLimits((previous) => ({ ...previous, [entry.id]: (previous[entry.id] ?? 40) + 40 }))}>{t("conversionHistory.showMoreFiles")}</Button>}
        </div>}</details>
        </article>
      </li>;
    })}</ol>}
    {entries.length > limit && <Button variant="outline" className="my-4" onClick={() => setLimit((value) => value + 20)}>{t("conversionHistory.showEarlierRecords")}</Button>}
  </section>;
}
