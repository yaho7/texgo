import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";

const keyNames: Record<string, string> = {
  " ": "Space", ArrowUp: "ArrowUp", ArrowDown: "ArrowDown", ArrowLeft: "ArrowLeft", ArrowRight: "ArrowRight",
  Enter: "Enter", Backspace: "Backspace", Delete: "Delete", Tab: "Tab", Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown",
};
const codeNames: Record<string, string> = { Minus: "Minus", Equal: "Equal", BracketLeft: "BracketLeft", BracketRight: "BracketRight", Backslash: "Backslash", Semicolon: "Semicolon", Quote: "Quote", Comma: "Comma", Period: "Period", Slash: "Slash", Backquote: "Backquote" };

export function shortcutFromKey(event: Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">): string | null {
  if (!event.altKey || (!event.metaKey && !event.ctrlKey)) return null;
  const key = /^Key[A-Z]$/.test(event.code) ? event.code.slice(3) : /^Digit[0-9]$/.test(event.code) ? event.code.slice(5)
    : keyNames[event.key] ?? codeNames[event.code] ?? (/^F([1-9]|1[0-9]|2[0-4])$/.test(event.key) ? event.key : /^[a-z0-9]$/i.test(event.key) ? event.key.toUpperCase() : null);
  if (!key) return null;
  return [event.metaKey && "Super", event.ctrlKey && "Control", event.altKey && "Alt", event.shiftKey && "Shift", key].filter(Boolean).join("+");
}

export function shortcutTokens(value: string, mac = /Mac|iPhone|iPad/.test(navigator.platform)) {
  const labels: Record<string, string> = { CommandOrControl: mac ? "⌘" : "Ctrl", CmdOrCtrl: mac ? "⌘" : "Ctrl", Command: "⌘", Cmd: "⌘", Super: mac ? "⌘" : "Win", Meta: mac ? "⌘" : "Win", Control: "Ctrl", Ctrl: "Ctrl", Alt: mac ? "⌥" : "Alt", Option: "⌥", Shift: "⇧", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", Space: "Space", Minus: "−", Equal: "=", BracketLeft: "[", BracketRight: "]", Backslash: "\\", Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/", Backquote: "`" };
  return value.split("+").filter(Boolean).map((key) => labels[key] ?? key);
}

// Serialize transient native updates, including cleanup from a previous settings view.
let nativeRecordingQueue: Promise<unknown> = Promise.resolve();
function nativeRecording(recording: boolean) {
  const next = nativeRecordingQueue.catch(() => undefined).then(() => invoke("set_shortcut_recording", { recording }));
  nativeRecordingQueue = next;
  return next;
}

export default function ShortcutRecorder({ value, onChange, disabled = false }: { value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const [recording, setRecording] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [arming, setArming] = useState(false);
  const mounted = useRef(true);
  const intent = useRef(0);
  const capture = useRef<HTMLDivElement>(null);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; intent.current += 1; void nativeRecording(false).catch(() => {}); };
  }, []);
  function finish() {
    intent.current += 1; setRecording(false); setArming(false); setHint(null);
    void nativeRecording(false).catch(() => { if (mounted.current) setHint("未能恢复全局快捷键，请重新打开 Texgo。"); });
  }
  useEffect(() => { if (disabled && (recording || arming)) finish(); }, [disabled, recording, arming]);
  async function start() {
    if (arming || recording || disabled) return;
    const request = ++intent.current; setArming(true); setHint(null);
    try {
      await nativeRecording(true);
      if (!mounted.current || request !== intent.current) return;
      setArming(false); setRecording(true); capture.current?.focus();
    } catch {
      if (mounted.current && request === intent.current) { setArming(false); setHint("暂时无法开始录制，请重试。现有快捷键保持不变。"); }
    }
  }
  return <div className="shortcut-recorder" data-recording={recording || arming}
    onBlur={(event) => { if ((recording || arming) && !event.currentTarget.contains(event.relatedTarget as Node | null)) finish(); }}>
    <div ref={capture} className="shortcut-capture" role="group" aria-label="全局快速转换快捷键" tabIndex={disabled ? -1 : 0} aria-disabled={disabled}
      onKeyDown={(event) => {
        if (!recording || disabled) return;
        event.preventDefault(); event.stopPropagation();
        if (event.key === "Escape") { finish(); return; }
        if (event.repeat || event.nativeEvent.isComposing) return;
        if (["Meta", "Control", "Alt", "Shift"].includes(event.key)) return;
        const next = shortcutFromKey(event.nativeEvent);
        if (!next) { setHint("请同时按住 ⌘ / Ctrl 和 Alt / Option，再按一个按键"); return; }
        onChange(next); finish();
      }}>
      {arming ? <span role="status">正在准备录制…</span> : recording ? <span role="status">正在等待按键…</span> : <span className="shortcut-tokens" aria-label={shortcutTokens(value).join(" + ")}>{shortcutTokens(value).map((token, index) => <span className="shortcut-token-part" key={`${value}:${index}`}>{index > 0 && <span aria-hidden="true">+</span>}<kbd style={{ animationDelay: `calc(var(--motion-fast) * ${index} / 4)` }}>{token}</kbd></span>)}</span>}
    </div>
    <Button type="button" variant="outline" size="sm" disabled={disabled} aria-busy={arming} onClick={() => recording || arming ? finish() : void start()}>{arming ? "正在准备…" : recording ? "取消录制" : "重新录制"}</Button>
    <p className="shortcut-hint text-xs text-muted-foreground" aria-live="polite">{hint ?? (recording ? "请按下新的快捷键，按 Esc 取消" : "按住 ⌘ / Ctrl 和 Alt / Option 录制。在其他应用中也可快速更新当前项目。")}</p>
  </div>;
}
