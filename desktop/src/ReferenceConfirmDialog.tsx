import { useRef } from "react";
import { FilePenLine, FileText, LoaderCircle } from "lucide-react";
import { t } from "./i18n";
import { nativeText } from "./nativeText";
import { relativeFile } from "./utils";
import type { ChangePreview } from "./types";
import { Button } from "@/controls/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/controls/dialog";

interface Props {
  preview: ChangePreview; root: string; originals: boolean; busy: boolean; error: string | null;
  conflict?: {path:string;message:string}; onRestoreFocus?: () => void; onRescan: () => void; onCancel: () => void; onConfirm: () => void;
}
export default function ReferenceConfirmDialog(props: Props) {
  const cancel = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  return <Dialog open onOpenChange={open => { if (!open && !props.busy) props.onCancel(); }}>
    <DialogContent showCloseButton={false} className="flex flex-col gap-0 overflow-hidden p-0 sm:max-w-[460px]"
      onOpenAutoFocus={event => { event.preventDefault(); returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; cancel.current?.focus(); }}
      onCloseAutoFocus={event => { event.preventDefault(); if (props.onRestoreFocus) props.onRestoreFocus(); else returnFocus.current?.focus(); }}
      onEscapeKeyDown={event => { if (props.busy) event.preventDefault(); }} onInteractOutside={event => { if (props.busy) event.preventDefault(); }}>
      <div className="flex items-start gap-3 px-6 pt-6 pb-5"><div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-700"><FilePenLine className="size-5" aria-hidden="true" /></div><DialogHeader className="gap-1 pr-0"><DialogTitle>{t(props.originals ? "reviewDialog.confirmOriginalsTitle" : "reviewDialog.confirmUpdateTitle", {count:props.preview.referenceCount})}</DialogTitle><DialogDescription>{t(props.originals ? "reviewDialog.confirmOriginalsDescription" : "reviewDialog.confirmUpdateDescription")}</DialogDescription></DialogHeader></div>
      <div className="min-h-0 overflow-y-auto px-6 pb-5">
        <ul className="max-h-44 overflow-y-auto rounded-lg bg-muted/60 px-3 py-1" aria-label={t("reviewDialog.selectedFiles")}>{props.preview.files.map(file => <li key={file.path} className="flex items-center gap-2 border-b border-border/50 py-2.5 text-[13px] last:border-0"><FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="min-w-0 flex-1 truncate" title={file.path}>{relativeFile(file.path, props.root)}</span><span className="shrink-0 text-xs tabular-nums text-muted-foreground">{file.changes.length}</span></li>)}</ul>
        <p className="mt-4 text-xs leading-relaxed text-muted-foreground">{t("reviewDialog.saveUnsavedChangesInOtherEditorsBeforeApplyingTexgoCannot")}</p>
        {(props.error || props.conflict) && <p role="alert" className="mt-4 text-xs leading-relaxed text-destructive">{nativeText(props.conflict?.message ?? props.error ?? "")}</p>}
      </div>
      <DialogFooter className="gap-2 px-6 py-4"><Button ref={cancel} variant="outline" disabled={props.busy} onClick={props.onCancel}>{t("reviewDialog.cancelConfirmation")}</Button>{props.conflict && <Button variant="outline" disabled={props.busy} onClick={props.onRescan}>{t("reviewDialog.rescan")}</Button>}<Button className="bg-amber-700 hover:bg-amber-800" disabled={props.busy || Boolean(props.conflict) || props.preview.referenceCount === 0} onClick={props.onConfirm}>{props.busy && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}{t(props.originals ? "reviewDialog.confirmOriginals" : "reviewDialog.confirmUpdate")}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
