import type { DecisionAction } from "../state/businessDecision";
import type { Dispatch, SetStateAction } from "react";
import type { useWorkspace } from "./useWorkspace";
import type { useAssetSelection } from "./useAssetSelection";
import type { useHistory } from "./useHistory";
import type { Operation } from "../state/operationMachine";
export type Setter<T> = Dispatch<SetStateAction<T>>;
export interface WorkflowPorts {
  workspace: ReturnType<typeof useWorkspace>;
  selection: ReturnType<typeof useAssetSelection>;
  execute: (kind: Operation, action: () => Promise<void>, decisionAction?: DecisionAction) => Promise<void>;
  currentOperationKind: () => Operation | null;
  setError: Setter<string | null>;
  setNotice: Setter<string>;
  rememberFocus: () => void;
  restoreFocus: () => void;
}
export type HistoryDomain = ReturnType<typeof useHistory>;
