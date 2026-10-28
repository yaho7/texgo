import { t, loadLocale, setLocale, useLocale } from "./i18n";
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowLeft, Check, LoaderCircle } from "lucide-react";
import { Button } from "@/controls/button";
import { Checkbox } from "@/controls/checkbox";
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/controls/field";
import { Input } from "@/controls/input";
import { NativeSelect, NativeSelectOption } from "@/controls/native-select";
import { ToggleGroup, ToggleGroupItem } from "@/controls/toggle-group";
import { conversionPreset, conversionPresets, type Preferences } from "./preferences";
import ShortcutRecorder from "./ShortcutRecorder";
import { errorMessage } from "./utils";
import "./inspector-settings.css";
import "./preferences-native.css";

const preferenceRow = "grid! min-w-0 grid-cols-1 gap-x-5 gap-y-2 sm:grid-cols-[150px_minmax(0,1fr)] [&>[data-slot=field-label]]:self-center sm:[&>[data-slot=field-description]]:col-start-2";

export default function SettingsPage({ value, onSaved, onClose, active = true }: { active?: boolean; value: Preferences; onSaved: (value: Preferences) => void; onClose: () => void }) {
  useLocale();
  const [draft, setDraft] = useState(value);
  const [openingLogs, setOpeningLogs] = useState(false);
  const openingLogsRef = useRef(false);
  const [logError, setLogError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shortcutError, setShortcutError] = useState(false);
  const [saved, setSaved] = useState(false);
  const inFlight = useRef(false);
  useEffect(() => { if (saved) { const timer = window.setTimeout(() => setSaved(false), 1800); return () => window.clearTimeout(timer); } }, [saved]);
  const change = <K extends keyof Preferences>(key: K, value: Preferences[K]) => { setDraft((p) => ({ ...p, [key]: value })); setSaved(false); setError(null); setShortcutError(false); };
  const toggle = (key: keyof Preferences, label: string) => <Field orientation="horizontal"><Checkbox id={`preference-${key}`} checked={draft[key] === true} onCheckedChange={(v) => change(key, Boolean(v))} /><FieldLabel htmlFor={`preference-${key}`}>{label}</FieldLabel></Field>;
  async function save() {
    if (inFlight.current) return;
    if (!Number.isInteger(draft.dpi) || draft.dpi < 72 || draft.dpi > 1200 || !Number.isInteger(draft.jpegQuality) || draft.jpegQuality < 1 || draft.jpegQuality > 100) { setError(t("settings.dPIMustBeAnIntegerFrom72To1200Quality")); return; }
    if (!draft.outputDir.trim()) { setError(t("settings.enterAnOutputDirectoryInsideTheProject")); return; }
    inFlight.current = true; setSaving(true); setError(null); setShortcutError(false); setSaved(false);
    try { await loadLocale(draft.language); const next = await invoke<Preferences>("save_preferences", { preferences: draft }); await setLocale(next.language); onSaved(next); setDraft(next); setSaved(true); }
    catch (reason) {
      const message = errorMessage(reason);
      const isShortcut = /快捷键|shortcut|hotkey|register|already.*use|occupied/i.test(message);
      setShortcutError(isShortcut); setError(isShortcut ? t("settings.thisShortcutIsUnavailableOrInUseByAnotherApp") : message);
    }
    finally { inFlight.current = false; setSaving(false); }
  }
  async function openLogs() {
    if (openingLogsRef.current) return;
    openingLogsRef.current = true; setOpeningLogs(true); setLogError(null);
    try { await invoke("open_log_directory"); }
    catch (reason) { setLogError(errorMessage(reason)); }
    finally { openingLogsRef.current = false; setOpeningLogs(false); }
  }
  return <main id={active ? "main-content" : undefined} tabIndex={-1} className="settings-page native-preferences" aria-label={t("common.settings")} onKeyDown={(event) => { if (event.key === "Escape" && !saving) { event.stopPropagation(); onClose(); } }}>
    <header className="flex items-center gap-3"><Button variant="ghost" size="icon" aria-label={t("settings.back")} onClick={onClose}><ArrowLeft aria-hidden="true" /></Button><h1 className="flex-1 text-lg font-semibold">{t("common.settings")}</h1><div className="settings-save-feedback"><Button form="preferences-form" type="submit" disabled={saving} aria-busy={saving}>{saving ? <LoaderCircle className="spin" data-icon="inline-start" aria-hidden="true" /> : saved ? <Check data-icon="inline-start" aria-hidden="true" /> : null}{saving ? t("settings.saving") : saved ? t("settings.saved") : t("settings.saveSettings")}</Button><span className="sr-only" role="status">{saved ? t("settings.settingsSaved") : ""}</span></div></header>
    <form id="preferences-form" noValidate onSubmit={(event) => { event.preventDefault(); void save(); }} className="flex flex-col gap-6">
      <FieldSet disabled={saving}><FieldLegend>{t("settings.general")}</FieldLegend><FieldGroup>
        <Field className={preferenceRow}><FieldLabel htmlFor="language">{t("common.language")}</FieldLabel><NativeSelect id="language" value={draft.language} onChange={event => change("language", event.target.value as Preferences["language"])}><NativeSelectOption value="zh-CN">{t("common.chinese")}</NativeSelectOption><NativeSelectOption value="en-US">{t("common.english")}</NativeSelectOption></NativeSelect><FieldDescription>{t("common.languageHint")}</FieldDescription></Field>
        <Field className={preferenceRow}><FieldLabel htmlFor="startup">{t("settings.onStartup")}</FieldLabel><NativeSelect id="startup" value={draft.startup} onChange={(e) => change("startup", e.target.value as Preferences["startup"])}><NativeSelectOption value="home">{t("settings.showRecentProjects")}</NativeSelectOption><NativeSelectOption value="lastWorkspace">{t("settings.restoreLastProject")}</NativeSelectOption></NativeSelect></Field>
        {toggle("autoUpdate", t("settings.checkForAppUpdatesAutomatically"))}
        <Field className={preferenceRow}><FieldLabel htmlFor="close-action">{t("settings.whenClosingTheWindow")}</FieldLabel><NativeSelect id="close-action" value={draft.closeAction} onChange={(e) => change("closeAction", e.target.value as Preferences["closeAction"])}><NativeSelectOption value="background">{t("settings.keepTexgoRunningInTheBackground")}</NativeSelectOption><NativeSelectOption value="quit">{t("settings.quitTexgo")}</NativeSelectOption></NativeSelect></Field>
      </FieldGroup></FieldSet>
      <FieldSet disabled={saving}><FieldLegend>{t("settings.imageProcessing")}</FieldLegend><FieldGroup>
        <Field className={preferenceRow}><FieldLabel>{t("settings.defaultProcessingPreset")}</FieldLabel><ToggleGroup type="single" value={conversionPreset(draft.dpi, draft.jpegQuality)?.id ?? ""} onValueChange={(id) => { const preset = conversionPresets.find((item) => item.id === id); if (preset) { change("dpi", preset.dpi); change("jpegQuality", preset.jpegQuality); } }} variant="outline" aria-label={t("settings.defaultProcessingPreset")}>{conversionPresets.map((preset) => <ToggleGroupItem key={preset.id} value={preset.id}>{preset.label}</ToggleGroupItem>)}</ToggleGroup><FieldDescription>{conversionPreset(draft.dpi, draft.jpegQuality)?.label ?? t("settings.custom")} · {draft.dpi} DPI · {draft.jpegQuality}%</FieldDescription></Field>
        <Field className={preferenceRow}><FieldLabel htmlFor="default-dpi">{t("settings.defaultDPI")}</FieldLabel><Input id="default-dpi" type="number" min={72} max={1200} value={draft.dpi} onChange={(e) => change("dpi", Number(e.target.value))} /></Field>
        <Field className={preferenceRow}><FieldLabel htmlFor="default-quality">{t("settings.defaultQuality")}</FieldLabel><Input id="default-quality" type="number" min={1} max={100} value={draft.jpegQuality} onChange={(e) => change("jpegQuality", Number(e.target.value))} /></Field>
        <Field className={preferenceRow}><FieldLabel htmlFor="default-output">{t("settings.defaultOutputDirectory")}</FieldLabel><Input id="default-output" value={draft.outputDir} onChange={(e) => change("outputDir", e.target.value)} /><FieldDescription>{t("settings.relativeToTheProjectExistingManagedPDFsContinueUpdatingIn")}</FieldDescription></Field>
      </FieldGroup></FieldSet>
      <FieldSet disabled={saving}><FieldLegend>{t("settings.automation")}</FieldLegend><FieldGroup>
        {toggle("autoWatch", t("settings.detectProjectFileChangesAutomatically"))}
        <FieldDescription>{t("settings.monitoringOnlyRefreshesStatusQuickProcessingUpdatesImagesReferenceChanges")}</FieldDescription>
      </FieldGroup></FieldSet>
      <FieldSet disabled={saving}><FieldLegend>{t("settings.notifications")}</FieldLegend><FieldGroup>
        {toggle("notifySuccess", t("settings.notifyWhenImageUpdatesFinish"))}{toggle("notifyFailure", t("settings.notifyWhenImageUpdatesFail"))}{toggle("notifyUnchanged", t("settings.notifyWhenNothingHasChanged"))}
      </FieldGroup></FieldSet>
      <FieldSet disabled={saving}><FieldLegend>{t("settings.keyboardShortcuts")}</FieldLegend><FieldGroup>{toggle("shortcutEnabled", t("settings.enableTheGlobalShortcut"))}<Field className={preferenceRow} data-invalid={shortcutError}><FieldLabel>{t("settings.globalQuickProcessing")}</FieldLabel><ShortcutRecorder value={draft.shortcut} disabled={!draft.shortcutEnabled || saving} onChange={(next) => change("shortcut", next)} />{shortcutError && error && <p role="alert" className="text-sm text-destructive">{error}</p>}</Field><FieldDescription>{t("settings.inTheAppCtrlOToOpenFToSearch")}</FieldDescription></FieldGroup></FieldSet>
      <FieldSet disabled={saving}><FieldLegend>{t("settings.advanced")}</FieldLegend><FieldGroup>{toggle("allowUnreviewed", t("settings.allowImageUpdatesWhileReferencesAwaitReview"))}<FieldDescription>{t("settings.continueProcessingImagesWithoutSkippingReferenceReview")}</FieldDescription>{toggle("debugLogging", t("settings.enableDebugLogging"))}<FieldDescription>{t("settings.appliesAfterSavingLogsContainEventsAndTimingNotFile")}</FieldDescription><Field><Button type="button" variant="outline" disabled={openingLogs} aria-busy={openingLogs} onClick={() => { void openLogs(); }}>{openingLogs ? t("settings.opening") : t("settings.openLogFolder")}</Button>{logError && <p role="alert" className="text-sm text-destructive">{logError}</p>}</Field></FieldGroup></FieldSet>
      {error && !shortcutError && <p role="alert" className="text-sm text-destructive">{error}</p>}

    </form>
  </main>;
}
