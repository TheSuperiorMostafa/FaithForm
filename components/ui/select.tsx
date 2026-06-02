import * as React from "react";

import { cn } from "@/lib/utils";

function Select({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="select"
      className={cn(
        "flex min-h-11 w-full min-w-0 appearance-none rounded-[10px] border-[1.5px] border-border bg-background px-4 py-3 pr-10 text-[15px] shadow-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export { Select };
