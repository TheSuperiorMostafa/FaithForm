"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { apiRequest } from "@/components/sermon-media/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  describeSchedule,
  timeZoneLabel,
  WEEKDAYS,
  type SettingsResponse,
  type StudioSettings,
} from "@/components/clips/format";
import { cn } from "@/lib/utils";

const PER_DAY = [
  { value: "1", label: "1 a day" },
  { value: "2", label: "2 a day" },
  { value: "3", label: "3 a day" },
] as const;

const PER_SERVICE = ["0", "1", "2", "3", "4", "5", "6"].map((value) => ({ value, label: value }));

/**
 * When approved clips post, and what FaithForm does on its own after each
 * service. Church administrators can change it; everyone else can read it.
 */
export function ScheduleDialog({
  open,
  onOpenChange,
  fallbackTimezone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fallbackTimezone: string;
}) {
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [draft, setDraft] = useState<StudioSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    const result = await apiRequest<SettingsResponse>("/api/sermon-media/settings", {}, "We couldn't load your posting schedule.");
    if (result.ok) {
      setData(result.data);
      setDraft(result.data.settings);
    } else {
      setLoadError(result.error);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setSaveError(null);
    void load();
  }, [open, load]);

  const canEdit = Boolean(data?.canEdit);
  const timezone = data?.timezone || fallbackTimezone;
  const schedule = draft?.postSchedule;
  const noDays = Boolean(schedule && schedule.days.length === 0);

  const update = (patch: Partial<StudioSettings>) => setDraft((current) => (current ? { ...current, ...patch } : current));
  const toggleDay = (day: number) => {
    if (!schedule) return;
    const days = schedule.days.includes(day) ? schedule.days.filter((d) => d !== day) : [...schedule.days, day].sort((a, b) => a - b);
    update({ postSchedule: { ...schedule, days } });
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft || !canEdit || saving) return;
    if (noDays) {
      setSaveError("Choose at least one day to post.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    const result = await apiRequest<{ saved: boolean }>(
      "/api/sermon-media/settings",
      {
        method: "PATCH",
        body: {
          autoClips: draft.autoClips,
          clipsPerService: draft.clipsPerService,
          autoConfirmRange: draft.autoConfirmRange,
          postSchedule: draft.postSchedule,
        },
      },
      "We couldn't save your posting schedule. Please try again.",
    );
    setSaving(false);
    if (!result.ok) {
      setSaveError(result.error);
      return;
    }
    toast.success(`Saved your posting schedule. Approved clips post ${describeSchedule(draft.postSchedule).replace(/^./, (c) => c.toLowerCase())}`);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl" aria-labelledby="clips-schedule-title">
        <form onSubmit={save} className="flex min-h-0 flex-auto flex-col">
          <DialogHeader className="pr-16">
            <DialogTitle id="clips-schedule-title">Posting schedule</DialogTitle>
            <DialogDescription className="text-[15px]">
              Approved clips post to Facebook at these times, one after another. Times are in your church&apos;s time zone
              {data ? `: ${timeZoneLabel(timezone)}` : ""}.
            </DialogDescription>
          </DialogHeader>

          <div className="flex min-h-0 flex-auto flex-col gap-6 overflow-y-auto overscroll-contain px-6 py-5">
            {loadError && !draft ? (
              <ErrorState compact description={loadError} onRetry={() => void load()} />
            ) : !draft || !schedule ? (
              <SkeletonContainer label="posting schedule" className="flex flex-col gap-6">
                <div className="flex flex-col gap-2">
                  <span className="text-[15px] font-medium">Days</span>
                  <div className="flex flex-wrap gap-2" aria-hidden>
                    {WEEKDAYS.map((day) => (
                      <Skeleton key={day.value} className="min-h-11 w-[3.75rem] rounded-[10px]" />
                    ))}
                  </div>
                </div>
                <Skeleton className="min-h-11 w-40 rounded-[10px]" />
                <Skeleton className="min-h-11 w-64 rounded-xl" />
                <Skeleton className="h-28 w-full rounded-xl" />
              </SkeletonContainer>
            ) : (
              <>
                {!canEdit ? (
                  <p className="rounded-xl bg-muted px-4 py-3 text-[15px]">Only a church administrator can change the schedule.</p>
                ) : null}

                <fieldset className="flex flex-col gap-2" disabled={!canEdit}>
                  <legend className="mb-2 text-[15px] font-medium">Days</legend>
                  <div className="flex flex-wrap gap-2">
                    {WEEKDAYS.map((day) => {
                      const on = schedule.days.includes(day.value);
                      return (
                        <button
                          key={day.value}
                          type="button"
                          aria-pressed={on}
                          aria-label={day.long}
                          onClick={() => toggleDay(day.value)}
                          className={cn(
                            "inline-flex min-h-11 min-w-[3.75rem] items-center justify-center rounded-[10px] border px-3 text-[15px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60",
                            on ? "border-accent bg-accent text-accent-foreground" : "border-border bg-background text-foreground hover:bg-accent/10",
                          )}
                        >
                          {day.short}
                        </button>
                      );
                    })}
                  </div>
                  {noDays ? <p className="text-sm text-destructive">Choose at least one day.</p> : null}
                </fieldset>

                <div className="flex flex-col gap-2">
                  <Label htmlFor="clips-post-time" className="text-[15px] font-medium">
                    Time
                  </Label>
                  <Input
                    id="clips-post-time"
                    type="time"
                    required
                    step={300}
                    value={schedule.time}
                    disabled={!canEdit}
                    onChange={(event) => {
                      const time = event.target.value.slice(0, 5);
                      if (/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) update({ postSchedule: { ...schedule, time } });
                    }}
                    className="min-h-11 w-40"
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <span className="text-[15px] font-medium">
                    Clips a day
                  </span>
                  <SegmentedControl
                    label="Clips a day"
                    value={String(schedule.per_day) as "1" | "2" | "3"}
                    options={PER_DAY}
                    onChange={(value) => canEdit && update({ postSchedule: { ...schedule, per_day: Number(value) } })}
                  />
                  {schedule.per_day > 1 ? <p className="text-sm text-muted-foreground">More than one a day post 4 hours apart.</p> : null}
                </div>

                <p className="rounded-xl bg-accent/[0.08] px-4 py-3 text-[15px]">{describeSchedule(schedule)}</p>

                <section aria-labelledby="clips-auto-heading" className="flex flex-col gap-4 border-t border-border pt-5">
                  <h3 id="clips-auto-heading" className="font-heading text-lg font-semibold">
                    After each service
                  </h3>
                  <div className="flex items-start justify-between gap-4">
                    <Label htmlFor="clips-auto" className="flex flex-col items-start gap-0.5 text-[15px] font-medium">
                      Prepare clips automatically
                      <span className="text-sm font-normal text-muted-foreground">
                        FaithForm makes clips once the transcript is ready. Nothing posts until you approve it.
                      </span>
                    </Label>
                    <Switch id="clips-auto" checked={draft.autoClips} disabled={!canEdit} onCheckedChange={(autoClips) => update({ autoClips })} />
                  </div>
                  {draft.autoClips ? (
                    <div className="flex flex-col gap-2">
                      <span className="text-[15px] font-medium">How many clips from each service</span>
                      <SegmentedControl
                        label="How many clips from each service"
                        value={String(draft.clipsPerService)}
                        options={PER_SERVICE}
                        onChange={(value) => canEdit && update({ clipsPerService: Number(value) })}
                      />
                    </div>
                  ) : null}
                  <div className="flex items-start justify-between gap-4">
                    <Label htmlFor="clips-auto-range" className="flex flex-col items-start gap-0.5 text-[15px] font-medium">
                      Find the sermon automatically
                      <span className="text-sm font-normal text-muted-foreground">
                        When FaithForm is sure where the sermon starts and ends. Otherwise it asks you on the transcript.
                      </span>
                    </Label>
                    <Switch
                      id="clips-auto-range"
                      checked={draft.autoConfirmRange}
                      disabled={!canEdit}
                      onCheckedChange={(autoConfirmRange) => update({ autoConfirmRange })}
                    />
                  </div>
                </section>
              </>
            )}
          </div>

          {saveError ? (
            <p role="alert" className="mx-6 mb-1 shrink-0 rounded-xl bg-destructive/[0.06] px-4 py-3 text-[15px]">
              {saveError}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {canEdit ? "Cancel" : "Close"}
            </Button>
            {canEdit ? (
              <Button type="submit" disabled={!draft || saving || noDays}>
                {saving ? "Saving…" : "Save schedule"}
              </Button>
            ) : null}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
