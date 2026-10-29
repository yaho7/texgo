import { t } from "./i18n";
import { Button } from "@/controls/button";
import type { ChangePreview } from "./types";
import { relativeFile } from "./utils";

export default function PendingReferences({ preview, root, onDetails, originals }: { preview: ChangePreview; originals?: boolean; root: string; onDetails: () => void }) {
  return <section className="pending-references" aria-label={t("commandBar.pendingReferences")}>
    <div className="flex items-center justify-between gap-2"><h3>{t(originals ? "commandBar.restoreReferences" : "commandBar.pendingReferences")}</h3><Button variant="ghost" size="xs" onClick={onDetails}>{t("commandBar.viewChanges")}</Button></div>
    <ul>{preview.files.map(file => <li key={file.path}>{t("reviewDialog.fileChangeCount", {path:relativeFile(file.path,root),count:file.changes.length})}</li>)}</ul>
    <p>{t("reviewDialog.saveUnsavedChangesInOtherEditorsBeforeApplyingTexgoCannot")}</p>
  </section>;
}
