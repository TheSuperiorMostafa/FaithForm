/**
 * Just enough iCalendar to read a church calendar.
 *
 * iCloud speaks CalDAV, and CalDAV hands back raw .ics text — no expanded
 * occurrences, no JSON. A church calendar is mostly recurring events (the
 * Sunday service, Wednesday youth group), so reading one means expanding
 * recurrence rules here rather than hoping the server does it: RFC 4791 makes
 * server-side expansion optional and iCloud does not offer it.
 *
 * Scope is deliberately the shape of a church calendar — VEVENT, the common
 * frequencies, EXDATE, and single-occurrence overrides. Anything stranger
 * degrades to "show the event as written" rather than throwing.
 */

export type IcsDateTime = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** IANA zone from TZID, "UTC" for a Z suffix, null for floating local time. */
  timeZone: string | null;
  /** VALUE=DATE — an all-day event, with no time of day at all. */
  dateOnly: boolean;
};

export type IcsEvent = {
  uid: string;
  summary: string;
  location: string;
  description: string;
  start: IcsDateTime;
  end: IcsDateTime | null;
  rrule: string | null;
  exdates: IcsDateTime[];
  /** Set when this VEVENT replaces one occurrence of a recurring event. */
  recurrenceId: IcsDateTime | null;
  status: string | null;
  sequence: number;
  /** ETag/href bookkeeping the CalDAV layer fills in. */
  href?: string;
};

export type IcsOccurrence = {
  uid: string;
  summary: string;
  location: string;
  description: string;
  /** UTC instant, ISO 8601. */
  startAt: string;
  endAt: string | null;
  allDay: boolean;
  /** Distinguishes the occurrences of a recurring event from one another. */
  occurrenceId: string;
  href?: string;
};

/** Folded lines (RFC 5545 §3.1) are continued by a leading space or tab. */
function unfold(text: string): string[] {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length > 0) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

type ContentLine = {
  name: string;
  params: Record<string, string>;
  value: string;
};

function parseLine(line: string): ContentLine | null {
  const colon = findValueColon(line);
  if (colon < 0) return null;

  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const [name, ...paramParts] = head.split(";");

  const params: Record<string, string> = {};
  for (const part of paramParts) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    params[part.slice(0, eq).toUpperCase()] = part
      .slice(eq + 1)
      .replace(/^"|"$/g, "");
  }

  return { name: (name ?? "").toUpperCase(), params, value };
}

/** The first colon outside a quoted parameter value ends the property name. */
function findValueColon(line: string): number {
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') quoted = !quoted;
    else if (ch === ":" && !quoted) return i;
  }
  return -1;
}

function unescapeText(value: string): string {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

export function parseIcsDateTime(
  value: string,
  params: Record<string, string>,
): IcsDateTime | null {
  const raw = value.trim();
  const dateOnly = params.VALUE === "DATE" || /^\d{8}$/.test(raw);

  const match = raw.match(
    /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/,
  );
  if (!match) return null;

  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4] ?? 0),
    minute: Number(match[5] ?? 0),
    second: Number(match[6] ?? 0),
    timeZone: match[7] ? "UTC" : (params.TZID ?? null),
    dateOnly,
  };
}

/**
 * How far `timeZone` sits from UTC at a given instant, in milliseconds.
 *
 * Derived from `Intl` rather than a bundled tz database: the runtime already
 * carries one, and a church calendar only ever needs offsets for real zones.
 */
function zoneOffsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));

  const field = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");

  const asUtc = Date.UTC(
    field("year"),
    field("month") - 1,
    field("day"),
    field("hour"),
    field("minute"),
    field("second"),
  );
  return asUtc - instant;
}

/**
 * The UTC instant for a wall-clock time in a named zone.
 *
 * Two passes because the offset depends on the instant we are still solving
 * for: guess with the offset at the naive instant, then correct once, which
 * settles every real transition including the spring-forward hour that does
 * not exist locally.
 */
export function wallTimeToUtc(dt: IcsDateTime): Date {
  const naive = Date.UTC(
    dt.year,
    dt.month - 1,
    dt.day,
    dt.hour,
    dt.minute,
    dt.second,
  );

  // Floating times and all-day dates have no zone to resolve against; both are
  // read as UTC, which is also how the Google side treats an all-day date.
  const zone = dt.dateOnly ? "UTC" : (dt.timeZone ?? "UTC");
  if (zone === "UTC") return new Date(naive);

  try {
    const firstGuess = naive - zoneOffsetMs(naive, zone);
    const corrected = naive - zoneOffsetMs(firstGuess, zone);
    return new Date(corrected);
  } catch {
    // An unrecognised TZID (a custom VTIMEZONE name) is better read as UTC
    // than dropped — the event still shows up, on the right day.
    return new Date(naive);
  }
}

export function icsDateTimeToISO(dt: IcsDateTime): string {
  return wallTimeToUtc(dt).toISOString();
}

/** Every VEVENT in a calendar object, VTIMEZONE and VTODO ignored. */
export function parseIcsEvents(ics: string): IcsEvent[] {
  const events: IcsEvent[] = [];
  let current: Partial<IcsEvent> & { exdates: IcsDateTime[] } = { exdates: [] };
  let depth = 0;
  let inEvent = false;

  for (const line of unfold(ics)) {
    const parsed = parseLine(line);
    if (!parsed) continue;

    if (parsed.name === "BEGIN") {
      depth += 1;
      if (parsed.value.toUpperCase() === "VEVENT") {
        inEvent = true;
        current = { exdates: [] };
      }
      continue;
    }

    if (parsed.name === "END") {
      depth -= 1;
      if (parsed.value.toUpperCase() === "VEVENT") {
        inEvent = false;
        if (current.uid && current.start) {
          events.push({
            uid: current.uid,
            summary: current.summary ?? "",
            location: current.location ?? "",
            description: current.description ?? "",
            start: current.start,
            end: current.end ?? null,
            rrule: current.rrule ?? null,
            exdates: current.exdates,
            recurrenceId: current.recurrenceId ?? null,
            status: current.status ?? null,
            sequence: current.sequence ?? 0,
          });
        }
      }
      continue;
    }

    // Alarms and nested components carry their own DTSTART/SUMMARY; only the
    // VEVENT's own properties count.
    if (!inEvent || depth > 2) continue;

    switch (parsed.name) {
      case "UID":
        current.uid = parsed.value.trim();
        break;
      case "SUMMARY":
        current.summary = unescapeText(parsed.value).trim();
        break;
      case "LOCATION":
        current.location = unescapeText(parsed.value).trim();
        break;
      case "DESCRIPTION":
        current.description = unescapeText(parsed.value).trim();
        break;
      case "STATUS":
        current.status = parsed.value.trim().toUpperCase();
        break;
      case "SEQUENCE":
        current.sequence = Number(parsed.value) || 0;
        break;
      case "DTSTART": {
        const dt = parseIcsDateTime(parsed.value, parsed.params);
        if (dt) current.start = dt;
        break;
      }
      case "DTEND": {
        const dt = parseIcsDateTime(parsed.value, parsed.params);
        if (dt) current.end = dt;
        break;
      }
      case "RECURRENCE-ID": {
        const dt = parseIcsDateTime(parsed.value, parsed.params);
        if (dt) current.recurrenceId = dt;
        break;
      }
      case "RRULE":
        current.rrule = parsed.value.trim();
        break;
      case "EXDATE": {
        for (const piece of parsed.value.split(",")) {
          const dt = parseIcsDateTime(piece, parsed.params);
          if (dt) current.exdates.push(dt);
        }
        break;
      }
      default:
        break;
    }
  }

  return events;
}

type Rule = {
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval: number;
  count: number | null;
  until: Date | null;
  /** Weekday numbers 0–6, optionally with an ordinal for MONTHLY ("3SU"). */
  byDay: Array<{ ordinal: number | null; weekday: number }>;
  byMonthDay: number[];
};

const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

export function parseRrule(rrule: string): Rule | null {
  const parts: Record<string, string> = {};
  for (const piece of rrule.replace(/^RRULE:/i, "").split(";")) {
    const eq = piece.indexOf("=");
    if (eq < 0) continue;
    parts[piece.slice(0, eq).toUpperCase()] = piece.slice(eq + 1);
  }

  const freq = (parts.FREQ ?? "").toUpperCase();
  if (
    freq !== "DAILY" &&
    freq !== "WEEKLY" &&
    freq !== "MONTHLY" &&
    freq !== "YEARLY"
  ) {
    return null;
  }

  const until = parts.UNTIL
    ? wallTimeToUtc(
        parseIcsDateTime(parts.UNTIL, {}) ?? {
          year: 1970,
          month: 1,
          day: 1,
          hour: 0,
          minute: 0,
          second: 0,
          timeZone: "UTC",
          dateOnly: false,
        },
      )
    : null;

  const byDay = (parts.BYDAY ?? "")
    .split(",")
    .map((token) => token.trim().toUpperCase())
    .filter(Boolean)
    .map((token) => {
      const match = token.match(/^([+-]?\d)?([A-Z]{2})$/);
      if (!match) return null;
      const weekday = WEEKDAYS.indexOf(match[2] ?? "");
      if (weekday < 0) return null;
      return {
        ordinal: match[1] ? Number(match[1]) : null,
        weekday,
      };
    })
    .filter((entry): entry is { ordinal: number | null; weekday: number } =>
      Boolean(entry),
    );

  const byMonthDay = (parts.BYMONTHDAY ?? "")
    .split(",")
    .map((token) => Number(token.trim()))
    .filter((value) => Number.isInteger(value) && value !== 0);

  return {
    freq,
    interval: Math.max(1, Number(parts.INTERVAL ?? 1) || 1),
    count: parts.COUNT ? Number(parts.COUNT) : null,
    until,
    byDay,
    byMonthDay,
  };
}

/** A hard stop, so a malformed rule can never spin. */
const MAX_OCCURRENCES = 750;

function addDaysUtc(dt: IcsDateTime, days: number): IcsDateTime {
  const base = new Date(Date.UTC(dt.year, dt.month - 1, dt.day));
  base.setUTCDate(base.getUTCDate() + days);
  return {
    ...dt,
    year: base.getUTCFullYear(),
    month: base.getUTCMonth() + 1,
    day: base.getUTCDate(),
  };
}

function addMonthsUtc(dt: IcsDateTime, months: number): IcsDateTime {
  const total = (dt.year * 12 + (dt.month - 1)) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { ...dt, year, month, day: Math.min(dt.day, lastDay) };
}

function weekdayOf(dt: IcsDateTime): number {
  return new Date(Date.UTC(dt.year, dt.month - 1, dt.day)).getUTCDay();
}

/**
 * The wall-clock starts a rule produces inside a window.
 *
 * The Sunday service a church set up years ago is the ordinary case, so the
 * cursor skips straight to the window rather than stepping through every week
 * since — walking them would blow the iteration cap long before reaching the
 * dates anybody asked about. COUNT is the exception: how many occurrences have
 * already happened is exactly what decides whether the series has ended, so a
 * counted rule is walked from the beginning, which its own COUNT bounds.
 */
function ruleStarts(
  start: IcsDateTime,
  rule: Rule,
  rangeStart: Date,
  rangeEnd: Date,
): IcsDateTime[] {
  const starts: IcsDateTime[] = [];
  let cursor = rule.count === null ? fastForward(start, rule, rangeStart) : start;
  let generated = 0;
  let periods = 0;

  const push = (candidate: IcsDateTime): boolean => {
    const instant = wallTimeToUtc(candidate);
    if (rule.until && instant.getTime() > rule.until.getTime()) return false;
    if (instant.getTime() > rangeEnd.getTime()) return false;
    generated += 1;
    // Occurrences before the window still count toward COUNT, but nothing
    // downstream needs them.
    if (instant.getTime() >= rangeStart.getTime()) starts.push(candidate);
    return !(rule.count !== null && generated >= rule.count);
  };

  while (periods < MAX_OCCURRENCES && starts.length < MAX_OCCURRENCES) {
    let keepGoing = true;

    if (rule.freq === "WEEKLY" && rule.byDay.length > 0) {
      // A weekly rule can name several days; walk the week the cursor opens.
      const weekStart = addDaysUtc(cursor, -weekdayOf(cursor));
      for (const day of [...rule.byDay].sort((a, b) => a.weekday - b.weekday)) {
        const candidate = addDaysUtc(weekStart, day.weekday);
        if (
          wallTimeToUtc(candidate).getTime() < wallTimeToUtc(start).getTime()
        ) {
          continue;
        }
        keepGoing = push(candidate);
        if (!keepGoing) break;
      }
    } else if (rule.freq === "MONTHLY" && rule.byDay.length > 0) {
      for (const day of rule.byDay) {
        const candidate = nthWeekdayOfMonth(cursor, day.weekday, day.ordinal);
        if (!candidate) continue;
        if (
          wallTimeToUtc(candidate).getTime() < wallTimeToUtc(start).getTime()
        ) {
          continue;
        }
        keepGoing = push(candidate);
        if (!keepGoing) break;
      }
    } else if (rule.freq === "MONTHLY" && rule.byMonthDay.length > 0) {
      for (const monthDay of rule.byMonthDay) {
        const lastDay = new Date(
          Date.UTC(cursor.year, cursor.month, 0),
        ).getUTCDate();
        const day = monthDay > 0 ? monthDay : lastDay + monthDay + 1;
        if (day < 1 || day > lastDay) continue;
        keepGoing = push({ ...cursor, day });
        if (!keepGoing) break;
      }
    } else {
      keepGoing = push(cursor);
    }

    if (!keepGoing) break;

    periods += 1;
    if (rule.freq === "DAILY") cursor = addDaysUtc(cursor, rule.interval);
    else if (rule.freq === "WEEKLY") cursor = addDaysUtc(cursor, 7 * rule.interval);
    else if (rule.freq === "MONTHLY") cursor = addMonthsUtc(cursor, rule.interval);
    else cursor = addMonthsUtc(cursor, 12 * rule.interval);

    // Past the window and not counting toward a COUNT limit: nothing later
    // can come back into range.
    if (wallTimeToUtc(cursor).getTime() > rangeEnd.getTime()) break;
  }

  return starts;
}

/**
 * Moves the cursor to the last period that starts on or before the window,
 * without generating anything in between.
 *
 * One period short of the window rather than exactly at it, so a rule whose
 * period contains several days (WEEKLY;BYDAY=TU,TH) cannot skip past the days
 * that fall inside.
 */
function fastForward(
  start: IcsDateTime,
  rule: Rule,
  rangeStart: Date,
): IcsDateTime {
  const startMs = wallTimeToUtc(start).getTime();
  const targetMs = rangeStart.getTime();
  if (startMs >= targetMs) return start;

  if (rule.freq === "DAILY" || rule.freq === "WEEKLY") {
    const periodDays = rule.freq === "DAILY" ? rule.interval : 7 * rule.interval;
    const elapsedDays = Math.floor((targetMs - startMs) / 86_400_000);
    const periods = Math.floor(elapsedDays / periodDays) - 1;
    return periods > 0 ? addDaysUtc(start, periods * periodDays) : start;
  }

  const monthsPerPeriod =
    rule.freq === "MONTHLY" ? rule.interval : 12 * rule.interval;
  const target = new Date(targetMs);
  const elapsedMonths =
    (target.getUTCFullYear() - start.year) * 12 +
    (target.getUTCMonth() + 1 - start.month);
  const periods = Math.floor(elapsedMonths / monthsPerPeriod) - 1;
  return periods > 0 ? addMonthsUtc(start, periods * monthsPerPeriod) : start;
}

function nthWeekdayOfMonth(
  month: IcsDateTime,
  weekday: number,
  ordinal: number | null,
): IcsDateTime | null {
  const first = { ...month, day: 1 };
  const lastDay = new Date(Date.UTC(month.year, month.month, 0)).getUTCDate();

  if (ordinal === null || ordinal > 0) {
    const shift = (weekday - weekdayOf(first) + 7) % 7;
    const day = 1 + shift + ((ordinal ?? 1) - 1) * 7;
    return day <= lastDay ? { ...month, day } : null;
  }

  const last = { ...month, day: lastDay };
  const shift = (weekdayOf(last) - weekday + 7) % 7;
  const day = lastDay - shift + (ordinal + 1) * 7;
  return day >= 1 ? { ...month, day } : null;
}

/**
 * Flattens parsed VEVENTs into the occurrences that fall inside a window.
 *
 * Overrides (a VEVENT carrying RECURRENCE-ID — "this week's service moved to
 * the park") replace the occurrence they name, and cancellations drop out.
 */
export function expandIcsEvents(
  events: IcsEvent[],
  rangeStartISO: string,
  rangeEndISO: string,
): IcsOccurrence[] {
  const rangeStart = new Date(rangeStartISO);
  const rangeEnd = new Date(rangeEndISO);

  const masters = new Map<string, IcsEvent>();
  const overrides = new Map<string, Map<string, IcsEvent>>();

  for (const event of events) {
    if (event.recurrenceId) {
      const byInstance = overrides.get(event.uid) ?? new Map<string, IcsEvent>();
      byInstance.set(icsDateTimeToISO(event.recurrenceId), event);
      overrides.set(event.uid, byInstance);
    } else {
      const existing = masters.get(event.uid);
      if (!existing || event.sequence >= existing.sequence) {
        masters.set(event.uid, event);
      }
    }
  }

  const occurrences: IcsOccurrence[] = [];

  const emit = (source: IcsEvent, startAt: Date, occurrenceId: string) => {
    if (source.status === "CANCELLED") return;

    const durationMs =
      source.end
        ? wallTimeToUtc(source.end).getTime() -
          wallTimeToUtc(source.start).getTime()
        : source.start.dateOnly
          ? 86_400_000
          : 0;
    const endAt =
      durationMs > 0 ? new Date(startAt.getTime() + durationMs) : null;

    // An event counts as in-window if any part of it is: a service that
    // started an hour ago is still the one happening now.
    const effectiveEnd = endAt ?? startAt;
    if (
      effectiveEnd.getTime() < rangeStart.getTime() ||
      startAt.getTime() > rangeEnd.getTime()
    ) {
      return;
    }

    occurrences.push({
      uid: source.uid,
      summary: source.summary,
      location: source.location,
      description: source.description,
      startAt: startAt.toISOString(),
      endAt: endAt ? endAt.toISOString() : null,
      allDay: source.start.dateOnly,
      occurrenceId,
      href: source.href,
    });
  };

  for (const [uid, master] of masters) {
    const instanceOverrides = overrides.get(uid) ?? new Map<string, IcsEvent>();
    const excluded = new Set(master.exdates.map(icsDateTimeToISO));
    const rule = master.rrule ? parseRrule(master.rrule) : null;

    const starts = rule
      ? ruleStarts(master.start, rule, rangeStart, rangeEnd)
      : [master.start];

    for (const wallStart of starts) {
      const instanceId = icsDateTimeToISO(wallStart);
      if (excluded.has(instanceId)) continue;

      const override = instanceOverrides.get(instanceId);
      if (override) {
        emit(override, wallTimeToUtc(override.start), instanceId);
        instanceOverrides.delete(instanceId);
        continue;
      }

      emit(master, wallTimeToUtc(wallStart), instanceId);
    }

    // An override can move an occurrence into a window the original series
    // never reached; those are still real events on the calendar.
    for (const [instanceId, override] of instanceOverrides) {
      emit(override, wallTimeToUtc(override.start), instanceId);
    }
  }

  // Overrides whose master never arrived (a partial CalDAV response) still
  // describe a real event.
  for (const [uid, byInstance] of overrides) {
    if (masters.has(uid)) continue;
    for (const [instanceId, override] of byInstance) {
      emit(override, wallTimeToUtc(override.start), instanceId);
    }
  }

  return occurrences.sort((a, b) => a.startAt.localeCompare(b.startAt));
}
