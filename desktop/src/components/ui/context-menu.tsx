import type { ComponentProps } from "react";
import { ContextMenu as Primitive } from "radix-ui";
import { cn } from "cn";

const ContextMenu = Primitive.Root;
const ContextMenuTrigger = Primitive.Trigger;
const ContextMenuGroup = Primitive.Group;
function ContextMenuContent({ className, ...props }: ComponentProps<typeof Primitive.Content>) {
  return <Primitive.Portal><Primitive.Content data-slot="context-menu-content" className={cn("z-50 min-w-[8rem] max-h-(--radix-context-menu-content-available-height) overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md outline-hidden data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95", className)} {...props} /></Primitive.Portal>;
}
function ContextMenuItem({ className, ...props }: ComponentProps<typeof Primitive.Item>) {
  return <Primitive.Item data-slot="context-menu-item" className={cn("relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50", className)} {...props} />;
}
function ContextMenuSeparator({ className, ...props }: ComponentProps<typeof Primitive.Separator>) {
  return <Primitive.Separator className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />;
}
export { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuGroup, ContextMenuItem, ContextMenuSeparator };
