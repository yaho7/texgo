import { viewTransition } from "./motion";
import { t } from "./i18n";
import { Component, lazy, Suspense, useState } from "react";
import type { ComponentProps, ReactNode } from "react";
import { Button } from "@/controls/button";
import type SettingsPage from "./SettingsPage";
import type ConversionHistory from "./ConversionHistory";

const Settings = lazy(() => import("./SettingsPage"));
const History = lazy(() => import("./ConversionHistory"));
class LoadBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}
function SettingsFallback({ onClose, failed = false, active = true }: { onClose: () => void; failed?: boolean; active?: boolean }) {
  return <main id={active ? "main-content" : undefined} tabIndex={-1} className="settings-page" aria-label={t("common.settings")} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
    <h1>{t("common.settings")}</h1><p role={failed ? "alert" : "status"}>{failed ? t("secondaryViews.couldNotLoadSettingsReturnToTheWorkspaceAndReopen") : t("secondaryViews.loadingSettings")}</p><Button variant="outline" onClick={onClose}>{t("secondaryViews.backToWorkspace")}</Button>
  </main>;
}
export function SettingsView({ active = true, ...props }: ComponentProps<typeof SettingsPage>) {
  const [visited, setVisited] = useState(active);
  if (active && !visited) setVisited(true);
  return visited ? <LoadBoundary fallback={<SettingsFallback onClose={props.onClose} active={active} failed />}><Suspense fallback={<SettingsFallback onClose={props.onClose} active={active} />}><Settings {...props} active={active} /></Suspense></LoadBoundary> : null;
}
export function HistoryView({ active, onReturn, ...props }: ComponentProps<typeof ConversionHistory> & { active: boolean; onReturn: () => void }) {
  // Load on first activation, then retain expanded rows and pagination while hidden.
  const [visited, setVisited] = useState(active);
  if (active && !visited) setVisited(true);
  return <div className={`history-view ${viewTransition(active)}`} hidden={!active} inert={!active}>{visited && <LoadBoundary fallback={<><p role="alert">{t("secondaryViews.couldNotLoadHistoryReopenTheAppToTryAgain")}</p><Button variant="outline" onClick={onReturn}>{t("secondaryViews.backToImages")}</Button></>}><Suspense fallback={<p role="status">{t("secondaryViews.loadingHistory")}</p>}><History {...props} /></Suspense></LoadBoundary>}</div>;
}
