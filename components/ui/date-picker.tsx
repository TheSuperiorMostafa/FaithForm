"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  addMonths,
  buildMonthGridCells,
  formatMonthYear,
  getWeekdayLabels,
  startOfDay,
} from "@/lib/utils/calendar";
import { cn } from "@/lib/utils";

/*
 * FaithForm's one date picker and its matching time picker.
 *
 * Every date or time a church chooses in the dashboard uses these, so the
 * sermon date, a donation's date and an event's start time all look and work
 * the same way. They hold the same string a native input would ("YYYY-MM-DD",
 * "HH:mm", "YYYY-MM-DDTHH:mm"), and with `name` they post that string with
 * their form through a hidden input, so they drop into server-action forms.
 *
 * The popover is positioned `fixed` from the trigger's rectangle: inside a
 * modal <dialog> with a scrolling body, an absolutely positioned panel would
 * be clipped by the scroll owner.
 */

function parseYmd(value: string | undefined | null): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return null;
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) {
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

function formatDateDisplay(value: string): string | null {
  const date = parseYmd(value);
  if (!date) return null;
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function parseHm(value: string | undefined | null): { h: number; m: number } | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(value ?? "");
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return { h, m };
}

function toHm(h: number, m: number): string {
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function formatTimeDisplay(value: string): string | null {
  const parsed = parseHm(value);
  if (!parsed) return null;
  const date = new Date(2000, 0, 1, parsed.h, parsed.m);
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** Keep a controlled or uncontrolled string value, like a native input. */
function useFieldValue(
  value: string | undefined,
  defaultValue: string | undefined,
  onChange: ((value: string) => void) | undefined,
): [string, (next: string) => void] {
  const [inner, setInner] = useState(defaultValue ?? "");
  const controlled = value !== undefined;
  const current = controlled ? value : inner;
  const set = useCallback(
    (next: string) => {
      if (!controlled) setInner(next);
      onChange?.(next);
    },
    [controlled, onChange],
  );
  return [current, set];
}

type PanelPosition = { top: number; left: number; width: number; maxHeight: number };

/** Opens and places a popover under (or above) its trigger, closing on outside click/Escape. */
function usePopover(panelWidth: number, panelHeight: number) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<PanelPosition | null>(null);

  const place = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const width = Math.min(panelWidth, viewportW - 16);
    const left = Math.max(8, Math.min(rect.left, viewportW - width - 8));
    const below = viewportH - rect.bottom - 8;
    const above = rect.top - 8;
    const openAbove = below < Math.min(panelHeight, 260) && above > below;
    const maxHeight = Math.max(160, (openAbove ? above : below) - 8);
    const height = Math.min(panelHeight, maxHeight);
    const top = openAbove ? rect.top - 8 - height : rect.bottom + 8;
    setPosition({ top, left, width, maxHeight });
  }, [panelWidth, panelHeight]);

  useLayoutEffect(() => {
    if (!open) return;
    place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent | TouchEvent) {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !panelRef.current?.contains(target)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        // Close the picker, not the dialog it may sit in.
        event.stopPropagation();
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, place]);

  return { open, setOpen, rootRef, triggerRef, panelRef, position };
}

function PopoverPanel({
  panelRef,
  position,
  label,
  className,
  children,
}: {
  panelRef: RefObject<HTMLDivElement | null>;
  position: PanelPosition | null;
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={label}
      style={
        position
          ? { top: position.top, left: position.left, width: position.width, maxHeight: position.maxHeight }
          : { visibility: "hidden" }
      }
      className={cn(
        "fixed z-[60] flex flex-col overflow-hidden rounded-xl border border-border bg-background p-3 shadow-lg",
        className,
      )}
    >
      {children}
    </div>
  );
}

const triggerClassName =
  "w-full justify-start gap-2 bg-muted/40 font-normal hover:bg-muted/60 aria-expanded:border-accent";

type FieldProps = {
  id?: string;
  /** Posts the value with its form through a hidden input. */
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  placeholder?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
  /** Offer a Clear button, for fields that may be left empty. */
  clearable?: boolean;
};

type DatePickerProps = FieldProps & {
  /** Earliest choosable day, "YYYY-MM-DD". */
  min?: string;
  /** Latest choosable day, "YYYY-MM-DD". */
  max?: string;
};

export function DatePicker({
  id,
  name,
  value,
  defaultValue,
  onChange,
  disabled,
  required,
  className,
  placeholder = "Pick a date",
  min,
  max,
  clearable,
  "aria-label": ariaLabel,
  "aria-describedby": describedBy,
}: DatePickerProps) {
  const autoId = useId();
  const triggerId = id ?? autoId;
  const [current, setCurrent] = useFieldValue(value, defaultValue, onChange);
  const { open, setOpen, rootRef, triggerRef, panelRef, position } = usePopover(320, 400);

  const selected = parseYmd(current);
  const initial = selected ?? new Date();
  const [viewYear, setViewYear] = useState(initial.getFullYear());
  const [viewMonth, setViewMonth] = useState(initial.getMonth());

  useEffect(() => {
    if (!open) return;
    const next = parseYmd(current) ?? parseYmd(min) ?? new Date();
    setViewYear(next.getFullYear());
    setViewMonth(next.getMonth());
  }, [open, current, min]);

  const minDate = parseYmd(min);
  const maxDate = parseYmd(max);
  const isAllowed = (date: Date) =>
    (!minDate || startOfDay(date) >= startOfDay(minDate)) &&
    (!maxDate || startOfDay(date) <= startOfDay(maxDate));

  const cells = buildMonthGridCells(viewYear, viewMonth);
  const weekdays = getWeekdayLabels();
  const selectedKey = selected ? startOfDay(selected).getTime() : null;
  const todayKey = startOfDay(new Date()).getTime();
  const display = formatDateDisplay(current);

  const choose = (next: string) => {
    setCurrent(next);
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      {name ? (
        <input
          type="text"
          name={name}
          value={current}
          required={required}
          onChange={() => {}}
          tabIndex={-1}
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-px w-full opacity-0"
          onFocus={() => triggerRef.current?.focus()}
          onInvalid={(event) => {
            event.preventDefault();
            triggerRef.current?.focus();
            setOpen(true);
          }}
        />
      ) : null}
      <Button
        ref={triggerRef}
        id={triggerId}
        type="button"
        variant="outline"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel ? `${ariaLabel}: ${display ?? "not chosen"}` : undefined}
        aria-describedby={describedBy}
        className={triggerClassName}
        onClick={() => setOpen((prev) => !prev)}
      >
        <CalendarIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className={cn("truncate tabular-nums", !display && "text-muted-foreground")}>
          {display ?? placeholder}
        </span>
      </Button>

      {open && (
        <PopoverPanel panelRef={panelRef} position={position} label={ariaLabel ?? "Choose a date"}>
          <div className="mb-3 flex shrink-0 items-center justify-between gap-2">
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
            <p className="text-sm font-semibold" aria-live="polite">
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

          <div className="mb-1 grid shrink-0 grid-cols-7 gap-1">
            {weekdays.map((label) => (
              <div
                key={label}
                className="py-1 text-center text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
              >
                {label.slice(0, 2)}
              </div>
            ))}
          </div>

          <div className="grid min-h-0 grid-cols-7 gap-1 overflow-y-auto">
            {cells.map((cell) => {
              const key = startOfDay(cell.date).getTime();
              const isSelected = selectedKey === key;
              const isToday = todayKey === key;
              const allowed = isAllowed(cell.date);
              return (
                <button
                  key={key}
                  type="button"
                  disabled={!allowed}
                  aria-pressed={isSelected}
                  aria-label={cell.date.toLocaleDateString(undefined, {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })}
                  onClick={() => choose(toYmd(cell.date))}
                  className={cn(
                    "flex aspect-square w-full items-center justify-center rounded-lg text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-35",
                    !cell.isCurrentMonth && "text-muted-foreground/50",
                    cell.isCurrentMonth && "text-foreground hover:bg-accent/15",
                    isToday && !isSelected && "ring-1 ring-accent/60",
                    isSelected && "bg-accent font-semibold text-accent-foreground hover:bg-accent",
                  )}
                >
                  {cell.dayOfMonth}
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex shrink-0 justify-between gap-2 border-t border-border pt-3">
            <div className="flex gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={!isAllowed(new Date())}
                onClick={() => choose(toYmd(new Date()))}
              >
                Today
              </Button>
              {clearable && current ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => choose("")}>
                  Clear
                </Button>
              ) : null}
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Close
            </Button>
          </div>
        </PopoverPanel>
      )}
    </div>
  );
}

type TimePickerProps = FieldProps & {
  /** Minutes between the offered times. Any time already set is still shown. */
  step?: number;
};

export function TimePicker({
  id,
  name,
  value,
  defaultValue,
  onChange,
  disabled,
  required,
  className,
  placeholder = "Pick a time",
  step = 15,
  clearable,
  "aria-label": ariaLabel,
  "aria-describedby": describedBy,
}: TimePickerProps) {
  const autoId = useId();
  const triggerId = id ?? autoId;
  const [current, setCurrent] = useFieldValue(value, defaultValue, onChange);
  const { open, setOpen, rootRef, triggerRef, panelRef, position } = usePopover(240, 360);
  const listRef = useRef<HTMLDivElement>(null);

  const parsed = parseHm(current);
  const selectedValue = parsed ? toHm(parsed.h, parsed.m) : "";
  const options: string[] = [];
  for (let minutes = 0; minutes < 24 * 60; minutes += Math.max(5, step)) {
    options.push(toHm(Math.floor(minutes / 60), minutes % 60));
  }
  if (selectedValue && !options.includes(selectedValue)) {
    options.push(selectedValue);
    options.sort();
  }

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const list = listRef.current;
      if (!list) return;
      const target =
        (selectedValue && list.querySelector<HTMLElement>(`[data-time="${selectedValue}"]`)) ||
        list.querySelector<HTMLElement>(`[data-time="09:00"]`);
      if (target) list.scrollTop = target.offsetTop - list.clientHeight / 2 + target.clientHeight / 2;
    });
    return () => cancelAnimationFrame(frame);
  }, [open, selectedValue]);

  const display = formatTimeDisplay(current);
  const choose = (next: string) => {
    setCurrent(next);
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      {name ? (
        <input
          type="text"
          name={name}
          value={selectedValue}
          required={required}
          onChange={() => {}}
          tabIndex={-1}
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-px w-full opacity-0"
          onFocus={() => triggerRef.current?.focus()}
          onInvalid={(event) => {
            event.preventDefault();
            triggerRef.current?.focus();
            setOpen(true);
          }}
        />
      ) : null}
      <Button
        ref={triggerRef}
        id={triggerId}
        type="button"
        variant="outline"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel ? `${ariaLabel}: ${display ?? "not chosen"}` : undefined}
        aria-describedby={describedBy}
        className={triggerClassName}
        onClick={() => setOpen((prev) => !prev)}
      >
        <Clock className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className={cn("truncate tabular-nums", !display && "text-muted-foreground")}>
          {display ?? placeholder}
        </span>
      </Button>

      {open && (
        <PopoverPanel panelRef={panelRef} position={position} label={ariaLabel ?? "Choose a time"}>
          <p className="mb-2 shrink-0 text-center text-sm font-semibold">Pick a time</p>
          <div ref={listRef} className="relative grid min-h-0 grid-cols-2 gap-1 overflow-y-auto pr-1">
            {options.map((option) => {
              const isSelected = option === selectedValue;
              const [h, m] = option.split(":").map(Number);
              return (
                <button
                  key={option}
                  type="button"
                  data-time={option}
                  aria-pressed={isSelected}
                  onClick={() => choose(option)}
                  className={cn(
                    "flex min-h-10 items-center justify-center rounded-lg text-sm tabular-nums transition-colors",
                    isSelected
                      ? "bg-accent font-semibold text-accent-foreground hover:bg-accent"
                      : "text-foreground hover:bg-accent/15",
                  )}
                >
                  {new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex shrink-0 justify-between gap-2 border-t border-border pt-3">
            {clearable && current ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => choose("")}>
                Clear
              </Button>
            ) : (
              <span />
            )}
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Close
            </Button>
          </div>
        </PopoverPanel>
      )}
    </div>
  );
}

/**
 * A day and a time together, replacing `<input type="datetime-local">`.
 * Holds "YYYY-MM-DDTHH:mm", or "" until both halves are chosen.
 */
export function DateTimePicker({
  id,
  name,
  value,
  defaultValue,
  onChange,
  disabled,
  required,
  className,
  min,
  "aria-label": ariaLabel,
  "aria-describedby": describedBy,
}: FieldProps & { min?: string }) {
  const [current, setCurrent] = useFieldValue(value, defaultValue, onChange);
  const [datePart, setDatePart] = useState(() => current.slice(0, 10));
  const [timePart, setTimePart] = useState(() => current.slice(11, 16));

  // Follow a controlled value changed from outside.
  useEffect(() => {
    if (value === undefined) return;
    setDatePart(value.slice(0, 10));
    setTimePart(value.slice(11, 16));
  }, [value]);

  const emit = (date: string, time: string) => {
    setDatePart(date);
    setTimePart(time);
    setCurrent(date && time ? `${date}T${time}` : "");
  };

  return (
    <div className={cn("relative grid min-w-0 grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-2", className)}>
      {name ? (
        <input
          type="text"
          name={name}
          value={datePart && timePart ? `${datePart}T${timePart}` : ""}
          required={required}
          onChange={() => {}}
          tabIndex={-1}
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-px w-full opacity-0"
        />
      ) : null}
      <DatePicker
        id={id}
        value={datePart}
        onChange={(date) => emit(date, timePart || "09:00")}
        disabled={disabled}
        min={min?.slice(0, 10)}
        aria-label={ariaLabel ? `${ariaLabel} day` : "Day"}
        aria-describedby={describedBy}
      />
      <TimePicker
        value={timePart}
        onChange={(time) => emit(datePart, time)}
        disabled={disabled}
        aria-label={ariaLabel ? `${ariaLabel} time` : "Time"}
      />
    </div>
  );
}
