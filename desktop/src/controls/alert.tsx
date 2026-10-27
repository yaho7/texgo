import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
export function Alert({ variant = "default", className, ...props }: ComponentProps<"div"> & { variant?: "default" | "destructive" }) {
  return <div data-slot="alert" role="alert" className={cn("grid grid-cols-[0_1fr] gap-y-1 rounded-md border border-border bg-background px-3 py-2.5 text-[13px] has-[>svg]:grid-cols-[16px_1fr] has-[>svg]:gap-x-2 [&>svg]:size-4 [&>svg]:mt-0.5", variant === "destructive" && "border-destructive/25 text-destructive", className)} {...props} />;
}
export function AlertTitle({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="alert-title" className={cn("col-start-2 font-medium", className)} {...props} />;
}
export function AlertDescription({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="alert-description" className={cn("col-start-2 min-w-0 text-[13px] leading-relaxed text-muted-foreground", className)} {...props} />;
}
