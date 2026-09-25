"use client";

import { useMemo, useState, useTransition } from "react";
import { Clock, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { saveServiceTimes } from "@/app/dashboard/attendance/setup/actions";
import type { SetupCampus, SetupServiceTime } from "@/lib/attendance/v2/setup";
import {
  DAY_INITIALS,
  DAY_NAMES,
  SERVICE_TEMPLATES,
  addClockMinutes,
  checkinWindow,
  clockMinutes,
  formatClock,
  suggestServiceName,
} from "@/lib/attendance/v2/setup-view";
import { isWorshipLabel } from "@/lib/attendance/v2/sunday-worship";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

type Row = {
  key: string;
  id: string | null;
  label: string;
  /** False while the name is still the one suggested from the day and time. */
  named: boolean;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  campusId: string;
};

function toRow(service: SetupServiceTime): Row {
  return {
    key: service.id,
    id: service.id,
    label: service.label,
    named: true,
    dayOfWeek: service.dayOfWeek,
    startTime: service.startTime,
    endTime: service.endTime ?? "",
    campusId: service.campusId ?? "",
  };
}

function signature(rows: Row[]): string {
  return JSON.stringify(
    rows.map((row) => [row.id, row.label, row.dayOfWeek, row.startTime, row.endTime, row.campusId]),
  );
}

/**
 * The church's weekly services, as attendance sees them.
 *
 * The same rows the website and the phone assistant read, so a time changed
 * here changes everywhere. Check-in only ever opens around these, so each row
 * shows the window it produces with the church's current check-in rules — the
 * one thing a person setting times up actually wants to know.
 *
 * A new church starts from a template rather than an empty form; a new row
 * names itself from its day and time until someone types a name.
 */
export function ServiceScheduleEditor({
  serviceTimes,
  campuses,
  isAdmin,
  onSaved,
  opensMinutesBefore,
  closesMinutesAfter,
}: {
  serviceTimes: SetupServiceTime[];
  campuses: SetupCampus[];
  isAdmin: boolean;
  onSaved: () => void;
  opensMinutesBefore: number;
  closesMinutesAfter: number;
}) {
  const [pending, startTransition] = useTransition();
  const [rows, setRows] = useState<Row[]>(() => serviceTimes.map(toRow));
  const saved = useMemo(() => signature(serviceTimes.map(toRow)), [serviceTimes]);
  const dirty = signature(rows) !== saved;
  const multiCampus = campuses.length > 1;
  const mainCampus = campuses.find((campus) => campus.isPrimary) ?? campuses[0] ?? null;

  const update = (key: string, patch: Partial<Row>) =>
    setRows((current) =>
      current.map((row) => {
        if (row.key !== key) return row;
        const next = { ...row, ...patch };
        // A name nobody typed follows the day and time it describes.
        if (!next.named && (patch.dayOfWeek !== undefined || patch.startTime !== undefined)) {
          next.label = suggestServiceName(next.dayOfWeek, next.startTime);
        }
        // Moving the start moves an end that was set, keeping the length.
        if (patch.startTime !== undefined) {
          const start = clockMinutes(row.startTime);
          const end = clockMinutes(row.endTime);
          if (start !== null && end !== null && end > start) {
            next.endTime = addClockMinutes(patch.startTime, end - start);
          }
        }
        return next;
      }),
    );

  const add = () =>
    setRows((current) => {
      const last = current[current.length - 1];
      const dayOfWeek = last?.dayOfWeek ?? 0;
      const startTime = last ? addClockMinutes(last.startTime, 120) : "10:00";
      return [
        ...current,
        {
          key: crypto.randomUUID(),
          id: null,
          label: suggestServiceName(dayOfWeek, startTime),
          named: false,
          dayOfWeek,
          startTime,
          endTime: addClockMinutes(startTime, 90),
          campusId: "",
        },
      ];
    });

  const applyTemplate = (templateId: string) => {
    const template = SERVICE_TEMPLATES.find((item) => item.id === templateId);
    if (!template) return;
    setRows(
      template.rows.map((row) => ({
        key: crypto.randomUUID(),
        id: null,
        label: row.label,
        named: false,
        dayOfWeek: row.dayOfWeek,
        startTime: row.startTime,
        endTime: row.endTime,
        campusId: "",
      })),
    );
  };

  const save = () => {
    startTransition(async () => {
      const result = await saveServiceTimes(
        rows.map((row) => ({
          id: row.id,
          label: row.label.trim() || suggestServiceName(row.dayOfWeek, row.startTime),
          dayOfWeek: row.dayOfWeek,
          startTime: row.startTime,
          endTime: row.endTime,
          campusId: row.campusId || null,
        })),
      );
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setRows(result.data.serviceTimes.map(toRow));
      toast.success(
        `${result.data.serviceTimes.length} service ${result.data.serviceTimes.length === 1 ? "time" : "times"} saved. They show on Services and your website.`,
      );
      onSaved();
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {rows.length === 0 ? (
        <div className="flex flex-col gap-3">
          <p className="text-[15px] text-muted-foreground">
            Start from a common schedule, then adjust it, or add services one by one.
          </p>
          {isAdmin ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {SERVICE_TEMPLATES.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => applyTemplate(template.id)}
                  className="flex min-h-16 flex-col items-start gap-1 rounded-xl border border-border bg-background p-4 text-left transition-colors hover:border-accent hover:bg-brand-gold/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="text-sm font-semibold text-foreground">{template.title}</span>
                  <span className="text-sm text-muted-foreground">{template.detail}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {rows.map((row) => {
        const open = checkinWindow({
          startTime: row.startTime,
          endTime: row.endTime || null,
          opensMinutesBefore,
          closesMinutesAfter,
        });
        return (
          <fieldset
            key={row.key}
            disabled={!isAdmin || pending}
            className="flex flex-col gap-4 rounded-xl border border-border bg-background p-4 sm:p-5"
          >
            <legend className="sr-only">{row.label || "New service"}</legend>
            <div className="flex items-start gap-2">
              <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm font-semibold text-foreground">
                Name
                <Input
                  value={row.label}
                  maxLength={120}
                  placeholder={suggestServiceName(row.dayOfWeek, row.startTime)}
                  onChange={(event) =>
                    update(row.key, { label: event.target.value, named: true })
                  }
                />
              </label>
              {isAdmin ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="mt-6 text-muted-foreground hover:text-destructive"
                  aria-label={`Remove ${row.label || "this service"}`}
                  onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}
                >
                  <Trash2 className="size-4" aria-hidden />
                  Remove
                </Button>
              ) : null}
            </div>

            <div
              role="radiogroup"
              aria-label={`Day of ${row.label || "this service"}`}
              className="flex flex-wrap gap-1.5"
            >
              {DAY_INITIALS.map((initial, day) => {
                const selected = row.dayOfWeek === day;
                return (
                  <button
                    key={DAY_NAMES[day]}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={DAY_NAMES[day]}
                    title={DAY_NAMES[day]}
                    onClick={() => update(row.key, { dayOfWeek: day })}
                    className={cn(
                      "flex size-11 items-center justify-center rounded-full text-[15px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed",
                      selected
                        ? "bg-primary text-primary-foreground"
                        : "border border-border bg-card text-muted-foreground hover:border-accent hover:text-foreground",
                    )}
                  >
                    {initial}
                  </button>
                );
              })}
            </div>

            <div className={cn("grid gap-3", multiCampus ? "sm:grid-cols-3" : "grid-cols-2")}>
              <label className="flex flex-col gap-1 text-sm font-semibold text-foreground">
                Starts
                <Input
                  type="time"
                  value={row.startTime}
                  onChange={(event) => update(row.key, { startTime: event.target.value })}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm font-semibold text-foreground">
                Ends
                <Input
                  type="time"
                  value={row.endTime}
                  onChange={(event) => update(row.key, { endTime: event.target.value })}
                />
              </label>
              {multiCampus ? (
                <label className="col-span-2 flex flex-col gap-1 text-sm font-semibold text-foreground sm:col-span-1">
                  Campus
                  <Select
                    value={row.campusId}
                    onChange={(event) => update(row.key, { campusId: event.target.value })}
                  >
                    <option value="">
                      {mainCampus ? `Main (${mainCampus.name})` : "Main campus"}
                    </option>
                    {campuses.map((campus) => (
                      <option key={campus.id} value={campus.id}>
                        {campus.name}
                      </option>
                    ))}
                  </Select>
                </label>
              ) : null}
            </div>

            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Clock className="size-4 shrink-0" aria-hidden />
              <span>
                Every {DAY_NAMES[row.dayOfWeek]}, check-in is open{" "}
                <span className="font-semibold text-foreground">
                  {formatClock(open.opens)} – {formatClock(open.closes)}
                </span>
                {row.endTime ? "" : " (a service without an end time is taken to last 90 minutes)"}
              </span>
            </p>
            {/* Sunday worship is the main list on Services; everything else is
                listed underneath it. Say where a service will show up. */}
            {row.dayOfWeek === 0 &&
            isWorshipLabel(row.label.trim() || suggestServiceName(row.dayOfWeek, row.startTime)) ? null : (
              <p className="text-sm text-muted-foreground">
                Shows on Services under &ldquo;Other services on your schedule&rdquo;,
                where you can mark who came.
              </p>
            )}
          </fieldset>
        );
      })}

      {isAdmin ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={add} disabled={pending || rows.length >= 20}>
            <Plus className="size-4" aria-hidden />
            Add a service
          </Button>
          <Button type="button" onClick={save} disabled={pending || !dirty}>
            {pending ? "Saving…" : "Save service times"}
          </Button>
          {dirty && rows.length > 0 ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => setRows(serviceTimes.map(toRow))}
              disabled={pending}
            >
              Undo changes
            </Button>
          ) : null}
        </div>
      ) : null}

      <p className="text-sm text-muted-foreground">
        Use the local time where the service is held. These are the same service
        times your website shows.
      </p>
    </div>
  );
}
