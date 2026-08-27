export type AnnouncementFormSeed = {
  id: string | null;
  event_title: string;
  event_date: string;
  event_location: string;
  push_to_app: boolean;
  push_to_facebook: boolean;
  push_to_team: boolean;
  notes: string;
};

/** Next occurrence of a weekday (0=Sun … 6=Sat) at given local time. */
function nextWeekday(
  from: Date,
  weekday: number,
  hours: number,
  minutes = 0,
): string {
  const d = new Date(from);
  const current = d.getDay();
  let daysAhead = weekday - current;
  if (daysAhead <= 0) daysAhead += 7;
  d.setDate(d.getDate() + daysAhead);
  d.setHours(hours, minutes, 0, 0);
  return d.toISOString();
}

export function getPlaceholderAnnouncements(): AnnouncementFormSeed[] {
  const now = new Date();

  return [
    {
      id: null,
      event_title: "Sunday Worship Service",
      event_date: nextWeekday(now, 0, 10, 0),
      event_location: "Main Sanctuary",
      push_to_app: true,
      push_to_facebook: true,
      push_to_team: true,
      notes: "",
    },
    {
      id: null,
      event_title: "Wednesday Bible Study",
      event_date: nextWeekday(now, 3, 19, 0),
      event_location: "Fellowship Hall",
      push_to_app: true,
      push_to_facebook: false,
      push_to_team: true,
      notes: "",
    },
    {
      id: null,
      event_title: "Youth Group",
      event_date: nextWeekday(now, 5, 18, 0),
      event_location: "Youth Room",
      push_to_app: true,
      push_to_facebook: true,
      push_to_team: false,
      notes: "",
    },
    {
      id: null,
      event_title: "Volunteer Meeting",
      event_date: nextWeekday(now, 6, 9, 0),
      event_location: "Conference Room",
      push_to_app: false,
      push_to_facebook: false,
      push_to_team: true,
      notes: "",
    },
  ];
}

/** ISO timestamptz → value for `<input type="datetime-local" />`. */
export function toDatetimeLocalValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** `<input type="datetime-local" />` value → ISO string or null. */
export function fromDatetimeLocalValue(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/**
 * ISO timestamptz → value for `<input type="date" />`, read in UTC.
 *
 * All-day events are stored as midnight UTC on the date the calendar gave.
 * Reading that back in the browser's own zone shows the day before for anyone
 * west of Greenwich, and editing the event would then save that wrong day.
 */
export function toDateInputValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

/** `<input type="date" />` value → midnight UTC ISO string, or null. */
export function fromDateInputValue(value: string): string | null {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const d = new Date(`${trimmed}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}
