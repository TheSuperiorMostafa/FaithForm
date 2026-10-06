"use client";

import { cn } from "@/lib/utils";
import type { DashboardRange } from "@/lib/queries/dashboard";

const ranges: { value: DashboardRange; label: string }[] = [
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "all", label: "All" },
];

type RangePickerProps = {
  value: DashboardRange;
  className?: string;
  onChange: (range: DashboardRange) => void;
};

export function RangePicker({ value, className, onChange }: RangePickerProps) {
  return (
    <div
      className={cn(
        "inline-flex rounded-full border border-border/80 bg-background/70 p-1 shadow-sm backdrop-blur-sm",
        className,
      )}
      role="group"
      aria-label="Time range"
    >
      {ranges.map(({ value: v, label }) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={cn(
            "min-h-11 min-w-11 rounded-full px-3 py-1.5 text-xs font-semibold transition-all",
            value === v
              ? "bg-accent text-accent-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
          aria-pressed={value === v}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
