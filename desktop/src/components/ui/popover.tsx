import * as React from "react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { cn } from "cn";

function Popover(props: React.ComponentProps<typeof PopoverPrimitive.Root>) { return <PopoverPrimitive.Root {...props} />; }
function PopoverTrigger(props: React.ComponentProps<typeof PopoverPrimitive.Trigger>) { return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />; }
function PopoverAnchor(props: React.ComponentProps<typeof PopoverPrimitive.Anchor>) { return <PopoverPrimitive.Anchor {...props} />; }
function PopoverContent({ className, align = "center", sideOffset = 6, ...props }: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return <PopoverPrimitive.Portal><PopoverPrimitive.Content data-slot="popover-content" align={align} sideOffset={sideOffset} className={cn("z-50 w-80 rounded-lg border bg-popover p-4 text-popover-foreground shadow-md outline-hidden", className)} {...props} /></PopoverPrimitive.Portal>;
}
export { Popover, PopoverTrigger, PopoverAnchor, PopoverContent };
