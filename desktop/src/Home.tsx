import { t } from "./i18n";
import { FolderOpen, LoaderCircle, Settings, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from "@/controls/dialog";
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
      <Dialog>
        <DialogTrigger asChild><Button variant="ghost" size="sm" className="text-xs text-muted-foreground">{t("home.howItWorksAndPermissions")}</Button></DialogTrigger>
        <DialogContent className="gap-0 p-0 sm:max-w-[480px]" aria-describedby="home-how-description">
          <DialogHeader className="px-6 pt-6 pb-5"><DialogTitle>{t("home.howItWorksAndPermissions")}</DialogTitle><DialogDescription id="home-how-description" className="sr-only">{t("home.whyItIsFaster")}</DialogDescription></DialogHeader>
          <div className="space-y-6 px-6 pb-6 text-[13px] leading-relaxed">
            <section><h3 className="mb-2 font-medium">{t("home.whyItIsFaster")}</h3><p className="text-muted-foreground">{t("home.prepareReusablePDFsBeforeCompilationAfterYouApproveTheReferences")}</p></section>
            <section className="border-t border-border/60 pt-5"><h3 className="mb-2 font-medium">{t("home.filesAndSystemPermissions")}</h3><p className="text-muted-foreground">{t("home.readTheSelectedProjectAndWriteProcessedImagesFileMonitoring")}</p><p className="mt-3 text-muted-foreground">{t("home.systemNotificationsReportResultsAGlobalShortcutStartsQuickProcessing")}</p></section>
          </div>
          <DialogFooter className="px-6 py-4"><DialogClose asChild><Button>{t("home.gotIt")}</Button></DialogClose></DialogFooter>
        </DialogContent>
      </Dialog>
      {props.recents.length > 0 && <section className="home-recents" aria-label={t("home.recentProjects")}><h2>{t("home.recentProjects")}</h2><ul className="recent-list">{props.recents.slice(0, 5).map((entry) => <li key={entry.path} className="flex items-center gap-1"><Button variant="ghost" className="recent-open" disabled={props.busy} onClick={() => props.onRecent(entry)}><RecentProjectDetails entry={entry} failed={props.failedRecent === workspaceKey(entry)} /></Button>{props.onRemove && <IconButton label={t("home.removeRecentProjectValue", { arg0: entry.path })} size="icon-sm" disabled={props.busy} onClick={() => props.onRemove?.(entry)}><X aria-hidden="true" /></IconButton>}</li>)}</ul></section>}
    </section>
    {props.onSettings && <Button variant="ghost" className="home-settings" onClick={props.onSettings}><Settings aria-hidden="true" />{t("common.settings")}</Button>}
  </main>;
}
