"use client";

import { useRouter, useSearchParams } from "next/navigation";
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
};

export function RangePicker({ value, className }: RangePickerProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const setRange = (next: DashboardRange) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "week") {
      params.delete("range");
    } else {
      params.set("range", next);
    }
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : "/dashboard", { scroll: false });
  };

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
          onClick={() => setRange(v)}
          className={cn(
            "rounded-full px-3 py-1.5 text-xs font-semibold transition-all",
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
