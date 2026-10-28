import { t, getLocale } from "./i18n";
import type { ConversionHistoryEntry } from "./types";


export function historyCalendarDay(timestamp: number, now = new Date()): string {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return t("historyPresentation.unknownTime");
  const calendar = new Intl.DateTimeFormat(getLocale(), {year:"numeric", month:"long", day:"numeric"}).format(date);
  const sameDay = (other: Date) => date.getFullYear() === other.getFullYear() && date.getMonth() === other.getMonth() && date.getDate() === other.getDate();
  if (sameDay(now)) return t("historyPresentation.todayValue", { arg0: calendar });
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
  return sameDay(yesterday) ? t("historyPresentation.yesterdayValue", { arg0: calendar }) : calendar;
}
export function historyTime(timestamp: number): string {
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(getLocale(), {hour:"2-digit", minute:"2-digit", hour12:false}).format(date) : t("historyPresentation.unknownTime");
}
export function renameEffects(rename: NonNullable<ConversionHistoryEntry["rename"]>): string {
  // Older journals may have persisted the former serde default (0) beside a PDF path.
  const pdfCount = rename.pdfCount && rename.pdfCount > 0 ? rename.pdfCount : rename.newPdf ? 1 : 0;
  return t("historyPresentation.updated1SourceImageValueAndValueLaTeXReferencesValue", { arg0: pdfCount > 0 ? t("historyPresentation.valuePDFs", { arg0: pdfCount }) : "", arg1: rename.referencesChanged, arg2: rename.permanentIgnoreMigrated ? t("historyPresentation.andThePermanentIgnoreRule") : "" });
}
