import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, FileCheck2, LoaderCircle, SlidersHorizontal, Square, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { conversionPreset, conversionPresets } from "./preferences";
import { motionDuration } from "./motion";
import { settingsIssues } from "./settings";
import type { ConversionSettings } from "./settings";
import type { ConversionProgress, WorkspaceStatus } from "./types";

interface Props {
  status: WorkspaceStatus;
  settings: ConversionSettings;
  selectionMode: boolean;
  selectedCount: number;
  busy: boolean;
  converting: boolean;
  progress: ConversionProgress | null;
  completion: number | null;
  cancelRequested: boolean;
  onAction: () => void;
  onConvert?: (intent: "pending" | "selected" | "reconvert", imageIds?: string[]) => void;
  currentImageId?: string | null;
  convertibleIds?: string[];
  onSettings: (settings: ConversionSettings) => void;
  onSelectionMode: (enabled: boolean) => void;
  onCancel: () => void;
}


export default function CommandBar(props: Props) {
  const { status, settings } = props;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualScope, setManualScope] = useState("current");
  const convertibleIds = props.convertibleIds ?? status.pendingImageIds;
  const currentConvertible = Boolean(props.currentImageId && convertibleIds.includes(props.currentImageId));
  const recommendedConvert = props.selectionMode || status.nextAction === "convertImages";
  const working = props.busy || props.completion !== null;
  function convert(intent: "pending" | "selected" | "reconvert", ids?: string[]) {
    if (working) return;
    if (Object.keys(issues).length) { setSettingsOpen(true); return; }
    setManualOpen(false);
    if (props.onConvert) props.onConvert(intent, ids); else props.onAction();
  }
  const preset = conversionPreset(Number(settings.dpi), Number(settings.jpegQuality));
  const presetLabel = preset?.label ?? "自定义";
  const count = props.selectionMode ? props.selectedCount : status.pendingImages;
  const issues = settingsIssues(settings);
  const blocked = Boolean(status.blockingReason);
  const label = props.converting ? `正在更新 ${props.progress?.current ?? 0} / ${props.progress?.total ?? count}`
    : props.completion !== null ? `已更新 ${props.completion} 张`
    : blocked ? "请先解决安全问题"
    : props.selectionMode ? `转换 ${count} 张图片`
    : status.nextAction === "reviewReferences" ? `检查 ${status.pendingReferences} 处引用`
    : recommendedConvert ? `转换 ${count} 张图片`
    : status.nextAction === "resolveProblems" ? "处理问题" : "项目已是最新状态";
  const message = props.converting ? props.progress?.name || "正在准备更新图片…"
    : props.completion !== null ? "图片已更新"
    : blocked ? "暂时无法安全更新项目"
    : props.selectionMode ? `已选择 ${props.selectedCount} 张`
    : status.nextAction === "reviewReferences" ? `${status.pendingReferences} 处引用等待确认`
    : status.nextAction === "convertImages" ? `${status.pendingImages} 张图片需要更新`
    : status.nextAction === "resolveProblems" ? `${status.problemCount} 个问题需要处理` : "项目已是最新状态";
  const transitionKey = props.converting ? "converting" : props.completion !== null ? "complete" : blocked ? "blocked" : props.selectionMode ? "selection" : status.nextAction;
  // Retain the departing message for one token duration; it never creates a second action.
  const [departing, setDeparting] = useState<string | null>(null);
  const previous = useRef({ key: transitionKey, message, label });
  const [departingLabel, setDepartingLabel] = useState<string | null>(null);
  useEffect(() => {
    const old = previous.current;
    previous.current = { key: transitionKey, message, label };
    if (old.key !== transitionKey) { setDeparting(old.message); setDepartingLabel(old.label); }
  }, [transitionKey, message, label]);
  useEffect(() => {
    if (departing === null && departingLabel === null) return;
    const timer = window.setTimeout(() => { setDeparting(null); setDepartingLabel(null); }, motionDuration());
    return () => window.clearTimeout(timer);
  }, [departing, departingLabel]);
  function submit() {
    if (working || blocked) return;
    if (status.nextAction === "convertImages" && Object.keys(issues).length) {
      setSettingsOpen(true);
      requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    if (recommendedConvert) convert(props.selectionMode ? "selected" : "pending"); else props.onAction();
  }
  const idle = status.nextAction === "upToDate" && !props.selectionMode && !props.busy && props.completion === null && !blocked;
  const progress = props.progress && props.progress.total > 0 ? props.progress.current / props.progress.total * 100 : 0;
  return <section className="command-bar" aria-label="项目下一步" data-state={transitionKey}>
    <div className="command-status">
      <div className="command-message-stage" aria-live="polite" role="status">
        {departing && <span aria-hidden="true" className="command-message command-message-exit">{departing}</span>}
        <span key={transitionKey} className="command-message command-message-enter">
          {(idle || props.completion !== null) && <Check className="command-success" aria-hidden="true" />}
          {blocked && <TriangleAlert aria-hidden="true" />}{message}
        </span>
      </div>
      {props.converting && <Progress value={progress} aria-label="图片更新进度" className="command-progress" />}
    </div>
    <div className="command-actions">
      {!props.converting && props.completion === null && <>
        {props.selectionMode && <Button variant="ghost" size="sm" disabled={props.busy} onClick={() => props.onSelectionMode(false)}>取消选择</Button>}
        <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
          <PopoverTrigger asChild><Button variant="ghost" size="sm" className="command-parameters" disabled={props.busy} aria-label={`输出参数：${presetLabel} · ${settings.dpi} DPI`}><SlidersHorizontal data-icon="inline-start" aria-hidden="true" />{presetLabel} · {settings.dpi} DPI<ChevronDown data-icon="inline-end" aria-hidden="true" /></Button></PopoverTrigger>
          <PopoverContent side="top" align="end" className="command-settings" aria-label="输出参数">
            <FieldSet disabled={props.busy}><FieldLegend>输出参数</FieldLegend><FieldGroup>
              <Field><FieldLabel id="conversion-preset-label">预设{!preset && <span className="text-muted-foreground"> · 自定义</span>}</FieldLabel>
                <ToggleGroup type="single" variant="outline" value={preset?.id ?? ""} aria-labelledby="conversion-preset-label" onValueChange={(value) => { const next = conversionPresets.find((item) => item.id === value); if (next) props.onSettings({ ...settings, dpi: String(next.dpi), jpegQuality: String(next.jpegQuality) }); }}>
                  {conversionPresets.map((item) => <ToggleGroupItem key={item.id} value={item.id}>{item.label}</ToggleGroupItem>)}
                </ToggleGroup>
              </Field><Separator />
              <Field data-invalid={Boolean(issues.dpi)}><FieldLabel htmlFor="conversion-dpi">DPI</FieldLabel><Input id="conversion-dpi" type="number" inputMode="numeric" min={72} max={1200} value={settings.dpi} aria-invalid={Boolean(issues.dpi)} aria-describedby={issues.dpi ? "conversion-dpi-error" : undefined} onChange={(event) => props.onSettings({ ...settings, dpi: event.target.value })} />{issues.dpi && <FieldError id="conversion-dpi-error">{issues.dpi}</FieldError>}</Field>
              <Field data-invalid={Boolean(issues.jpegQuality)}><FieldLabel htmlFor="conversion-quality">质量 (%)</FieldLabel><Input id="conversion-quality" type="number" inputMode="numeric" min={1} max={100} value={settings.jpegQuality} aria-invalid={Boolean(issues.jpegQuality)} aria-describedby={issues.jpegQuality ? "conversion-quality-error" : undefined} onChange={(event) => props.onSettings({ ...settings, jpegQuality: event.target.value })} />{issues.jpegQuality && <FieldError id="conversion-quality-error">{issues.jpegQuality}</FieldError>}</Field>
              <Field data-invalid={Boolean(issues.outputDir)}><FieldLabel htmlFor="conversion-output">输出目录</FieldLabel><Input id="conversion-output" value={settings.outputDir} spellCheck={false} aria-invalid={Boolean(issues.outputDir)} aria-describedby={issues.outputDir ? "conversion-output-error" : undefined} onChange={(event) => props.onSettings({ ...settings, outputDir: event.target.value })} />{issues.outputDir && <FieldError id="conversion-output-error">{issues.outputDir}</FieldError>}</Field>
            </FieldGroup></FieldSet>
          </PopoverContent>
        </Popover>
      </>}
      {!props.converting && props.completion === null && !props.selectionMode && <>
        {recommendedConvert && !blocked ? <div className="command-split">
          <Button className="command-action" disabled={working || count === 0} onClick={submit}><span className="command-action-label-stage">{departingLabel && <span className="command-action-label-exit" aria-hidden="true">{departingLabel}</span>}<span key={transitionKey} className="command-action-label-enter">{label}</span></span></Button>
          <DropdownMenu><DropdownMenuTrigger asChild><Button aria-label="更多转换操作" className="command-split-menu" size="icon" disabled={working}><ChevronDown aria-hidden="true" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" side="top"><DropdownMenuGroup>
            <DropdownMenuItem disabled={!status.pendingImages} onSelect={() => convert("pending")}>转换需要更新的图片</DropdownMenuItem>
            <DropdownMenuItem disabled={!convertibleIds.length} onSelect={() => props.onSelectionMode(true)}>选择图片转换…</DropdownMenuItem>
            <DropdownMenuItem disabled={!currentConvertible} onSelect={() => convert("reconvert", [props.currentImageId!])}>重新转换当前图片</DropdownMenuItem>
            <DropdownMenuItem disabled={!convertibleIds.length} onSelect={() => convert("reconvert", convertibleIds)}>重新转换全部图片</DropdownMenuItem>
          </DropdownMenuGroup><DropdownMenuSeparator /><DropdownMenuGroup><DropdownMenuItem onSelect={() => setSettingsOpen(true)}>转换设置…</DropdownMenuItem></DropdownMenuGroup></DropdownMenuContent></DropdownMenu>
        </div> : <Popover open={manualOpen} onOpenChange={(open) => { setManualOpen(open); if (open) setManualScope(currentConvertible ? "current" : "all"); }}><PopoverTrigger asChild><Button variant="outline" disabled={working} onClick={() => { if (!manualOpen) setManualScope(currentConvertible ? "current" : "all"); }}>转换…</Button></PopoverTrigger><PopoverContent align="end" side="top" className="command-manual" aria-label="手动转换图片"><FieldSet disabled={working}><FieldLegend>转换图片</FieldLegend><FieldGroup>
          <ToggleGroup type="single" value={manualScope} onValueChange={(value) => { if (value) setManualScope(value); }} aria-label="转换范围" className="manual-scope" variant="outline"><ToggleGroupItem value="current" disabled={!currentConvertible}>当前图片</ToggleGroupItem><ToggleGroupItem value="selected" disabled={!convertibleIds.length}>选择图片…</ToggleGroupItem><ToggleGroupItem value="all" disabled={!convertibleIds.length}>全部可转换图片</ToggleGroupItem></ToggleGroup>
          <Button variant="ghost" onClick={() => { setManualOpen(false); setSettingsOpen(true); }}>{presetLabel} · {settings.dpi} DPI · 转换设置…</Button>
          {!convertibleIds.length && <p className="text-sm text-muted-foreground">当前没有可安全转换的源图片，请先处理问题。</p>}
          <Button variant="outline" disabled={working || !convertibleIds.length || (manualScope === "current" && !currentConvertible)} onClick={() => { if (manualScope === "selected") { setManualOpen(false); props.onSelectionMode(true); } else convert("reconvert", manualScope === "current" ? [props.currentImageId!] : convertibleIds); }}>{manualScope === "selected" ? "选择图片" : "开始转换"}</Button>
        </FieldGroup></FieldSet></PopoverContent></Popover>}
      </>}
      {props.converting && <Button variant="outline" size="sm" disabled={props.cancelRequested} onClick={props.onCancel}><Square data-icon="inline-start" aria-hidden="true" />{props.cancelRequested ? "等待取消…" : "取消更新"}</Button>}
      {(!idle && (!recommendedConvert || blocked || props.converting || props.completion !== null || props.selectionMode)) && <Button className="command-action" disabled={props.busy || props.completion !== null || blocked || (recommendedConvert && count === 0)} onClick={submit}>
        {props.converting ? <LoaderCircle data-icon="inline-start" className="spin" aria-hidden="true" /> : props.completion !== null ? <Check data-icon="inline-start" aria-hidden="true" /> : status.nextAction === "reviewReferences" ? <FileCheck2 data-icon="inline-start" aria-hidden="true" /> : null}<span className="command-action-label-stage">{departingLabel && <span className="command-action-label-exit" aria-hidden="true">{departingLabel}</span>}<span key={transitionKey} className="command-action-label-enter">{label}</span></span>
      </Button>}
    </div>
  </section>;
}
