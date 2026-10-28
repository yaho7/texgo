import { t } from "./i18n";
import { Download, FolderOpen, X, MoreHorizontal, RefreshCw, Undo2 } from "lucide-react";
import { Button } from "@/controls/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger } from "@/controls/dropdown-menu";

interface Props { busy: boolean; hasProject: boolean; canUndo: boolean; onOpen: () => void; onClose: () => void; onRefresh: () => void; onUndo: () => void; onUpdate: () => void; }
export default function WorkbenchMenu(props: Props) {
  const mod = /Mac/.test(navigator.userAgent) ? "⌘" : "Ctrl+";
  return <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="workbench-menu-trigger" aria-label={t("workbenchMenu.moreActions")} title={t("workbenchMenu.moreActions")}><MoreHorizontal aria-hidden="true" /></Button></DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="min-w-60">
      <DropdownMenuGroup>
        <DropdownMenuItem disabled={props.busy} onSelect={props.onOpen}><FolderOpen aria-hidden="true" />{t("workbenchMenu.openLaTeXProject")}<DropdownMenuShortcut>{mod}O</DropdownMenuShortcut></DropdownMenuItem>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuItem disabled={props.busy || !props.hasProject} onSelect={props.onRefresh}><RefreshCw aria-hidden="true" />{t("workbenchMenu.rescan")}<DropdownMenuShortcut>{mod}R</DropdownMenuShortcut></DropdownMenuItem>
        <DropdownMenuItem disabled={props.busy || !props.canUndo} onSelect={props.onUndo}><Undo2 aria-hidden="true" />{t("workbenchMenu.undoLastOperation")}</DropdownMenuItem>
        <DropdownMenuItem disabled={props.busy || !props.hasProject} onSelect={props.onClose}><X aria-hidden="true" />{t("workbenchMenu.closeCurrentProject")}</DropdownMenuItem>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuGroup><DropdownMenuItem disabled={props.busy} onSelect={props.onUpdate}><Download aria-hidden="true" />{t("workbenchMenu.checkForUpdates")}</DropdownMenuItem></DropdownMenuGroup>
    </DropdownMenuContent>
  </DropdownMenu>;
}
