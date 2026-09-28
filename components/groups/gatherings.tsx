"use client";
import { useState, type FormEvent } from "react";
import { CalendarDays, CalendarPlus, ClipboardCheck, MapPin, Pencil, Plus, Repeat, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AttendanceSheet } from "@/lib/groups/gatherings";
import type { StaffGroupDetail } from "@/lib/groups/staff/groups";
import type { listStaffGatherings, getStaffGathering } from "@/lib/groups/staff/gatherings";
import * as actions from "@/app/dashboard/groups/actions";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { formatTimezoneLabel } from "@/lib/timezones";
import { isoToZonedInput, zonedInputToIso } from "@/lib/utils/zoned-datetime-input";
import { dateTime, Empty, Field, Modal, Notice, Pill, Submit, useGroupAction } from "./shared";

/* Shown to churches as "Meetings"; the code and URLs keep the older name, "gatherings". */

type Gathering = Awaited<ReturnType<typeof listStaffGatherings>>["items"][number];
type EventPage = Awaited<ReturnType<typeof listStaffGatherings>>;
type EventDetail = NonNullable<Awaited<ReturnType<typeof getStaffGathering>>>;
export function Gatherings({ detail, upcoming, past, timezone }: { detail: StaffGroupDetail; upcoming: EventPage; past: EventPage; timezone: string }) {
  const [mode, setMode] = useState<"upcoming" | "past">("upcoming");
  const [editing, setEditing] = useState<EventDetail | null>(null);
  const [extra, setExtra] = useState<Partial<Record<"upcoming" | "past", EventPage>>>({}); const [adding, setAdding] = useState(false); const [cancelling, setCancelling] = useState<Gathering | null>(null); const [sheet, setSheet] = useState<AttendanceSheet | null>(null);
  const { pending, error, run } = useGroupAction(); const archived = detail.group.status === "archived";
  const initial = mode === "upcoming" ? upcoming : past;
  const items = [...initial.items, ...(extra[mode]?.items ?? []).filter(e => !initial.items.some(i => i.id === e.id))];
  const cursor = extra[mode] ? extra[mode]?.nextCursor : initial.nextCursor;
  return <div className="flex flex-col gap-6"><div className="g-toolbar"><div className="g-segment" role="group" aria-label="Show">{(["upcoming", "past"] as const).map(s => <button type="button" key={s} className={mode === s ? "is-active" : ""} aria-pressed={mode === s} onClick={() => setMode(s)}>{s === "upcoming" ? "Coming up" : "Past meetings"}</button>)}</div>{!archived && <Button size="lg" onClick={() => setAdding(true)}><CalendarPlus className="size-5" aria-hidden />Plan a meeting</Button>}</div>{error && <Notice>{error}</Notice>}{items.length ? <ul className="g-list" aria-label={mode === "upcoming" ? "Meetings coming up" : "Past meetings"}>{items.map(event => <li className="g-list-row" key={event.id}><div className="flex min-w-0 gap-4"><div className="g-icon-tile"><CalendarDays className="size-6" aria-hidden /></div><div className="min-w-0"><div className="g-row-title flex flex-wrap items-center gap-2">{event.title} {event.isCancelled && <Pill>Cancelled</Pill>}</div><p className="g-row-sub">{dateTime(event.startsAt, event.timezone)}</p>{event.locationName && <p className="g-meta mt-1"><MapPin aria-hidden />{event.locationName}</p>}<p className="g-row-sub">{event.attendance ? `${event.attendance.present} came · ${event.attendance.guests} guests` : `${event.goingCount} said they’re coming`}</p></div></div><div className="flex flex-wrap gap-2">{!event.isCancelled && <><Button variant="outline" disabled={pending} onClick={() => run(() => actions.attendanceSheet(detail.group.id, event.id), undefined, setSheet)}><ClipboardCheck className="size-5" aria-hidden />{event.attendance ? "See attendance" : "Take attendance"}</Button>{!archived && <Button variant="ghost" disabled={pending} onClick={() => run(() => actions.gatheringDetails(detail.group.id, event.id), undefined, data => { if (data) setEditing(data); })}><Pencil className="size-5" aria-hidden />Edit</Button>}{mode === "upcoming" && !archived && <Button variant="ghost" onClick={() => setCancelling(event)}><X className="size-5" aria-hidden />Cancel meeting</Button>}</>}</div></li>)}</ul> : <Empty icon="events" compact title={mode === "upcoming" ? "No meetings planned" : "No past meetings yet"} description={mode === "upcoming" ? "Plan the next meeting, or set a regular time below so meetings are added for you." : "Past meetings and their attendance will show here."} />}
    {cursor && <Button variant="outline" className="self-start" disabled={pending} onClick={() => run(() => actions.moreGatherings(detail.group.id, mode, cursor), undefined, page => setExtra(old => ({ ...old, [mode]: { items: [...(old[mode]?.items ?? []), ...page.items], nextCursor: page.nextCursor } })))}>Show more meetings</Button>}
    <Modal open={!!editing} onClose={() => setEditing(null)} title="Edit meeting">{editing && <GatheringForm groupId={detail.group.id} timezone={timezone} existing={editing} close={() => { setEditing(null); setExtra({}); }} />}</Modal>
    <Modal open={adding} onClose={() => setAdding(false)} title="Plan a meeting" description="Members see it in the app and can say if they’re coming.">{adding && <GatheringForm groupId={detail.group.id} timezone={timezone} close={() => setAdding(false)} />}</Modal>
    <Modal open={!!cancelling} onClose={() => setCancelling(null)} title={`Cancel ${cancelling?.title ?? "this meeting"}?`} description="Members will be told in the app. It stays in the group’s history.">{cancelling && <form onSubmit={e => { e.preventDefault(); const reason = String(new FormData(e.currentTarget).get("reason") ?? ""); run(() => actions.cancelGathering(detail.group.id, cancelling.id, reason), `${cancelling.title} cancelled. Members will be told.`, () => setCancelling(null)); }}><Field label="Tell people why (optional)"><textarea name="reason" rows={3} maxLength={300} /></Field>{error && <Notice>{error}</Notice>}<div className="g-form-actions"><Button type="button" variant="ghost" onClick={() => setCancelling(null)}>Go back</Button><Button type="submit" variant="destructive" disabled={pending}>Cancel meeting</Button></div></form>}</Modal>
    <Modal open={!!sheet} onClose={() => setSheet(null)} title={sheet?.title ?? "Attendance"} description={sheet ? dateTime(sheet.startsAt, sheet.timezone) : undefined}>{sheet && <Attendance groupId={detail.group.id} sheet={sheet} close={() => setSheet(null)} />}</Modal>
  </div>;
}
function GatheringForm({ groupId, timezone, close, existing }: { groupId: string; timezone: string; close: () => void; existing?: EventDetail }) {
  const { pending, error, setError, run } = useGroupAction();
  // Preserve the zone of an existing meeting. New meetings use church time,
  // including when a staff member is scheduling from another time zone.
  const formZone = existing?.event.timezone ?? timezone;
  const starts = existing ? isoToZonedInput(existing.event.startsAt, formZone) ?? "" : "";
  const ends = existing ? isoToZonedInput(existing.event.endsAt, formZone) ?? "" : "";

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const startsAt = zonedInputToIso(String(fields.get("starts") ?? ""), formZone);
    const endsAt = zonedInputToIso(String(fields.get("ends") ?? ""), formZone);
    if (!startsAt || !endsAt) {
      setError(`Choose valid meeting times in ${existing ? "this meeting’s" : "your church’s"} time zone.`);
      return;
    }
    const title = String(fields.get("title") ?? "").trim();
    run(
      () => actions.saveGathering(groupId, existing?.event.id ?? null, {
        title,
        description: String(fields.get("description") ?? ""),
        startsAt,
        endsAt,
        timezone: formZone,
        locationName: String(fields.get("location") ?? ""),
        onlineMeetingUrl: String(fields.get("url") ?? ""),
      }),
      existing ? `${title} updated.` : `${title} planned. Members can see it in the app.`,
      close,
    );
  }

  return <form className="space-y-4" onSubmit={submit}>
    <Field label="What’s the meeting called?"><input autoFocus name="title" defaultValue={existing?.event.title} required maxLength={120} placeholder="e.g. Dinner and Bible study" /></Field>
    <div className="g-form-grid">
      <Field label="Starts"><input name="starts" type="datetime-local" defaultValue={starts} required /></Field>
      <Field label="Ends"><input name="ends" type="datetime-local" defaultValue={ends} required /></Field>
    </div>
    <p className="text-sm text-muted-foreground">
      Times use {existing ? "this meeting’s" : "your church’s"} time zone ({formatTimezoneLabel(formZone)}).
    </p>
    <Field label="Where (optional)"><input name="location" defaultValue={existing?.event.locationName ?? ""} maxLength={200} placeholder="e.g. Fellowship hall" /></Field>
    <Field label="Online meeting link (optional)"><input name="url" defaultValue={existing?.onlineMeetingUrl ?? ""} type="url" placeholder="https://" /></Field>
    <Field label="Anything to know? (optional)"><textarea name="description" defaultValue={existing?.description ?? ""} rows={3} maxLength={4000} placeholder="What to bring, what to expect…" /></Field>
    {error && <Notice>{error}</Notice>}
    <div className="g-form-actions"><Submit pending={pending}>{existing ? "Save meeting" : "Plan meeting"}</Submit></div>
  </form>;
}
function Attendance({ groupId, sheet, close }: { groupId: string; sheet: AttendanceSheet; close: () => void }) {
  const [selected, setSelected] = useState(sheet.entries.filter(e => e.present).map(e => e.membershipId));
  const [key] = useState(() => crypto.randomUUID());
  const { pending, error, run } = useGroupAction();
  const lockedMessage = sheet.lockedReason === "too_early"
    ? "Attendance opens the day before this meeting. You can return then to mark who came."
    : sheet.lockedReason === "too_late"
      ? "Attendance closed 30 days after this meeting."
      : sheet.lockedReason === "cancelled"
        ? "Attendance is unavailable for a cancelled meeting."
        : null;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sheet.canRecord) return;
    const fields = new FormData(event.currentTarget);
    run(() => actions.recordAttendance(groupId, sheet.eventId, {
      presentMembershipIds: selected,
      guestCount: Number(fields.get("guests")),
      firstTimeGuestCount: Number(fields.get("first")),
      notes: String(fields.get("notes")),
    }, key), `Attendance saved: ${selected.length} came.`, close);
  }

  return <form onSubmit={submit}>
    {lockedMessage && <Notice tone="info">{lockedMessage}</Notice>}
    <fieldset disabled={!sheet.canRecord || pending} className="min-w-0 border-0 p-0">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <span className="text-base font-semibold">{selected.length} here</span>
        <Button type="button" variant="outline" onClick={() => setSelected(selected.length ? [] : sheet.entries.filter(e => e.recordable).map(e => e.membershipId))}>{selected.length ? "Clear everyone" : "Mark everyone here"}</Button>
      </div>
      <div className="max-h-64 overflow-y-auto">{sheet.entries.map(entry => <label key={entry.membershipId} className="g-row cursor-pointer"><span className="text-base">{entry.name}{!entry.recordable && <small className="block text-sm text-muted-foreground">No longer in the group</small>}</span><input type="checkbox" disabled={!entry.recordable} checked={selected.includes(entry.membershipId)} onChange={e => setSelected(s => e.target.checked ? [...s, entry.membershipId] : s.filter(id => id !== entry.membershipId))} className="size-5" /></label>)}</div>
      <div className="g-form-grid mt-5"><Field label="Guests"><input type="number" name="guests" min={0} max={1000} defaultValue={sheet.guestCount} required /></Field><Field label="First-time guests"><input type="number" name="first" min={0} max={1000} defaultValue={sheet.firstTimeGuestCount} required /></Field></div>
      <div className="mt-4"><Field label="Notes (optional)"><textarea name="notes" rows={2} maxLength={1000} defaultValue={sheet.notes ?? ""} /></Field></div>
      {error && <Notice>{error}</Notice>}
      {sheet.canRecord && <div className="g-form-actions"><Submit pending={pending}>Save attendance</Submit></div>}
    </fieldset>
  </form>;
}
export function Schedules({ detail, timezone }: { detail: StaffGroupDetail; timezone: string }) {
  const [adding, setAdding] = useState(false); const { pending, error, run } = useGroupAction();
  async function stop(id: string, description: string) {
    const ok = await confirmAction({ title: "Stop this regular time?", description: `${description}. Upcoming meetings that came from it will be removed. Past meetings and attendance stay.`, confirmLabel: "Stop regular time", destructive: true });
    if (ok) run(() => actions.stopSchedule(detail.group.id, id), "Regular meeting time stopped.");
  }
  return <section className="g-panel space-y-2" aria-labelledby="schedule-title"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="schedule-title">Regular meeting time</h2><p className="g-row-sub">Set a repeating time and the next meetings are added for you.</p></div><Button variant="outline" onClick={() => setAdding(true)}><Plus className="size-5" aria-hidden />Add a regular time</Button></div>{detail.schedules.filter(s => s.isActive).map(s => <div key={s.id} className="g-row"><div><p className="g-row-title">{s.description}</p><p className="g-row-sub">{s.durationMinutes} minutes · {s.timezone}</p></div><Button variant="outline" disabled={pending} onClick={() => void stop(s.id, s.description)}>Stop</Button></div>)}{error && <Notice>{error}</Notice>}{detail.schedules.some(s => s.isActive) && <Button variant="outline" className="mt-4" disabled={pending} onClick={() => run(() => actions.generateGatherings(detail.group.id), "The next 8 weeks of meetings are on the calendar.")}><Repeat className="size-5" aria-hidden />Add the next 8 weeks</Button>}
    <Modal open={adding} onClose={() => setAdding(false)} title="Add a regular meeting time"><form className="space-y-4" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); run(() => actions.saveSchedule(detail.group.id, null, { frequency: String(f.get("frequency")), dayOfWeek: Number(f.get("day")), weekOfMonth: f.get("frequency") === "monthly" ? Number(f.get("week")) : null, startTime: String(f.get("time")), durationMinutes: Number(f.get("duration")), timezone: String(f.get("timezone")), startsOn: String(f.get("starts")), endsOn: String(f.get("ends")) || null }), "Regular meeting time saved.", () => setAdding(false)); }}><div className="g-form-grid"><Field label="Repeat"><select name="frequency"><option value="weekly">Every week</option><option value="biweekly">Every other week</option><option value="monthly">Every month</option></select></Field><Field label="Day"><select name="day">{["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((d, i) => <option value={i} key={d}>{d}</option>)}</select></Field><Field label="Which week (monthly only)"><select name="week">{[[1,"First"],[2,"Second"],[3,"Third"],[4,"Fourth"],[-1,"Last"]].map(([v,t]) => <option key={v} value={v}>{t}</option>)}</select></Field><Field label="Time"><input name="time" type="time" required defaultValue="18:30" /></Field><Field label="How long (minutes)"><input name="duration" type="number" min={15} max={720} defaultValue={90} required /></Field><Field label="Time zone"><input name="timezone" defaultValue={timezone} required /></Field><Field label="First meeting on or after"><input name="starts" type="date" required /></Field><Field label="End date (optional)"><input name="ends" type="date" /></Field></div>{error && <Notice>{error}</Notice>}<div className="g-form-actions"><Submit pending={pending}>Save regular time</Submit></div></form></Modal>
  </section>;
}
