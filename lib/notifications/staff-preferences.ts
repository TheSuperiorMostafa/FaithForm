import { z } from "zod";

export const STAFF_NOTIFICATION_EVENTS = [
  { id: "attendance_documents", label: "Attendance documents", description: "When a monthly, quarterly, or annual attendance report becomes available.", feature: "attendance" },
  { id: "attendance_completed", label: "Attendance completed", description: "When your team saves weekly attendance.", feature: "attendance" },
  { id: "kids_alerts", label: "Kids alerts", description: "When the Kids desk asks a guardian to return. Child details stay in FaithForm.", feature: "checkin" },
] as const;
export type StaffNotificationEvent = (typeof STAFF_NOTIFICATION_EVENTS)[number]["id"];
export const staffPreferencesSchema = z.object({
  phone: z.string().trim().max(32),
  events: z.object({
    attendance_documents: z.object({ email: z.boolean(), phone: z.boolean() }),
    attendance_completed: z.object({ email: z.boolean(), phone: z.boolean() }),
    kids_alerts: z.object({ email: z.boolean(), phone: z.boolean() }),
  }),
});
export type StaffPreferences = z.infer<typeof staffPreferencesSchema>;
export function emptyStaffPreferences(): StaffPreferences {
  return { phone: "", events: { attendance_documents: { email: false, phone: false }, attendance_completed: { email: false, phone: false }, kids_alerts: { email: false, phone: false } } };
}

/** Report availability uses the church's calendar, including year boundaries. */
export function newlyAvailableAttendancePeriods(timeZone: string, now = new Date()): string[] {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const read = (type: string) => Number(parts.find(p => p.type === type)?.value);
  if (read("day") !== 1) return [];
  const month = read("month"), year = read("year");
  const previousYear = month === 1 ? year - 1 : year;
  const previousMonth = month === 1 ? 12 : month - 1;
  return [`${previousYear}-${String(previousMonth).padStart(2, "0")}`, ...([1, 4, 7, 10].includes(month) ? [`${previousYear}-Q${Math.ceil(previousMonth / 3)}`] : []), ...(month === 1 ? [String(previousYear)] : [])];
}
