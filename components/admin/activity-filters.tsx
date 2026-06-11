"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import type { AdminActivityRange } from "@/lib/queries/admin";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

const ranges: { value: AdminActivityRange; label: string }[] = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
  { value: "all", label: "All" },
];

type ActivityFiltersProps = {
  filterOptions: {
    types: string[];
    categories: string[];
  };
  current: {
    category?: string;
    type?: string;
    range: AdminActivityRange;
    page: number;
  };
};

export function ActivityFilters({ filterOptions, current }: ActivityFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const updateParams = (updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (!value) {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    }
    if (!("page" in updates)) {
      params.delete("page");
    }
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : "?", { scroll: false });
  };

  const hasFilters =
    Boolean(current.category) ||
    Boolean(current.type) ||
    current.range !== "all" ||
    current.page > 1;

  return (
    <div className="flex flex-col gap-3 border-b border-border p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Category
            </span>
            <Select
              value={current.category ?? ""}
              onChange={(event) =>
                updateParams({
                  category: event.target.value || null,
                })
              }
              aria-label="Filter by category"
            >
              <option value="">All categories</option>
              {filterOptions.categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </Select>
          </label>

          <label className="space-y-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Type
            </span>
            <Select
              value={current.type ?? ""}
              onChange={(event) =>
                updateParams({
                  type: event.target.value || null,
                })
              }
              aria-label="Filter by activity type"
            >
              <option value="">All types</option>
              {filterOptions.types.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </Select>
          </label>
        </div>

        <div
          className="inline-flex rounded-full border border-border/80 bg-background/70 p-1 shadow-sm"
          role="group"
          aria-label="Activity time range"
        >
          {ranges.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => updateParams({ range: value === "all" ? null : value })}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-semibold transition-all",
                current.range === value
                  ? "bg-accent text-accent-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {hasFilters && (
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => router.replace("?", { scroll: false })}
          >
            Clear filters
          </Button>
        </div>
      )}
    </div>
  );
}
