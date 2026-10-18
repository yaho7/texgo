import { describe, expect, it } from "vitest";
import { conversionOptions, settingsIssues } from "../src/settings";

const custom = { dpi: "300", jpegQuality: "90", outputDir: "texgo-pdf" };

describe("backend-aligned conversion settings", () => {
  it("sends no reference width and preserves custom output names", () => {
    expect(conversionOptions({ ...custom, outputDir: "论文图片/pdf" }, ["a"])).toEqual({ imageIds: ["a"], quality: "custom", dpi: 300, jpegQuality: 90, outputDir: "论文图片/pdf" });
  });

  it.each(["72", "1200"])("accepts DPI boundary %s", (dpi) => {
    expect(settingsIssues({ ...custom, dpi })).toEqual({});
  });

  it.each(["", "71", "1201", "NaN", "150.5"])("rejects invalid DPI %s", (dpi) => {
    expect(settingsIssues({ ...custom, dpi }).dpi).toBe("DPI 需为 72–1200 的整数");
  });

  it.each(["1", "100"])("accepts quality boundary %s", (jpegQuality) => {
    expect(settingsIssues({ ...custom, jpegQuality })).toEqual({});
  });

  it.each(["", ".", "..", "../out", "/tmp/out", "C:\\out", "x/../out", ".texgo/pdf", ".git", "x/node_modules"])("rejects unsafe output %s", (outputDir) => {
    expect(settingsIssues({ ...custom, outputDir }).outputDir).toBeTruthy();
  });

  it.each(["", "0", "101", "85.5"])("rejects JPEG quality %s", (jpegQuality) => {
    expect(settingsIssues({ ...custom, jpegQuality }).jpegQuality).toBe("质量需为 1–100 的整数");
  });
});
