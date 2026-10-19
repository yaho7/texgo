import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Separator } from "@/components/ui/separator";
import type { Preferences } from "./preferences";
import { errorMessage } from "./utils";

export default function SettingsPage({ value, onSaved, onClose }: { value: Preferences; onSaved: (value: Preferences) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const change = <K extends keyof Preferences>(key: K, value: Preferences[K]) => { setDraft((p) => ({ ...p, [key]: value })); setSaved(false); };
  const toggle = (key: keyof Preferences, label: string) => <Field orientation="horizontal"><Checkbox id={`preference-${key}`} checked={draft[key] === true} onCheckedChange={(v) => change(key, Boolean(v))} /><FieldLabel htmlFor={`preference-${key}`}>{label}</FieldLabel></Field>;
  async function save() {
    setSaving(true); setError(null);
    try { const next = await invoke<Preferences>("save_preferences", { preferences: draft }); onSaved(next); setDraft(next); setSaved(true); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { setSaving(false); }
  }
  return <main id="main-content" tabIndex={-1} className="settings-page" aria-label="设置" onKeyDown={(event) => { if (event.key === "Escape" && !saving) { event.stopPropagation(); onClose(); } }}>
    <header className="flex items-center gap-3"><Button variant="ghost" size="icon" aria-label="返回工作区" onClick={onClose}><ArrowLeft aria-hidden="true" /></Button><h1 className="text-lg font-semibold">设置</h1></header>
    <form noValidate onSubmit={(event) => { event.preventDefault(); void save(); }} className="flex flex-col gap-6">
      <FieldSet disabled={saving}><FieldLegend>常规</FieldLegend><FieldGroup>
        <Field><FieldLabel htmlFor="startup">启动时</FieldLabel><NativeSelect id="startup" value={draft.startup} onChange={(e) => change("startup", e.target.value as Preferences["startup"])}><NativeSelectOption value="home">打开首页</NativeSelectOption><NativeSelectOption value="lastWorkspace">恢复上次工作区</NativeSelectOption></NativeSelect></Field>
        {toggle("autoWatch", "自动检测项目文件变化")}{toggle("autoUpdate", "自动检查应用更新")}{toggle("recursive", "图片目录默认递归扫描")}
        <Field><FieldLabel htmlFor="close-action">关闭窗口时</FieldLabel><NativeSelect id="close-action" value={draft.closeAction} onChange={(e) => change("closeAction", e.target.value as Preferences["closeAction"])}><NativeSelectOption value="background">保持 Texgo 在后台运行</NativeSelectOption><NativeSelectOption value="quit">完全退出 Texgo</NativeSelectOption></NativeSelect></Field>
      </FieldGroup></FieldSet><Separator />
      <FieldSet disabled={saving}><FieldLegend>转换</FieldLegend><FieldGroup>
        <Field><FieldLabel htmlFor="default-preset">默认转换预设</FieldLabel><NativeSelect id="default-preset" value={draft.dpi === 300 && draft.jpegQuality === 90 ? "balanced" : draft.dpi === 300 && draft.jpegQuality === 100 ? "high" : draft.dpi === 150 && draft.jpegQuality === 75 ? "small" : "custom"} onChange={(e) => { const presets: Record<string, [number, number]> = { balanced: [300, 90], high: [300, 100], small: [150, 75] }; const v = presets[e.target.value]; if (v) { change("dpi", v[0]); change("jpegQuality", v[1]); } }}><NativeSelectOption value="balanced">平衡 · 300 DPI / 90%</NativeSelectOption><NativeSelectOption value="high">高质量 · 300 DPI / 100%</NativeSelectOption><NativeSelectOption value="small">小体积 · 150 DPI / 75%</NativeSelectOption><NativeSelectOption value="custom">自定义</NativeSelectOption></NativeSelect></Field>
        <Field><FieldLabel htmlFor="default-dpi">默认 DPI</FieldLabel><Input id="default-dpi" type="number" min={72} max={1200} value={draft.dpi} onChange={(e) => change("dpi", Number(e.target.value))} /></Field>
        <Field><FieldLabel htmlFor="default-quality">默认质量 (%)</FieldLabel><Input id="default-quality" type="number" min={1} max={100} value={draft.jpegQuality} onChange={(e) => change("jpegQuality", Number(e.target.value))} /></Field>
        <Field><FieldLabel htmlFor="default-output">默认输出目录</FieldLabel><Input id="default-output" value={draft.outputDir} onChange={(e) => change("outputDir", e.target.value)} /><p className="text-xs text-muted-foreground">工作区内的相对目录。Smart Convert 沿用已管理图片的输出目录。</p></Field>
        <Field><FieldLabel htmlFor="after-conversion">转换完成后的默认行为</FieldLabel><NativeSelect id="after-conversion" value={draft.afterConversion} onChange={(e) => change("afterConversion", e.target.value as Preferences["afterConversion"])}><NativeSelectOption value="stay">留在当前视图</NativeSelectOption><NativeSelectOption value="history">查看转换记录</NativeSelectOption><NativeSelectOption value="review">检查引用变更</NativeSelectOption></NativeSelect></Field>
        {toggle("allowUnreviewed", "引用尚未审核时允许继续转换")}
      </FieldGroup></FieldSet><Separator />
      <FieldSet disabled={saving}><FieldLegend>通知</FieldLegend><FieldGroup>{toggle("notifySuccess", "转换完成后显示系统通知")}{toggle("notifyFailure", "转换失败时显示系统通知")}{toggle("notifyUnchanged", "没有变化时显示通知")}</FieldGroup></FieldSet><Separator />
      <FieldSet disabled={saving}><FieldLegend>快捷键</FieldLegend><FieldGroup>{toggle("shortcutEnabled", "启用系统级全局快捷键")}<Field><FieldLabel htmlFor="global-shortcut">Smart Convert 全局快捷键</FieldLabel><Input id="global-shortcut" value={draft.shortcut} disabled={!draft.shortcutEnabled} onChange={(e) => change("shortcut", e.target.value)} /><p className="text-xs text-muted-foreground">默认 macOS：⌘ Option Enter；Windows / Linux：Ctrl Alt Enter。使用 CommandOrControl、Alt、Shift 和按键名，以 + 连接。</p></Field><p className="text-xs text-muted-foreground">应用内：⌘/Ctrl , 设置 · F 搜索 · Enter 转换 · Shift Enter 审核。预览区域：Space 对比 · ← / → 调整 · Shift 大步 · 0 复位。</p></FieldGroup></FieldSet>
      <details><summary className="text-sm text-muted-foreground">外观</summary><p className="py-3 text-xs text-muted-foreground">使用 Texgo 默认外观。</p></details>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex items-center gap-3"><Button type="submit" disabled={saving}>{saving ? "正在保存…" : "保存设置"}</Button>{saved && <span role="status" className="text-xs text-muted-foreground">设置已保存</span>}</div>
    </form>
  </main>;
}
