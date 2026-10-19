import { FileCode2, FolderOpen, House, Images, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import IconButton from "./IconButton";
import type { RecentWorkspace } from "./recents";
import { workspaceKey } from "./recents";
import { fileName } from "./utils";

interface Props {
  busy: boolean;
  activeKey: string | null;
  recents: RecentWorkspace[];
  failedRecent: string | null;
  onHome: () => void;
  onOpenTex: () => void;
  onOpenDirectory: () => void;
  onRecent: (entry: RecentWorkspace) => void;
  onRemove: (entry: RecentWorkspace) => void;
}

export default function WorkspaceSidebar(props: Props) {
  return <nav className="sidebar-content" aria-label="项目导航">
    <div className="sidebar-brand" translate="no"><FileCode2 aria-hidden="true" /><span>Texgo</span></div>
    <div className="sidebar-actions">
      <Button variant="ghost" disabled={props.busy} onClick={props.onHome}><House aria-hidden="true" />主页</Button>
      <Button variant="ghost" disabled={props.busy} onClick={props.onOpenTex}><FolderOpen aria-hidden="true" />打开 LaTeX 项目</Button>
      <Button variant="ghost" disabled={props.busy} onClick={props.onOpenDirectory}><Images aria-hidden="true" />批量转换图片</Button>
    </div>
    <section className="sidebar-recents" aria-label="最近打开">
      <h2>最近打开<span>{props.recents.length}</span></h2>
      {props.recents.length === 0 ? <p className="recent-empty">暂无最近记录</p> : <ul className="recent-list">
        {props.recents.map((entry) => {
          const key = workspaceKey(entry);
          return <li key={key} className="recent-item" data-active={props.activeKey === key}>
            <Button variant="ghost" className="recent-open" disabled={props.busy} aria-current={props.activeKey === key ? "page" : undefined} aria-label={`打开最近${entry.mode === "tex" ? "项目" : "目录"} ${entry.path}`} onClick={() => props.onRecent(entry)}>
              {entry.mode === "tex" ? <FileCode2 aria-hidden="true" /> : <Images aria-hidden="true" />}
              <span className="recent-copy"><strong>{fileName(entry.path)}</strong><span title={entry.path}>{entry.path}</span>{props.failedRecent === key && <span className="text-destructive">无法打开，请检查路径或重新选择</span>}</span>
            </Button>
            <IconButton label={`移除最近记录 ${entry.path}`} size="icon-sm" disabled={props.busy} onClick={() => props.onRemove(entry)}><X aria-hidden="true" /></IconButton>
          </li>;
        })}
      </ul>}
    </section>
    <div className="sidebar-footer"><span className="status-dot" />本地工作区</div>
  </nav>;
}
