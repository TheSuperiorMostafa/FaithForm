/**
 * The arithmetic and wording behind the check-in setup screens.
 *
 * Kept free of imports, like `setup-bounds.ts`, so the browser can use it
 * without pulling the server's setup module (and through it the service-role
 * client) into the bundle. Everything here is a pure function of its inputs.
 */

export const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export const DAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"] as const;

/** A service with no end time is taken to last this long (as the generator does). */
export const DEFAULT_SERVICE_MINUTES = 90;

/** "HH:MM" to minutes after midnight, or null. */
export function clockMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^([01]\d|2[0-3]):([0-5]\d)/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Minutes after midnight back to "HH:MM", wrapped into one day. */
export function clockFromMinutes(minutes: number): string {
  const wrapped = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const hours = Math.floor(wrapped / 60);
  const mins = wrapped % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

/** "13:05" as "1:05 PM". */
export function formatClock(value: string | null | undefined): string {
  const minutes = clockMinutes(value);
  if (minutes === null) return "";
  const hours24 = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const suffix = hours24 < 12 ? "AM" : "PM";
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return mins === 0 ? `${hours12} ${suffix}` : `${hours12}:${String(mins).padStart(2, "0")} ${suffix}`;
}

export function addClockMinutes(value: string, minutes: number): string {
  const start = clockMinutes(value);
  return start === null ? value : clockFromMinutes(start + minutes);
}

/**
 * When check-in is open for one weekly service, as local clock times.
 * Crossing midnight is shown as the clock reads, which is what a church sees.
 */
export function checkinWindow(input: {
  startTime: string;
  endTime: string | null;
  opensMinutesBefore: number;
  closesMinutesAfter: number;
}): { opens: string; starts: string; ends: string; closes: string } {
  const start = clockMinutes(input.startTime) ?? 600;
  const end = clockMinutes(input.endTime) ?? start + DEFAULT_SERVICE_MINUTES;
  // An end at or before the start is a service that runs past midnight.
  const endAfterStart = end > start ? end : end + 1440;
  return {
    opens: clockFromMinutes(start - input.opensMinutesBefore),
    starts: clockFromMinutes(start),
    ends: clockFromMinutes(endAfterStart),
    closes: clockFromMinutes(endAfterStart + input.closesMinutesAfter),
  };
}

/** A sensible name for a new service, from when it is. */
export function suggestServiceName(dayOfWeek: number, startTime: string): string {
  const minutes = clockMinutes(startTime) ?? 600;
  const day = DAY_NAMES[dayOfWeek] ?? "Weekly";
  if (dayOfWeek === 0) {
    if (minutes < 12 * 60) return "Sunday Worship";
    if (minutes >= 17 * 60) return "Sunday Evening Service";
    return "Sunday Afternoon Service";
  }
  if (dayOfWeek === 6 && minutes >= 16 * 60) return "Saturday Evening Service";
  if (minutes >= 17 * 60) return `${day} Night`;
  return `${day} Service`;
}

export type ServiceTemplateRow = {
  label: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
};

/** One tap to a schedule most churches have, adjusted from there. */
export const SERVICE_TEMPLATES: { id: string; title: string; detail: string; rows: ServiceTemplateRow[] }[] = [
  {
    id: "one-sunday",
    title: "One Sunday service",
    detail: "Sunday 10 AM",
    rows: [{ label: "Sunday Worship", dayOfWeek: 0, startTime: "10:00", endTime: "11:30" }],
  },
  {
    id: "two-sunday",
    title: "Two Sunday services",
    detail: "Sunday 9 AM and 11 AM",
    rows: [
      { label: "Early Service", dayOfWeek: 0, startTime: "09:00", endTime: "10:15" },
      { label: "Late Service", dayOfWeek: 0, startTime: "11:00", endTime: "12:15" },
    ],
  },
];

/** The choices offered for when check-in opens and closes, in minutes. */
export const OPENS_BEFORE_CHOICES = [0, 15, 30, 45, 60] as const;
export const CLOSES_AFTER_CHOICES = [0, 15, 30, 60] as const;
export const RECOMMENDED_OPENS_BEFORE = 30;
export const RECOMMENDED_CLOSES_AFTER = 30;

/** How long someone stays before they are counted automatically. */
export const ARRIVAL_CHOICES = [
  { seconds: 0, label: "Right away" },
  { seconds: 60, label: "1 min" },
  { seconds: 120, label: "2 min" },
  { seconds: 300, label: "5 min" },
] as const;
export const RECOMMENDED_ARRIVAL_SECONDS = 120;

export const ACCURACY_CHOICES = [
  { meters: 50, label: "Strict · 50 m" },
  { meters: 100, label: "Standard · 100 m" },
  { meters: 150, label: "Relaxed · 150 m" },
  { meters: 200, label: "Lenient · 200 m" },
] as const;

export const RADIUS_PRESETS = [
  { meters: 100, label: "Small building" },
  { meters: 150, label: "Church and parking" },
  { meters: 250, label: "Large campus" },
] as const;

/** The listed choices, plus the saved value when it is none of them. */
export function withCurrentChoice(choices: readonly number[], current: number): number[] {
  return choices.includes(current)
    ? [...choices]
    : [...choices, current].sort((a, b) => a - b);
}

/** The nearest listed choice, for a saved value between them. */
export function nearestChoice(choices: readonly number[], value: number): number {
  return choices.reduce((best, choice) =>
    Math.abs(choice - value) < Math.abs(best - value) ? choice : best,
  );
}

export function minutesPhrase(minutes: number): string {
  if (minutes === 0) return "0 min";
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours} hr` : `${minutes} min`;
}
