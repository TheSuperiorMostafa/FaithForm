export function formatDate(value: string | null | undefined): string {
  if (!value) return "Never";
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "Never";
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatRelativeTime(value: string | null | undefined): string {
  if (!value) return "Never";

  const deltaMs = new Date(value).getTime() - Date.now();
  const absMs = Math.abs(deltaMs);
  const units: { unit: Intl.RelativeTimeFormatUnit; ms: number }[] = [
    { unit: "year", ms: 1000 * 60 * 60 * 24 * 365 },
    { unit: "month", ms: 1000 * 60 * 60 * 24 * 30 },
    { unit: "week", ms: 1000 * 60 * 60 * 24 * 7 },
    { unit: "day", ms: 1000 * 60 * 60 * 24 },
    { unit: "hour", ms: 1000 * 60 * 60 },
    { unit: "minute", ms: 1000 * 60 },
  ];

  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const match = units.find((item) => absMs >= item.ms);
  if (!match) return "Just now";

  return formatter.format(Math.round(deltaMs / match.ms), match.unit);
}

export function formatHours(value: number): string {
  return value.toLocaleString("en-US", {
    maximumFractionDigits: 1,
  });
}

export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return "0 min";

  if (seconds < 60) return "< 1 min";

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes.toLocaleString("en-US")} min`;
  }

  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (remainder === 0) {
    return `${hours.toLocaleString("en-US")} hr`;
  }
  return `${hours.toLocaleString("en-US")} hr ${remainder} min`;
}
