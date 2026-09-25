"use client";

import { AlertTriangle } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * A medical note is the one thing on these screens that has to be impossible
 * to miss. It is a warning row in readable type, not an icon with a tooltip,
 * because a volunteer holding a toddler is not going to hover.
 */
export function MedicalNote({
  note,
  className,
}: {
  note: string | null | undefined;
  className?: string;
}) {
  if (!note?.trim()) return null;

  return (
    <p
      className={cn(
        "flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-[15px] font-semibold leading-snug text-amber-950 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-100",
        className,
      )}
    >
      <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-300" aria-hidden />
      <span>
        <span className="sr-only">Allergy or medical note: </span>
        {note}
      </span>
    </p>
  );
}

/**
 * The pickup code in type big enough to read across a desk. Digits are
 * grouped 3 + 3 the way people say them aloud.
 */
export function PickupCode({
  code,
  familyName,
  size = "lg",
}: {
  code: string;
  familyName?: string;
  size?: "lg" | "xl";
}) {
  const spaced = code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;

  return (
    <div className="flex flex-col items-center gap-2">
      <p className="text-base font-semibold text-foreground">
        {familyName ? `Pickup code for the ${familyName.replace(/^the\s+/i, "")}` : "Pickup code"}
      </p>
      <p
        className={cn(
          "rounded-2xl border-2 border-primary/20 bg-card px-6 py-3 font-mono font-bold tabular-nums tracking-[0.12em] text-primary dark:text-accent",
          size === "xl" ? "text-7xl sm:text-8xl" : "text-6xl sm:text-7xl",
        )}
        aria-label={`Pickup code ${code.split("").join(" ")}`}
      >
        {spaced}
      </p>
      <p className="max-w-md text-[15px] text-muted-foreground">
        Show this to the parent or write it down for them. They will need it
        to pick up. It stays the same all week.
      </p>
    </div>
  );
}
