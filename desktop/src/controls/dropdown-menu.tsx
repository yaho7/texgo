import type { ComponentProps } from "react";
import { DropdownMenu as Menu } from "radix-ui";
import { cn } from "@/lib/utils";
import { menuSurface, menuEntry } from "./menu-styles";
export const DropdownMenu = Menu.Root;
export const DropdownMenuTrigger = Menu.Trigger;
export const DropdownMenuGroup = Menu.Group;
export function DropdownMenuContent({ className, sideOffset = 5, ...props }: ComponentProps<typeof Menu.Content>) {
  return <Menu.Portal><Menu.Content data-slot="dropdown-menu-content" sideOffset={sideOffset} className={cn(menuSurface, "max-h-[var(--radix-dropdown-menu-content-available-height)]", className)} {...props} /></Menu.Portal>;
}
export function DropdownMenuItem({ className, variant = "default", ...props }: ComponentProps<typeof Menu.Item> & { variant?: "default" | "destructive" }) {
  return <Menu.Item data-slot="dropdown-menu-item" className={cn(menuEntry, variant === "destructive" && "text-destructive data-[highlighted]:bg-destructive", className)} {...props} />;
}
export function DropdownMenuSeparator({ className, ...props }: ComponentProps<typeof Menu.Separator>) {
  return <Menu.Separator className={cn("my-1 h-px bg-border", className)} {...props} />;
}
export function DropdownMenuShortcut({ className, ...props }: ComponentProps<"span">) {
  return <span data-slot="dropdown-menu-shortcut" className={cn("ml-auto pl-5 text-[11px] tabular-nums opacity-65", className)} {...props} />;
}
