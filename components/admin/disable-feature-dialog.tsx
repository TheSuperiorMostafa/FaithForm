"use client";

import { useState } from "react";

import { Check, Eye } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  describeDisabledFeature,
  DISABLED_REASON_OPTIONS,
  type DisabledReason,
} from "@/lib/features/disabled-reason";
import { cn } from "@/lib/utils";

type DisableFeatureDialogProps = {
  featureLabel: string;
  churchName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: DisabledReason, note: string | null) => void;
};

/**
 * Asks why before switching a feature off.
 *
 * The church is going to read whatever is chosen here in place of the feature,
 * so the preview is not decoration — it is the actual text they will see.
 */
export function DisableFeatureDialog({
  featureLabel,
  churchName,
  open,
  onOpenChange,
  onConfirm,
}: DisableFeatureDialogProps) {
  const [reason, setReason] = useState<DisabledReason>(
    "temporarily_unavailable",
  );
  const [note, setNote] = useState("");

  const trimmedNote = note.trim();
  const needsNote = reason === "custom" && !trimmedNote;

  const preview = describeDisabledFeature(featureLabel, {
    reason,
    note: trimmedNote || null,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Turn off {featureLabel}</DialogTitle>
          <DialogDescription>
            {churchName} will see this instead of {featureLabel}.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-6 py-5">
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-semibold">Reason</legend>
            {DISABLED_REASON_OPTIONS.map((option) => {
              const active = reason === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setReason(option.value)}
                  className={cn(
                    "group flex items-start gap-3 rounded-xl border p-3.5 text-left transition-all",
                    active
                      ? "border-accent bg-accent/10 shadow-card"
                      : "border-border hover:border-accent/50 hover:bg-accent/5",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors",
                      active
                        ? "border-accent bg-accent text-accent-foreground"
                        : "border-input bg-background",
                    )}
                  >
                    {active && <Check className="size-3" strokeWidth={3} />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-foreground">
                      {option.label}
                    </span>
                    <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                      {option.hint}
                    </span>
                  </span>
                </button>
              );
            })}
          </fieldset>

          {reason === "custom" && (
            <div className="space-y-2">
              <Label htmlFor="disabled-note">What should they see?</Label>
              <Textarea
                id="disabled-note"
                value={note}
                rows={3}
                onChange={(e) => setNote(e.target.value)}
                placeholder="We've paused this while we migrate your records. Back on Monday."
              />
            </div>
          )}

          {/*
            Not decoration — this is the exact copy the church will read in
            place of the feature, so it updates as the reason changes.
          */}
          <div className="overflow-hidden rounded-xl border border-border">
            <p className="flex items-center gap-1.5 border-b border-border bg-muted/50 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              <Eye className="size-3.5" strokeWidth={2} aria-hidden />
              What {churchName} sees
            </p>
            <div className="bg-card px-4 py-5 text-center">
              <p className="font-heading text-base font-bold text-foreground">
                {preview.title}
              </p>
              <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-muted-foreground">
                {preview.message}
              </p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={needsNote}
            onClick={() => onConfirm(reason, trimmedNote || null)}
          >
            Turn off {featureLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
