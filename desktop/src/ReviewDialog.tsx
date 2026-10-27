import { useRef, useState } from "react";
import { ArrowRight, FileWarning, LoaderCircle, X } from "lucide-react";
import { Alert, AlertDescription } from "@/controls/alert";
import { Badge } from "@/controls/badge";
import { Button } from "@/controls/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/controls/dialog";
import { Empty, EmptyHeader, EmptyTitle } from "@/controls/empty";
import { Separator } from "@/controls/separator";
import type { ChangePreview } from "./types";
import { relativeFile } from "./utils";

interface Props {
  preview: ChangePreview;
  root: string;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onApply: (selectionIds: string[]) => void;
  conflict?: { path: string; message: string };
  onRescan?: () => void;
}

export default function ReviewDialog(props: Props) {
  const returnFocus = useRef<HTMLElement | null>(null);
  // Missing IDs are not selectable: an older preview must never submit new edits.
  const idOf = (change: ChangePreview["files"][number]["changes"][number]) => "id" in change && typeof change.id === "string" ? change.id : "";
  const ids = props.preview.files.flatMap((file) => file.changes.map(idOf)).filter(Boolean);
  const [selection, setSelection] = useState(() => new Set(ids));
  const selected = ids.filter((id) => selection.has(id));
  const selectedFiles = props.preview.files.map((file) => ({ path: relativeFile(file.path, props.root), count: file.changes.filter((change) => selection.has(idOf(change))).length })).filter((file) => file.count > 0);
  const toggle = (values: string[], checked: boolean) => setSelection((previous) => {
    const next = new Set(previous);
    for (const id of values.filter(Boolean)) { if (checked) next.add(id); else next.delete(id); }
    return next;
  });
  const checkbox = (values: string[], label: string) => {
    const valid = values.filter(Boolean);
    const count = valid.filter((id) => selection.has(id)).length;
    return <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={props.busy || valid.length === 0} checked={valid.length > 0 && count === valid.length} ref={(element) => { if (element) element.indeterminate = count > 0 && count < valid.length; }} onChange={(event) => toggle(valid, event.target.checked)} />{label}</label>;
  };
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !props.busy) props.onClose(); }}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[85dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl"
        onOpenAutoFocus={() => { returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }}
        onCloseAutoFocus={(event) => { event.preventDefault(); returnFocus.current?.focus(); }}
        onEscapeKeyDown={(event) => { if (props.busy) event.preventDefault(); }}
        onInteractOutside={(event) => { if (props.busy) event.preventDefault(); }}
      >
        <div className="flex shrink-0 items-start justify-between gap-4 p-5">
          <DialogHeader>
            <DialogTitle>检查引用变更</DialogTitle>
            <DialogDescription>{props.preview.files.length} 个文件，{props.preview.referenceCount} 处引用</DialogDescription>
          </DialogHeader>
          <DialogClose asChild>
            <Button variant="ghost" size="icon" aria-label="关闭替换预览" title="关闭替换预览" disabled={props.busy}><X aria-hidden="true" /></Button>
          </DialogClose>
        </div>
        <Separator />
        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-5">
          {checkbox(ids, "全选")}
          {props.preview.files.length === 0 && <Empty><EmptyHeader><EmptyTitle>没有可替换的引用</EmptyTitle></EmptyHeader></Empty>}
          {props.preview.files.map((file) => (
            <section className="flex min-w-0 flex-col gap-3" key={file.path}>
              <div className="flex min-w-0 items-center gap-2">
                {checkbox(file.changes.map(idOf), "选择文件")}
                <h3 className="truncate text-sm font-medium" title={file.path}>{relativeFile(file.path, props.root)}</h3>
                <Badge variant="secondary">{file.changes.length}</Badge>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground"><span>替换前</span><span>替换后</span></div>
              {file.changes.map((change, index) => (
                <div className="flex min-w-0 flex-col gap-2" key={idOf(change) || `${change.line}:${index}`}>
                  {checkbox([idOf(change)], `第 ${change.line} 行`)}
                  <div className="grid min-w-0 grid-cols-2 gap-3">
                    <pre className="min-w-0 overflow-x-auto rounded-md border bg-muted/40 p-3 text-xs leading-relaxed" aria-label={`第 ${change.line} 行替换前`}><code>{change.before}</code></pre>
                    <pre className="min-w-0 overflow-x-auto rounded-md border bg-muted p-3 text-xs leading-relaxed" aria-label={`第 ${change.line} 行替换后`}><code>{change.after}</code></pre>
                  </div>
                </div>
              ))}
            </section>
          ))}
        </div>
        {(props.conflict || props.error) && <div className="shrink-0 px-5 pb-4"><Alert variant="destructive"><FileWarning aria-hidden="true" /><AlertDescription>{props.conflict && <span>{props.conflict.message}</span>}{props.error && <span>{props.error}</span>}</AlertDescription></Alert></div>}
        <Separator />
        <div className="shrink-0 px-5 pt-4 text-sm" aria-live="polite">
          <p>已选择 {selectedFiles.length} 个文件，{selected.length} 处引用</p>
          <ul className="max-h-16 overflow-y-auto break-words text-xs text-muted-foreground" aria-label="所选文件">{selectedFiles.length ? selectedFiles.map((file) => <li key={file.path}>{file.path}（{file.count} 处）</li>) : <li>未选择文件</li>}</ul>
          <p className="mt-3 text-xs text-muted-foreground">应用前请保存其他编辑器中的未保存修改。Texgo无法检测这些未保存内容，会在写入前检查磁盘文件是否被外部修改。</p>
        </div>
        <DialogFooter className="shrink-0 p-5">
          <DialogClose asChild><Button variant="outline" disabled={props.busy}>返回</Button></DialogClose>
          {props.conflict && <Button variant="outline" disabled={props.busy} onClick={props.onRescan}>重新扫描</Button>}
          <Button disabled={props.busy || Boolean(props.conflict) || selected.length === 0} onClick={() => props.onApply(selected)}>
            {props.busy ? <LoaderCircle data-icon="inline-start" className="animate-spin" aria-hidden="true" /> : <ArrowRight data-icon="inline-start" aria-hidden="true" />}应用 {selected.length} 处引用修改
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
