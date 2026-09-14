"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { saveServiceTimes } from "@/app/dashboard/attendance/setup/actions";
import type { SetupCampus, SetupServiceTime } from "@/lib/attendance/v2/setup";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type Row = {
  key: string;
  id: string | null;
  label: string;
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
    dayOfWeek: service.dayOfWeek,
    startTime: service.startTime,
    endTime: service.endTime ?? "",
    campusId: service.campusId ?? "",
  };
}

/**
 * The church's weekly services, as attendance sees them.
 *
 * The same rows the website and the phone assistant read, so a time changed
 * here changes everywhere. What this editor adds is the end time (check-in
 * closes a set time after the service ends, and without one a service is
 * taken to last ninety minutes) and, for a church with more than one campus,
 * which campus each service is at. A service with no campus is held at the main
 * campus.
 */
export function ServiceScheduleEditor({
  serviceTimes,
  campuses,
  isAdmin,
  onSaved,
}: {
  serviceTimes: SetupServiceTime[];
  campuses: SetupCampus[];
  isAdmin: boolean;
  onSaved: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [rows, setRows] = useState<Row[]>(() => serviceTimes.map(toRow));
  const multiCampus = campuses.length > 1;
  const mainCampus = campuses.find((campus) => campus.isPrimary) ?? campuses[0] ?? null;

  const update = (key: string, patch: Partial<Row>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  const add = () =>
    setRows((current) => [
      ...current,
      {
        key: crypto.randomUUID(),
        id: null,
        label: current.length === 0 ? "Sunday Worship" : "",
        dayOfWeek: 0,
        startTime: "10:00",
        endTime: "11:30",
        campusId: "",
      },
    ]);

  const save = () => {
    startTransition(async () => {
      const result = await saveServiceTimes(
        rows.map((row) => ({
          id: row.id,
          label: row.label,
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
      toast.success("Service times saved. Upcoming services were updated.");
      onSaved();
    });
  };

  return (
    <div className="flex flex-col gap-3">
      {rows.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No weekly services yet. Add one so there is something to check in to.
        </p>
      )}

      {rows.map((row) => (
        <fieldset
          key={row.key}
          disabled={!isAdmin || pending}
          className="grid gap-2 rounded-lg border border-border bg-background p-3 sm:grid-cols-[1fr_9rem_7rem_7rem_auto] sm:items-end"
        >
          <legend className="sr-only">{row.label || "New service"}</legend>
          <label className="flex flex-col gap-1 text-xs font-semibold text-foreground">
            Name
            <Input
              value={row.label}
              maxLength={120}
              placeholder="Sunday Worship"
              onChange={(event) => update(row.key, { label: event.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-foreground">
            Day
            <Select
              value={row.dayOfWeek}
              onChange={(event) => update(row.key, { dayOfWeek: Number(event.target.value) })}
            >
              {DAYS.map((day, index) => (
                <option key={day} value={index}>
                  {day}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-foreground">
            Starts
            <Input
              type="time"
              value={row.startTime}
              onChange={(event) => update(row.key, { startTime: event.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-foreground">
            Ends
            <Input
              type="time"
              value={row.endTime}
              onChange={(event) => update(row.key, { endTime: event.target.value })}
            />
          </label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={`Remove ${row.label || "this service"}`}
            onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}
          >
            <Trash2 className="size-4" aria-hidden />
          </Button>

          {multiCampus && (
            <label className="flex flex-col gap-1 text-xs font-semibold text-foreground sm:col-span-5">
              Campus
              <Select
                value={row.campusId}
                onChange={(event) => update(row.key, { campusId: event.target.value })}
              >
                <option value="">
                  {mainCampus ? `Main campus (${mainCampus.name})` : "Main campus"}
                </option>
                {campuses.map((campus) => (
                  <option key={campus.id} value={campus.id}>
                    {campus.name}
                  </option>
                ))}
              </Select>
            </label>
          )}
        </fieldset>
      ))}

      {isAdmin && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={add} disabled={pending || rows.length >= 20}>
            <Plus className="size-4" aria-hidden />
            Add a service
          </Button>
          <Button type="button" onClick={save} disabled={pending}>
            {pending ? "Saving…" : "Save service times"}
          </Button>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Times are local time where the service is held, and daylight saving is
        handled for you. Leave the end time blank and the service is taken to
        last 90 minutes. These are the same service times your website shows.
      </p>
    </div>
  );
}
