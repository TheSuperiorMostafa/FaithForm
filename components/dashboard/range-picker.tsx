"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import type { DashboardRange } from "@/lib/queries/dashboard";

const ranges: { value: DashboardRange; label: string }[] = [
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "all", label: "All time" },
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
            "min-h-10 rounded-full px-4 text-[15px] font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            value === v
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-foreground/70 hover:text-foreground",
          )}
          aria-pressed={value === v}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
