import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi, beforeEach } from "vitest";
import SettingsPage from "../src/SettingsPage";
import { defaultPreferences } from "../src/preferences";
const ipc = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: ipc.invoke }));
beforeEach(() => { ipc.invoke.mockReset(); });
it("saves native preferences only on explicit submission", async () => {
  const saved = vi.fn(); const user = userEvent.setup();
  ipc.invoke.mockImplementation((_command, args) => Promise.resolve(args?.preferences));
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
  expect(await screen.findByRole("alert")).toHaveTextContent("该快捷键已被其他应用占用");
  expect(saved).not.toHaveBeenCalled();
});

it("organizes settings around projects without removed directory and completion options", () => {
  render(<SettingsPage value={defaultPreferences} onSaved={vi.fn()} onClose={vi.fn()} />);
  for (const section of ["常规", "转换", "自动化", "通知", "快捷键", "高级"]) expect(screen.getByText(section, { selector: "legend" })).toBeInTheDocument();
  expect(screen.queryByText("图片目录默认递归扫描")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("转换完成后的默认行为")).not.toBeInTheDocument();
  expect(screen.queryByText("外观")).not.toBeInTheDocument();
  expect(screen.getByLabelText("引用尚未审核时允许继续更新图片").closest("fieldset")).toHaveTextContent("高级");
});

it("derives custom settings without offering a custom preset", async () => {
  const user = userEvent.setup();
  render(<SettingsPage value={{ ...defaultPreferences, dpi: 200 }} onSaved={vi.fn()} onClose={vi.fn()} />);
  expect(screen.getByText("自定义 · 200 DPI · 90%")).toBeInTheDocument();
  expect(screen.queryByRole("radio", { name: "自定义" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("radio", { name: "小体积" }));
  expect(screen.getByLabelText("默认 DPI")).toHaveValue(150);
  expect(screen.getByLabelText("默认质量 (%)")).toHaveValue(75);
});

it("disables repeat saves and keeps edited values after a failed save", async () => {
  const user = userEvent.setup(); let reject!: (reason: Error) => void;
  ipc.invoke.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
  render(<SettingsPage value={defaultPreferences} onSaved={vi.fn()} onClose={vi.fn()} />);
  await user.clear(screen.getByLabelText("默认输出目录")); await user.type(screen.getByLabelText("默认输出目录"), "figures-pdf");
  await user.click(screen.getByRole("button", { name: "保存设置" }));
  expect(screen.getByRole("button", { name: "正在保存…" })).toBeDisabled();
  await act(async () => reject(new Error("保存失败")));
  expect(screen.getByLabelText("默认输出目录")).toHaveValue("figures-pdf");
  expect(await screen.findByRole("alert")).toHaveTextContent("保存失败");
  expect(ipc.invoke).toHaveBeenCalledTimes(1);
});


it("keeps debug logging a draft until a successful save and leaves failures inline", async () => {
  const user = userEvent.setup(); const saved = vi.fn();
  ipc.invoke.mockRejectedValueOnce(new Error("磁盘不可写"));
  render(<SettingsPage value={defaultPreferences} onSaved={saved} onClose={vi.fn()} />);
  await user.click(screen.getByLabelText("启用调试日志"));
  expect(ipc.invoke).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "保存设置" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("磁盘不可写");
  expect(saved).not.toHaveBeenCalled();
  expect(screen.getByLabelText("启用调试日志")).toBeChecked();
  ipc.invoke.mockImplementation((_command, args) => Promise.resolve(args?.preferences));
  await user.click(screen.getByRole("button", { name: "保存设置" }));
  await screen.findByText("设置已保存");
  expect(saved).toHaveBeenCalledWith({ ...defaultPreferences, debugLogging: true });
});

it("opens only the native log directory and guards repeat clicks with inline failure", async () => {
  const user = userEvent.setup(); let reject!: (reason: Error) => void;
  ipc.invoke.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
  render(<SettingsPage value={defaultPreferences} onSaved={vi.fn()} onClose={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: "打开日志目录" }));
  expect(screen.getByRole("button", { name: "正在打开…" })).toBeDisabled();
  expect(ipc.invoke).toHaveBeenCalledExactlyOnceWith("open_log_directory");
  await act(async () => reject(new Error("文件管理器不可用")));
  expect(await screen.findByRole("alert")).toHaveTextContent("文件管理器不可用");
  expect(screen.getByRole("button", { name: "打开日志目录" })).toBeEnabled();
});

it("places closing behavior in General and explains manual reference review", () => {
  render(<SettingsPage value={defaultPreferences} onSaved={vi.fn()} onClose={vi.fn()} />);
  expect(screen.getByLabelText("关闭窗口时").closest("fieldset")).toHaveTextContent("常规");
  expect(screen.getByText(/Space 切换原图/)).toHaveTextContent("PDF / 对比");
  expect(screen.getByText(/托盘或全局快捷键/)).toHaveTextContent(".tex 引用始终等待你在窗口中审核并确认");
  expect(screen.getByText(/仅允许在引用待审核时/)).toHaveTextContent("不会自动修改 .tex 引用");
});
