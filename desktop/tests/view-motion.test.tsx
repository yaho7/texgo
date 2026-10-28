import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { HistoryView } from "../src/SecondaryViews";
import { motionDuration, viewTransition } from "../src/motion";
import { readFileSync } from "node:fs";
const css = readFileSync("src/view-motion.css", "utf8");
vi.mock("../src/ConversionHistory", () => ({ default: () => <button>History item</button> }));
it("retains hidden history without intercepting focus and uses shared navigation classes", async () => {
  const props = { entries: [], busy: false, onUndo: vi.fn(), onReturn: vi.fn() };
  const view = render(<><button>Navigation</button><HistoryView {...props} active /></>);
  await screen.findByRole("button", { name: "History item" });
  const navigation = screen.getByRole("button", {name:"Navigation"}); navigation.focus();
  view.rerender(<><button>Navigation</button><HistoryView {...props} active={false} /></>);
  expect(view.container.querySelector(".history-view")).toHaveAttribute("hidden");
  expect(view.container.querySelector(".history-view")).toHaveAttribute("inert");
  expect(screen.queryByRole("button", {name:"History item"})).toBeNull();
  expect(navigation).toHaveFocus();
  expect(viewTransition(true)).toBe("view-enter"); expect(viewTransition(false)).toBe("view-exit");
});
it("reduces navigation to brief opacity without spatial motion", () => {
  const media = vi.spyOn(window, "matchMedia").mockReturnValue({matches:true} as MediaQueryList);
  expect(motionDuration()).toBe(20);
  expect(css).toContain("prefers-reduced-motion: reduce");
  expect(css).toContain("view-opacity 1ms linear both; transform: none");
  media.mockRestore();
});
