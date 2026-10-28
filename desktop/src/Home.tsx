import { t } from "./i18n";
import { FolderOpen, LoaderCircle, Settings, X } from "lucide-react";
import { Button } from "@/controls/button";
import IconButton from "./IconButton";
import type { RecentWorkspace } from "./recents";
import { workspaceKey } from "./recents";
import RecentProjectDetails from "./RecentProjectDetails";

interface Props {
  busy: boolean;
  onSettings?: () => void;
  onOpenTex: () => void;
  recents: RecentWorkspace[];
  onRecent: (entry: RecentWorkspace) => void;
  onRemove?: (entry: RecentWorkspace) => void;
  failedRecent?: string | null;
}
export default function Home(props: Props) {
  return <main id="main-content" tabIndex={-1} className="home-workspace view-enter py-8!">
    <section className="home-opening gap-4!" aria-labelledby="home-title">
      <div className="flex flex-col items-center gap-2"><p className="text-[18px] font-semibold leading-6 text-foreground/65" translate="no">Texgo</p><h1 id="home-title">{t("home.speedUpLaTeXCompilation")}</h1></div>
      <Button aria-busy={props.busy} disabled={props.busy} onClick={props.onOpenTex}>{props.busy ? <LoaderCircle className="animate-spin" data-icon="inline-start" aria-hidden="true" /> : <FolderOpen data-icon="inline-start" aria-hidden="true" />}{props.busy ? t("home.scanning") : t("home.openOrDropATexFile")}</Button>
      <details className="w-full max-w-[440px] text-left text-xs leading-relaxed">
        <summary className="mx-auto w-fit cursor-pointer rounded-xs px-2 py-1 text-muted-foreground focus-visible:outline-2 focus-visible:outline-primary">{t("home.howItWorksAndPermissions")}</summary>
        <div className="mt-3 space-y-3 p-4">
          <section><h2 className="mb-1 font-medium">{t("home.whyItIsFaster")}</h2><p className="text-muted-foreground">{t("home.prepareReusablePDFsBeforeCompilationAfterYouApproveTheReferences")}</p></section>
          <section><h2 className="mb-1 font-medium">{t("home.filesAndSystemPermissions")}</h2><p className="text-muted-foreground">{t("home.readTheSelectedProjectAndWriteProcessedImagesFileMonitoring")}</p><p className="mt-2 text-muted-foreground">{t("home.systemNotificationsReportResultsAGlobalShortcutStartsQuickProcessing")}</p></section>
        </div>
      </details>
      {props.recents.length > 0 && <section className="home-recents" aria-label={t("home.recentProjects")}><h2>{t("home.recentProjects")}</h2><ul className="recent-list">{props.recents.slice(0, 5).map((entry) => <li key={entry.path} className="flex items-center gap-1"><Button variant="ghost" className="recent-open" disabled={props.busy} onClick={() => props.onRecent(entry)}><RecentProjectDetails entry={entry} failed={props.failedRecent === workspaceKey(entry)} /></Button>{props.onRemove && <IconButton label={t("home.removeRecentProjectValue", { arg0: entry.path })} size="icon-sm" disabled={props.busy} onClick={() => props.onRemove?.(entry)}><X aria-hidden="true" /></IconButton>}</li>)}</ul></section>}
    </section>
    {props.onSettings && <Button variant="ghost" className="home-settings" onClick={props.onSettings}><Settings aria-hidden="true" />{t("common.settings")}</Button>}
  </main>;
}
