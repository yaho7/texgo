import { useCallback, useRef, useState } from "react";
import { acquireOperation, releaseOperation } from "../state/operationMachine";
import type { Operation, OperationLease, OperationOwner, OperationState } from "../state/operationMachine";

type OperationResult<T> = { acquired: false } | { acquired: true; value: T };

export function useOperation() {
  const [state, setState] = useState<OperationState>({ status: "idle" });
  // Acquisition must arbitrate synchronously, including calls before React renders.
  const stateRef = useRef<OperationState>(state);
  const current = useCallback(() => stateRef.current, []);
  const acquire = useCallback((kind: Operation, owner: OperationOwner): OperationLease | null => {
    const lease: OperationLease = { kind, owner, token: Symbol(kind) };
    const next = acquireOperation(stateRef.current, lease);
    if (next === stateRef.current) return null;
    stateRef.current = next;
    setState(next);
    return lease;
  }, []);
  const release = useCallback((lease: OperationLease): boolean => {
    const next = releaseOperation(stateRef.current, lease);
    if (next === stateRef.current) return false;
    stateRef.current = next;
    setState(next);
    return true;
  }, []);
  const run = useCallback(async <T,>(kind: Operation, owner: OperationOwner, action: () => Promise<T>): Promise<OperationResult<T>> => {
    const lease = acquire(kind, owner);
    if (!lease) return { acquired: false };
    try { return { acquired: true, value: await action() }; }
    finally { release(lease); }
  }, [acquire, release]);
  return { state, current, acquire, release, run };
}
