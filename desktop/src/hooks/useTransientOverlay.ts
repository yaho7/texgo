import { useEffect, useState } from "react";

const overlaySelector = '[data-slot="context-menu-content"]:not([data-state="closed"]), [data-slot="dialog-content"]:not([data-state="closed"]), [data-slot="dropdown-menu-content"]:not([data-state="closed"]), [data-slot="popover-content"]:not([data-state="closed"]), [data-recording="true"]';
export function hasTransientOverlay() { return document.querySelector(overlaySelector) !== null; }

// Portals and shortcut recorders own their own state. Observe their actual lifetime
// so queued review resumes when they close, without waiting for another App render.
export function useTransientOverlay() {
  const [open, setOpen] = useState(hasTransientOverlay);
  useEffect(() => {
    const update = () => setOpen(hasTransientOverlay());
    const observer = new MutationObserver(update);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-state", "data-recording"] });
    update();
    return () => observer.disconnect();
  }, []);
  return open;
}
