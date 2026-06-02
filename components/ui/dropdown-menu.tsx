"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type DropdownMenuContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
};

const DropdownMenuContext = React.createContext<DropdownMenuContextValue | null>(
  null,
);

function useDropdownMenu() {
  const ctx = React.useContext(DropdownMenuContext);
  if (!ctx) throw new Error("DropdownMenu components must be used within DropdownMenu");
  return ctx;
}

export function DropdownMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <DropdownMenuContext.Provider value={{ open, setOpen }}>
      <div ref={ref} className="relative inline-block text-left">
        {children}
      </div>
    </DropdownMenuContext.Provider>
  );
}

export function DropdownMenuTrigger({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const { open, setOpen } = useDropdownMenu();
  return (
    <button
      type="button"
      onClick={() => setOpen(!open)}
      className={cn(
        "inline-flex items-center justify-center rounded-[10px] px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground",
        className,
      )}
      aria-expanded={open}
    >
      {children}
    </button>
  );
}

export function DropdownMenuContent({
  children,
  className,
  align = "end",
}: {
  children: React.ReactNode;
  className?: string;
  align?: "start" | "end";
}) {
  const { open, setOpen } = useDropdownMenu();
  if (!open) return null;

  return (
    <div
      className={cn(
        "absolute z-50 mt-1 min-w-[160px] rounded-xl border border-border bg-card p-1 shadow-lg",
        align === "end" ? "right-0" : "left-0",
        className,
      )}
    >
      {React.Children.map(children, (child) => {
        if (!React.isValidElement(child)) return child;
        return React.cloneElement(child as React.ReactElement<{ onSelect?: () => void }>, {
          onSelect: () => {
            (child.props as { onSelect?: () => void }).onSelect?.();
            setOpen(false);
          },
        });
      })}
    </div>
  );
}

export function DropdownMenuItem({
  children,
  onSelect,
  className,
  disabled,
}: {
  children: React.ReactNode;
  onSelect?: () => void;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex w-full items-center rounded-lg px-3 py-2 text-left text-sm text-foreground hover:bg-accent/10 disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
    >
      {children}
    </button>
  );
}
