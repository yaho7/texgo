export type Operation = "opening" | "converting" | "reviewing" | "applying" | "undoing" | "updating" | "renaming";
export type OperationOwner = "foreground" | "background";
export type OperationLease = Readonly<{ token: symbol; kind: Operation; owner: OperationOwner }>;
export type OperationState = { status: "idle" } | ({ status: "running" } & OperationLease);

export function acquireOperation(state: OperationState, lease: OperationLease): OperationState {
  return state.status === "idle" ? { status: "running", ...lease } : state;
}

export function releaseOperation(state: OperationState, lease: OperationLease): OperationState {
  return state.status === "running" && state.token === lease.token && state.owner === lease.owner
    ? { status: "idle" }
    : state;
}
