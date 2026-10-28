import { t } from "./i18n";
import { PanelLeft, House, Plus, Images, History, X, Settings, Circle, CircleCheck, TriangleAlert, CircleSlash } from "lucide-react";
import { Button } from "@/controls/button";
import "./workspace-navigation.css";
import IconButton from "./IconButton";
import { ToggleGroup, ToggleGroupItem } from "@/controls/toggle-group";
import type { WorkspaceStatus } from "./types";
import type { RecentWorkspace } from "./recents";
import { workspaceKey } from "./recents";
import RecentProjectDetails from "./RecentProjectDetails";

interface Props {
  busy: boolean;
  compact?: boolean;
  onHome?: () => void;
  onToggleSidebar?: () => void;
  status?: WorkspaceStatus;
  filter?: string;
  onFilter?: (filter: string) => void;
  activeKey: string | null;
  projectPath: string | null;
  view: "home" | "assets" | "history" | "settings";
  recents: RecentWorkspace[];
  failedRecent: string | null;
  onView: (view: "assets" | "history") => void;
  onSettings: () => void;
  onOpenTex: () => void;
  onRecent: (entry: RecentWorkspace) => void;
  onRemove: (entry: RecentWorkspace) => void;
}

export default function WorkspaceSidebar(props: Props) {
  const recentEntries = props.recents.filter((entry) => !props.projectPath || workspaceKey(entry) !== props.activeKey);
  return <nav className="workspace-navigation" data-compact={props.compact || undefined} aria-label={t("workspaceSidebar.projectNavigation")}>
    {props.view !== "home" && <div className="navigation-brand"><span className="navigation-wordmark text-[15px] font-semibold" translate="no">Texgo</span><div className="navigation-window-actions">{!props.compact && <Button variant="ghost" size="icon-sm" className="navigation-home translate-x-0.5 transition-[background-color,transform] hover:bg-black/8 active:scale-90 active:bg-black/15 motion-reduce:transition-none" aria-label={t("workspaceSidebar.texgoHome")} title={t("workspaceSidebar.home")} disabled={props.busy} onClick={props.onHome}><House aria-hidden="true" /></Button>}{props.onToggleSidebar && <Button id="sidebar-toggle" variant="ghost" size="icon-sm" aria-label={t(props.compact ? "app.showSidebar" : "app.hideSidebar")} title={t(props.compact ? "app.showSidebar" : "app.hideSidebar")} aria-expanded={!props.compact} onClick={props.onToggleSidebar}><PanelLeft aria-hidden="true" /></Button>}</div></div>}
    {props.view !== "home" && <div className="sidebar-actions">{props.compact && <Button variant="ghost" size="icon-sm" className="navigation-home translate-x-0.5 transition-[background-color,transform] hover:bg-black/8 active:scale-90 active:bg-black/15 motion-reduce:transition-none" aria-label={t("workspaceSidebar.texgoHome")} title={t("workspaceSidebar.home")} disabled={props.busy} onClick={props.onHome}><House aria-hidden="true" /></Button>}<Button variant="ghost" disabled={props.busy} aria-label={t("workspaceSidebar.openProject")} title={t("workspaceSidebar.openProject")} onClick={props.onOpenTex}><Plus aria-hidden="true" /><span>{t("workspaceSidebar.openProject")}</span></Button>
      {props.projectPath && <Button variant="ghost" aria-current={props.view === "history" ? "page" : undefined} aria-label={t("workspaceSidebar.history")} title={t("workspaceSidebar.history")} onClick={() => props.onView("history")}><History aria-hidden="true" /><span>{t("workspaceSidebar.history")}</span></Button>}
    </div>}
    {props.projectPath && props.view !== "home" && (!props.status || !props.onFilter) && <section className="navigation-section" aria-label={t("workspaceSidebar.currentProject")}>
      <Button variant="ghost" aria-current={props.view === "assets" ? "page" : undefined} onClick={() => props.onView("assets")}><Images aria-hidden="true" />{t("workspaceSidebar.images")}</Button>
    </section>}
    {props.view !== "home" && props.status && props.onFilter && <section aria-label={t("workspaceSidebar.imageFilters")} className="navigation-section">
      <h2 className="navigation-section-title">{t("workspaceSidebar.library")}</h2>
      <ToggleGroup type="single" orientation="vertical" value={props.view === "assets" ? props.filter : ""} onValueChange={(value) => { if (value) { props.onView("assets"); props.onFilter?.(value); } }} aria-label={t("workspaceSidebar.imageStatusFilters")} className="flex! w-full! flex-col! items-stretch! gap-0.5! rounded-none! bg-transparent! p-0!">
        {[
          { value: "all", label: t("workspaceSidebar.allImages"), count: Math.max(0, props.status.totalImages - props.status.ignoredCount), icon: Images },
          { value: "pending", label: t("workspaceSidebar.pending"), count: props.status.pendingImages, icon: Circle },
          { value: "problems", label: t("workspaceSidebar.problems"), count: props.status.problemCount, icon: TriangleAlert },
          { value: "completed", label: t("workspaceSidebar.completed"), count: props.status.completedImages, icon: CircleCheck },
          { value: "ignored", label: t("workspaceSidebar.ignored"), count: props.status.ignoredCount, icon: CircleSlash },
        ].map(({ value, label, count, icon: Icon }) => <ToggleGroupItem key={value} value={value} title={`${label} ${count}`} aria-label={`${label} ${count}`} className={`h-8! min-h-8! w-full! rounded-md! border-0! text-xs! data-[state=on]:bg-black/8! data-[state=on]:text-foreground! [&_svg]:size-4 ${props.compact ? "justify-center! gap-0! px-0!" : "justify-start! gap-2! px-2!"}`}><Icon aria-hidden="true" className={(value === "problems" || value === "pending") && count ? "text-warning" : "text-muted-foreground"} /><span>{label}</span><span className="ml-auto text-muted-foreground tabular-nums">{count}</span></ToggleGroupItem>)}
      </ToggleGroup>
    </section>}
    {!props.compact && props.view !== "home" && recentEntries.length > 0 && <section className="navigation-section navigation-recents" aria-label={t("workspaceSidebar.recentProjects")}>
      <h2 className="navigation-section-title">{t("workspaceSidebar.recentProjects")}</h2>
      <ul className="recent-list">{recentEntries.map((entry) => {
        const key = workspaceKey(entry);
        return <li key={key} className="recent-item" data-active={props.activeKey === key}>
          <Button variant="ghost" className="recent-open" disabled={props.busy} aria-label={t("workspaceSidebar.openRecentProjectValue", { arg0: entry.path })} onClick={() => props.onRecent(entry)}><RecentProjectDetails entry={entry} failed={props.failedRecent === key} /></Button>
          <IconButton label={t("workspaceSidebar.removeRecentProjectValue", { arg0: entry.path })} size="icon-sm" disabled={props.busy} onClick={() => props.onRemove(entry)}><X aria-hidden="true" /></IconButton>
        </li>;
      })}</ul>
    </section>}
    <div className="navigation-settings"><Button variant="ghost" aria-current={props.view === "settings" ? "page" : undefined} aria-label={t("common.settings")} title={t("common.settings")} onClick={props.onSettings}><Settings aria-hidden="true" /><span>{t("common.settings")}</span></Button></div>
  </nav>;
}
