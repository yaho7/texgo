import type { ChangePreview, ConversionHistoryEntry } from "../types";
import type { Operation } from "./operationMachine";
export type BusinessDecision =
  | { kind: "none" }
  | { kind: "review"; preview: ChangePreview; repair: boolean; repairContext?: { imageId: string; target: string }; conflict?: { path: string; message: string } }
  | { kind: "problem"; imageId: string }
  | { kind: "undo"; entry: ConversionHistoryEntry }
  | { kind: "manual-block" };
export type DecisionAction = "apply-review" | "rescan-review" | "confirm-undo" | "repair" | "ignore-problem";
export function mayStartOperation(decision: BusinessDecision, kind: Operation, action?: DecisionAction) {
  if (decision.kind === "none") return action === undefined || (action === "repair" && (kind === "opening" || kind === "reviewing"));
  if (decision.kind === "review") return (action === "apply-review" && kind === "applying" && !decision.conflict) || (action === "rescan-review" && kind === "reviewing" && Boolean(decision.conflict));
  if (decision.kind === "undo") return action === "confirm-undo" && kind === "undoing";
  if (decision.kind === "problem") return (action === "repair" && (kind === "opening" || kind === "reviewing")) || (action === "ignore-problem" && kind === "updating");
  return false;
}
