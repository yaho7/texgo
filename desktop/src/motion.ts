/** Keep React transition lifetimes in sync with the shared CSS motion tokens. */
export function motionDuration(speed: "fast" | "normal" | "slow" = "normal"): number {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return 20;
  const value = getComputedStyle(document.documentElement).getPropertyValue(`--motion-${speed}`).trim();
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return { fast: 120, normal: 180, slow: 260 }[speed];
  return value.endsWith("ms") ? parsed : parsed * 1000;
}
