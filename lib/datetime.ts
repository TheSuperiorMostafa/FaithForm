export function combineDateAndTime(date: string, time: string): string {
  return new Date(`${date}T${time}`).toISOString();
}

export function splitDateTime(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const date = d.toISOString().slice(0, 10);
  const time = d.toTimeString().slice(0, 5);
  return { date, time };
}

export function formatReadyLabel(startAt: string): string {
  const start = new Date(startAt);
  const formatted = start.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return `Ready to share beginning as of ${formatted}`;
}
