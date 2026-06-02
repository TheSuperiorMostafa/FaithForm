"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Label } from "@/components/ui/label";
import {
  COMMON_US_TIMEZONES,
  filterTimezones,
  formatTimezoneLabel,
} from "@/lib/timezones";
import { cn } from "@/lib/utils";

const inputClass = cn(
  "min-h-11 w-full rounded-[10px] border-[1.5px] border-border bg-background px-4 py-3 text-[15px] text-foreground shadow-sm outline-none",
  "placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background",
);

type TimezoneSelectProps = {
  value: string;
  onChange: (value: string) => void;
  id?: string;
};

function TimezoneOption({
  tz,
  selected,
  onSelect,
}: {
  tz: string;
  selected: boolean;
  onSelect: (tz: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(tz)}
      className={cn(
        "flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-accent/10",
        selected && "bg-accent/15 font-medium",
      )}
    >
      <span>{formatTimezoneLabel(tz)}</span>
      <span className="text-xs text-muted-foreground">{tz}</span>
    </button>
  );
}

export function TimezoneSelect({
  value,
  onChange,
  id = "timezone",
}: TimezoneSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const { common, rest } = useMemo(() => {
    const all = filterTimezones(query, value);
    if (query.trim()) {
      return { common: [] as string[], rest: all };
    }
    const commonSet = new Set<string>(COMMON_US_TIMEZONES);
    return {
      common: all.filter((tz) => commonSet.has(tz)),
      rest: all.filter((tz) => !commonSet.has(tz)),
    };
  }, [query, value]);

  const displayValue = value ? formatTimezoneLabel(value) : "";

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  function selectTimezone(tz: string) {
    onChange(tz);
    setOpen(false);
    setQuery("");
  }

  const hasResults = common.length > 0 || rest.length > 0;

  return (
    <div ref={containerRef} className="relative space-y-2">
      <Label htmlFor={id}>Timezone</Label>
      <div className="relative">
        <input
          id={id}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          autoComplete="off"
          value={open ? query : displayValue}
          placeholder="Search or select timezone…"
          onChange={(e) => {
            setQuery(e.target.value);
            if (!open) setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          className={cn(inputClass, "pr-10")}
        />
        <ChevronDown
          className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          strokeWidth={1.75}
        />
      </div>

      {open && (
        <ul
          role="listbox"
          className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-border bg-card py-1 shadow-lg"
        >
          {!hasResults && (
            <li className="px-3 py-2 text-sm text-muted-foreground">
              No timezones match your search.
            </li>
          )}

          {common.length > 0 && (
            <>
              <li className="px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Common US timezones
              </li>
              {common.map((tz) => (
                <li key={tz} role="option" aria-selected={tz === value}>
                  <TimezoneOption
                    tz={tz}
                    selected={tz === value}
                    onSelect={selectTimezone}
                  />
                </li>
              ))}
            </>
          )}

          {rest.length > 0 && (
            <>
              {!query && (
                <li className="mt-1 border-t border-border px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  All timezones
                </li>
              )}
              {rest.map((tz) => (
                <li key={tz} role="option" aria-selected={tz === value}>
                  <TimezoneOption
                    tz={tz}
                    selected={tz === value}
                    onSelect={selectTimezone}
                  />
                </li>
              ))}
            </>
          )}
        </ul>
      )}
    </div>
  );
}
