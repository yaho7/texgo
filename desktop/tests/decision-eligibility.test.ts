import { describe, expect, it } from "vitest";
import type { BusinessDecision } from "../src/state/businessDecision";
import { mayStartOperation } from "../src/state/businessDecision";

describe("business decision ownership", () => {
  it("blocks a conversion, scan or rename while a review owns the workspace", () => {
    const review: BusinessDecision = { kind: "review", preview: { files: [], referenceCount: 1 }, repair: false };
    for (const kind of ["converting", "opening", "renaming"] as const) expect(mayStartOperation(review, kind)).toBe(false);
    expect(mayStartOperation(review, "applying", "apply-review")).toBe(true);
    expect(mayStartOperation(review, "opening", "repair")).toBe(false);
    expect(mayStartOperation(review, "undoing", "confirm-undo")).toBe(false);
  });
  it("limits repair actions to the open problem and prevents unrelated operations", () => {
    const problem = { kind: "problem", imageId: "missing" } as const;
    expect(mayStartOperation(problem, "reviewing", "repair")).toBe(true);
    expect(mayStartOperation(problem, "opening", "repair")).toBe(true);
    expect(mayStartOperation(problem, "updating", "ignore-problem")).toBe(true);
    expect(mayStartOperation(problem, "converting", "repair")).toBe(false);
    expect(mayStartOperation({ kind: "manual-block" }, "opening", "repair")).toBe(false);
  });
});

it("allows only an explicit rescan after a pre-write review conflict", () => {
  const stale: BusinessDecision = { kind: "review", preview: { files: [], referenceCount: 1 }, repair: false, conflict: { path: "/paper/main.tex", message: "changed" } };
  expect(mayStartOperation(stale, "applying", "apply-review")).toBe(false);
  expect(mayStartOperation(stale, "reviewing", "rescan-review")).toBe(true);
  expect(mayStartOperation(stale, "converting", "rescan-review")).toBe(false);
  expect(mayStartOperation({ kind: "none" }, "reviewing", "rescan-review")).toBe(false);
});
