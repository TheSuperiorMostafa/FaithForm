"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  EVENT_REPEAT_FREQUENCIES,
  EVENT_REPEAT_WEEKDAYS,
  eventRepeatStartWeekday,
  type CustomEventRepeat,
  type EventRepeat,
} from "@/lib/announcements/recurrence";

const selectClassName = "h-11 w-full rounded-xl border border-input bg-background px-3 text-base";

export function EventRepeatFields({
  id, repeat, until, custom, startDate, onRepeat, onUntil, onCustom,
}: {
  id: string;
  repeat: EventRepeat;
  until: string;
  custom: CustomEventRepeat;
  startDate: string;
  onRepeat: (value: EventRepeat) => void;
  onUntil: (value: string) => void;
  onCustom: (value: CustomEventRepeat) => void;
}) {
  const frequency = EVENT_REPEAT_FREQUENCIES.find(({ value }) => value === custom.frequency)!;
  const startDay = eventRepeatStartWeekday(startDate);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="min-w-0 space-y-2">
          <Label htmlFor={`${id}-repeat`}>Repeat</Label>
          <select
            id={`${id}-repeat`}
            value={repeat}
            onChange={(event) => onRepeat(event.target.value as EventRepeat)}
            className={selectClassName}
          >
            <option value="none">Does not repeat</option>
            {EVENT_REPEAT_FREQUENCIES.map(({ value, label }) => (
              <option key={value} value={value}>{label}</option>
            ))}
            <option value="custom">Custom…</option>
          </select>
        </div>
        {repeat !== "none" && (
          <div className="min-w-0 space-y-2">
            <Label htmlFor={`${id}-until`}>Last date</Label>
            <Input
              id={`${id}-until`}
              type="date"
              required
              min={startDate || undefined}
              value={until}
              onChange={(event) => onUntil(event.target.value)}
            />
          </div>
        )}
      </div>

      {repeat === "custom" && (
        <fieldset className="min-w-0 space-y-4 rounded-xl border border-border px-4 pb-4">
          <legend className="px-1 text-sm font-medium">Custom repeat</legend>
          <div className="space-y-2">
            <Label htmlFor={`${id}-frequency`}>Frequency</Label>
            <select
              id={`${id}-frequency`}
              className={selectClassName}
              value={custom.frequency}
              onChange={(event) => onCustom({
                ...custom,
                frequency: event.target.value as CustomEventRepeat["frequency"],
              })}
            >
              {EVENT_REPEAT_FREQUENCIES.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor={`${id}-interval`}>Every</Label>
            <Input
              id={`${id}-interval`}
              type="number"
              inputMode="numeric"
              min={1}
              required
              aria-label={`Repeat every this many ${frequency.unit}s`}
              className="w-24"
              value={custom.interval ?? ""}
              onChange={(event) => onCustom({
                ...custom,
                interval: event.target.value === "" ? null : event.target.valueAsNumber,
              })}
            />
            <span className="text-sm">{frequency.unit}{custom.interval === 1 ? "" : "s"}</span>
          </div>
          {custom.frequency === "weekly" && (
            <fieldset className="min-w-0 space-y-2">
              <legend className="text-sm font-medium">Repeat on</legend>
              <div className="flex flex-wrap gap-2">
                {EVENT_REPEAT_WEEKDAYS.map(({ code, label }) => {
                  const isStartDay = code === startDay;
                  const selected = isStartDay || custom.weekdays.includes(code);
                  return (
                    <label
                      key={code}
                      className="relative flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-input px-1.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-primary-foreground has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
                    >
                      <input
                        type="checkbox"
                        className="sr-only"
                        aria-label={label}
                        disabled={isStartDay}
                        checked={selected}
                        onChange={(event) => onCustom({
                          ...custom,
                          weekdays: event.target.checked
                            ? [...custom.weekdays, code]
                            : custom.weekdays.filter((day) => day !== code),
                        })}
                      />
                      <span aria-hidden="true">{label.slice(0, 3)}</span>
                    </label>
                  );
                })}
              </div>
              <p className="text-sm text-muted-foreground">The event’s start day is included.</p>
            </fieldset>
          )}
        </fieldset>
      )}
    </div>
  );
}
