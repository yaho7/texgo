import { StrictMode, useEffect } from "react";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useWorkspaceGuard } from "../src/hooks/useWorkspaceGuard";

describe("asynchronous workspace ownership", () => {
  it("does not revive a queued response after A to B to A browsing", () => {
    const { result, rerender } = renderHook(({ generation }) => useWorkspaceGuard(() => generation), { initialProps: { generation: 1 } });
    const oldResponse = result.current();
    rerender({ generation: 2 }); rerender({ generation: 3 });
    expect(oldResponse()).toBe(false);
    expect(result.current()()).toBe(true);
  });
  it("invalidates the discarded StrictMode setup and the final unmounted context", () => {
    const captures: (() => boolean)[] = [];
    const { unmount } = renderHook(() => {
      const capture = useWorkspaceGuard(() => 1);
      useEffect(() => { captures.push(capture()); }, []);
    }, { wrapper: StrictMode });
    expect(captures).toHaveLength(2);
    expect(captures[0]()).toBe(false); expect(captures[1]()).toBe(true);
    act(() => unmount());
    expect(captures[1]()).toBe(false);
  });
});
