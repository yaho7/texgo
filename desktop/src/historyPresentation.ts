import type { ConversionHistoryEntry } from "./types";

const timeFormat = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
export function historyCalendarDay(timestamp: number, now = new Date()): string {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return "时间未知";
  const calendar = `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
  const sameDay = (other: Date) => date.getFullYear() === other.getFullYear() && date.getMonth() === other.getMonth() && date.getDate() === other.getDate();
  if (sameDay(now)) return `今天 · ${calendar}`;
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
  return sameDay(yesterday) ? `昨天 · ${calendar}` : calendar;
}
export function historyTime(timestamp: number): string {
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime()) ? timeFormat.format(date) : "时间未知";
}
export function renameEffects(rename: NonNullable<ConversionHistoryEntry["rename"]>): string {
  // Older journals may have persisted the former serde default (0) beside a PDF path.
  const pdfCount = rename.pdfCount && rename.pdfCount > 0 ? rename.pdfCount : rename.newPdf ? 1 : 0;
  return `同步更新：1 张源图片${pdfCount > 0 ? `、${pdfCount} 个 PDF` : ""}、${rename.referencesChanged} 处 LaTeX 引用${rename.permanentIgnoreMigrated ? "、永久忽略规则" : ""}`;
}
