import type { ComponentProps } from "react";
import { ContextMenu as Menu } from "radix-ui";
import { cn } from "@/lib/utils";
import { menuSurface, menuEntry } from "./menu-styles";
export const ContextMenu = Menu.Root;
export const ContextMenuTrigger = Menu.Trigger;
export const ContextMenuGroup = Menu.Group;
export function ContextMenuContent({ className, ...props }: ComponentProps<typeof Menu.Content>) {
  return <Menu.Portal><Menu.Content data-slot="context-menu-content" className={cn(menuSurface, "max-h-[var(--radix-context-menu-content-available-height)]", className)} {...props} /></Menu.Portal>;
}
export function ContextMenuItem({ className, ...props }: ComponentProps<typeof Menu.Item>) {
  return <Menu.Item data-slot="context-menu-item" className={cn(menuEntry, className)} {...props} />;
}
export function ContextMenuSeparator({ className, ...props }: ComponentProps<typeof Menu.Separator>) {
  return <Menu.Separator className={cn("my-1 h-px bg-border", className)} {...props} />;
}
