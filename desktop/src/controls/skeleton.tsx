import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="skeleton" aria-hidden="true" className={cn("rounded-xs bg-secondary motion-safe:animate-pulse", className)} {...props} />;
}
