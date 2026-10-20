import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
const root = existsSync(resolve(process.cwd(), "src/theme.css")) ? process.cwd() : resolve(process.cwd(), "desktop");
const css = readFileSync(resolve(root, "src/styles.css"), "utf8");
const tokens = readFileSync(resolve(root, "src/theme.css"), "utf8");
it("shares motion tokens across workflow, sidebar, badges and overlay surfaces", () => {
  for (const name of ["--motion-fast", "--motion-normal", "--motion-slow", "--ease-standard", "--ease-out"]) expect(tokens).toContain(name);
  for (const name of ["command-enter", "command-exit", "complete-enter", "surface-enter", "dialog-enter"]) expect(css).toContain(`@keyframes ${name}`);
  expect(css).toContain('data-collapsed="true"');
});
it("removes spatial and perpetual animation under reduced motion", () => {
  expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  expect(css).toContain("animation-name: reduced-opacity !important");
  expect(css).toContain(".spin, .animate-spin { animation: none !important; }");
  expect(css).toContain("transition-duration: 1ms !important");
});
