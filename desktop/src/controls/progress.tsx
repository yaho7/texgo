import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
export function Progress({ value, max = 100, className, ...props }: Omit<ComponentProps<"div">, "children"> & { value?: number | null; max?: number }) {
  const limit = max > 0 ? max : 100;
  const current = value == null ? undefined : Math.min(limit, Math.max(0, value));
  return <div data-slot="progress" role="progressbar" aria-valuemin={0} aria-valuemax={limit} aria-valuenow={current} className={cn("h-1.5 w-full overflow-hidden rounded-full bg-secondary", className)} {...props}>
    <div data-slot="progress-indicator" className="h-full rounded-full bg-primary motion-safe:transition-[width]" style={{ width: current === undefined ? "35%" : `${current / limit * 100}%` }} />
  </div>;
}
