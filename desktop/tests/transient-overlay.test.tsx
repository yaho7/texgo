import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useTransientOverlay } from "../src/hooks/useTransientOverlay";

describe("transient focus ownership", () => {
  it.each(["popover", "context-menu", "recorder"] as const)("tracks %s closing without another application render", async (kind) => {
    const { result, unmount } = renderHook(useTransientOverlay);
    expect(result.current).toBe(false);
    const portal = document.createElement("div");
    if (kind !== "recorder") { portal.dataset.slot = `${kind}-content`; portal.dataset.state = "open"; }
    else portal.dataset.recording = "true";
    try {
      await act(async () => { document.body.append(portal); });
      expect(result.current).toBe(true);
      await act(async () => { if (kind !== "recorder") portal.dataset.state = "closed"; else portal.dataset.recording = "false"; });
      expect(result.current).toBe(false);
    } finally { unmount(); portal.remove(); }
  });
});
