import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ExternalLink, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { errorMessage } from "./utils";

interface Release { tag_name: string; html_url: string; name: string; }
export default function ApplicationUpdate({ onClose }: { onClose: () => void }) {
  const [release, setRelease] = useState<Release | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = (import.meta as ImportMeta & { env: Record<string, string> }).env.VITE_RELEASE_TAG;
  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12_000);
    void fetch("https://api.github.com/repos/yaho7/texgo/releases/latest", { signal: controller.signal, headers: { Accept: "application/vnd.github+json" } })
      .then(async (response) => {
        if (!response.ok) throw new Error(response.status === 403 ? "GitHub 请求次数受限，请稍后重试" : "暂时无法读取 GitHub 发行版");
        const data = await response.json() as Release;
        if (typeof data.tag_name !== "string" || !data.html_url?.startsWith("https://github.com/yaho7/texgo/releases/tag/")) throw new Error("GitHub 返回了无效的发行版信息");
        if (!disposed) setRelease(data);
      }).catch((reason: unknown) => { if (disposed) return; if (!controller.signal.aborted) setError(errorMessage(reason)); else setError("检查超时，请检查网络后重试"); })
      .finally(() => window.clearTimeout(timeout));
    return () => { disposed = true; controller.abort(); window.clearTimeout(timeout); };
  }, []);
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent onCloseAutoFocus={(event) => { event.preventDefault(); document.querySelector<HTMLButtonElement>(".workbench-menu-trigger")?.focus(); }}>
    <DialogHeader><DialogTitle>检查应用更新</DialogTitle><DialogDescription>GitHub Releases</DialogDescription></DialogHeader>
    <div role="status">{error ? <p className="text-destructive">{error}</p> : release ? <><p>{release.tag_name === current ? "已是最新发行版" : `最新发行版：${release.name || release.tag_name}`}</p><p className="mt-2 text-xs text-muted-foreground">当前版本：{current === "development" ? "开发版本" : current}</p></> : <p className="flex items-center gap-2"><LoaderCircle className="animate-spin" aria-hidden="true" />正在检查 GitHub 更新…</p>}</div>
    <DialogFooter><Button variant="outline" onClick={onClose}>关闭</Button>{release && <Button onClick={() => { void invoke("open_release_page", { url: release.html_url }).catch((reason: unknown) => setError(errorMessage(reason))); }}><ExternalLink data-icon="inline-start" aria-hidden="true" />查看发行版</Button>}</DialogFooter>
  </DialogContent></Dialog>;
}
