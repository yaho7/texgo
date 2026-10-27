import type { ComponentProps } from "react";
import { Popover as Surface } from "radix-ui";
import { cn } from "@/lib/utils";
export const Popover = Surface.Root;
export const PopoverTrigger = Surface.Trigger;
export function PopoverContent({ className, align = "center", sideOffset = 6, ...props }: ComponentProps<typeof Surface.Content>) {
  return <Surface.Portal><Surface.Content data-slot="popover-content" align={align} sideOffset={sideOffset} className={cn("z-50 w-80 max-w-[calc(100vw-24px)] rounded-md border border-border bg-popover p-4 text-popover-foreground shadow-lg outline-none", className)} {...props} /></Surface.Portal>;
}
