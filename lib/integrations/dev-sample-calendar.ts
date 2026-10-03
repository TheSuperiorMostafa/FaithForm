import type { CalendarEventPreview } from "./types";

/**
 * Local development only: shows the Announcements calendar with made-up events
 * when no real calendar is connected, so the layout can be worked on. Switched
 * on by FAITHFORM_DEV_SAMPLE_CALENDAR=1 and never honored in production.
 */
export function devSampleCalendarOn(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.FAITHFORM_DEV_SAMPLE_CALENDAR === "1"
  );
}

const WEEKLY: { day: number; hour: number; minutes: number; title: string; location: string; description: string }[] = [
  { day: 0, hour: 10, minutes: 90, title: "Sunday Worship", location: "Main Sanctuary", description: "Our weekly gathering. Kids ministry during the service." },
  { day: 3, hour: 19, minutes: 60, title: "Midweek Bible Study", location: "Fellowship Hall", description: "Working through the Gospel of John together." },
  { day: 5, hour: 18, minutes: 120, title: "Youth Night", location: "Youth Room", description: "Games, food and a short message for grades 6–12." },
];

const ONE_OFF: { dayOfMonth: number; hour: number; minutes: number; title: string; location: string; description: string }[] = [
  { dayOfMonth: 6, hour: 9, minutes: 180, title: "Community Food Drive", location: "Church Parking Lot", description: "Bring canned goods; volunteers needed for sorting." },
  { dayOfMonth: 13, hour: 12, minutes: 90, title: "Newcomers Lunch", location: "Fellowship Hall", description: "Meet the pastors and learn about the church." },
  { dayOfMonth: 20, hour: 17, minutes: 150, title: "Fall Festival", location: "Church Lawn", description: "Hayrides, chili cook-off and family games. Everyone welcome." },
  { dayOfMonth: 27, hour: 8, minutes: 60, title: "Men's Breakfast", location: "Fellowship Hall", description: "Breakfast and a short devotional." },
];

function event(
  start: Date,
  minutes: number,
  item: { title: string; location: string; description: string },
): CalendarEventPreview {
  const key = `${item.title}-${start.toISOString().slice(0, 10)}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return {
    googleEventId: `dev-sample-${key}`,
    calendarId: "dev-sample",
    title: item.title,
    location: item.location,
    description: item.description,
    startAt: start.toISOString(),
    endAt: new Date(start.getTime() + minutes * 60_000).toISOString(),
    source: "apple",
    // Nothing to write back to: the panel treats these like a read-only calendar.
    readOnly: true,
  };
}

/** Sample events between startISO and endISO (local server time). */
export function devSampleCalendarEvents(startISO: string, endISO: string): CalendarEventPreview[] {
  const start = new Date(startISO);
  const end = new Date(endISO);
  const events: CalendarEventPreview[] = [];
  const day = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  for (; day < end; day.setDate(day.getDate() + 1)) {
    const matches = [
      ...WEEKLY.filter((item) => item.day === day.getDay()),
      ...ONE_OFF.filter((item) => item.dayOfMonth === day.getDate()),
    ];
    for (const item of matches) {
      const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), item.hour);
      if (at >= start && at < end) events.push(event(at, item.minutes, item));
    }
  }
  return events.sort((a, b) => a.startAt.localeCompare(b.startAt));
}
