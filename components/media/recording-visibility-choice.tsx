"use client";

import type { ReactNode } from "react";
import { CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

/** One publication control shared by upcoming services and recording review. */
export function RecordingVisibilityChoice({ checked, onChange, label, hint, icon, disabled }: {
  checked: boolean; onChange: (value: boolean) => void; label: string;
  hint?: string; icon?: ReactNode; disabled?: boolean;
}) {
  return <label className={cn(
    "relative flex min-h-14 cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors focus-within:ring-2 focus-within:ring-ring has-[:disabled]:cursor-default has-[:disabled]:opacity-70 motion-reduce:transition-none",
    checked ? "border-accent/60 bg-accent/5" : "border-border bg-background hover:border-accent/40",
  )}>
    <input type="checkbox" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} className="peer sr-only" />
    <span aria-hidden className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors", checked ? "border-accent bg-accent text-accent-foreground" : "border-muted-foreground/40 bg-card")}>
      {checked ? <CheckCircle2 className="size-3.5" /> : null}
    </span>
    <span className="flex min-w-0 flex-col gap-1"><span className="inline-flex items-center gap-2 text-[15px] font-medium">{icon}{label}</span>{hint ? <span className="text-sm leading-relaxed text-muted-foreground">{hint}</span> : null}</span>
  </label>;
}
