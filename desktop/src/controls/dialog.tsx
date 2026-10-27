import type { ComponentProps } from "react";
import { Dialog as Modal } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Dialog = Modal.Root;
export const DialogClose = Modal.Close;
export const DialogTrigger = Modal.Trigger;

/** Radix owns the modal lifetime, focus trap, Escape and focus restoration. */
export function DialogContent({ className, children, showCloseButton = true, ...props }: ComponentProps<typeof Modal.Content> & { showCloseButton?: boolean }) {
  return <Modal.Portal>
    <Modal.Overlay data-slot="dialog-overlay" className="fixed inset-0 z-50 bg-[#20252c]/30" />
    <Modal.Content data-slot="dialog-content" className={cn("fixed left-1/2 top-1/2 z-50 grid max-h-[calc(100dvh-32px)] w-[calc(100%-32px)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-lg border border-border bg-background p-5 text-foreground shadow-xl outline-none", className)} {...props}>
      {children}
      {showCloseButton && <Modal.Close data-slot="dialog-close" aria-label="关闭" className="absolute right-3 top-3 grid size-7 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-45"><X aria-hidden="true" className="size-4" /></Modal.Close>}
    </Modal.Content>
  </Modal.Portal>;
}
export function DialogHeader({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="dialog-header" className={cn("flex min-w-0 flex-col gap-1.5 pr-6 text-left", className)} {...props} />;
}
export function DialogFooter({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="dialog-footer" className={cn("flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4", className)} {...props} />;
}
export function DialogTitle({ className, ...props }: ComponentProps<typeof Modal.Title>) {
  return <Modal.Title data-slot="dialog-title" className={cn("text-base leading-6 font-semibold", className)} {...props} />;
}
export function DialogDescription({ className, ...props }: ComponentProps<typeof Modal.Description>) {
  return <Modal.Description data-slot="dialog-description" className={cn("text-xs leading-relaxed text-muted-foreground", className)} {...props} />;
}
