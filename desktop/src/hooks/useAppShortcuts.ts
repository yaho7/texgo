import { hasTransientOverlay } from "./useTransientOverlay";
import { useEffect } from "react";
import type { RefObject } from "react";
import type { ImageAsset } from "../types";
import type { useAssetSelection } from "./useAssetSelection";
import type { Setter } from "./workflowPorts";
interface Ports {
  settingsPage: boolean; setSettingsPage: Setter<boolean>; blocked: boolean; busy: boolean;
  view: "assets" | "history"; setView: Setter<"assets" | "history">;
  activeAsset: ImageAsset | null; activeId: string | null; visibleImages: ImageAsset[];
  selection: ReturnType<typeof useAssetSelection>; desktopAction: RefObject<(action: string) => void>;
}
export function useAppShortcuts(ports: Ports) {
  const { settingsPage, setSettingsPage, blocked, busy, view, setView, activeAsset, activeId, visibleImages, selection, desktopAction } = ports;
  const { selectionMode, activate: setActiveId } = selection;
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      const element = event.target instanceof HTMLElement ? event.target : null;
      const editing = Boolean(element?.closest("input,textarea,select,[contenteditable]:not([contenteditable=false])"));
      if (event.isComposing || event.repeat || event.altKey) return;
      const mod = event.metaKey || event.ctrlKey;
      // Checkbox primitives consume Enter; reserved app accelerators still take priority.
      if (event.defaultPrevented && !(mod && [",", "f", "Enter"].includes(event.key))) return;
      if (blocked || hasTransientOverlay()) return;
      if ((event.metaKey || event.ctrlKey) && event.key === ",") { event.preventDefault(); setSettingsPage(true); return; }
      if (settingsPage) {
        if (event.key === "Escape") { event.preventDefault(); setSettingsPage(false); requestAnimationFrame(() => document.getElementById("main-content")?.focus()); }
        return;
      }

      if (mod && event.key.toLowerCase() === "o") { event.preventDefault(); desktopAction.current("open-project"); }
      else if (mod && event.key.toLowerCase() === "r") { event.preventDefault(); desktopAction.current("refresh"); }
      else if (mod && event.key === "Enter") { event.preventDefault(); desktopAction.current(event.shiftKey ? "review" : "convert"); }
      else if (mod && event.key.toLowerCase() === "f") { event.preventDefault(); setView("assets"); requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[name="imageSearch"]')?.focus()); }
      else if (!editing && !mod && event.key === "/") { event.preventDefault(); setView("assets"); requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[name="imageSearch"]')?.focus()); }
      else if (view === "assets" && !editing && !mod && event.key === "F2" && !busy && activeAsset?.canRename) { event.preventDefault(); selection.requestRename(activeAsset.id); }
      else if (view === "assets" && !editing && !mod && ["ArrowUp", "ArrowDown"].includes(event.key) && visibleImages.length) {
        event.preventDefault(); const index = visibleImages.findIndex((image) => image.id === activeId);
        const next = Math.max(0, Math.min(visibleImages.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
        setActiveId(visibleImages[next].id);
        requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.asset-preview-trigger[aria-pressed="true"]')?.scrollIntoView?.({ block: "nearest" }));
      } else if (event.key === "Escape" && !busy && selectionMode) { selection.clearSelection(); }
    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  });
}
