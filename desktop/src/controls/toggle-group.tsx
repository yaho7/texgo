import { createContext, useContext, type ComponentProps } from "react";
import { ToggleGroup as Segments } from "radix-ui";
import { cn } from "@/lib/utils";
type Appearance = { variant?: "default" | "outline"; size?: "default" | "sm" | "lg" };
const AppearanceContext = createContext<Appearance>({});

/** Radix retains roving focus and single/multiple selection for these segmented controls. */
export function ToggleGroup({ variant = "default", size = "default", className, children, ...props }: ComponentProps<typeof Segments.Root> & Appearance) {
  return <AppearanceContext.Provider value={{ variant, size }}><Segments.Root data-slot="toggle-group" data-variant={variant} data-size={size} className={cn("inline-flex w-fit max-w-full items-center gap-0.5 rounded-md bg-secondary p-0.5", className)} {...props}>{children}</Segments.Root></AppearanceContext.Provider>;
}
export function ToggleGroupItem({ variant, size, className, ...props }: ComponentProps<typeof Segments.Item> & Appearance) {
  const group = useContext(AppearanceContext);
  const itemSize = size ?? group.size;
  return <Segments.Item data-slot="toggle-group-item" data-variant={variant ?? group.variant} data-size={itemSize} className={cn("inline-flex shrink-0 items-center justify-center gap-1 rounded px-2.5 text-xs text-muted-foreground outline-offset-2 hover:bg-background/70 hover:text-foreground focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-primary data-[state=on]:bg-background data-[state=on]:text-primary data-[state=on]:shadow-sm disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4", itemSize === "sm" ? "h-7" : itemSize === "lg" ? "h-10" : "h-8", className)} {...props} />;
}
