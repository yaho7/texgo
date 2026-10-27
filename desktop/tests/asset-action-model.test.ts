import { expect, it } from "vitest";
import { revealLabel } from "../src/assetActions";
it.each([["MacIntel", "在 Finder 中显示"], ["Win32", "在文件资源管理器中显示"], ["Linux x86_64", "在文件管理器中显示"]])("uses the platform file manager label for %s", (platform, label) => {
  expect(revealLabel(platform)).toBe(label);
});
