import type { ComponentProps } from "react";
import { Checkbox as Check } from "radix-ui";
import { CheckIcon, MinusIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function Checkbox({ className, ...props }: ComponentProps<typeof Check.Root>) {
  return <Check.Root data-slot="checkbox" className={cn("group inline-grid size-4 shrink-0 place-items-center rounded-xs border border-input bg-background text-white outline-offset-2 focus-visible:outline-2 focus-visible:outline-primary data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary disabled:opacity-40 disabled:cursor-not-allowed", className)} {...props}>
    <Check.Indicator data-slot="checkbox-indicator"><CheckIcon aria-hidden="true" className="size-3 group-data-[state=indeterminate]:hidden" /><MinusIcon aria-hidden="true" className="hidden size-3 group-data-[state=indeterminate]:block" /></Check.Indicator>
  </Check.Root>;
}
