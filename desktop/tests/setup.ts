import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { clearMocks } from "@tauri-apps/api/mocks";
import { afterEach } from "vitest";

// Vitest 3 leaves Node's native storage globals in place on newer Node releases.
const browser = (globalThis as typeof globalThis & { jsdom: { window: Window } }).jsdom.window;
for (const key of ["localStorage", "sessionStorage"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: browser[key] });
}

// Radix floating controls observe their dimensions even in layout-free jsdom.
if (typeof ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

afterEach(() => {
  cleanup();
  clearMocks();
});

// jsdom does not provide pointer coordinates without a PointerEvent constructor.
if (typeof PointerEvent === "undefined") globalThis.PointerEvent = MouseEvent as typeof PointerEvent;
