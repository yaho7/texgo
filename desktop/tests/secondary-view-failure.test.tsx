import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SettingsView, UpdateView } from "../src/SecondaryViews";
import { defaultPreferences } from "../src/preferences";
vi.mock("../src/SettingsPage", () => { throw new Error("chunk unavailable"); });
vi.mock("../src/ApplicationUpdate", () => { throw new Error("chunk unavailable"); });
afterEach(() => vi.restoreAllMocks());
it("keeps a return action and main landmark when the settings chunk fails", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const close = vi.fn(); render(<SettingsView value={defaultPreferences} onSaved={vi.fn()} onClose={close} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("无法加载设置");
  expect(screen.getByRole("main", { name: "设置" })).toHaveAttribute("id", "main-content");
  fireEvent.click(screen.getByRole("button", { name: "返回工作区" })); expect(close).toHaveBeenCalledOnce();
});
it("keeps a closable modal when the update chunk fails outside the inert workbench", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const close = vi.fn(); render(<><div inert>工作区</div><UpdateView onClose={close} /></>);
  expect(await screen.findByRole("alert")).toHaveTextContent("更新页面加载失败");
  expect(screen.getByRole("dialog", { name: "应用更新" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "关闭" })); expect(close).toHaveBeenCalledOnce();
});
