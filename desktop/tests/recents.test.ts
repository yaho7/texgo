import { beforeEach, describe, expect, it } from "vitest";
import { readRecents, rememberWorkspace, removeRecent, readSettings, storeSettings, workspaceKey } from "../src/recents";

beforeEach(() => localStorage.clear());

describe("recent LaTeX projects", () => {
  it("deduplicates by main file while keeping latest first", () => {
    rememberWorkspace({ path: "/paper/main.tex" });
    rememberWorkspace({ path: "/report/report.tex" });
    rememberWorkspace({ path: "/paper/main.tex" });
    expect(readRecents().map((entry) => entry.path)).toEqual(["/paper/main.tex", "/report/report.tex"]);
    expect(workspaceKey(readRecents()[0])).toBe("tex:/paper/main.tex");
  });
  it("migrates old project records and permanently removes directory records", () => {
    localStorage.setItem("texgo.recents.v1", JSON.stringify([
      { mode: "directory", path: "/images", recursive: true, openedAt: 2 },
      { mode: "tex", path: "/paper/main.tex", recursive: true, openedAt: 1 },
    ]));
    expect(readRecents()).toEqual([{ path: "/paper/main.tex", openedAt: 1 }]);
    expect(JSON.parse(localStorage.getItem("texgo.recents.v1")!)).toEqual([{ path: "/paper/main.tex", openedAt: 1 }]);
  });
  it("bounds history, removes only the requested project, and keeps settings", () => {
    for (let i = 0; i < 20; i++) rememberWorkspace({ path: `/paper/${i}.tex` });
    expect(readRecents()).toHaveLength(12);
    storeSettings("tex:/paper/19.tex", { dpi: "150", jpegQuality: "80", outputDir: "pdf-ready" });
    removeRecent(readRecents()[0]);
    expect(readRecents()).toHaveLength(11);
    expect(readSettings("tex:/paper/19.tex")?.outputDir).toBe("pdf-ready");
  });
  it("tolerates malformed state and rejects non-LaTeX paths", () => {
    localStorage.setItem("texgo.recents.v1", "{bad");
    expect(readRecents()).toEqual([]);
    localStorage.setItem("texgo.recents.v1", JSON.stringify([{ path: "/bad.png", openedAt: 1 }, { mode: "bad", path: "/bad.tex", openedAt: 1 }]));
    expect(readRecents()).toEqual([]);
  });
});
