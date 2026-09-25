"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The pieces the check-in setup screens are built from: a numbered step that
 * shows a one-line summary when closed and its editor when open, a segmented
 * choice, and a small status chip.
 */

export type StepTone = "done" | "todo" | "attention";

export function SetupStep({
  number,
  title,
  summary,
  tone,
  open,
  onToggle,
  actionLabel,
  children,
  id,
}: {
  number: number;
  title: string;
  /** One line that says what is set, or what is missing. */
  summary: ReactNode;
  tone: StepTone;
  open: boolean;
  onToggle: () => void;
  actionLabel: string;
  children: ReactNode;
  id: string;
}) {
  const panelId = `${id}-panel`;
  return (
    <section
      id={id}
      className={cn(
        "scroll-mt-24 rounded-2xl border bg-card shadow-card transition-colors dark:shadow-none",
        open ? "border-brand-gold/50" : "border-border",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex min-h-16 w-full items-center gap-4 rounded-2xl p-5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-6"
      >
        <span
          aria-hidden
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-bold",
            tone === "done"
              ? "bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300"
              : tone === "attention"
                ? "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
                : "bg-muted text-muted-foreground",
          )}
        >
          {tone === "done" ? <Check className="size-4" strokeWidth={2.5} /> : number}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="font-heading text-lg font-semibold text-foreground">
            {title}
            <span className="sr-only">
              {tone === "done" ? " (done)" : tone === "attention" ? " (needs attention)" : " (to do)"}
            </span>
          </span>
          <span className="text-[15px] text-muted-foreground">{summary}</span>
        </span>
        <span className="hidden shrink-0 text-[15px] font-semibold text-accent sm:inline">
          {open ? "Close" : actionLabel}
        </span>
        <ChevronDown
          aria-hidden
          className={cn(
            "size-5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open ? (
        <div id={panelId} className="border-t border-border px-5 pb-6 pt-5 sm:px-6">
          {children}
        </div>
      ) : null}
    </section>
  );
}

/**
 * One choice from a short list, as a row of buttons. A radio group to
 * assistive technology, with the arrow keys moving between choices.
 */
export function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string;
  options: { value: T; label: string; hint?: string }[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const delta =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (!delta) return;
    event.preventDefault();
    const next = (index + delta + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex max-w-full flex-wrap gap-1 rounded-xl border border-border bg-muted p-1"
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={String(option.value)}
            ref={(element) => {
              refs.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              "flex min-h-11 flex-col items-center justify-center rounded-lg px-4 py-1.5 text-[15px] font-semibold leading-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
              selected
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-background hover:text-foreground",
            )}
          >
            {option.label}
            {option.hint ? (
              <span
                className={cn(
                  "text-sm font-medium",
                  selected ? "text-primary-foreground/80" : "text-accent",
                )}
              >
                {option.hint}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function StatusChip({
  tone,
  children,
}: {
  tone: "good" | "warn" | "muted" | "info";
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-sm font-semibold",
        tone === "good" && "bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300",
        tone === "warn" && "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
        tone === "info" && "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300",
        tone === "muted" && "bg-muted text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}
