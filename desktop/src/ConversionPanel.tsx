import { useState } from "react";
import { ArrowRight, FileCheck2, LoaderCircle, Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ImageAsset } from "./types";
import type { ConversionSettings } from "./settings";
import { settingsIssues } from "./settings";
import { relativeFile } from "./utils";

interface Props {
  settings: ConversionSettings;
  selectedCount: number;
  busy: boolean;
  converting: boolean;
  canReview: boolean;
  undoAvailable: boolean;
  activeAsset: ImageAsset | null;
  root: string;
  directoryMode: boolean;
  onSettings: (settings: ConversionSettings) => void;
  onConvert: () => void;
  onReview: () => void;
  onUndo: () => void;
}

export default function ConversionPanel(props: Props) {
  const issues = settingsIssues(props.settings);
  const [tab, setTab] = useState("settings");
  function submit() {
    if (Object.keys(issues).length && tab !== "settings") {
      setTab("settings");
      requestAnimationFrame(props.onConvert);
    } else { props.onConvert(); }
  }
  return <aside className="conversion-panel" aria-label="转换设置">
    <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1 gap-0">
      <TabsList variant="line" className="mx-4 shrink-0" aria-label="转换设置与引用位置">
        <TabsTrigger value="settings">转换设置</TabsTrigger>
        {!props.directoryMode && <TabsTrigger value="references">引用位置 <Badge variant="secondary">{props.activeAsset?.references.length ?? 0}</Badge></TabsTrigger>}
      </TabsList>
      <TabsContent value="settings" className="min-h-0 overflow-y-auto px-4 py-4">
        <form noValidate onSubmit={(event) => { event.preventDefault(); submit(); }}>
          <FieldSet disabled={props.busy} className="gap-3">
            <FieldLegend className="sr-only">PDF 输出设置</FieldLegend>
            <FieldGroup className="gap-4">
              <FieldGroup className="grid grid-cols-2 gap-3">
                <Field className="min-w-0 gap-1.5" data-disabled={props.busy} data-invalid={Boolean(issues.dpi)}>
                  <FieldLabel htmlFor="conversion-dpi">分辨率 (DPI)</FieldLabel>
                  <Input id="conversion-dpi" name="dpi" autoComplete="off" inputMode="numeric" type="number" min="72" max="1200" step="1" aria-invalid={Boolean(issues.dpi)} aria-describedby={issues.dpi ? "dpi-error" : undefined} value={props.settings.dpi} onChange={(event) => props.onSettings({ ...props.settings, dpi: event.target.value })} />
                  {issues.dpi && <FieldError id="dpi-error">{issues.dpi}</FieldError>}
                </Field>
                <Field className="min-w-0 gap-1.5" data-disabled={props.busy} data-invalid={Boolean(issues.jpegQuality)}>
                  <FieldLabel htmlFor="conversion-quality">质量 (%)</FieldLabel>
                  <Input id="conversion-quality" name="jpegQuality" autoComplete="off" inputMode="numeric" type="number" min="1" max="100" step="1" aria-invalid={Boolean(issues.jpegQuality)} aria-describedby={issues.jpegQuality ? "quality-error" : undefined} value={props.settings.jpegQuality} onChange={(event) => props.onSettings({ ...props.settings, jpegQuality: event.target.value })} />
                  {issues.jpegQuality && <FieldError id="quality-error">{issues.jpegQuality}</FieldError>}
                </Field>
              </FieldGroup>
              <Field className="gap-1.5" data-disabled={props.busy} data-invalid={Boolean(issues.outputDir)}>
                <FieldLabel htmlFor="conversion-output">输出目录</FieldLabel>
                <Input id="conversion-output" name="outputDir" autoComplete="off" spellCheck={false} placeholder="例如 figures-pdf…" aria-invalid={Boolean(issues.outputDir)} aria-describedby={issues.outputDir ? "output-error" : "output-path"} value={props.settings.outputDir} onChange={(event) => props.onSettings({ ...props.settings, outputDir: event.target.value })} />
                {issues.outputDir ? <FieldError id="output-error">{issues.outputDir}</FieldError> : <p id="output-path" className="output-path" title={`${props.root}/${props.settings.outputDir.trim()}`}>{props.root.replace(/[\\/]$/, "")}/{props.settings.outputDir.trim().replaceAll("\\", "/")}</p>}
              </Field>
            </FieldGroup>
          </FieldSet>
        </form>
      </TabsContent>
      {!props.directoryMode && <TabsContent value="references" className="min-h-0 overflow-y-auto px-4 py-4">
        <section aria-label="图片引用位置">
          {props.activeAsset?.references.length ? <ul className="flex flex-col gap-3">
            {props.activeAsset.references.map((ref, index) => <li key={`${ref.file}:${ref.start}:${index}`} className="flex min-w-0 items-center justify-between gap-3 text-xs">
              <span className="truncate" title={ref.file}>{relativeFile(ref.file, props.root)}</span><span className="shrink-0 tabular-nums text-muted-foreground">第 {ref.line} 行</span>
            </li>)}
          </ul> : <Empty className="p-4"><EmptyHeader><EmptyTitle>{props.activeAsset ? "无引用位置" : "未选择图片"}</EmptyTitle></EmptyHeader></Empty>}
        </section>
      </TabsContent>}
    </Tabs>
    <Separator />
    <div className="flex shrink-0 flex-col gap-3 px-4 py-3">
      <Button type="button" className="w-full" aria-label="转换所选图片" disabled={props.busy || props.selectedCount === 0} onClick={submit}>
        {props.converting ? <LoaderCircle data-icon="inline-start" className="animate-spin" aria-hidden="true" /> : <ArrowRight data-icon="inline-start" aria-hidden="true" />}
        {props.converting ? "正在转换…" : "转换所选图片"}<span className="ml-auto tabular-nums">{props.selectedCount}</span>
      </Button>
      {!props.directoryMode && <section className="grid grid-cols-2 gap-2" aria-label="引用替换">
        <Button variant="outline" size="sm" disabled={props.busy || !props.canReview} onClick={props.onReview}><FileCheck2 data-icon="inline-start" aria-hidden="true" />预览替换</Button>
        <Button variant="ghost" size="sm" disabled={props.busy || !props.undoAvailable} onClick={props.onUndo}><Undo2 data-icon="inline-start" aria-hidden="true" />撤销替换</Button>
      </section>}
    </div>
  </aside>;
}
