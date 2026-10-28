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

export default function SettingsPage({ value, onSaved, onClose }: { value: Preferences; onSaved: (value: Preferences) => void; onClose: () => void }) {
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
    if (!Number.isInteger(draft.dpi) || draft.dpi < 72 || draft.dpi > 1200 || !Number.isInteger(draft.jpegQuality) || draft.jpegQuality < 1 || draft.jpegQuality > 100) { setError("DPI 应为 72–1200 的整数，质量应为 1–100 的整数。"); return; }
    if (!draft.outputDir.trim()) { setError("请填写项目内的输出目录。"); return; }
    inFlight.current = true; setSaving(true); setError(null); setShortcutError(false); setSaved(false);
    try { const next = await invoke<Preferences>("save_preferences", { preferences: draft }); onSaved(next); setDraft(next); setSaved(true); }
    catch (reason) {
      const message = errorMessage(reason);
      const isShortcut = /快捷键|shortcut|hotkey|register|already.*use|occupied/i.test(message);
      setShortcutError(isShortcut); setError(isShortcut ? "该快捷键已被其他应用占用，或无法在当前系统注册。请重新录制后保存。" : message);
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
  return <main id="main-content" tabIndex={-1} className="settings-page native-preferences" aria-label="设置" onKeyDown={(event) => { if (event.key === "Escape" && !saving) { event.stopPropagation(); onClose(); } }}>
    <header className="flex items-center gap-3"><Button variant="ghost" size="icon" aria-label="返回工作区" onClick={onClose}><ArrowLeft aria-hidden="true" /></Button><h1 className="flex-1 text-lg font-semibold">设置</h1><div className="settings-save-feedback"><Button form="preferences-form" type="submit" disabled={saving} aria-busy={saving}>{saving ? <LoaderCircle className="spin" data-icon="inline-start" aria-hidden="true" /> : saved ? <Check data-icon="inline-start" aria-hidden="true" /> : null}{saving ? "正在保存…" : saved ? "已保存" : "保存设置"}</Button><span className="sr-only" role="status">{saved ? "设置已保存" : ""}</span></div></header>
    <form id="preferences-form" noValidate onSubmit={(event) => { event.preventDefault(); void save(); }} className="flex flex-col gap-6">
      <FieldSet disabled={saving}><FieldLegend>常规</FieldLegend><FieldGroup>
        <Field className={preferenceRow}><FieldLabel htmlFor="startup">启动时</FieldLabel><NativeSelect id="startup" value={draft.startup} onChange={(e) => change("startup", e.target.value as Preferences["startup"])}><NativeSelectOption value="home">显示最近项目</NativeSelectOption><NativeSelectOption value="lastWorkspace">恢复上次项目</NativeSelectOption></NativeSelect></Field>
        {toggle("autoUpdate", "自动检查应用更新")}
        <Field className={preferenceRow}><FieldLabel htmlFor="close-action">关闭窗口时</FieldLabel><NativeSelect id="close-action" value={draft.closeAction} onChange={(e) => change("closeAction", e.target.value as Preferences["closeAction"])}><NativeSelectOption value="background">保持 Texgo 在后台运行</NativeSelectOption><NativeSelectOption value="quit">完全退出 Texgo</NativeSelectOption></NativeSelect></Field>
      </FieldGroup></FieldSet>
      <FieldSet disabled={saving}><FieldLegend>转换</FieldLegend><FieldGroup>
        <Field className={preferenceRow}><FieldLabel>默认转换预设</FieldLabel><ToggleGroup type="single" value={conversionPreset(draft.dpi, draft.jpegQuality)?.id ?? ""} onValueChange={(id) => { const preset = conversionPresets.find((item) => item.id === id); if (preset) { change("dpi", preset.dpi); change("jpegQuality", preset.jpegQuality); } }} variant="outline" aria-label="默认转换预设">{conversionPresets.map((preset) => <ToggleGroupItem key={preset.id} value={preset.id}>{preset.label}</ToggleGroupItem>)}</ToggleGroup><FieldDescription>{conversionPreset(draft.dpi, draft.jpegQuality)?.label ?? "自定义"} · {draft.dpi} DPI · {draft.jpegQuality}%</FieldDescription></Field>
        <Field className={preferenceRow}><FieldLabel htmlFor="default-dpi">默认 DPI</FieldLabel><Input id="default-dpi" type="number" min={72} max={1200} value={draft.dpi} onChange={(e) => change("dpi", Number(e.target.value))} /></Field>
        <Field className={preferenceRow}><FieldLabel htmlFor="default-quality">默认质量 (%)</FieldLabel><Input id="default-quality" type="number" min={1} max={100} value={draft.jpegQuality} onChange={(e) => change("jpegQuality", Number(e.target.value))} /></Field>
        <Field className={preferenceRow}><FieldLabel htmlFor="default-output">默认输出目录</FieldLabel><Input id="default-output" value={draft.outputDir} onChange={(e) => change("outputDir", e.target.value)} /><FieldDescription>相对于项目目录。已经生成的 PDF 会继续在原位置更新。</FieldDescription></Field>
      </FieldGroup></FieldSet>
      <FieldSet disabled={saving}><FieldLegend>自动化</FieldLegend><FieldGroup>
        {toggle("autoWatch", "自动检测项目文件变化")}
        <FieldDescription>自动检测文件变化会刷新项目状态。托盘或全局快捷键的快速更新只更新 Texgo 管理的 PDF；.tex 引用始终等待你在窗口中审核并确认。</FieldDescription>
      </FieldGroup></FieldSet>
      <FieldSet disabled={saving}><FieldLegend>通知</FieldLegend><FieldGroup>
        {toggle("notifySuccess", "图片更新完成后显示系统通知")}{toggle("notifyFailure", "图片更新失败时显示系统通知")}{toggle("notifyUnchanged", "没有变化时显示通知")}
      </FieldGroup></FieldSet>
      <FieldSet disabled={saving}><FieldLegend>快捷键</FieldLegend><FieldGroup>{toggle("shortcutEnabled", "启用系统级全局快捷键")}<Field className={preferenceRow} data-invalid={shortcutError}><FieldLabel>全局快速转换</FieldLabel><ShortcutRecorder value={draft.shortcut} disabled={!draft.shortcutEnabled || saving} onChange={(next) => change("shortcut", next)} />{shortcutError && error && <p role="alert" className="text-sm text-destructive">{error}</p>}</Field><FieldDescription>应用内：⌘/Ctrl , 设置 · F 搜索 · Enter 更新图片 · Shift Enter 审核引用。预览：Space 切换原图 / PDF / 对比 · ← / → 调整 · Shift 大步 · 0 复位。</FieldDescription></FieldGroup></FieldSet>
      <FieldSet disabled={saving}><FieldLegend>高级</FieldLegend><FieldGroup>{toggle("allowUnreviewed", "引用尚未审核时允许继续更新图片")}<FieldDescription>仅允许在引用待审核时继续更新 PDF，不会自动修改 .tex 引用。引用仍需逐一审核并确认；Texgo 仍会检查安全写入条件。</FieldDescription>{toggle("debugLogging", "启用调试日志")}<FieldDescription>保存后生效。默认仅记录警告和错误；调试日志增加操作次数和耗时，不记录文件内容、图片、引用文本或密钥。日志会自动轮换。</FieldDescription><Field><Button type="button" variant="outline" disabled={openingLogs} aria-busy={openingLogs} onClick={() => { void openLogs(); }}>{openingLogs ? "正在打开…" : "打开日志目录"}</Button>{logError && <p role="alert" className="text-sm text-destructive">{logError}</p>}</Field></FieldGroup></FieldSet>
      {error && !shortcutError && <p role="alert" className="text-sm text-destructive">{error}</p>}

    </form>
  </main>;
}
