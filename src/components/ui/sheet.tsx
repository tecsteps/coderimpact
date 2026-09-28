import * as React from "react";
import { Dialog as D } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Sheet = D.Root;

export function SheetContent({
  className,
  children,
  side = "bottom",
  title,
  description,
  ...props
}: React.ComponentProps<typeof D.Content> & { side?: "bottom" | "right" | "left"; title: string; description?: string }) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-40 bg-black/40 data-[state=open]:animate-in" />
      <D.Content
        className={cn(
          "fixed z-50 flex flex-col bg-surface text-foreground shadow-pop outline-none",
          // Above the browser's own bottom toolbar, sized to the visible area.
          side === "bottom" && "inset-x-0 bottom-[var(--vv-bottom,0px)] max-h-[calc(var(--app-h,100dvh)*0.94)] rounded-t-xl border-t border-border pb-safe",
          side === "right" && "inset-y-0 right-0 w-[min(420px,92vw)] border-l border-border",
          side === "left" && "inset-y-0 left-0 w-[min(340px,88vw)] border-r border-border",
          className,
        )}
        {...props}
      >
        {side === "bottom" && <div aria-hidden className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-border-strong" />}
        <div className="flex items-center justify-between gap-2 px-4 pt-2 pb-1">
          <D.Title className="min-w-0 truncate text-sm font-semibold">{title}</D.Title>
          <D.Close className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-surface-2 hover:text-foreground" aria-label="Close">
            <X className="size-4" />
          </D.Close>
        </div>
        {description ? (
          <D.Description className="sr-only">{description}</D.Description>
        ) : (
          <D.Description className="sr-only">{title}</D.Description>
        )}
        {children}
      </D.Content>
    </D.Portal>
  );
}
