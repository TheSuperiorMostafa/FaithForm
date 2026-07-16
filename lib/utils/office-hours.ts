import type { DayKey, OfficeHours } from "@/types/voice-assistant";

const DAY_KEYS: DayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export function defaultOfficeHours(): OfficeHours {
  const weekday = { enabled: true, open: "09:00", close: "17:00" };
  const weekend = { enabled: false, open: "09:00", close: "17:00" };
  return {
    mon: { ...weekday },
    tue: { ...weekday },
    wed: { ...weekday },
    thu: { ...weekday },
    fri: { ...weekday },
    sat: { ...weekend },
    sun: { ...weekend },
  };
}

export function normalizeOfficeHours(raw: unknown): OfficeHours {
  const defaults = defaultOfficeHours();
  if (!raw || typeof raw !== "object") return defaults;

  const record = raw as Record<
    string,
    Partial<{ enabled: boolean; open: string; close: string }>
  >;
  const result = { ...defaults };

  for (const key of DAY_KEYS) {
    const day = record[key];
    if (day && typeof day === "object") {
      result[key] = {
        enabled: Boolean(day.enabled),
        open: typeof day.open === "string" ? day.open : defaults[key].open,
        close: typeof day.close === "string" ? day.close : defaults[key].close,
      };
    }
  }

  return result;
}

export function formatOfficeHoursText(officeHours: OfficeHours): string {
  const dayLabels: Record<string, string> = {
    mon: "Monday",
    tue: "Tuesday",
    wed: "Wednesday",
    thu: "Thursday",
    fri: "Friday",
    sat: "Saturday",
    sun: "Sunday",
  };

  const lines = Object.entries(officeHours)
    .filter(([, hours]) => hours.enabled)
    .map(([key, hours]) => {
      const label = dayLabels[key] ?? key;
      return `${label}: ${hours.open} – ${hours.close}`;
    });

  return lines.length > 0 ? lines.join("; ") : "Not configured";
}
