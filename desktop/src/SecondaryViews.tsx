import { viewTransition } from "./motion";
import { t } from "./i18n";
import { Component, useState } from "react";
import type { ComponentProps, ReactNode } from "react";
import { Button } from "@/controls/button";
import SettingsPage from "./SettingsPage";
import ConversionHistory from "./ConversionHistory";

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
  return visited ? <LoadBoundary fallback={<SettingsFallback onClose={props.onClose} active={active} failed />}><SettingsPage {...props} active={active} /></LoadBoundary> : null;
}
export function HistoryView({ active, onReturn, ...props }: ComponentProps<typeof ConversionHistory> & { active: boolean; onReturn: () => void }) {
  // Code is loaded with the workspace; retain expanded rows and pagination while hidden.
  const [visited, setVisited] = useState(active);
  if (active && !visited) setVisited(true);
  return <div className={`history-view ${viewTransition(active)}`} hidden={!active} inert={!active}>{visited && <LoadBoundary fallback={<><p role="alert">{t("secondaryViews.couldNotLoadHistoryReopenTheAppToTryAgain")}</p><Button variant="outline" onClick={onReturn}>{t("secondaryViews.backToImages")}</Button></>}><ConversionHistory {...props} /></LoadBoundary>}</div>;
}
