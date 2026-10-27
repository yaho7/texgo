import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** Keep the platform select picker and keyboard interaction. */
export function NativeSelect({ className, size = "default", ...props }: Omit<ComponentProps<"select">, "size"> & { size?: "default" | "sm" }) {
  return <select data-slot="native-select" className={cn("w-full min-w-0 rounded-md border border-input bg-background px-2 text-[13px] text-foreground outline-offset-2 focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-45", size === "sm" ? "h-8" : "h-9", className)} {...props} />;
}
export function NativeSelectOption(props: ComponentProps<"option">) { return <option {...props} />; }
