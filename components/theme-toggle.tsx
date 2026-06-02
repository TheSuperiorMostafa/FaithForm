"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme, type ThemeMode } from "@/components/theme-provider";
import { cn } from "@/lib/utils";

type ThemeToggleProps = {
  variant?: "segmented" | "compact";
  className?: string;
};

const options: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

export function ThemeToggle({
  variant = "segmented",
  className,
}: ThemeToggleProps) {
  const { mode, setMode } = useTheme();

  if (variant === "compact") {
    const cycle: ThemeMode[] = ["light", "dark", "system"];
    const next = cycle[(cycle.indexOf(mode) + 1) % cycle.length];
    const Icon =
      mode === "dark" ? Moon : mode === "light" ? Sun : Monitor;

    return (
      <button
        type="button"
        onClick={() => setMode(next)}
        className={cn(
          "flex size-10 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
          className,
        )}
        aria-label={`Theme: ${mode}. Click to switch.`}
      >
        <Icon className="size-4" />
      </button>
    );
  }

  return (
    <div
      className={cn(
        "flex rounded-xl border border-border bg-muted/40 p-1",
        className,
      )}
      role="group"
      aria-label="Theme"
    >
      {options.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          onClick={() => setMode(value)}
          className={cn(
            "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-all",
            mode === value
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
          aria-pressed={mode === value}
          aria-label={label}
        >
          <Icon className="size-3.5" />
          <span className="hidden sm:inline">{label}</span>
        </button>
      ))}
    </div>
  );
}
