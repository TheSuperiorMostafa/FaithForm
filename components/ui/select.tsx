import * as React from "react";

import { cn } from "@/lib/utils";

/** Drawn chevron: `appearance-none` removes the browser's own arrow. */
const CHEVRON =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%235B6272' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")";

function Select({ className, children, style, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="select"
      style={{
        backgroundImage: CHEVRON,
        backgroundRepeat: "no-repeat",
        backgroundPosition: "right 0.875rem center",
        backgroundSize: "1.125rem",
        ...style,
      }}
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
