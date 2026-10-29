import { mockIPC } from "@tauri-apps/api/mocks";
import { expect, it, vi } from "vitest";
import { checkApplicationUpdate, openReleasePage } from "../src/applicationUpdates";

it("opens the fixed GitHub page without downloading or installing", async () => {
  const ipc = vi.fn(); mockIPC(ipc);
  await openReleasePage();
  expect(ipc).toHaveBeenCalledExactlyOnceWith("open_release_page", { url: "https://github.com/yaho7/texgo/releases/latest" });
});
it("only reports newer stable releases during background metadata checks", async () => {
  const fetcher = vi.spyOn(globalThis, "fetch");
  for (const [tag_name, prerelease, expected] of [["v0.3.3",false,"available"],["v0.3.2",false,"current"],["v0.3.1",false,"current"],["v0.4.0-beta.1",true,"current"],["invalid",false,"current"]] as const) {
    fetcher.mockResolvedValue({ok:true,json:async()=>({tag_name,prerelease})} as Response);
    expect((await checkApplicationUpdate("0.3.2")).stage).toBe(expected);
  }
  expect(fetcher).toHaveBeenCalledWith("https://api.github.com/repos/yaho7/texgo/releases/latest", expect.objectContaining({signal:expect.any(AbortSignal)}));
});
it("does not report network errors as a current version", async () => {
  vi.spyOn(globalThis,"fetch").mockResolvedValue({ok:false,status:503} as Response);
  await expect(checkApplicationUpdate("0.3.2")).rejects.toThrow("503");
});
