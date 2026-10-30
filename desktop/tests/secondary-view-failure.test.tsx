import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SettingsView } from "../src/SecondaryViews";
import { defaultPreferences } from "../src/preferences";
vi.mock("../src/SettingsPage", () => ({ default: () => { throw new Error("render unavailable"); } }));
afterEach(() => vi.restoreAllMocks());
it("keeps a return action and main landmark when the settings rendering fails", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const close = vi.fn(); render(<SettingsView value={defaultPreferences} onSaved={vi.fn()} onClose={close} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("无法加载设置");
  expect(screen.getByRole("main", { name: "设置" })).toHaveAttribute("id", "main-content");
  fireEvent.click(screen.getByRole("button", { name: "返回工作区" })); expect(close).toHaveBeenCalledOnce();
});
