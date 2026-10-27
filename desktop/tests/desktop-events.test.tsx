import { act, renderHook } from "@testing-library/react";
import type { EventCallback } from "@tauri-apps/api/event";
import { expect, it, vi } from "vitest";
import { useDesktopEvents } from "../src/hooks/useDesktopEvents";
const native = vi.hoisted(() => ({ listeners: new Map<string, EventCallback<unknown>>(), resolves: [] as ((stop: () => void) => void)[] }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn((name: string, callback: EventCallback<unknown>) => {
  native.listeners.set(name, callback);
  return new Promise<() => void>((resolve) => native.resolves.push(resolve));
}) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => ({ error: null })) }));
it("ignores disposed callbacks and cleans up subscriptions that resolve after unmount", async () => {
  native.listeners.clear(); native.resolves = [];
  const onAction = vi.fn(); const onError = vi.fn(); const stop = vi.fn();
  const background = { onObserved: vi.fn(), onObservationUnavailable: vi.fn(), onWorkspace: vi.fn(), onStart: vi.fn(), onFinished: vi.fn(), onIdle: vi.fn(), onProgress: vi.fn(), onResult: vi.fn(), onNavigate: vi.fn(), onNativeError: onError };
  const { unmount } = renderHook(() => useDesktopEvents({ background, onAction, onDrop: vi.fn(), setDragging: vi.fn() }));
  unmount();
  await act(async () => {
    native.listeners.get("menu-action")?.({ event: "menu-action", id: 1, payload: "settings" });
    native.listeners.get("desktop-error")?.({ event: "desktop-error", id: 2, payload: "late failure" });
    native.resolves.forEach((resolve) => resolve(stop));
  });
  expect(onAction).not.toHaveBeenCalled(); expect(onError).not.toHaveBeenCalled();
  expect(stop).toHaveBeenCalledTimes(native.resolves.length);
});
