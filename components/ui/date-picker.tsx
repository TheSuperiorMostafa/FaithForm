"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  addMonths,
  buildMonthGridCells,
  formatMonthYear,
  getWeekdayLabels,
  startOfDay,
} from "@/lib/utils/calendar";
import { cn } from "@/lib/utils";

type DatePickerProps = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
};

function parseYmd(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return null;
  const date = new Date(y, m - 1, d);
  if (
    date.getFullYear() !== y ||
    date.getMonth() !== m - 1 ||
    date.getDate() !== d
  ) {
    return null;
  }
  return date;
}

function toYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatDisplay(value: string): string {
  const date = parseYmd(value);
  if (!date) return "Pick a date";
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function DatePicker({
  id,
  value,
  onChange,
  disabled,
  className,
}: DatePickerProps) {
  const autoId = useId();
  const triggerId = id ?? autoId;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const selected = parseYmd(value);
  const initial = selected ?? new Date();
  const [viewYear, setViewYear] = useState(initial.getFullYear());
  const [viewMonth, setViewMonth] = useState(initial.getMonth());

  useEffect(() => {
    if (!open) return;
    const next = parseYmd(value) ?? new Date();
    setViewYear(next.getFullYear());
    setViewMonth(next.getMonth());
  }, [open, value]);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const cells = buildMonthGridCells(viewYear, viewMonth);
  const weekdays = getWeekdayLabels();
  const selectedKey = selected ? startOfDay(selected).getTime() : null;
  const todayKey = startOfDay(new Date()).getTime();

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <Button
        id={triggerId}
        type="button"
        variant="outline"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="w-full justify-start font-normal"
        onClick={() => setOpen((prev) => !prev)}
      >
        <CalendarIcon className="size-4 text-muted-foreground" />
        <span className={cn(!selected && "text-muted-foreground")}>
          {formatDisplay(value)}
        </span>
      </Button>

      {open && (
        <div
          role="dialog"
          aria-label="Choose sermon date"
          className="absolute left-0 z-50 mt-2 w-[min(100%,20rem)] rounded-xl border border-border bg-background p-3 shadow-lg"
        >
          <div className="mb-3 flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Previous month"
              onClick={() => {
                const next = addMonths(viewYear, viewMonth, -1);
                setViewYear(next.year);
                setViewMonth(next.monthIndex);
              }}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <p className="text-sm font-semibold">
              {formatMonthYear(viewYear, viewMonth)}
            </p>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Next month"
              onClick={() => {
                const next = addMonths(viewYear, viewMonth, 1);
                setViewYear(next.year);
                setViewMonth(next.monthIndex);
              }}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>

          <div className="mb-1 grid grid-cols-7 gap-1">
            {weekdays.map((label) => (
              <div
                key={label}
                className="py-1 text-center text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
              >
                {label.slice(0, 2)}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {cells.map((cell) => {
              const key = startOfDay(cell.date).getTime();
              const isSelected = selectedKey === key;
              const isToday = todayKey === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    onChange(toYmd(cell.date));
                    setOpen(false);
                  }}
                  className={cn(
                    "flex size-9 items-center justify-center rounded-lg text-sm transition-colors",
                    !cell.isCurrentMonth && "text-muted-foreground/50",
                    cell.isCurrentMonth && "text-foreground hover:bg-accent/15",
                    isToday && !isSelected && "ring-1 ring-accent/60",
                    isSelected &&
                      "bg-accent font-semibold text-accent-foreground hover:bg-accent",
                  )}
                >
                  {cell.dayOfMonth}
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex justify-between gap-2 border-t border-border pt-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                onChange(toYmd(new Date()));
                setOpen(false);
              }}
            >
              Today
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
            >
              Close
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
