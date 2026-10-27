import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useOperation } from "../src/hooks/useOperation";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("operation ownership", () => {
  it("rejects occupied acquisition synchronously before React renders", () => {
    const { result } = renderHook(useOperation);
    act(() => {
      const first = result.current.acquire("opening", "foreground");
      expect(first).not.toBeNull();
      expect(result.current.acquire("renaming", "foreground")).toBeNull();
    });
    expect(result.current.state).toMatchObject({ status: "running", kind: "opening", owner: "foreground" });
  });

  it("does not let stale completion release a newer lease", () => {
    const { result } = renderHook(useOperation);
    act(() => {
      const first = result.current.acquire("opening", "foreground")!;
      expect(result.current.release(first)).toBe(true);
      const second = result.current.acquire("renaming", "foreground")!;
      expect(second.token).not.toBe(first.token);
      expect(result.current.release(first)).toBe(false);
      expect(result.current.current()).toEqual({ status: "running", ...second });
    });
    expect(result.current.state).toMatchObject({ status: "running", kind: "renaming" });
  });

  it("releases the owning lease when an action fails and permits retry", async () => {
    const { result } = renderHook(useOperation);
    await act(async () => {
      await expect(result.current.run("renaming", "foreground", async () => { throw new Error("rename failed"); })).rejects.toThrow("rename failed");
    });
    expect(result.current.state).toEqual({ status: "idle" });
    await act(async () => {
      await expect(result.current.run("opening", "foreground", async () => "ready")).resolves.toEqual({ acquired: true, value: "ready" });
    });
    expect(result.current.state).toEqual({ status: "idle" });
  });

  it("does not run rejected actions or let background work claim foreground ownership", async () => {
    const { result } = renderHook(useOperation);
    const pending = deferred();
    let foreground: Promise<unknown>;
    act(() => { foreground = result.current.run("applying", "foreground", () => pending.promise); });
    await act(async () => {
      expect(result.current.acquire("converting", "background")).toBeNull();
      await expect(result.current.run("converting", "background", async () => { throw new Error("must not run"); })).resolves.toEqual({ acquired: false });
    });
    expect(result.current.state).toMatchObject({ status: "running", kind: "applying", owner: "foreground" });
    await act(async () => { pending.resolve(); await foreground; });
    expect(result.current.state).toEqual({ status: "idle" });
  });

  it("requires both token and owner to release an operation", () => {
    const { result } = renderHook(useOperation);
    act(() => {
      const lease = result.current.acquire("converting", "background")!;
      expect(result.current.release({ ...lease, owner: "foreground" })).toBe(false);
      expect(result.current.release(lease)).toBe(true);
    });
    expect(result.current.state).toEqual({ status: "idle" });
  });
});
