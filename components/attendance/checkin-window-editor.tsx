"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { saveCheckinPolicy } from "@/app/dashboard/attendance/setup/actions";
import type { AttendanceSetupPolicy } from "@/lib/attendance/v2/setup";
import {
  ACCURACY_CHOICES,
  ARRIVAL_CHOICES,
  CLOSES_AFTER_CHOICES,
  OPENS_BEFORE_CHOICES,
  RECOMMENDED_ARRIVAL_SECONDS,
  RECOMMENDED_CLOSES_AFTER,
  RECOMMENDED_OPENS_BEFORE,
  checkinWindow,
  clockMinutes,
  formatClock,
  minutesPhrase,
  nearestChoice,
  withCurrentChoice,
} from "@/lib/attendance/v2/setup-view";
import { Segmented } from "@/components/attendance/setup-step";
import { AdvancedSection } from "@/components/ui/advanced-section";
import { Button } from "@/components/ui/button";

type WindowDraft = {
  opensBefore: number;
  closesAfter: number;
  /** 0 means counted on arrival, with no wait. */
  dwellSeconds: number;
  accuracy: number;
};

function draftOf(policy: AttendanceSetupPolicy): WindowDraft {
  return {
    opensBefore: policy.checkinOpensMinutesBefore,
    closesAfter: policy.checkinClosesMinutesAfter,
    dwellSeconds: policy.requiresConfirmation ? policy.minDwellSeconds : 0,
    accuracy: policy.maxLocationAccuracyM,
  };
}

/**
 * When check-in is open around each service, and what counts as arriving.
 *
 * Shown against one of the church's own services, on a timeline, because
 * "30 minutes before" means nothing until it reads "opens 9:30 AM". The
 * recommended choices are marked; nothing else needs deciding.
 *
 * Saves only these fields. The on/off switches for each way of checking in
 * save themselves, so a half-finished edit here never rides along with them.
 */
export function CheckinWindowEditor({
  policy,
  sample,
  isAdmin,
  onSaved,
  showPhoneOptions = true,
}: {
  policy: AttendanceSetupPolicy;
  /**
   * How a phone's arrival is counted only matters with phone check-in on.
   * Hidden otherwise; the saved values are kept as they are.
   */
  showPhoneOptions?: boolean;
  /** A service to show the window against — the church's first, when it has one. */
  sample: { label: string; startTime: string; endTime: string | null } | null;
  isAdmin: boolean;
  onSaved: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<WindowDraft>(() => draftOf(policy));
  const dirty = JSON.stringify(draft) !== JSON.stringify(draftOf(policy));

  const service = sample ?? { label: "A 10 AM service", startTime: "10:00", endTime: "11:30" };
  const hours = checkinWindow({
    startTime: service.startTime,
    endTime: service.endTime,
    opensMinutesBefore: draft.opensBefore,
    closesMinutesAfter: draft.closesAfter,
  });
  const start = clockMinutes(hours.starts) ?? 0;
  const end = clockMinutes(hours.ends) ?? start + 90;
  const duration = end > start ? end - start : end + 1440 - start;

  const save = () => {
    startTransition(async () => {
      const result = await saveCheckinPolicy({
        geofenceEnabled: policy.geofenceEnabled,
        qrEnabled: policy.qrEnabled,
        kioskEnabled: policy.kioskEnabled,
        checkinOpensMinutesBefore: draft.opensBefore,
        checkinClosesMinutesAfter: draft.closesAfter,
        requiresConfirmation: draft.dwellSeconds > 0,
        minDwellSeconds: draft.dwellSeconds,
        maxLocationAccuracyM: draft.accuracy,
      });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success(
        `Check-in now opens ${draft.opensBefore === 0 ? "at the start" : `${minutesPhrase(draft.opensBefore)} before`} and closes ${draft.closesAfter === 0 ? "at the end" : `${minutesPhrase(draft.closesAfter)} after`}, from the next service.`,
      );
      onSaved();
    });
  };

  const opensOptions = withCurrentChoice(OPENS_BEFORE_CHOICES, draft.opensBefore).map((minutes) => ({
    value: minutes,
    label: minutes === 0 ? "At start" : minutesPhrase(minutes),
    hint: minutes === RECOMMENDED_OPENS_BEFORE ? "Best" : undefined,
  }));
  const closesOptions = withCurrentChoice(CLOSES_AFTER_CHOICES, draft.closesAfter).map((minutes) => ({
    value: minutes,
    label: minutes === 0 ? "At end" : minutesPhrase(minutes),
    hint: minutes === RECOMMENDED_CLOSES_AFTER ? "Best" : undefined,
  }));
  const arrivalValues: number[] = ARRIVAL_CHOICES.map((choice) => choice.seconds);
  const arrivalOptions = withCurrentChoice(arrivalValues, draft.dwellSeconds).map((seconds) => ({
    value: seconds,
    label:
      ARRIVAL_CHOICES.find((choice) => choice.seconds === seconds)?.label ??
      `${Math.round(seconds / 60)} min`,
    hint: seconds === RECOMMENDED_ARRIVAL_SECONDS ? "Best" : undefined,
  }));

  return (
    <div className="flex flex-col gap-6">
      <figure className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4">
        <figcaption className="text-sm font-semibold text-muted-foreground">
          {sample ? `Every week for ${service.label}` : "For example, a 10 AM service"}
        </figcaption>
        <div
          className="flex h-3 w-full overflow-hidden rounded-full bg-muted"
          role="img"
          aria-label={`Check-in opens at ${formatClock(hours.opens)}, the service runs ${formatClock(hours.starts)} to ${formatClock(hours.ends)}, and check-in closes at ${formatClock(hours.closes)}.`}
        >
          <span style={{ flexGrow: draft.opensBefore }} className="bg-brand-gold/45" />
          <span style={{ flexGrow: Math.max(duration, 1) }} className="bg-primary" />
          <span style={{ flexGrow: draft.closesAfter }} className="bg-brand-gold/45" />
        </div>
        <div className="grid grid-cols-3 gap-2 text-sm">
          <span className="flex flex-col">
            <span className="text-muted-foreground">Check-in opens</span>
            <span className="text-base font-semibold tabular-nums text-foreground">
              {formatClock(hours.opens)}
            </span>
          </span>
          <span className="flex flex-col items-center text-center">
            <span className="text-muted-foreground">Service</span>
            <span className="text-base font-semibold tabular-nums text-foreground">
              {formatClock(hours.starts)} – {formatClock(hours.ends)}
            </span>
          </span>
          <span className="flex flex-col items-end text-right">
            <span className="text-muted-foreground">Check-in closes</span>
            <span className="text-base font-semibold tabular-nums text-foreground">
              {formatClock(hours.closes)}
            </span>
          </span>
        </div>
      </figure>

      <fieldset disabled={!isAdmin || pending} className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <span className="text-[15px] font-semibold text-foreground">Check-in opens before the service</span>
          <Segmented
            label="Check-in opens before the service"
            options={opensOptions}
            value={draft.opensBefore}
            onChange={(opensBefore) => setDraft({ ...draft, opensBefore })}
            disabled={!isAdmin || pending}
          />
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-[15px] font-semibold text-foreground">Check-in closes after the service</span>
          <Segmented
            label="Check-in closes after the service"
            options={closesOptions}
            value={draft.closesAfter}
            onChange={(closesAfter) => setDraft({ ...draft, closesAfter })}
            disabled={!isAdmin || pending}
          />
          {draft.opensBefore + draft.closesAfter === 0 ? (
            <p className="text-sm text-amber-700 dark:text-amber-300">
              Check-in has to be open for some time around the service.
            </p>
          ) : null}
        </div>

        {showPhoneOptions ? (
          <div className="flex flex-col gap-2">
            <span className="text-[15px] font-semibold text-foreground">
              When a phone arrives, count them
            </span>
            <Segmented
              label="When a phone arrives, count them"
              options={arrivalOptions}
              value={draft.dwellSeconds}
              onChange={(dwellSeconds) => setDraft({ ...draft, dwellSeconds })}
              disabled={!isAdmin || pending}
            />
            <p className="text-sm text-muted-foreground">
              {draft.dwellSeconds === 0
                ? "Right away counts someone as soon as their phone shows they're at church during check-in, with no tap needed. This can include someone dropping another person off."
                : "After this wait, their phone asks them to confirm they're attending, and they're counted when they tap Check in."}
            </p>
          </div>
        ) : null}

        {showPhoneOptions ? (
          <AdvancedSection
            title="How exact a phone's location must be"
            description="Standard suits almost every church."
          >
            <div className="flex flex-col gap-2">
              <Segmented
                label="How exact a phone's location must be"
                options={ACCURACY_CHOICES.map((choice) => ({
                  value: choice.meters as number,
                  label: choice.label,
                }))}
                value={nearestChoice(
                  ACCURACY_CHOICES.map((choice) => choice.meters),
                  draft.accuracy,
                )}
                onChange={(accuracy) => setDraft({ ...draft, accuracy })}
                disabled={!isAdmin || pending}
              />
              <p className="text-sm text-muted-foreground">
                A phone indoors is often less exact. A reading less exact than
                this isn&apos;t used.
              </p>
            </div>
          </AdvancedSection>
        ) : null}
      </fieldset>

      {isAdmin ? (
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={save}
            disabled={pending || !dirty || draft.opensBefore + draft.closesAfter === 0}
          >
            {pending ? "Saving…" : "Save check-in times"}
          </Button>
          {dirty ? (
            <Button variant="ghost" onClick={() => setDraft(draftOf(policy))} disabled={pending}>
              Undo changes
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
