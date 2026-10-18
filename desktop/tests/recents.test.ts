import { beforeEach, describe, expect, it } from "vitest";
import { readRecents, rememberWorkspace, removeRecent, readSettings, storeSettings } from "../src/recents";

beforeEach(() => localStorage.clear());

describe("recent workspaces", () => {
  it("deduplicates by mode and path while keeping latest first", () => {
    rememberWorkspace({ mode: "tex", path: "/paper/main.tex", recursive: true });
    rememberWorkspace({ mode: "directory", path: "/images", recursive: false });
    rememberWorkspace({ mode: "tex", path: "/paper/main.tex", recursive: true });
    expect(readRecents().map((entry) => entry.path)).toEqual(["/paper/main.tex", "/images"]);
  });
  it("bounds history, removes only the requested entry, and keeps settings", () => {
    for (let i = 0; i < 20; i++) rememberWorkspace({ mode: "directory", path: `/images/${i}`, recursive: true });
    expect(readRecents()).toHaveLength(12);
    storeSettings("directory:/images/19", { dpi: "150", jpegQuality: "80", outputDir: "pdf-ready" });
    removeRecent(readRecents()[0]);
    expect(readRecents()).toHaveLength(11);
    expect(readSettings("directory:/images/19")?.outputDir).toBe("pdf-ready");
  });
  it("tolerates malformed local state", () => {
    localStorage.setItem("texgo.recents.v1", "{bad");
    expect(readRecents()).toEqual([]);
    localStorage.setItem("texgo.recents.v1", JSON.stringify([{ mode: "bad", path: "/bad" }]));
    expect(readRecents()).toEqual([]);
  });
});
