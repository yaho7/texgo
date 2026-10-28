import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/controls/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/controls/dialog";
import { errorMessage } from "./utils";

export interface ApplicationUpdateInfo {
  currentVersion: string;
  version: string | null;
  token: number | null;
  installerRestarts: boolean;
  stage: "current" | "available" | "ready" | "installed";
}
export default function ApplicationUpdate({ onClose }: { onClose: () => void }) {
  const [info, setInfo] = useState<ApplicationUpdateInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [operation, setOperation] = useState<"checking" | "downloading" | "installing" | "restarting" | null>("checking");
  const pending = useRef<Promise<ApplicationUpdateInfo> | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    // Reuse the first request through StrictMode's setup/cleanup replay.
    const request = pending.current ??= invoke<ApplicationUpdateInfo>("check_application_update");
    let active = true;
    void request.then(value => { if (active) setInfo(value); }).catch(reason => { if (active) setError(errorMessage(reason)); }).finally(() => { if (active) setOperation(null); });
    return () => { active = false; mounted.current = false; };
  }, []);
  async function act(kind: NonNullable<typeof operation>, command: string) {
    if (inFlight.current || operation) return;
    inFlight.current = true; setOperation(kind); setError(null);
    try {
      const value = await invoke<ApplicationUpdateInfo | void>(command, info?.token == null ? undefined : { token: info.token });
      if (mounted.current && value) setInfo(value);
    } catch (reason) { if (mounted.current) setError(errorMessage(reason)); }
    finally { inFlight.current = false; if (mounted.current) setOperation(null); }
  }
  const busy = operation !== null;
  const status = operation === "checking" ? "正在检查更新…" : operation === "downloading" ? "正在下载并验证签名…" : operation === "installing" ? "正在安装更新…" : operation === "restarting" ? "正在重启…"
    : info?.stage === "installed" ? "更新已安装，重启后生效" : info?.stage === "ready" ? `${info.version} 签名验证通过，可以安装` : info?.stage === "available" ? `新版本：${info.version}` : info?.stage === "current" ? "已是最新版本" : "未能检查更新";
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent showCloseButton={false} onEscapeKeyDown={event => { if (busy) event.preventDefault(); }} onInteractOutside={event => { if (busy) event.preventDefault(); }} onCloseAutoFocus={event => { event.preventDefault(); (document.querySelector<HTMLButtonElement>(".workbench-menu-trigger") ?? document.getElementById("main-content"))?.focus(); }}>
    <DialogHeader><DialogTitle>应用更新</DialogTitle><DialogDescription>{info ? `当前版本：${info.currentVersion}` : "检查可用的新版本"}</DialogDescription></DialogHeader>
    <p role="status" className="flex items-center gap-2">{busy && <LoaderCircle className="animate-spin" aria-hidden="true" />}{status}</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {info?.stage === "ready" && <p className="text-xs text-muted-foreground">{info.installerRestarts ? "安装时将退出并重新打开 Texgo，请先保存工作。" : "安装后需重启 Texgo。"}</p>}
    <DialogFooter><Button variant="outline" disabled={busy} onClick={onClose}>关闭</Button>
      {info?.stage === "available" && <Button disabled={busy} onClick={() => { void act("downloading", "download_application_update"); }}>下载更新</Button>}
      {info?.stage === "ready" && <Button disabled={busy} onClick={() => { void act("installing", "install_application_update"); }}>安装更新</Button>}
      {info?.stage === "installed" && <Button disabled={busy} onClick={() => { void act("restarting", "restart_after_update"); }}>重启应用</Button>}
      {!busy && info?.stage !== "installed" && <Button variant="outline" onClick={() => { void act("checking", "check_application_update"); }}>重新检查</Button>}
    </DialogFooter>
  </DialogContent></Dialog>;
}
