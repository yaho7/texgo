import { FolderOpen, LoaderCircle, FileCode2, X } from "lucide-react";
import { Button } from "@/controls/button";
import IconButton from "./IconButton";
import type { RecentWorkspace } from "./recents";
import { workspaceKey } from "./recents";
import RecentProjectDetails from "./RecentProjectDetails";

interface Props {
  busy: boolean;
  onOpenTex: () => void;
  recents: RecentWorkspace[];
  onRecent: (entry: RecentWorkspace) => void;
  onRemove?: (entry: RecentWorkspace) => void;
  failedRecent?: string | null;
}
export default function Home(props: Props) {
  return <main id="main-content" tabIndex={-1} className="home-workspace page-transition py-8!">
    <section className="home-opening gap-4!" aria-labelledby="home-title">
      <div className="flex flex-col items-center gap-2"><p className="text-[18px] font-semibold leading-6 text-foreground/65" translate="no">Texgo</p><h1 id="home-title">加快 LaTeX 编译</h1></div>
      <Button aria-busy={props.busy} disabled={props.busy} onClick={props.onOpenTex}>{props.busy ? <LoaderCircle className="animate-spin" data-icon="inline-start" aria-hidden="true" /> : <FolderOpen data-icon="inline-start" aria-hidden="true" />}{props.busy ? "正在扫描…" : "打开或拖入 .tex 文件"}</Button>
      <details className="w-full max-w-[440px] text-left text-xs leading-relaxed">
        <summary className="mx-auto w-fit cursor-pointer rounded px-2 py-1 text-muted-foreground focus-visible:outline-2 focus-visible:outline-primary">工作原理与权限</summary>
        <div className="mt-3 space-y-3 rounded-lg border border-border bg-secondary/50 p-4">
          <section><h2 className="mb-1 font-medium">为什么更快</h2><p className="text-muted-foreground">提前完成图片处理，生成可直接引用的 PDF。确认引用后，后续编译复用处理结果，减少图片处理开销。</p></section>
          <section><h2 className="mb-1 font-medium">文件与系统权限</h2><p className="text-muted-foreground">读取所选项目并写入处理结果。自动检测只刷新状态，自动处理不修改 .tex 引用；引用修改须由你确认。</p><p className="mt-2 text-muted-foreground">系统通知用于完成提醒，全局快捷键用于快速处理；均可在设置中关闭。</p></section>
        </div>
      </details>
      {props.recents.length > 0 && <section className="home-recents" aria-label="最近项目"><h2>最近项目</h2><ul className="recent-list">{props.recents.slice(0, 5).map((entry) => <li key={entry.path} className="flex items-center gap-1"><Button variant="ghost" className="recent-open" disabled={props.busy} onClick={() => props.onRecent(entry)}><FileCode2 aria-hidden="true" /><RecentProjectDetails entry={entry} failed={props.failedRecent === workspaceKey(entry)} /></Button>{props.onRemove && <IconButton label={`移除最近记录 ${entry.path}`} size="icon-sm" disabled={props.busy} onClick={() => props.onRemove?.(entry)}><X aria-hidden="true" /></IconButton>}</li>)}</ul></section>}
    </section>
  </main>;
}
