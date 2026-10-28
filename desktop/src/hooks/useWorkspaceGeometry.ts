import { useEffect, useRef } from "react";

/** Align the sidebar footer with the command bar, including additional notices. */
export function useWorkspaceGeometry(active: boolean, notice: string) {
  const shellRef = useRef<HTMLDivElement>(null);
  const commandRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const shell = shellRef.current, command = commandRef.current;
    if (!active || !shell || !command) return;
    const measure = () => {
      const height = shell.getBoundingClientRect().bottom - command.getBoundingClientRect().top;
      if (height > 0) shell.style.setProperty("--workspace-footer-height", `${height}px`);
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(shell); observer.observe(command);
    return () => observer.disconnect();
  }, [active, notice]);
  return { shellRef, commandRef };
}
