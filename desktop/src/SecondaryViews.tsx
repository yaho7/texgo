import { Component, lazy, Suspense, useState } from "react";
import type { ComponentProps, ReactNode } from "react";
import { Button } from "@/controls/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/controls/dialog";
import type SettingsPage from "./SettingsPage";
import type ConversionHistory from "./ConversionHistory";
import type ApplicationUpdate from "./ApplicationUpdate";

const Settings = lazy(() => import("./SettingsPage"));
const History = lazy(() => import("./ConversionHistory"));
const Update = lazy(() => import("./ApplicationUpdate"));
class LoadBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}
function SettingsFallback({ onClose, failed = false }: { onClose: () => void; failed?: boolean }) {
  return <main id="main-content" tabIndex={-1} className="settings-page" aria-label="设置" onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
    <h1>设置</h1><p role={failed ? "alert" : "status"}>{failed ? "无法加载设置。返回工作区后可重新打开应用再试。" : "正在加载设置…"}</p><Button variant="outline" onClick={onClose}>返回工作区</Button>
  </main>;
}
export function SettingsView(props: ComponentProps<typeof SettingsPage>) {
  return <LoadBoundary fallback={<SettingsFallback onClose={props.onClose} failed />}><Suspense fallback={<SettingsFallback onClose={props.onClose} />}><Settings {...props} /></Suspense></LoadBoundary>;
}
export function HistoryView({ active, onReturn, ...props }: ComponentProps<typeof ConversionHistory> & { active: boolean; onReturn: () => void }) {
  // Load on first activation, then retain expanded rows and pagination while hidden.
  const [visited, setVisited] = useState(active);
  if (active && !visited) setVisited(true);
  return <div className="history-view page-enter" hidden={!active}>{visited && <LoadBoundary fallback={<><p role="alert">无法加载历史记录。重新打开应用后再试。</p><Button variant="outline" onClick={onReturn}>返回图片</Button></>}><Suspense fallback={<p role="status">正在加载历史记录…</p>}><History {...props} /></Suspense></LoadBoundary>}</div>;
}
function UpdateFallback({ onClose, failed = false }: { onClose: () => void; failed?: boolean }) {
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent showCloseButton={false}><DialogHeader><DialogTitle>应用更新</DialogTitle><DialogDescription>{failed ? "无法加载应用更新。关闭后可重新打开应用再试。" : "正在加载应用更新…"}</DialogDescription></DialogHeader><p role={failed ? "alert" : "status"}>{failed ? "更新页面加载失败" : "正在加载…"}</p><DialogFooter><Button variant="outline" onClick={onClose}>关闭</Button></DialogFooter></DialogContent></Dialog>;
}
export function UpdateView(props: ComponentProps<typeof ApplicationUpdate>) {
  return <LoadBoundary fallback={<UpdateFallback onClose={props.onClose} failed />}><Suspense fallback={<UpdateFallback onClose={props.onClose} />}><Update {...props} /></Suspense></LoadBoundary>;
}
