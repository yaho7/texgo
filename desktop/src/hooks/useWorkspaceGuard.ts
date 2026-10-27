import { useEffect, useRef } from "react";
// A captured guard belongs to one mount lifetime and one workspace generation.
// A -> B -> A cannot revive an older response, even when the path matches again.
export function useWorkspaceGuard(generation: () => number) {
  const lifetime = useRef<object | null>({});
  const latest = useRef(generation); latest.current = generation;
  useEffect(() => { lifetime.current = {}; return () => { lifetime.current = null; }; }, []);
  return function capture() {
    const mounted = lifetime.current;
    const started = latest.current();
    return () => mounted !== null && lifetime.current === mounted && latest.current() === started;
  };
}
