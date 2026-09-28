import * as React from "react";
import { Tabs as T } from "radix-ui";
import { cn } from "@/lib/utils";

export const Tabs = T.Root;

export function TabsList({ className, ...props }: React.ComponentProps<typeof T.List>) {
  return <T.List className={cn("flex items-center gap-1 border-b border-border px-2", className)} {...props} />;
}

export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof T.Trigger>) {
  return (
    <T.Trigger
      className={cn(
        "relative -mb-px inline-flex h-9 items-center gap-1.5 border-b-2 border-transparent px-2 text-[13px] font-medium text-muted-foreground cursor-pointer",
        "hover:text-foreground data-[state=active]:border-accent data-[state=active]:text-foreground",
        "focus-visible:outline-2 focus-visible:outline-offset-[-2px]",
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: React.ComponentProps<typeof T.Content>) {
  return <T.Content className={cn("min-h-0 flex-1 outline-none", className)} {...props} />;
}
