import type { ComponentProps } from "react";
import { Tooltip as Hint } from "radix-ui";
import { cn } from "@/lib/utils";
export const Tooltip = Hint.Root;
export const TooltipTrigger = Hint.Trigger;
export function TooltipProvider({ delayDuration = 0, ...props }: ComponentProps<typeof Hint.Provider>) {
  return <Hint.Provider delayDuration={delayDuration} {...props} />;
}
export function TooltipContent({ className, sideOffset = 5, ...props }: ComponentProps<typeof Hint.Content>) {
  return <Hint.Portal><Hint.Content data-slot="tooltip-content" sideOffset={sideOffset} className={cn("z-50 max-w-72 rounded-xs border border-border bg-foreground px-2 py-1 text-[11px] leading-4 text-background shadow-md", className)} {...props} /></Hint.Portal>;
}
