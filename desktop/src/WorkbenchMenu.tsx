import { Download, FolderOpen, FolderPlus, Images, MoreHorizontal, RefreshCw, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

interface Props { busy: boolean; hasProject: boolean; canUndo: boolean; onOpen: () => void; onDirectory: () => void; onAddDirectory: () => void; onRefresh: () => void; onUndo: () => void; onUpdate: () => void; }
export default function WorkbenchMenu(props: Props) {
  const mod = /Mac/.test(navigator.userAgent) ? "⌘" : "Ctrl+";
  return <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="workbench-menu-trigger" aria-label="更多操作" title="更多操作"><MoreHorizontal aria-hidden="true" /></Button></DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="min-w-60">
      <DropdownMenuGroup>
        <DropdownMenuItem disabled={props.busy} onSelect={props.onOpen}><FolderOpen aria-hidden="true" />打开 LaTeX 项目<DropdownMenuShortcut>{mod}O</DropdownMenuShortcut></DropdownMenuItem>
        <DropdownMenuItem disabled={props.busy} onSelect={props.onDirectory}><Images aria-hidden="true" />批量转换图片<DropdownMenuShortcut>{mod}⇧O</DropdownMenuShortcut></DropdownMenuItem>
        <DropdownMenuItem disabled={props.busy || !props.hasProject} onSelect={props.onAddDirectory}><FolderPlus aria-hidden="true" />添加图片目录</DropdownMenuItem>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuItem disabled={props.busy || !props.hasProject} onSelect={props.onRefresh}><RefreshCw aria-hidden="true" />重新扫描<DropdownMenuShortcut>{mod}R</DropdownMenuShortcut></DropdownMenuItem>
        <DropdownMenuItem disabled={props.busy || !props.canUndo} onSelect={props.onUndo}><Undo2 aria-hidden="true" />撤销最近任务</DropdownMenuItem>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuGroup><DropdownMenuItem onSelect={props.onUpdate}><Download aria-hidden="true" />检查应用更新</DropdownMenuItem></DropdownMenuGroup>
    </DropdownMenuContent>
  </DropdownMenu>;
}
