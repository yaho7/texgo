import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
export function Separator({ orientation = "horizontal", decorative = true, className, ...props }: ComponentProps<"div"> & { orientation?: "horizontal" | "vertical"; decorative?: boolean }) {
  return <div data-slot="separator" data-orientation={orientation} role={decorative ? "none" : "separator"} aria-orientation={decorative ? undefined : orientation} className={cn("shrink-0 bg-border", orientation === "vertical" ? "h-full w-px" : "h-px w-full", className)} {...props} />;
}
