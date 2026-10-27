import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ConversionProgress, ImageResult, Project, SmartReport } from "../types";
import type { useBackgroundAutomation, Navigation, ObservationIdentity, ObservationUpdate } from "./useBackgroundAutomation";
import type { Setter } from "./workflowPorts";
interface Ports {
  background: ReturnType<typeof useBackgroundAutomation>;
  onAction: (action: string) => void;
  onDrop: (paths: string[]) => void;
  setDragging: Setter<boolean>;
}
export function useDesktopEvents(ports: Ports) {
  const latest = useRef(ports); latest.current = ports;
  useEffect(() => {
    let active = true;
    const stops: (() => void)[] = [];
    function stopSafely(stop: () => void) { try { void Promise.resolve(stop()).catch(() => {}); } catch { /* Native teardown may already have completed. */ } }
    function subscribe<T>(name: string, action: (payload: T) => void) {
      void listen<T>(name, ({ payload }) => { if (active) action(payload); }).then((stop) => {
        if (active) stops.push(stop); else stopSafely(stop);
      }).catch(() => {});
    }
    subscribe<ObservationUpdate>("workspace-observed", (p) => latest.current.background.onObserved(p));
    subscribe<ObservationIdentity>("workspace-observation-unavailable", (p) => latest.current.background.onObservationUnavailable(p));
    subscribe<Project>("workspace-updated", (p) => latest.current.background.onWorkspace(p));
    subscribe<Project>("background-start", (p) => latest.current.background.onStart(p));
    subscribe<SmartReport>("background-finished", (p) => latest.current.background.onFinished(p));
    subscribe("background-idle", () => latest.current.background.onIdle());
    subscribe<ConversionProgress>("conversion-progress", (p) => latest.current.background.onProgress(p));
    subscribe<ImageResult>("conversion-result", (p) => latest.current.background.onResult(p));
    subscribe<string>("desktop-error", (p) => latest.current.background.onNativeError(p));
    subscribe<Navigation>("notification-navigate", (p) => latest.current.background.onNavigate(p));
    subscribe<string>("menu-action", (p) => latest.current.onAction(p));
    subscribe<{ paths: string[] }>("tauri://drag-drop", (p) => { latest.current.setDragging(false); latest.current.onDrop(p.paths); });
    subscribe("tauri://drag-enter", () => latest.current.setDragging(true));
    subscribe("tauri://drag-leave", () => latest.current.setDragging(false));
    void invoke<{ error: string | null }>("desktop_status").then((status) => { if (active && status?.error) latest.current.background.onNativeError(status.error); }).catch(() => {});
    return () => { active = false; stops.forEach(stopSafely); };
  }, []);
}
