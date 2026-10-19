import { useState } from "react";
import { ArrowRight, Check, FileCheck2, Info, LoaderCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
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

const presets = {
  balanced: { dpi: "300", jpegQuality: "90" },
  lossless: { dpi: "300", jpegQuality: "100" },
  small: { dpi: "150", jpegQuality: "75" },
};

export default function ConversionPanel(props: Props) {
  const issues = settingsIssues(props.settings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [custom, setCustom] = useState(false);
  const preset = custom ? "custom" : Object.entries(presets).find(([, value]) => value.dpi === props.settings.dpi && value.jpegQuality === props.settings.jpegQuality)?.[0] ?? "custom";
  const showAdvanced = preset === "custom" || Object.keys(issues).length > 0;
  const review = props.selectedCount === 0 && props.canReview && !props.directoryMode;
  const locked = props.busy || props.converting;
  function submit() {
    if (locked || props.selectedCount === 0) return;
    if (Object.keys(issues).length) {
      setSettingsOpen(true);
      setCustom(true);
      requestAnimationFrame(props.onConvert);
    } else { props.onConvert(); }
  }
  return <aside className="conversion-panel" aria-label="转换设置">
    <div className="conversion-sections min-h-0 flex-1 overflow-y-auto">
      <details className="conversion-settings" open={settingsOpen} onToggle={(event) => setSettingsOpen(event.currentTarget.open)}>
        <summary className="conversion-summary"><span>输出设置</span><span className="conversion-summary-value" title={props.settings.outputDir}>{props.settings.dpi} DPI · {props.settings.jpegQuality}% · {props.settings.outputDir}</span></summary>
        <form className="px-4 py-4" noValidate onSubmit={(event) => { event.preventDefault(); submit(); }}>
          <FieldSet disabled={locked} className="gap-3">
            <FieldLegend className="sr-only">PDF 输出设置</FieldLegend>
            <FieldGroup className="gap-4">
              <Field className="gap-1.5">
                <FieldLabel id="conversion-preset-label">输出预设</FieldLabel>
                <ToggleGroup className="conversion-presets" type="single" variant="outline" size="sm" disabled={locked} aria-labelledby="conversion-preset-label" value={preset} onValueChange={(value) => {
                  if (!value) return;
                  setCustom(value === "custom");
                  if (value in presets) props.onSettings({ ...props.settings, ...presets[value as keyof typeof presets] });
                }}>
                  <ToggleGroupItem value="balanced">平衡</ToggleGroupItem>
                  <ToggleGroupItem value="lossless">无损</ToggleGroupItem>
                  <ToggleGroupItem value="small">小体积</ToggleGroupItem>
                  <ToggleGroupItem value="custom">自定义</ToggleGroupItem>
                </ToggleGroup>
              </Field>
              {showAdvanced && <FieldGroup className="conversion-advanced grid grid-cols-2 gap-3">
                <Field className="min-w-0 gap-1.5" data-disabled={props.busy} data-invalid={Boolean(issues.dpi)}>
                  <FieldLabel htmlFor="conversion-dpi">分辨率 (DPI)</FieldLabel>
                  <Input id="conversion-dpi" name="dpi" autoComplete="off" inputMode="numeric" type="number" min="72" max="1200" step="1" aria-invalid={Boolean(issues.dpi)} aria-describedby={issues.dpi ? "dpi-error" : undefined} value={props.settings.dpi} onChange={(event) => { setCustom(true); props.onSettings({ ...props.settings, dpi: event.target.value }); }} />
                  {issues.dpi && <FieldError id="dpi-error">{issues.dpi}</FieldError>}
                </Field>
                <Field className="min-w-0 gap-1.5" data-disabled={props.busy} data-invalid={Boolean(issues.jpegQuality)}>
                  <FieldLabel htmlFor="conversion-quality" title="不透明位图：1–99 有损压缩，100 无损编码；质量越高，文件通常越大。">质量 (%)<Info className="size-3.5" aria-hidden="true" /></FieldLabel>
                  <Input id="conversion-quality" name="jpegQuality" autoComplete="off" inputMode="numeric" type="number" min="1" max="100" step="1" aria-invalid={Boolean(issues.jpegQuality)} aria-describedby={issues.jpegQuality ? "quality-error quality-help" : "quality-help"} value={props.settings.jpegQuality} onChange={(event) => { setCustom(true); props.onSettings({ ...props.settings, jpegQuality: event.target.value }); }} />
                  {issues.jpegQuality && <FieldError id="quality-error">{issues.jpegQuality}</FieldError>}
                </Field>
              </FieldGroup>}
              <p id="quality-help" className="conversion-quality-help text-xs text-muted-foreground">不透明位图：质量低于 100 为有损压缩，100 为无损编码。透明图保持无损，SVG 保留矢量；DPI 仅缩小采样，不放大原图。</p>
              <Field className="gap-1.5" data-disabled={props.busy} data-invalid={Boolean(issues.outputDir)}>
                <FieldLabel htmlFor="conversion-output">输出目录</FieldLabel>
                <Input id="conversion-output" name="outputDir" autoComplete="off" spellCheck={false} placeholder="例如 figures-pdf…" aria-invalid={Boolean(issues.outputDir)} aria-describedby={issues.outputDir ? "output-error" : "output-path"} value={props.settings.outputDir} onChange={(event) => props.onSettings({ ...props.settings, outputDir: event.target.value })} />
                {issues.outputDir ? <FieldError id="output-error">{issues.outputDir}</FieldError> : <p id="output-path" className="output-path" title={`${props.root}/${props.settings.outputDir.trim()}`}>{props.root.replace(/[\\/]$/, "")}/{props.settings.outputDir.trim().replaceAll("\\", "/")}</p>}
              </Field>
            </FieldGroup>
          </FieldSet>
        </form>
      </details>
      {!props.directoryMode && <details className="conversion-references">
        <summary className="conversion-summary"><span>引用位置</span><Badge variant="secondary">{props.activeAsset?.references.length ?? 0}</Badge></summary>
        <section className="px-4 py-4" aria-label="图片引用位置">
          {props.activeAsset?.references.length ? <ul className="flex flex-col gap-3">
            {props.activeAsset.references.map((ref, index) => <li key={`${ref.file}:${ref.start}:${index}`} className="flex min-w-0 items-center justify-between gap-3 text-xs">
              <span className="truncate" title={ref.file}>{relativeFile(ref.file, props.root)}</span><span className="shrink-0 tabular-nums text-muted-foreground">第 {ref.line} 行</span>
            </li>)}
          </ul> : <Empty className="p-4"><EmptyHeader><EmptyTitle>{props.activeAsset ? "无引用位置" : "未选择图片"}</EmptyTitle></EmptyHeader></Empty>}
        </section>
      </details>}
    </div>
    <Separator />
    <div className="conversion-actions flex shrink-0 flex-col gap-3 px-4 py-3">
      <Button type="button" className="w-full" disabled={locked || (props.selectedCount === 0 && !review)} onClick={review ? props.onReview : submit}>
        {props.converting ? <LoaderCircle data-icon="inline-start" className="animate-spin" aria-hidden="true" /> : review ? <FileCheck2 data-icon="inline-start" aria-hidden="true" /> : props.selectedCount > 0 ? <ArrowRight data-icon="inline-start" aria-hidden="true" /> : <Check data-icon="inline-start" aria-hidden="true" />}
        {props.converting ? "正在转换…" : props.selectedCount > 0 ? `转换 ${props.selectedCount} 张` : review ? "检查引用变更" : props.undoAvailable ? "已完成" : "请选择图片"}
      </Button>
    </div>
  </aside>;
}
