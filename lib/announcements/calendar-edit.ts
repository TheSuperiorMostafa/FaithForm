const DAY_MS = 86_400_000;

function sameInstant(a: string, b: string): boolean {
  if (!a || !b) return a === b;
  const left = Date.parse(a);
  const right = Date.parse(b);
  return Number.isFinite(left) && Number.isFinite(right) ? left === right : a === b;
}

/**
 * What publishing an announcement should write back to its calendar event.
 *
 * `changed` decides whether the calendar is touched at all. Times are compared
 * as instants, not strings, since the form and the calendar format them
 * differently. An all-day event's end is ignored because the form never shows
 * it: it arrives blank against the calendar's real end, and counting that as an
 * edit rewrote every all-day event on every publish.
 *
 * `endAt` is the end to send when it is. For an all-day event that is the
 * original length moved to the new start date, so a three-day retreat moved by
 * a week is still three days.
 */
export function calendarEditFor(input: {
  title: string;
  location: string;
  startAt: string;
  endAt: string | null;
  allDay: boolean;
  original: {
    title: string;
    location: string;
    startAt: string;
    endAt: string;
  };
}): { changed: boolean; endAt: string | null } {
  const { original } = input;

  const changed =
    input.title !== original.title ||
    input.location !== original.location ||
    !sameInstant(input.startAt, original.startAt) ||
    (!input.allDay && !sameInstant(input.endAt ?? "", original.endAt));

  if (!input.allDay) return { changed, endAt: input.endAt };

  const start = Date.parse(input.startAt);
  const originalStart = Date.parse(original.startAt);
  const originalEnd = Date.parse(original.endAt);
  const length =
    Number.isFinite(originalStart) &&
    Number.isFinite(originalEnd) &&
    originalEnd > originalStart
      ? originalEnd - originalStart
      : DAY_MS;

  return {
    changed,
    endAt: Number.isFinite(start) ? new Date(start + length).toISOString() : null,
  };
}
