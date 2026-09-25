"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Loader2, Search, X } from "lucide-react";

import { AdvancedSection } from "@/components/ui/advanced-section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { GIFT_STATUS_FILTERS } from "@/lib/giving/labels";
import { detectRangePreset, RANGE_PRESETS, rangeForPreset, type RangePreset } from "@/lib/giving/periods";
import { cn } from "@/lib/utils";
import type { GivingFundRow } from "@/types/giving";

const SEARCH_DELAY_MS = 400;

/**
 * Search, date range and filters for the gifts table. Search runs as you
 * type (after a short pause) and straight away on Enter. Dates are one tap:
 * This week, This month, This year, or Custom for any two dates.
 */
export function GiftsToolbar({ funds }: { funds: GivingFundRow[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const searchId = useId();

  const currentSearch = searchParams.get("search") ?? "";
  const [search, setSearch] = useState(currentSearch);
  const lastPushed = useRef(currentSearch);
  const dateFrom = searchParams.get("dateFrom") ?? "";
  const dateTo = searchParams.get("dateTo") ?? "";
  const detected = detectRangePreset(dateFrom, dateTo);
  const [customOpen, setCustomOpen] = useState(detected === "custom");

  const fundId = searchParams.get("fundId") ?? "";
  const giftType = searchParams.get("giftType") ?? "";
  const status = searchParams.get("status") ?? "";
  const moreActive = Boolean(fundId || giftType || status);
  const anyActive = Boolean(currentSearch || dateFrom || dateTo || moreActive);

  const updateParams = (updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === "") params.delete(key);
      else params.set(key, value);
    }
    params.delete("page");
    const qs = params.toString();
    startTransition(() => {
      router.replace(`/dashboard/giving/gifts${qs ? `?${qs}` : ""}`, { scroll: false });
    });
  };

  const runSearch = (value: string) => {
    const trimmed = value.trim();
    if (trimmed === lastPushed.current) return;
    lastPushed.current = trimmed;
    updateParams({ search: trimmed || null });
  };

  // Search as the person types, once they pause.
  useEffect(() => {
    const timer = setTimeout(() => runSearch(search), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const choosePreset = (preset: RangePreset) => {
    setCustomOpen(false);
    if (detected === preset) {
      updateParams({ dateFrom: null, dateTo: null });
      return;
    }
    updateParams(rangeForPreset(preset));
  };

  const clearAll = () => {
    setSearch("");
    lastPushed.current = "";
    setCustomOpen(false);
    startTransition(() => {
      router.replace("/dashboard/giving/gifts", { scroll: false });
    });
  };

  return (
    <section aria-label="Find gifts" className="flex flex-col gap-4">
      <div className="relative">
        <Label htmlFor={searchId} className="sr-only">
          Search by donor name or email
        </Label>
        <Search
          className="pointer-events-none absolute left-5 top-1/2 size-6 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          id={searchId}
          type="search"
          value={search}
          placeholder="Search by donor name or email"
          className="min-h-14 rounded-2xl pl-14 pr-12 text-lg"
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              runSearch(search);
            }
          }}
        />
        {pending && (
          <Loader2
            className="absolute right-5 top-1/2 size-5 -translate-y-1/2 animate-spin text-muted-foreground motion-reduce:animate-none"
            aria-label="Updating gifts"
          />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="When">
        {RANGE_PRESETS.map((preset) => (
          <Chip
            key={preset.value}
            active={detected === preset.value && !customOpen}
            onClick={() => choosePreset(preset.value)}
          >
            {preset.label}
          </Chip>
        ))}
        <Chip
          active={customOpen || detected === "custom"}
          onClick={() => setCustomOpen((open) => !open)}
        >
          Custom dates
        </Chip>
        {anyActive && (
          <Button type="button" variant="ghost" onClick={clearAll}>
            <X aria-hidden />
            Clear filters
          </Button>
        )}
      </div>

      {(customOpen || detected === "custom") && (
        <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 sm:flex-row">
          <div className="flex-1 space-y-2">
            <Label htmlFor={`${searchId}-from`}>From</Label>
            <Input
              id={`${searchId}-from`}
              type="date"
              value={dateFrom}
              max={dateTo || undefined}
              onChange={(e) => updateParams({ dateFrom: e.target.value || null })}
            />
          </div>
          <div className="flex-1 space-y-2">
            <Label htmlFor={`${searchId}-to`}>To</Label>
            <Input
              id={`${searchId}-to`}
              type="date"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={(e) => updateParams({ dateTo: e.target.value || null })}
            />
          </div>
        </div>
      )}

      <AdvancedSection
        title="More filters"
        description="Fund, one-time or recurring, and status"
        defaultOpen={moreActive}
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor={`${searchId}-fund`}>Fund</Label>
            <Select
              id={`${searchId}-fund`}
              value={fundId}
              onChange={(e) => updateParams({ fundId: e.target.value || null })}
            >
              <option value="">All funds</option>
              {funds.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${searchId}-type`}>One-time or recurring</Label>
            <Select
              id={`${searchId}-type`}
              value={giftType}
              onChange={(e) => updateParams({ giftType: e.target.value || null })}
            >
              <option value="">Both</option>
              <option value="one_time">One-time</option>
              <option value="recurring">Recurring</option>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${searchId}-status`}>Status</Label>
            <Select
              id={`${searchId}-status`}
              value={status}
              onChange={(e) => updateParams({ status: e.target.value || null })}
            >
              <option value="">Any status</option>
              {GIFT_STATUS_FILTERS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </AdvancedSection>
    </section>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex min-h-11 items-center rounded-full border px-5 text-[15px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "border-primary bg-primary text-primary-foreground dark:border-accent dark:bg-accent dark:text-accent-foreground"
          : "border-border bg-card text-foreground hover:border-accent",
      )}
    >
      {children}
    </button>
  );
}
