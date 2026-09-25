"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

type SwitchProps = Omit<React.ComponentProps<"button">, "onChange"> & {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
};

function Switch({
  className,
  checked = false,
  onCheckedChange,
  disabled,
  ...props
}: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      data-slot="switch"
      data-state={checked ? "checked" : "unchecked"}
      disabled={disabled}
      className={cn(
        "peer relative inline-flex h-8 w-14 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors outline-none before:absolute before:-inset-2 before:content-['']",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-accent" : "bg-foreground/25",
        className,
      )}
      onClick={() => onCheckedChange?.(!checked)}
      {...props}
    >
      <span
        className={cn(
          "pointer-events-none block size-6 rounded-full bg-background shadow-sm ring-0 transition-transform",
          checked ? "translate-x-6" : "translate-x-0",
        )}
      />
    </button>
  );
}

export { Switch };
