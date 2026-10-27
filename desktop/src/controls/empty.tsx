import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
export function Empty({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="empty" className={cn("flex min-w-0 flex-1 flex-col items-center justify-center gap-4 px-6 py-10 text-center", className)} {...props} />;
}
export function EmptyHeader({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="empty-header" className={cn("flex max-w-sm flex-col items-center gap-2", className)} {...props} />;
}
export function EmptyMedia({ className, variant = "default", ...props }: ComponentProps<"div"> & { variant?: "default" | "icon" }) {
  return <div data-slot="empty-icon" className={cn("mb-1 text-muted-foreground [&>svg]:size-8", variant === "icon" && "grid size-12 place-items-center", className)} {...props} />;
}
export function EmptyTitle({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="empty-title" className={cn("text-sm font-medium text-foreground", className)} {...props} />;
}
