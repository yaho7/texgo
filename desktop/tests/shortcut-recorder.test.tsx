import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import ShortcutRecorder, { shortcutFromKey, shortcutTokens } from "../src/ShortcutRecorder";

const ipc = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: ipc.invoke }));
beforeEach(() => { ipc.invoke.mockReset(); ipc.invoke.mockResolvedValue(undefined); });

it("shows readable key tokens and records a modified key without exposing syntax", async () => {
  const changed = vi.fn();
  render(<ShortcutRecorder value="CommandOrControl+Alt+Enter" onChange={changed} />);
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(screen.queryByText("CommandOrControl+Alt+Enter")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "重新录制" }));
  await screen.findByText("正在等待按键…");
  const capture = screen.getByRole("group", { name: "全局快速转换快捷键" });
  expect(capture).toHaveFocus();
  expect(screen.getByText("正在等待按键…")).toBeInTheDocument();
  fireEvent.keyDown(capture, { key: "k", code: "KeyK", metaKey: true, altKey: true });
  expect(changed).toHaveBeenCalledWith("Super+Alt+K");
  expect(screen.queryByText("正在等待按键…")).not.toBeInTheDocument();
});

it("rejects bare keys and modifiers while Escape cancels only recording", async () => {
  const changed = vi.fn(); const outer = vi.fn();
  render(<div onKeyDown={outer}><ShortcutRecorder value="Control+Alt+Enter" onChange={changed} /></div>);
  await userEvent.click(screen.getByRole("button", { name: "重新录制" }));
  await screen.findByText("正在等待按键…");
  const capture = screen.getByRole("group", { name: "全局快速转换快捷键" });
  fireEvent.keyDown(capture, { key: "Control", ctrlKey: true });
  fireEvent.keyDown(capture, { key: "k", code: "KeyK" });
  expect(screen.getByText(/请同时按住/)).toBeInTheDocument();
  expect(changed).not.toHaveBeenCalled();
  fireEvent.keyDown(capture, { key: "Escape" });
  expect(outer).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "重新录制" })).toBeInTheDocument();
});

it("uses physical key codes for option-modified characters", () => {
  expect(shortcutFromKey({ key: "˚", code: "KeyK", altKey: true, metaKey: true, ctrlKey: false, shiftKey: false })).toBe("Super+Alt+K");
  expect(shortcutFromKey({ key: "K", code: "KeyK", altKey: false, metaKey: false, ctrlKey: false, shiftKey: true })).toBeNull();
  expect(shortcutTokens("Super+Alt+Enter", true)).toEqual(["⌘", "⌥", "Enter"]);
  expect(shortcutTokens("CommandOrControl+Alt+Enter", false)).toEqual(["Ctrl", "Alt", "Enter"]);
});

it("does not start recording when disabled", () => {
  render(<ShortcutRecorder value="Control+Enter" onChange={vi.fn()} disabled />);
  expect(screen.getByRole("button", { name: "重新录制" })).toBeDisabled();
  expect(screen.getByRole("group")).toHaveAttribute("aria-disabled", "true");
});

it("pauses the native shortcut before accepting keys and resumes on completion", async () => {
  let resolve!: () => void;
  ipc.invoke.mockImplementation((_command, args) => args.recording ? new Promise<void>((done) => { resolve = done; }) : Promise.resolve());
  const changed = vi.fn();
  render(<ShortcutRecorder value="Control+Alt+Enter" onChange={changed} />);
  await userEvent.click(screen.getByRole("button", { name: "重新录制" }));
  expect(screen.getByText("正在准备录制…")).toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole("group"), { key: "k", code: "KeyK", ctrlKey: true, altKey: true });
  expect(changed).not.toHaveBeenCalled();
  await act(async () => resolve());
  fireEvent.keyDown(screen.getByRole("group"), { key: "k", code: "KeyK", ctrlKey: true, altKey: true });
  expect(changed).toHaveBeenCalledWith("Control+Alt+K");
  await waitFor(() => expect(ipc.invoke).toHaveBeenLastCalledWith("set_shortcut_recording", { recording: false }));
});

it("does not enter recording when the native guard fails", async () => {
  ipc.invoke.mockImplementation((_command, args) => args.recording ? Promise.reject(new Error("IPC unavailable")) : Promise.resolve());
  render(<ShortcutRecorder value="Control+Alt+Enter" onChange={vi.fn()} />);
  await userEvent.click(screen.getByRole("button", { name: "重新录制" }));
  expect(await screen.findByText(/暂时无法开始录制/)).toBeInTheDocument();
  expect(screen.queryByText("正在等待按键…")).not.toBeInTheDocument();
});

it("resumes even when unmounted during the pending native pause", async () => {
  let resolve!: () => void;
  ipc.invoke.mockImplementation((_command, args) => args.recording ? new Promise<void>((done) => { resolve = done; }) : Promise.resolve());
  const view = render(<ShortcutRecorder value="Control+Alt+Enter" onChange={vi.fn()} />);
  await userEvent.click(screen.getByRole("button", { name: "重新录制" }));
  view.unmount();
  await act(async () => resolve());
  await waitFor(() => expect(ipc.invoke).toHaveBeenLastCalledWith("set_shortcut_recording", { recording: false }));
});
