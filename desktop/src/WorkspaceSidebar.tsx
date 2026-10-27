import { FileCode2, Plus, Images, History, X, Settings, Circle, CircleCheck, TriangleAlert, CircleSlash } from "lucide-react";
import { Button } from "@/controls/button";
import { Separator } from "@/controls/separator";
import IconButton from "./IconButton";
import { ToggleGroup, ToggleGroupItem } from "@/controls/toggle-group";
import type { WorkspaceStatus } from "./types";
import type { RecentWorkspace } from "./recents";
import { workspaceKey } from "./recents";
import { fileName } from "./utils";
import RecentProjectDetails from "./RecentProjectDetails";

interface Props {
  busy: boolean;
  status?: WorkspaceStatus;
  filter?: string;
  onFilter?: (filter: string) => void;
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
  return <nav className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto px-3 pb-3 pt-4 text-[13px]" aria-label="项目导航">
    <div className="flex h-8 shrink-0 items-center gap-2.5 px-2 text-[15px] font-semibold [&_svg]:size-5" translate="no"><FileCode2 aria-hidden="true" /><span>Texgo</span></div>
    <div className="sidebar-actions"><Button variant="ghost" disabled={props.busy} onClick={props.onOpenTex}><Plus aria-hidden="true" />打开项目</Button></div>
    {props.projectPath && <section className="flex shrink-0 flex-col gap-2 [&>h2]:px-2 [&>h2]:text-[11px] [&>h2]:font-medium [&>h2]:text-muted-foreground [&>p]:flex [&>p]:items-center [&>p]:gap-2 [&>p]:truncate [&>p]:px-2 [&>p_svg]:size-4" aria-label="当前项目"><h2>当前项目</h2><p title={props.projectPath}><FileCode2 aria-hidden="true" />{fileName(props.projectPath)}</p><div className="sidebar-project-pages flex flex-col [&>button]:h-8! [&>button]:min-h-8! [&>button]:justify-start">
      <Button variant="ghost" aria-current={props.view === "assets" ? "page" : undefined} onClick={() => props.onView("assets")}><Images aria-hidden="true" />图片</Button>
      <Button variant="ghost" aria-current={props.view === "history" ? "page" : undefined} onClick={() => props.onView("history")}><History aria-hidden="true" />操作记录</Button>
    </div></section>}
    {props.status && props.onFilter && <section aria-label="图片筛选" className="flex shrink-0 flex-col gap-2">
      <h2 className="px-2 text-[11px] font-medium text-muted-foreground">资料库</h2>
      <ToggleGroup type="single" orientation="vertical" value={props.view === "assets" ? props.filter : ""} onValueChange={(value) => { if (value) { props.onView("assets"); props.onFilter?.(value); } }} aria-label="图片状态摘要" className="flex! w-full! flex-col! items-stretch! gap-0.5! rounded-none! bg-transparent! p-0!">
        {[
          { value: "all", label: "全部", count: props.status.totalImages, icon: Images },
          { value: "pending", label: "待处理", count: props.status.pendingImages, icon: Circle },
          { value: "problems", label: "问题", count: props.status.problemCount, icon: TriangleAlert },
          { value: "completed", label: "已完成", count: props.status.completedImages, icon: CircleCheck },
          { value: "ignored", label: "已忽略", count: props.status.ignoredCount, icon: CircleSlash },
        ].map(({ value, label, count, icon: Icon }) => <ToggleGroupItem key={value} value={value} aria-label={`${label} ${count}`} className="h-8! min-h-8! w-full! justify-start! gap-2! rounded-md! border-0! px-2! text-xs! data-[state=on]:bg-black/8! data-[state=on]:text-foreground! [&_svg]:size-4"><Icon aria-hidden="true" className={value === "problems" && count ? "text-warning" : "text-primary"} /><span>{label}</span><span className="ml-auto text-muted-foreground tabular-nums">{count}</span></ToggleGroupItem>)}
      </ToggleGroup>
    </section>}
    <section className="sidebar-recents mt-0!" aria-label="最近项目">
      <h2>最近项目</h2>
      {props.recents.length === 0 ? <p className="recent-empty">暂无最近项目</p> : <ul className="recent-list">{props.recents.map((entry) => {
        const key = workspaceKey(entry);
        return <li key={key} className="recent-item" data-active={props.activeKey === key}>
          <Button variant="ghost" className="recent-open" disabled={props.busy} aria-label={`打开最近项目 ${entry.path}`} onClick={() => props.onRecent(entry)}><FileCode2 aria-hidden="true" /><RecentProjectDetails entry={entry} failed={props.failedRecent === key} /></Button>
          <IconButton label={`移除最近记录 ${entry.path}`} size="icon-sm" disabled={props.busy} onClick={() => props.onRemove(entry)}><X aria-hidden="true" /></IconButton>
        </li>;
      })}</ul>}
    </section>
    <div className="mt-auto"><Separator /></div><div className="sidebar-settings shrink-0"><Button variant="ghost" aria-current={props.view === "settings" ? "page" : undefined} onClick={props.onSettings}><Settings aria-hidden="true" />设置</Button></div>
  </nav>;
}
