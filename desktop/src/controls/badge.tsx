import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
const tones = {
  default: "bg-primary/10 text-primary", secondary: "bg-secondary text-muted-foreground",
  success: "bg-success/10 text-success", warning: "bg-warning/10 text-warning",
  destructive: "bg-destructive/10 text-destructive", outline: "border-border text-muted-foreground",
};
export function Badge({ variant = "default", className, ...props }: ComponentProps<"span"> & { variant?: keyof typeof tones }) {
  return <span data-slot="badge" data-variant={variant} className={cn("inline-flex w-fit shrink-0 items-center gap-1 rounded border border-transparent px-1.5 py-0.5 text-[11px] leading-4 font-medium whitespace-nowrap [&>svg]:size-3", tones[variant], className)} {...props} />;
}
