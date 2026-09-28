import * as React from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "h-8 w-full rounded-md border border-border bg-surface px-2.5 text-[13px] text-foreground placeholder:text-subtle-foreground",
        "focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring",
        className,
      )}
      {...props}
    />
  );
}
