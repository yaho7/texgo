import type { ComponentProps } from "react";
import { Slot } from "radix-ui";
import { cn } from "@/lib/utils";

const tones = {
  default: "border-transparent bg-primary text-primary-foreground hover:bg-[#0967d4]",
  outline: "border-border bg-background text-foreground hover:bg-accent",
  secondary: "border-transparent bg-secondary text-secondary-foreground hover:bg-accent",
  ghost: "border-transparent bg-transparent text-foreground hover:bg-accent",
  destructive: "border-transparent bg-destructive text-white hover:bg-red-700",
  link: "border-transparent bg-transparent text-primary underline-offset-4 hover:underline",
};
const sizes = {
  default: "h-9 px-3 text-[13px]", sm: "h-8 px-2.5 text-xs", xs: "h-6 px-2 text-xs",
  lg: "h-10 px-4 text-sm", icon: "size-9 p-0", "icon-sm": "size-8 p-0",
  "icon-xs": "size-6 p-0", "icon-lg": "size-10 p-0",
};
type ButtonProps = ComponentProps<"button"> & {
  variant?: keyof typeof tones; size?: keyof typeof sizes; asChild?: boolean;
};

/** Workbench action. Slot composition keeps native semantics on menu triggers and links. */
export function Button({ variant = "default", size = "default", asChild, className, type = "button", ...props }: ButtonProps) {
  const Element = asChild ? Slot.Root : "button";
  return <Element data-slot="button" data-variant={variant} data-size={size} type={asChild ? undefined : type}
    className={cn("inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md border font-medium whitespace-nowrap outline-offset-2 focus-visible:outline-2 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:pointer-events-none", tones[variant], sizes[size], className)} {...props} />;
}
