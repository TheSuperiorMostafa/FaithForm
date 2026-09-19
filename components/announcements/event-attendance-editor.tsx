"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Clock3, Loader2, MapPin, QrCode, Radio, Tablet } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { AttendanceSetupPolicy } from "@/lib/attendance/v2/setup";
import {
  DEFAULT_EVENT_ATTENDANCE,
  type EventAttendanceSettings,
} from "@/lib/attendance/v2/event-attendance-types";
import type { CalendarEventPreview } from "@/lib/integrations/types";
import { cn } from "@/lib/utils";

export type EventAttendanceCampus = {
  id: string;
  name: string;
  address: string | null;
  hasCoordinates: boolean;
};

export type EventAttendanceDraft = Pick<
  EventAttendanceSettings,
  | "enabled"
  | "campusId"
  | "automaticEnabled"
  | "codeEnabled"
  | "kioskEnabled"
  | "checkinOpensMinutesBefore"
  | "checkinClosesMinutesAfter"
>;

export const DEFAULT_EVENT_ATTENDANCE_DRAFT: EventAttendanceDraft = {
  ...DEFAULT_EVENT_ATTENDANCE,
};

type FieldsProps = {
  value: EventAttendanceDraft;
  onChange: (value: EventAttendanceDraft) => void;
  campuses: EventAttendanceCampus[];
  policy: AttendanceSetupPolicy;
  allDay?: boolean;
  disabled?: boolean;
  locked?: boolean;
};

function MethodCard({
  icon: Icon,
  title,
  description,
  checked,
  disabled,
  onChange,
}: {
  icon: typeof Radio;
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className={cn("flex items-start gap-3 rounded-xl border p-3 transition-colors", checked && "border-accent bg-[color:color-mix(in_srgb,var(--accent)_7%,transparent)]", disabled && "opacity-60")}>
      <span className="rounded-lg bg-secondary p-2 text-accent"><Icon className="size-4" /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-xs leading-5 text-muted-foreground">{description}</span>
      </span>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} aria-label={title} />
    </div>
  );
}

export function EventAttendanceFields({ value, onChange, campuses, policy, allDay, disabled, locked }: FieldsProps) {
  const update = (patch: Partial<EventAttendanceDraft>) => onChange({ ...value, ...patch });
  const campus = campuses.find((item) => item.id === value.campusId);

  return (
    <section className="space-y-4 rounded-2xl border bg-secondary/25 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold">Count attendance</h3>
          <p className="mt-1 text-sm text-muted-foreground">Create one trusted roster for this event.</p>
        </div>
        <Switch
          checked={value.enabled}
          disabled={disabled || allDay || (locked && !value.enabled)}
          onCheckedChange={(enabled) => update({ enabled })}
          aria-label="Count attendance for this event"
        />
      </div>

      {allDay && (
        <p className="rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
          Add exact start and end times before enabling attendance.
        </p>
      )}

      {value.enabled && !allDay && (
        <div className="space-y-5 border-t pt-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-semibold"><MapPin className="size-4 text-accent" />Where is it?</div>
            <Select value={value.campusId ?? ""} disabled={disabled || locked} onChange={(event) => {
              const campusId = event.target.value || null;
              const chosen = campuses.find((item) => item.id === campusId);
              update({ campusId, automaticEnabled: chosen?.hasCoordinates ? value.automaticEnabled : false });
            }}>
              <option value="">No campus / online</option>
              {campuses.map((item) => <option key={item.id} value={item.id}>{item.name}{item.address ? ` — ${item.address}` : ""}</option>)}
            </Select>
          </div>

          <div className="space-y-2">
            <div>
              <p className="text-sm font-semibold">How can people check in?</p>
              <p className="text-xs text-muted-foreground">Staff can always mark the roster. Add any self check-in methods you want.</p>
            </div>
            <MethodCard icon={Radio} title="Automatic arrival" description={!policy.geofenceEnabled ? "Enable automatic check-in in Attendance setup first." : !campus?.hasCoordinates ? "Choose a published campus with a mapped location." : "The app recognizes arrival during the check-in window."} checked={value.automaticEnabled} disabled={disabled || locked || !policy.geofenceEnabled || !campus?.hasCoordinates} onChange={(automaticEnabled) => update({ automaticEnabled })} />
            <MethodCard icon={QrCode} title="Event code" description={policy.qrEnabled ? "People scan or enter the event code." : "Enable code check-in in Attendance setup first."} checked={value.codeEnabled} disabled={disabled || locked || !policy.qrEnabled} onChange={(codeEnabled) => update({ codeEnabled })} />
            <MethodCard icon={Tablet} title="Check-in station" description={policy.kioskEnabled ? "Use a shared device at the welcome desk." : "Enable kiosk check-in in Attendance setup first."} checked={value.kioskEnabled} disabled={disabled || locked || !policy.kioskEnabled} onChange={(kioskEnabled) => update({ kioskEnabled })} />
            {(!policy.geofenceEnabled || !policy.qrEnabled || !policy.kioskEnabled) && (
              <Link href="/dashboard/attendance/setup" className="inline-flex text-xs font-semibold text-accent underline underline-offset-2">Manage church-wide check-in methods</Link>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-semibold"><Clock3 className="size-4 text-accent" />Check-in window</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1"><Label className="text-xs">Opens before</Label><Select disabled={disabled || locked} value={value.checkinOpensMinutesBefore} onChange={(event) => update({ checkinOpensMinutesBefore: Number(event.target.value) })}>{[0, 15, 30, 45, 60, 90, 120].map((minutes) => <option key={minutes} value={minutes}>{minutes === 0 ? "At start time" : `${minutes} minutes`}</option>)}</Select></div>
              <div className="space-y-1"><Label className="text-xs">Closes after</Label><Select disabled={disabled || locked} value={value.checkinClosesMinutesAfter} onChange={(event) => update({ checkinClosesMinutesAfter: Number(event.target.value) })}>{[15, 30, 45, 60, 90, 120, 180, 240].map((minutes) => <option key={minutes} value={minutes}>{minutes} minutes</option>)}</Select></div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export function EventAttendanceEditor({ event, campuses, policy, initial, canEdit, onSaved }: {
  event: CalendarEventPreview;
  campuses: EventAttendanceCampus[];
  policy: AttendanceSetupPolicy;
  initial?: EventAttendanceSettings;
  canEdit: boolean;
  onSaved?: (settings: EventAttendanceSettings) => void;
}) {
  const [draft, setDraft] = useState<EventAttendanceDraft>(initial ?? DEFAULT_EVENT_ATTENDANCE_DRAFT);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => setDraft(initial ?? DEFAULT_EVENT_ATTENDANCE_DRAFT), [event.googleEventId, initial]);
  const locked = Boolean(initial?.locked);

  async function save() {
    setSaving(true); setMessage(null);
    try {
      const response = await fetch("/api/announcements/calendar/attendance", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, calendarEventId: event.googleEventId, calendarId: event.calendarId, calendarSource: event.source ?? (event.googleEventId.startsWith("apple:") ? "apple" : "google"), title: event.title, startAt: event.startAt, endAt: event.endAt, allDay: Boolean(event.allDay) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not save attendance.");
      setDraft(data.settings); onSaved?.(data.settings);
      setMessage(data.settings.enabled ? "Attendance is ready for this event." : "Attendance is off for this event.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save attendance."); }
    finally { setSaving(false); }
  }

  return (
    <div className="mt-6 space-y-3 border-t pt-6">
      <div><h3 className="font-heading text-lg font-bold">Event attendance</h3><p className="text-sm text-muted-foreground">Choose whether and how this event counts attendance.</p></div>
      <EventAttendanceFields value={draft} onChange={setDraft} campuses={campuses} policy={policy} allDay={event.allDay || !event.endAt} disabled={!canEdit || saving} locked={locked} />
      {locked && <p className="text-xs text-muted-foreground">Settings are locked because check-in has opened. You can still turn attendance off in an emergency.</p>}
      {message && <p className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"><CheckCircle2 className="size-4 text-accent" />{message}</p>}
      {canEdit && <Button type="button" onClick={save} disabled={saving || (locked && draft.enabled)}>{saving ? <><Loader2 className="size-4 animate-spin" />Saving…</> : "Save attendance"}</Button>}
    </div>
  );
}
