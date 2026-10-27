import { describe, expect, it } from "vitest";
import { recentOpenedAt, recentProjectPath } from "../src/recentPresentation";

describe("recent project paths", () => {
  it.each([
    ["/Users/other/paper/main.tex", "main.tex", "/Users/other/paper"],
    ["/main.tex", "main.tex", "/"],
    ["C:\\papers\\main.tex", "main.tex", "C:\\papers"],
    ["C:\\main.tex", "main.tex", "C:\\"],
    ["C:/main.tex", "main.tex", "C:/"],
    ["\\\\server\\share\\main.tex", "main.tex", "\\\\server\\share"],
    ["main.tex", "main.tex", "."],
  ])("preserves native directory boundaries for %s", (path, name, directory) => {
    expect(recentProjectPath(path)).toEqual({ name, directory });
  });
});

describe("recent opening times", () => {
  const now = new Date(2026, 9, 27, 12).getTime();
  it("uses elapsed minutes and local calendar days", () => {
    expect(recentOpenedAt(now - 30_000, now).label).toBe("刚刚");
    expect(recentOpenedAt(now - 5 * 60_000, now).label).toBe("5 分钟前");
    expect(recentOpenedAt(now - 60 * 60_000, now).label).toBe("今天");
    expect(recentOpenedAt(new Date(2026, 9, 26, 23, 59).getTime(), now).label).toBe("昨天");
    expect(recentOpenedAt(new Date(2026, 9, 24, 23, 59).getTime(), now).label).toBe("3 天前");
    expect(recentOpenedAt(now, now).iso).toBe(new Date(now).toISOString());
  });
  it("handles midnight and daylight saving calendar boundaries", () => {
    const midnight = new Date(2026, 9, 27, 0, 1).getTime();
    expect(recentOpenedAt(midnight - 2 * 60_000, midnight).label).toBe("昨天");
    const date = new Date(2026, 2, 9, 12);
    expect(recentOpenedAt(new Date(2026, 2, 7, 12).getTime(), date.getTime()).label).toBe("2 天前");
  });
  it.each([NaN, Infinity, -Infinity, 8.64e15 + 1])("rejects an unrepresentable timestamp %s", (value) => {
    expect(recentOpenedAt(value, now)).toEqual({ label: "时间未知" });
  });
  it("does not present a future timestamp as a past opening", () => {
    expect(recentOpenedAt(now + 60_000, now)).toEqual({ label: "时间未知", iso: new Date(now + 60_000).toISOString() });
  });
});
