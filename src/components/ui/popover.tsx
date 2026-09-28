import * as React from "react";
import { Popover as P } from "radix-ui";
import { cn } from "@/lib/utils";

export const Popover = P.Root;
export const PopoverTrigger = P.Trigger;

export function PopoverContent({ className, align = "end", sideOffset = 6, ...props }: React.ComponentProps<typeof P.Content>) {
  return (
    <P.Portal>
      <P.Content
        align={align}
        sideOffset={sideOffset}
        collisionPadding={12}
        className={cn(
          "z-50 w-72 rounded-lg border border-border bg-surface p-3 text-foreground shadow-pop outline-none",
          "max-h-[var(--radix-popover-content-available-height)] overflow-y-auto",
          className,
        )}
        {...props}
      />
    </P.Portal>
  );
}
