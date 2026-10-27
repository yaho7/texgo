import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
export function InputGroup({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="input-group" role="group" className={cn("flex h-9 min-w-0 items-center gap-2 rounded-md border border-input bg-background px-2.5 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20", className)} {...props} />;
}
export function InputGroupInput({ className, ...props }: ComponentProps<"input">) {
  return <input data-slot="input-group-control" className={cn("h-full w-full min-w-0 flex-1 border-0 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-45", className)} {...props} />;
}
export function InputGroupAddon({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="input-group-addon" className={cn("order-first flex shrink-0 items-center text-muted-foreground [&>svg]:size-4", className)} onClick={(event) => { if (!(event.target instanceof Element) || !event.target.closest("button")) event.currentTarget.parentElement?.querySelector("input")?.focus(); }} {...props} />;
}
