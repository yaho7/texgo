import { FileCode2, Plus, Images, History, X, Settings } from "lucide-react";
import { Button } from "@/controls/button";
import { Separator } from "@/controls/separator";
import IconButton from "./IconButton";
import type { RecentWorkspace } from "./recents";
import { workspaceKey } from "./recents";
import { fileName } from "./utils";
import RecentProjectDetails from "./RecentProjectDetails";

interface Props {
  busy: boolean;
  activeKey: string | null;
  projectPath: string | null;
  view: "assets" | "history" | "settings";
  recents: RecentWorkspace[];
  failedRecent: string | null;
  onView: (view: "assets" | "history") => void;
  onSettings: () => void;
  onOpenTex: () => void;
  onRecent: (entry: RecentWorkspace) => void;
  onRemove: (entry: RecentWorkspace) => void;
}

export default function WorkspaceSidebar(props: Props) {
  return <nav className="sidebar-content" aria-label="项目导航">
    <div className="sidebar-brand" translate="no"><FileCode2 aria-hidden="true" /><span>Texgo</span></div>
    <div className="sidebar-actions"><Button variant="ghost" disabled={props.busy} onClick={props.onOpenTex}><Plus aria-hidden="true" />打开项目</Button></div>
    {props.projectPath && <section className="sidebar-project" aria-label="当前项目"><h2>当前项目</h2><p title={props.projectPath}><FileCode2 aria-hidden="true" />{fileName(props.projectPath)}</p><div className="sidebar-actions sidebar-project-pages">
      <Button variant="ghost" aria-current={props.view === "assets" ? "page" : undefined} onClick={() => props.onView("assets")}><Images aria-hidden="true" />图片</Button>
      <Button variant="ghost" aria-current={props.view === "history" ? "page" : undefined} onClick={() => props.onView("history")}><History aria-hidden="true" />操作记录</Button>
    </div></section>}
    <section className="sidebar-recents" aria-label="最近项目">
      <h2>最近项目</h2>
      {props.recents.length === 0 ? <p className="recent-empty">暂无最近项目</p> : <ul className="recent-list">{props.recents.map((entry) => {
        const key = workspaceKey(entry);
        return <li key={key} className="recent-item" data-active={props.activeKey === key}>
          <Button variant="ghost" className="recent-open" disabled={props.busy} aria-label={`打开最近项目 ${entry.path}`} onClick={() => props.onRecent(entry)}><FileCode2 aria-hidden="true" /><RecentProjectDetails entry={entry} failed={props.failedRecent === key} /></Button>
          <IconButton label={`移除最近记录 ${entry.path}`} size="icon-sm" disabled={props.busy} onClick={() => props.onRemove(entry)}><X aria-hidden="true" /></IconButton>
        </li>;
      })}</ul>}
    </section>
    <Separator /><div className="sidebar-settings"><Button variant="ghost" aria-current={props.view === "settings" ? "page" : undefined} onClick={props.onSettings}><Settings aria-hidden="true" />设置</Button></div>
  </nav>;
}
