"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DatePicker, TimePicker } from "@/components/ui/date-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { PlanTime, TimeKind } from "@/lib/service-plans/types";

export type DraftPlanTime = { key: string; kind: TimeKind; label: string; date: string; time: string };

/** A plan time's local date and clock time in the church's zone. */
export function localParts(iso: string, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

export function PlanTimesDialog({
  open,
  onOpenChange,
  times,
  planDate,
  timeZone,
  onSave,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  times: PlanTime[];
  planDate: string | null;
  timeZone: string;
  onSave: (times: DraftPlanTime[]) => void;
  pending: boolean;
}) {
  const [draft, setDraft] = useState<DraftPlanTime[]>([]);
  useEffect(() => {
    if (open) {
      setDraft(times.map((t) => ({ key: t.id, kind: t.kind, label: t.label, ...localParts(t.startsAt, timeZone) })));
    }
  }, [open, times, timeZone]);
  const update = (key: string, patch: Partial<DraftPlanTime>) =>
    setDraft((all) => all.map((t) => (t.key === key ? { ...t, ...patch } : t)));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Service times</DialogTitle>
          <DialogDescription>
            Several service times share one order. Start times follow the time you pick above the plan.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-auto space-y-3 overflow-y-auto px-6 py-5">
          {draft.map((t) => (
            <div key={t.key} className="grid gap-3 rounded-2xl border border-border p-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={`pt-label-${t.key}`}>Label</Label>
                <Input id={`pt-label-${t.key}`} value={t.label} maxLength={60} onChange={(e) => update(t.key, { label: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`pt-kind-${t.key}`}>Kind</Label>
                <Select id={`pt-kind-${t.key}`} value={t.kind} onChange={(e) => update(t.key, { kind: e.target.value as TimeKind })}>
                  <option value="service">Service</option>
                  <option value="rehearsal">Rehearsal</option>
                  <option value="other">Other</option>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`pt-date-${t.key}`}>Date</Label>
                <DatePicker id={`pt-date-${t.key}`} value={t.date} onChange={(v) => update(t.key, { date: v })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`pt-time-${t.key}`}>Time</Label>
                <TimePicker id={`pt-time-${t.key}`} value={t.time} onChange={(v) => update(t.key, { time: v })} step={15} />
              </div>
              <Button
                type="button"
                variant="ghost"
                className="w-fit sm:col-span-2"
                onClick={() => setDraft((all) => all.filter((x) => x.key !== t.key))}
              >
                <Trash2 aria-hidden />
                Remove {t.label || "this time"}
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              setDraft((all) => [
                ...all,
                {
                  key: crypto.randomUUID(),
                  kind: "service",
                  label: "Service",
                  date: all.at(-1)?.date ?? planDate ?? new Date().toISOString().slice(0, 10),
                  time: "11:00",
                },
              ])
            }
          >
            <Plus aria-hidden />
            Add a time
          </Button>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={pending} onClick={() => onSave(draft)}>
            {pending ? "Saving…" : "Save times"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
