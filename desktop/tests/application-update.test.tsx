import { act, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import userEvent from "@testing-library/user-event";
import { mockIPC } from "@tauri-apps/api/mocks";
import { expect, it, vi } from "vitest";
import ApplicationUpdate from "../src/ApplicationUpdate";
const available = { currentVersion: "0.3.0", version: "0.4.0", token: 7, stage: "available" };
it("checks once through StrictMode without downloading or installing", async () => {
  const ipc = vi.fn((_command: string) => available); mockIPC(ipc);
  render(<StrictMode><ApplicationUpdate onClose={vi.fn()} /></StrictMode>);
  await screen.findByText("新版本：0.4.0");
  expect(ipc).toHaveBeenCalledTimes(1);
  expect(ipc.mock.calls[0][0]).toBe("check_application_update");
});
it("requires separate download, install and restart actions with the native token", async () => {
  const user = userEvent.setup(); const calls: { command: string; args: unknown }[] = [];
  mockIPC((command, args) => { calls.push({ command, args }); return command === "download_application_update" ? { ...available, stage: "ready" } : command === "install_application_update" ? { ...available, stage: "installed" } : available; });
  render(<ApplicationUpdate onClose={vi.fn()} />);
  await user.click(await screen.findByRole("button", { name: "下载更新" }));
  await screen.findByText("0.4.0 签名验证通过，可以安装");
  expect(calls.map(c => c.command)).toEqual(["check_application_update", "download_application_update"]);
  expect(calls[1].args).toEqual({ token: 7 });
  await user.click(screen.getByRole("button", { name: "安装更新" }));
  await screen.findByText("更新已安装，重启后生效");
  expect(calls.at(-1)).toEqual({ command: "install_application_update", args: { token: 7 } });
  await user.click(screen.getByRole("button", { name: "重启应用" }));
  expect(calls.at(-1)).toEqual({ command: "restart_after_update", args: { token: 7 } });
});
it("keeps installation unavailable after signature failure and permits retry", async () => {
  const user = userEvent.setup(); let fail = true;
  mockIPC(command => { if (command === "download_application_update") { if (fail) throw new Error("签名验证失败，未安装更新"); return { ...available, stage: "ready" }; } return available; });
  render(<ApplicationUpdate onClose={vi.fn()} />);
  await user.click(await screen.findByRole("button", { name: "下载更新" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("签名验证失败");
  expect(screen.queryByRole("button", { name: "安装更新" })).not.toBeInTheDocument();
  fail = false; await user.click(screen.getByRole("button", { name: "下载更新" }));
  expect(await screen.findByRole("button", { name: "安装更新" })).toBeEnabled();
});
it("blocks dismissal and double download while verification is running", async () => {
  const user = userEvent.setup(); const close = vi.fn(); let resolve!: (value: unknown) => void;
  mockIPC(command => command === "check_application_update" ? available : new Promise(yes => { resolve = yes; }));
  render(<ApplicationUpdate onClose={close} />);
  await user.click(await screen.findByRole("button", { name: "下载更新" }));
  expect(screen.getByRole("button", { name: "关闭" })).toBeDisabled();
  await user.keyboard("{Escape}"); expect(close).not.toHaveBeenCalled();
  await act(async () => resolve({ ...available, stage: "ready" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "关闭" })).toBeEnabled());
});
it("reports check failures without claiming the app is up to date", async () => {
  mockIPC(() => { throw new Error("更新服务器不可用"); });
  render(<ApplicationUpdate onClose={vi.fn()} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("更新服务器不可用");
  expect(screen.queryByText("已是最新版本")).not.toBeInTheDocument();
});
