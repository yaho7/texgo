import { render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import userEvent from "@testing-library/user-event";
import { mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, expect, it, vi } from "vitest";
import ApplicationUpdate from "../src/ApplicationUpdate";

afterEach(() => vi.unstubAllGlobals());

it("does not report a disposed StrictMode request as a timeout", async () => {
  vi.stubGlobal("fetch", vi.fn((_url, { signal }: { signal: AbortSignal }) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    queueMicrotask(() => resolve({ ok: true, json: async () => ({ tag_name: "v1", name: "Texgo 1", html_url: "https://github.com/yaho7/texgo/releases/tag/v1" }) }));
  })));
  render(<StrictMode><ApplicationUpdate onClose={() => {}} /></StrictMode>);
  await screen.findByText("最新发行版：Texgo 1");
  expect(screen.queryByText(/检查超时/)).not.toBeInTheDocument();
});

it("checks GitHub releases and opens the verified release URL", async () => {
  const url = "https://github.com/yaho7/texgo/releases/tag/desktop-v0.3.0";
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ tag_name: "desktop-v0.3.0", name: "Texgo 0.3.0", html_url: url }) });
  vi.stubGlobal("fetch", fetcher);
  const open = vi.fn();
  mockIPC((command, payload) => { if (command === "open_release_page") open(payload); });
  render(<ApplicationUpdate onClose={() => {}} />);
  await screen.findByText("最新发行版：Texgo 0.3.0");
  expect(fetcher.mock.calls[0][0]).toBe("https://api.github.com/repos/yaho7/texgo/releases/latest");
  await userEvent.click(screen.getByRole("button", { name: "查看发行版" }));
  expect(open).toHaveBeenCalledWith({ url });
});

it("does not expose a download action for an unexpected GitHub URL", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ tag_name: "x", html_url: "https://example.com/download" }) }));
  render(<ApplicationUpdate onClose={() => {}} />);
  await screen.findByText("GitHub 返回了无效的发行版信息");
  expect(screen.queryByRole("button", { name: "查看发行版" })).not.toBeInTheDocument();
});

it("explains GitHub rate limits without reporting the app as current", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403 }));
  render(<ApplicationUpdate onClose={() => {}} />);
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("GitHub 请求次数受限"));
  expect(screen.queryByText("已是最新发行版")).not.toBeInTheDocument();
});
