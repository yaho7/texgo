import { useId, useState } from "react";
import { ArrowRight, EyeOff, FileSearch, FileWarning, LoaderCircle, X } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Separator } from "@/components/ui/separator";
import type { ImageAsset } from "./types";
import { relativeFile } from "./utils";

export interface RepairCandidate {
  path: string;
  relativePath: string;
}

export interface AssetProblemsProps {
  asset: ImageAsset | null;
  projectRoot: string;
  busy: boolean;
  candidates: readonly RepairCandidate[];
  candidatesLoading?: boolean;
  error?: string | null;
  onClose: () => void;
  /** Open the host's file picker; it must not apply a repair. */
  onLocate: (assetId: string) => void;
  /** Request the normal ReviewDialog. Selection is not write authorization. */
  onChoose: (assetId: string, targetPath: string) => void;
  /** Session-only hiding/exclusion. Never persist or edit TeX from this callback. */
  onIgnore: (assetId: string) => void;
}

export default function AssetProblems(props: AssetProblemsProps) {
  if (!props.asset) return null;
  return <ProblemDialog key={`${props.projectRoot}:${props.asset.id}`} {...props} asset={props.asset} />;
}

function ProblemDialog(props: AssetProblemsProps & { asset: ImageAsset }) {
  const [selected, setSelected] = useState<string | null>(null);
  const groupId = useId();
  const repairable = props.asset.status === "missing" || props.asset.status === "ambiguous";
  const loading = Boolean(props.candidatesLoading);
  const chosen = props.candidates.find((candidate) => candidate.path === selected);
  const locked = props.busy || loading;
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !props.busy) props.onClose(); }}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[85dvh] min-w-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
        onEscapeKeyDown={(event) => { if (props.busy) event.preventDefault(); }}
        onInteractOutside={(event) => { if (props.busy) event.preventDefault(); }}
      >
        <div className="flex min-w-0 shrink-0 items-start justify-between gap-3 p-5">
          <DialogHeader className="min-w-0 text-left">
            <DialogTitle>图片引用问题</DialogTitle>
            <DialogDescription className="break-all">{props.asset.relativePath}</DialogDescription>
          </DialogHeader>
          <Button variant="ghost" size="icon" aria-label="关闭图片问题" title="关闭图片问题" disabled={props.busy} onClick={props.onClose}>
            <X aria-hidden="true" />
          </Button>
        </div>
        <Separator />
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5">
          {props.asset.message && <p className="break-words text-sm text-muted-foreground">{props.asset.message}</p>}
          <ul aria-label="受影响的引用" className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
            {props.asset.references.map((reference) => (
              <li className="break-all" key={`${reference.file}:${reference.start}`} title={reference.file}>{relativeFile(reference.file, props.projectRoot)}:{reference.line}</li>
            ))}
          </ul>
          <FieldSet disabled={locked || !repairable} className="min-w-0 gap-3">
            <FieldLegend variant="label">候选文件</FieldLegend>
            {loading ? <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" aria-hidden="true" />正在查找候选文件</p>
              : props.candidates.length === 0 ? <p className="text-sm text-muted-foreground">没有匹配的候选文件</p>
                : <FieldGroup className="gap-3">
                  {props.candidates.map((candidate, index) => (
                    <Field key={candidate.path} orientation="horizontal" data-disabled={locked || !repairable}>
                      <FieldLabel htmlFor={`${groupId}-${index}`} className="min-h-10 w-full min-w-0 cursor-pointer items-center rounded-md border px-3 py-2" title={candidate.path}>
                        <input
                          type="radio" id={`${groupId}-${index}`} name={groupId}
                          value={candidate.path} checked={chosen?.path === candidate.path}
                          disabled={locked || !repairable} className="size-4 shrink-0"
                          onChange={() => setSelected(candidate.path)}
                        />
                        <span className="min-w-0 break-all">{candidate.relativePath}</span>
                      </FieldLabel>
                    </Field>
                  ))}
                </FieldGroup>}
          </FieldSet>
          {props.error && <Alert variant="destructive"><FileWarning aria-hidden="true" /><AlertDescription className="break-words">{props.error}</AlertDescription></Alert>}
        </div>
        <Separator />
        <DialogFooter className="shrink-0 flex-wrap p-5">
          <Button variant="ghost" disabled={props.busy} onClick={() => props.onIgnore(props.asset.id)}><EyeOff data-icon="inline-start" aria-hidden="true" />忽略本次</Button>
          <Button variant="outline" disabled={locked || !repairable} onClick={() => props.onLocate(props.asset.id)}><FileSearch data-icon="inline-start" aria-hidden="true" />定位文件</Button>
          <Button disabled={locked || !repairable || !chosen} onClick={() => { if (chosen && !locked && repairable) props.onChoose(props.asset.id, chosen.path); }}>
            <ArrowRight data-icon="inline-start" aria-hidden="true" />查看修复
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
