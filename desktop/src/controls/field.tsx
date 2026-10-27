import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
export function FieldSet({ className, ...props }: ComponentProps<"fieldset">) {
  return <fieldset data-slot="field-set" className={cn("flex min-w-0 flex-col gap-4 disabled:opacity-60", className)} {...props} />;
}
export function FieldLegend({ className, variant = "legend", ...props }: ComponentProps<"legend"> & { variant?: "legend" | "label" }) {
  return <legend data-slot="field-legend" className={cn("mb-3 font-semibold", variant === "label" ? "text-xs" : "text-sm", className)} {...props} />;
}
export function FieldGroup({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="field-group" className={cn("flex min-w-0 flex-col gap-4", className)} {...props} />;
}
export function Field({ className, orientation = "vertical", ...props }: ComponentProps<"div"> & { orientation?: "vertical" | "horizontal" }) {
  return <div role="group" data-slot="field" data-orientation={orientation} className={cn("flex min-w-0 gap-2 data-[invalid=true]:text-destructive", orientation === "horizontal" ? "flex-row items-center" : "flex-col", className)} {...props} />;
}
export function FieldLabel({ className, ...props }: ComponentProps<"label">) {
  return <label data-slot="field-label" className={cn("flex items-center gap-2 text-[13px] leading-5 font-medium", className)} {...props} />;
}
export function FieldDescription({ className, ...props }: ComponentProps<"p">) {
  return <p data-slot="field-description" className={cn("text-xs leading-relaxed text-muted-foreground", className)} {...props} />;
}
export function FieldError({ className, ...props }: ComponentProps<"div">) {
  return <div role="alert" data-slot="field-error" className={cn("text-xs leading-relaxed text-destructive", className)} {...props} />;
}
