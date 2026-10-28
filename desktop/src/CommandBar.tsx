import { nativeText } from "./nativeText";
import { t } from "./i18n";
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, FileCheck2, SlidersHorizontal, Square, TriangleAlert } from "lucide-react";
import { Button } from "@/controls/button";
import { Field, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/controls/field";
import { Input } from "@/controls/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/controls/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/controls/dropdown-menu";
import { Progress } from "@/controls/progress";
import { Separator } from "@/controls/separator";
import { ToggleGroup, ToggleGroupItem } from "@/controls/toggle-group";
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
  onManualOpen?: () => boolean;
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
  const convertibleIds = props.convertibleIds ?? status.pendingImageIds;
  const currentConvertible = Boolean(props.currentImageId && convertibleIds.includes(props.currentImageId));
  const recommendedConvert = props.selectionMode || status.nextAction === "convertImages";
  const working = props.busy || props.completion !== null;
  const manualUnavailable = working || props.converting || props.selectionMode;
  useEffect(() => {
    if (manualUnavailable) setManualOpen(false);
  }, [manualUnavailable]);
  function convert(intent: "pending" | "selected" | "reconvert", ids?: string[]) {
    if (working || blocked) return;
    if (Object.keys(issues).length) { setSettingsOpen(true); return; }
    setManualOpen(false);
    if (props.onConvert) props.onConvert(intent, ids); else props.onAction();
  }
  const preset = conversionPreset(Number(settings.dpi), Number(settings.jpegQuality));
  const presetLabel = preset?.label ?? t("commandBar.custom");
  const count = props.selectionMode ? props.selectedCount : status.pendingImages;
  const issues = settingsIssues(settings);
  const blocked = Boolean(status.blockingReason);
  const label = props.converting ? t("commandBar.processingValueValue", { arg0: props.progress?.current ?? 0, arg1: props.progress?.total ?? count })
    : props.completion !== null ? t("commandBar.processedValueImages", { arg0: props.completion })
    : blocked ? t("commandBar.resolveTheSafetyIssueFirst")
    : props.selectionMode ? t("commandBar.processValueImages", { arg0: count })
    : status.nextAction === "reviewReferences" ? t("commandBar.reviewValueReferences", { arg0: status.pendingReferences })
    : recommendedConvert ? t("commandBar.processValueImages", { arg0: count })
    : status.nextAction === "resolveProblems" ? t("commandBar.resolveProblems") : t("commandBar.projectIsUpToDate");
  const message = props.converting ? `${label} · ${props.progress?.name || t("commandBar.preparingImageUpdates")}`
    : props.completion !== null ? t("commandBar.processedValueImages2", { arg0: props.completion })
    : blocked ? t("commandBar.operationPaused")
    : props.selectionMode ? t("commandBar.selectImagesToProcess")
    : status.nextAction === "reviewReferences" ? t("commandBar.processedImagesAreReady")
    : status.nextAction === "convertImages" ? ""
    : status.nextAction === "resolveProblems" ? t("commandBar.locateOrRepairTheAffectedImages") : t("commandBar.projectIsUpToDate");
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
  return <section className="command-bar" aria-label={t("commandBar.nextProjectAction")} data-state={transitionKey}>
    <div className="command-status">
      <div className="command-message-stage" aria-live="polite" role="status">
        {departing && <span aria-hidden="true" className="command-message command-message-exit">{departing}</span>}
        {message && <span key={transitionKey} title={blocked ? nativeText(status.blockingReason ?? "") : undefined} className="command-message command-message-enter">
          {(idle || props.completion !== null) && <Check className="command-success" aria-hidden="true" />}
          {blocked && <TriangleAlert aria-hidden="true" />}{message}
        </span>}
      </div>
      {props.converting && <Progress value={progress} aria-label={t("commandBar.imageUpdateProgress")} className="command-progress" />}
    </div>
    {!props.converting && props.completion === null && (
        <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
          <PopoverTrigger asChild><Button variant="ghost" size="sm" className="command-parameters" disabled={props.busy} aria-label={t("commandBar.outputSettingsValueValueDPI", { arg0: presetLabel, arg1: settings.dpi })}><SlidersHorizontal data-icon="inline-start" aria-hidden="true" />{presetLabel} · {settings.dpi} DPI<ChevronDown data-icon="inline-end" aria-hidden="true" /></Button></PopoverTrigger>
          <PopoverContent side="top" align="end" className="command-settings" aria-label={t("commandBar.outputSettings")}>
            <FieldSet disabled={props.busy}><FieldLegend>{t("commandBar.outputSettings")}</FieldLegend><FieldGroup>
              <Field><FieldLabel id="conversion-preset-label">{t("commandBar.preset")}{!preset && <span className="text-muted-foreground"> {t("commandBar.custom2")}</span>}</FieldLabel>
                <ToggleGroup type="single" variant="outline" value={preset?.id ?? ""} aria-labelledby="conversion-preset-label" onValueChange={(value) => { const next = conversionPresets.find((item) => item.id === value); if (next) props.onSettings({ ...settings, dpi: String(next.dpi), jpegQuality: String(next.jpegQuality) }); }}>
                  {conversionPresets.map((item) => <ToggleGroupItem key={item.id} value={item.id}>{item.label}</ToggleGroupItem>)}
                </ToggleGroup>
              </Field><Separator />
              <Field data-invalid={Boolean(issues.dpi)}><FieldLabel htmlFor="conversion-dpi">DPI</FieldLabel><Input id="conversion-dpi" type="number" inputMode="numeric" min={72} max={1200} value={settings.dpi} aria-invalid={Boolean(issues.dpi)} aria-describedby={issues.dpi ? "conversion-dpi-error" : undefined} onChange={(event) => props.onSettings({ ...settings, dpi: event.target.value })} />{issues.dpi && <FieldError id="conversion-dpi-error">{issues.dpi}</FieldError>}</Field>
              <Field data-invalid={Boolean(issues.jpegQuality)}><FieldLabel htmlFor="conversion-quality">{t("commandBar.quality")}</FieldLabel><Input id="conversion-quality" type="number" inputMode="numeric" min={1} max={100} value={settings.jpegQuality} aria-invalid={Boolean(issues.jpegQuality)} aria-describedby={issues.jpegQuality ? "conversion-quality-error" : undefined} onChange={(event) => props.onSettings({ ...settings, jpegQuality: event.target.value })} />{issues.jpegQuality && <FieldError id="conversion-quality-error">{issues.jpegQuality}</FieldError>}</Field>
              <Field data-invalid={Boolean(issues.outputDir)}><FieldLabel htmlFor="conversion-output">{t("commandBar.outputDirectory")}</FieldLabel><Input id="conversion-output" value={settings.outputDir} spellCheck={false} aria-invalid={Boolean(issues.outputDir)} aria-describedby={issues.outputDir ? "conversion-output-error" : undefined} onChange={(event) => props.onSettings({ ...settings, outputDir: event.target.value })} />{issues.outputDir && <FieldError id="conversion-output-error">{issues.outputDir}</FieldError>}</Field>
            </FieldGroup></FieldSet>
          </PopoverContent>
        </Popover>
    )}
    <div className="command-actions">
      {!props.converting && props.completion === null && props.selectionMode && <Button variant="ghost" size="sm" disabled={props.busy} onClick={() => props.onSelectionMode(false)}>{t("commandBar.cancelSelection")}</Button>}
      {!props.converting && props.completion === null && !props.selectionMode && <DropdownMenu open={manualOpen && !manualUnavailable} onOpenChange={(open) => {
        if (open && (manualUnavailable || props.onManualOpen?.() === false)) return;
        setManualOpen(open);
      }}>
        <div className={recommendedConvert && !blocked ? "command-split" : undefined}>
          {recommendedConvert && !blocked && <Button className="command-action" disabled={working || count === 0} onClick={submit}><span className="command-action-label-stage">{departingLabel && <span className="command-action-label-exit" aria-hidden="true">{departingLabel}</span>}<span key={transitionKey} className="command-action-label-enter">{label}</span></span></Button>}
          <DropdownMenuTrigger asChild>{recommendedConvert && !blocked
            ? <Button aria-label={t("commandBar.moreProcessingActions")} className="command-split-menu" size="icon" disabled={working}><ChevronDown aria-hidden="true" /></Button>
            : <Button variant="outline" disabled={working}>{t("commandBar.processImages")}</Button>}
          </DropdownMenuTrigger>
        </div>
        <DropdownMenuContent align="end" side="top"><DropdownMenuGroup>
          <DropdownMenuItem disabled={blocked || !status.pendingImages} onSelect={() => convert("pending")}>{t("commandBar.processPendingImages")}</DropdownMenuItem>
          <DropdownMenuItem disabled={blocked || !convertibleIds.length} onSelect={() => props.onSelectionMode(true)}>{t("commandBar.selectImages")}</DropdownMenuItem>
          <DropdownMenuItem disabled={blocked || !currentConvertible} onSelect={() => convert("reconvert", [props.currentImageId!])}>{t("commandBar.reprocessCurrentImage")}</DropdownMenuItem>
          <DropdownMenuItem disabled={blocked || !convertibleIds.length} onSelect={() => convert("reconvert", convertibleIds)}>{t("commandBar.reprocessAllImages")}</DropdownMenuItem>
        </DropdownMenuGroup></DropdownMenuContent>
      </DropdownMenu>}
      {props.converting && <Button variant="outline" size="sm" disabled={props.cancelRequested} onClick={props.onCancel}><Square data-icon="inline-start" aria-hidden="true" />{props.cancelRequested ? t("commandBar.cancelling") : t("commandBar.cancelProcessing")}</Button>}
      {(!props.converting && props.completion === null && !idle && (!recommendedConvert || blocked || props.selectionMode)) && <Button className="command-action" disabled={props.busy || props.completion !== null || blocked || (recommendedConvert && count === 0)} onClick={submit}>
        {status.nextAction === "reviewReferences" ? <FileCheck2 data-icon="inline-start" aria-hidden="true" /> : null}<span className="command-action-label-stage">{departingLabel && <span className="command-action-label-exit" aria-hidden="true">{departingLabel}</span>}<span key={transitionKey} className="command-action-label-enter">{label}</span></span>
      </Button>}
    </div>
  </section>;
}
