import { nativeText } from "./nativeText";
import { t } from "./i18n";
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
  const status = operation === "checking" ? t("applicationUpdate.checkingForUpdates") : operation === "downloading" ? t("applicationUpdate.downloadingAndVerifyingTheSignature") : operation === "installing" ? t("applicationUpdate.installingUpdate") : operation === "restarting" ? t("applicationUpdate.restarting")
    : info?.stage === "installed" ? t("applicationUpdate.updateInstalledRestartToUseIt") : info?.stage === "ready" ? t("applicationUpdate.versionValueIsVerifiedAndReadyToInstall", { arg0: info.version }) : info?.stage === "available" ? t("applicationUpdate.newVersionValue", { arg0: info.version }) : info?.stage === "current" ? t("applicationUpdate.youHaveTheLatestVersion") : t("applicationUpdate.couldNotCheckForUpdates");
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent showCloseButton={false} onEscapeKeyDown={event => { if (busy) event.preventDefault(); }} onInteractOutside={event => { if (busy) event.preventDefault(); }} onCloseAutoFocus={event => { event.preventDefault(); (document.querySelector<HTMLButtonElement>(".workbench-menu-trigger") ?? document.getElementById("main-content"))?.focus(); }}>
    <DialogHeader><DialogTitle>{t("applicationUpdate.appUpdate")}</DialogTitle><DialogDescription>{info ? t("applicationUpdate.currentVersionValue", { arg0: info.currentVersion }) : t("applicationUpdate.checkForANewVersion")}</DialogDescription></DialogHeader>
    <p role="status" className="flex items-center gap-2">{busy && <LoaderCircle className="animate-spin" aria-hidden="true" />}{status}</p>
    {error && <p role="alert" className="text-sm text-destructive">{nativeText(error)}</p>}
    {info?.stage === "ready" && <p className="text-xs text-muted-foreground">{info.installerRestarts ? t("applicationUpdate.installationWillCloseAndReopenTexgoSaveYourWorkFirst") : t("applicationUpdate.restartTexgoAfterInstallation")}</p>}
    <DialogFooter><Button variant="outline" disabled={busy} onClick={onClose}>{t("applicationUpdate.close")}</Button>
      {info?.stage === "available" && <Button disabled={busy} onClick={() => { void act("downloading", "download_application_update"); }}>{t("applicationUpdate.downloadUpdate")}</Button>}
      {info?.stage === "ready" && <Button disabled={busy} onClick={() => { void act("installing", "install_application_update"); }}>{t("applicationUpdate.installUpdate")}</Button>}
      {info?.stage === "installed" && <Button disabled={busy} onClick={() => { void act("restarting", "restart_after_update"); }}>{t("applicationUpdate.restartApp")}</Button>}
      {!busy && info?.stage !== "installed" && <Button variant="outline" onClick={() => { void act("checking", "check_application_update"); }}>{t("applicationUpdate.checkAgain")}</Button>}
    </DialogFooter>
  </DialogContent></Dialog>;
}
