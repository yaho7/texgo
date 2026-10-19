import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi, beforeEach } from "vitest";
import SettingsPage from "../src/SettingsPage";
import { defaultPreferences } from "../src/preferences";
const ipc = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: ipc.invoke }));
beforeEach(() => { ipc.invoke.mockReset(); });
it("saves native preferences only on explicit submission", async () => {
  const saved = vi.fn(); const user = userEvent.setup();
  ipc.invoke.mockImplementation((_command, { preferences }) => Promise.resolve(preferences));
  render(<SettingsPage value={defaultPreferences} onSaved={saved} onClose={vi.fn()} />);
  await user.click(screen.getByLabelText("没有变化时显示通知"));
  expect(ipc.invoke).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "保存设置" }));
  await screen.findByText("设置已保存");
  expect(saved).toHaveBeenCalledWith({ ...defaultPreferences, notifyUnchanged: true });
  expect(ipc.invoke).toHaveBeenCalledWith("save_preferences", { preferences: { ...defaultPreferences, notifyUnchanged: true } });
});
it("keeps previous settings and reports native registration or persistence failure", async () => {
  const saved = vi.fn(); ipc.invoke.mockRejectedValue(new Error("快捷键已被占用"));
  render(<SettingsPage value={defaultPreferences} onSaved={saved} onClose={vi.fn()} />);
  await userEvent.click(screen.getByRole("button", { name: "保存设置" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("快捷键已被占用");
  expect(saved).not.toHaveBeenCalled();
});
