"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme, type ThemeMode } from "@/components/theme-provider";
import { cn } from "@/lib/utils";

type ThemeToggleProps = {
  /**
   * "icons" is the three-button Sun / Moon / Computer control at the top of
   * Settings; "segmented" and "compact" are for tight spaces (admin sidebar,
   * sign-in screen).
   */
  variant?: "icons" | "segmented" | "compact";
  className?: string;
};

const options: {
  value: ThemeMode;
  label: string;
  /** For the narrow segmented control. */
  shortLabel: string;
  hint: string;
  icon: typeof Sun;
}[] = [
  { value: "light", label: "Light", shortLabel: "Light", hint: "Dark text on a light page.", icon: Sun },
  { value: "dark", label: "Dark", shortLabel: "Dark", hint: "Light text on a dark page.", icon: Moon },
  {
    value: "system",
    label: "Match my computer",
    shortLabel: "Auto",
    hint: "Follows your computer or phone's own setting.",
    icon: Monitor,
  },
];

function labelFor(mode: ThemeMode): string {
  return options.find((option) => option.value === mode)?.label ?? "Light";
}

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
        aria-label={`Colours: ${labelFor(mode)}. Click to switch.`}
      >
        <Icon className="size-4" />
      </button>
    );
  }

  if (variant === "icons") {
    return (
      <div
        role="radiogroup"
        aria-label="Light or dark"
        className={cn("flex w-fit gap-1 rounded-2xl border border-border bg-card p-1 shadow-sm", className)}
      >
        {options.map(({ value, label, hint, icon: Icon }) => {
          const active = mode === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={label}
              title={`${label}. ${hint}`}
              onClick={() => setMode(value)}
              className={cn(
                "flex size-11 items-center justify-center rounded-xl transition-colors motion-reduce:transition-none",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                active
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Icon className="size-5" strokeWidth={1.75} aria-hidden />
            </button>
          );
        })}
      </div>
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
      {options.map(({ value, label, shortLabel, icon: Icon }) => (
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
          <span className="hidden sm:inline">{shortLabel}</span>
        </button>
      ))}
    </div>
  );
}
