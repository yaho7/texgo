import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
export function Table({ className, ...props }: ComponentProps<"table">) { return <div data-slot="table-container" className="w-full overflow-x-auto"><table data-slot="table" className={cn("w-full border-collapse text-xs", className)} {...props} /></div>; }
export function TableHeader({ className, ...props }: ComponentProps<"thead">) { return <thead data-slot="table-header" className={cn("bg-secondary/50 text-muted-foreground", className)} {...props} />; }
export function TableBody({ className, ...props }: ComponentProps<"tbody">) { return <tbody data-slot="table-body" className={className} {...props} />; }
export function TableRow({ className, ...props }: ComponentProps<"tr">) { return <tr data-slot="table-row" className={cn("border-b border-border hover:bg-[var(--hover-bg)] data-[state=selected]:bg-[var(--selection-bg)]", className)} {...props} />; }
export function TableHead({ className, ...props }: ComponentProps<"th">) { return <th data-slot="table-head" className={cn("h-8 px-2 text-left font-medium whitespace-nowrap", className)} {...props} />; }
export function TableCell({ className, ...props }: ComponentProps<"td">) { return <td data-slot="table-cell" className={cn("px-2 py-1.5 align-middle", className)} {...props} />; }
export function TableCaption({ className, ...props }: ComponentProps<"caption">) { return <caption data-slot="table-caption" className={cn("py-3 text-xs text-muted-foreground", className)} {...props} />; }
