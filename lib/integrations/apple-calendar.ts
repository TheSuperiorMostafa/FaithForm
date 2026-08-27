import type { SupabaseClient } from "@supabase/supabase-js";

import {
  absoluteHref,
  calDavRequest,
  CalDavAuthError,
  CalDavError,
  parseMultiStatus,
  responseProperty,
  type CalDavCredentials,
} from "@/lib/integrations/caldav";
import { expandIcsEvents, parseIcsEvents } from "@/lib/integrations/ics";
import {
  getIntegration,
  markIntegrationNeedsReconnect,
} from "@/lib/integrations/tokens";
import type {
  AppleIntegrationMetadata,
  CalendarEventPreview,
} from "@/lib/integrations/types";

/**
 * iCloud Calendar for the announcements flow.
 *
 * Apple offers no OAuth for calendar data, so a church connects the way every
 * calendar app does: an Apple ID plus an app-specific password, over CalDAV.
 * The event ids this module hands back are prefixed `apple:` so the rest of
 * the app can tell an iCloud event from a Google one and write changes back to
 * the right place.
 */

const ICLOUD_DISCOVERY_URL = "https://caldav.icloud.com/.well-known/caldav";
const APPLE_EVENT_PREFIX = "apple:";

/**
 * Discovery hands back URLs from iCloud's own response, and each one is then
 * fetched with the church's Apple credentials attached. They only ever go to
 * Apple: a redirect or a tampered response that pointed somewhere else would
 * otherwise be handed a working password.
 */
function assertICloudUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new CalDavError("iCloud returned an address we could not read.");
  }

  const onApple =
    parsed.protocol === "https:" &&
    (parsed.hostname === "icloud.com" || parsed.hostname.endsWith(".icloud.com"));

  if (!onApple) {
    throw new CalDavError("Refusing to send iCloud credentials off Apple.");
  }
  return parsed.toString();
}

export class AppleReconnectRequiredError extends Error {
  constructor(
    message = "iCloud needs to be reconnected. Apple rejected the saved app-specific password.",
  ) {
    super(message);
    this.name = "AppleReconnectRequiredError";
  }
}

export function isAppleEventId(eventId: string): boolean {
  return eventId.startsWith(APPLE_EVENT_PREFIX);
}

/**
 * `apple:<calendar-object-href>#<occurrence>` — enough to find the .ics file
 * again, and to tell two occurrences of the same weekly service apart.
 */
export function buildAppleEventId(href: string, occurrenceId: string): string {
  return `${APPLE_EVENT_PREFIX}${href}#${occurrenceId}`;
}

export function parseAppleEventId(
  eventId: string,
): { href: string; occurrenceId: string } | null {
  if (!isAppleEventId(eventId)) return null;
  const rest = eventId.slice(APPLE_EVENT_PREFIX.length);
  const hash = rest.lastIndexOf("#");
  if (hash < 0) return { href: rest, occurrenceId: "" };
  return { href: rest.slice(0, hash), occurrenceId: rest.slice(hash + 1) };
}

export type AppleCalendarChoice = {
  url: string;
  name: string;
  /** False for subscribed or shared read-only calendars. */
  writable: boolean;
};

export type AppleDiscovery = {
  calendarHomeUrl: string;
  calendars: AppleCalendarChoice[];
};

/**
 * Walks iCloud's CalDAV discovery: well-known URL to principal, principal to
 * calendar home, home to the calendars that hold events.
 */
export async function discoverAppleCalendars(
  credentials: CalDavCredentials,
): Promise<AppleDiscovery> {
  const principalXml = `<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:">
  <d:prop><d:current-user-principal /></d:prop>
</d:propfind>`;

  const principalRes = await calDavRequest(
    ICLOUD_DISCOVERY_URL,
    credentials,
    { method: "PROPFIND", depth: "0", body: principalXml },
  );

  const principalHref = parseMultiStatus(principalRes.text)
    .map((response) => responseProperty(response, "current-user-principal"))
    .map((value) => value?.match(/<(?:[A-Za-z0-9_.-]+:)?href[^>]*>([\s\S]*?)</i)?.[1])
    .find(Boolean);

  if (!principalHref) {
    throw new CalDavError("iCloud did not return a calendar account.");
  }

  const principalUrl = assertICloudUrl(
    absoluteHref(principalHref.trim(), ICLOUD_DISCOVERY_URL),
  );

  const homeXml = `<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><c:calendar-home-set /></d:prop>
</d:propfind>`;

  const homeRes = await calDavRequest(principalUrl, credentials, {
    method: "PROPFIND",
    depth: "0",
    body: homeXml,
  });

  const homeHref = parseMultiStatus(homeRes.text)
    .map((response) => responseProperty(response, "calendar-home-set"))
    .map((value) => value?.match(/<(?:[A-Za-z0-9_.-]+:)?href[^>]*>([\s\S]*?)</i)?.[1])
    .find(Boolean);

  if (!homeHref) {
    throw new CalDavError("iCloud did not return a calendar list.");
  }

  const calendarHomeUrl = assertICloudUrl(
    absoluteHref(homeHref.trim(), principalUrl),
  );

  const listXml = `<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:displayname />
    <d:resourcetype />
    <d:current-user-privilege-set />
    <c:supported-calendar-component-set />
  </d:prop>
</d:propfind>`;

  const listRes = await calDavRequest(calendarHomeUrl, credentials, {
    method: "PROPFIND",
    depth: "1",
    body: listXml,
  });

  const calendars: AppleCalendarChoice[] = [];

  for (const response of parseMultiStatus(listRes.text)) {
    const resourceType = responseProperty(response, "resourcetype") ?? "";
    if (!/<(?:[A-Za-z0-9_.-]+:)?calendar\b/i.test(resourceType)) continue;

    // Skip the scheduling inbox/outbox, which are calendars by resource type
    // but hold invitations rather than a church's events.
    if (/(?:inbox|outbox|notification)/i.test(resourceType)) continue;

    const components =
      responseProperty(response, "supported-calendar-component-set") ?? "";
    if (components && !/name="VEVENT"/i.test(components)) continue;

    let url: string;
    try {
      url = assertICloudUrl(absoluteHref(response.href, calendarHomeUrl));
    } catch {
      continue;
    }
    if (url.replace(/\/$/, "") === calendarHomeUrl.replace(/\/$/, "")) continue;

    const privileges =
      responseProperty(response, "current-user-privilege-set") ?? "";

    calendars.push({
      url,
      name:
        responseProperty(response, "displayname")?.trim() ||
        decodeURIComponent(url.replace(/\/$/, "").split("/").pop() ?? "Calendar"),
      // No privilege set reported means iCloud did not narrow it; assume the
      // owner's own calendar is writable and let a failed write say otherwise.
      writable: privileges
        ? /<(?:[A-Za-z0-9_.-]+:)?write(?:-content)?\b/i.test(privileges)
        : true,
    });
  }

  if (calendars.length === 0) {
    throw new CalDavError("That Apple ID has no calendars we can read.");
  }

  return { calendarHomeUrl, calendars };
}

type AppleConnection = {
  credentials: CalDavCredentials;
  calendarUrl: string;
  calendarName: string;
};

async function getAppleConnection(
  churchId: string,
  supabase?: SupabaseClient,
): Promise<AppleConnection | null> {
  const integration = await getIntegration(churchId, "apple", supabase);
  if (!integration?.access_token) return null;

  const metadata = (integration.metadata ?? {}) as AppleIntegrationMetadata;
  if (!metadata.apple_id || !metadata.calendar_url) return null;

  return {
    credentials: {
      username: metadata.apple_id,
      password: integration.access_token,
    },
    calendarUrl: assertICloudUrl(metadata.calendar_url),
    calendarName: metadata.calendar_name ?? "iCloud",
  };
}

async function flagReconnect(
  churchId: string,
  supabase?: SupabaseClient,
): Promise<never> {
  await markIntegrationNeedsReconnect(
    churchId,
    "apple",
    "Apple rejected the saved app-specific password. Reconnect iCloud in Settings.",
    supabase,
  );
  throw new AppleReconnectRequiredError();
}

/** CalDAV time-range filters use basic-format UTC: 20260804T200000Z. */
function toCalDavStamp(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export async function listAppleCalendarEventsInRange(
  churchId: string,
  startISO: string,
  endISO: string,
  supabase?: SupabaseClient,
): Promise<CalendarEventPreview[]> {
  const connection = await getAppleConnection(churchId, supabase);
  if (!connection) return [];

  const queryXml = `<?xml version="1.0" encoding="utf-8" ?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:getetag />
    <c:calendar-data />
  </d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT">
        <c:time-range start="${toCalDavStamp(startISO)}" end="${toCalDavStamp(endISO)}" />
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`;

  let text: string;
  try {
    ({ text } = await calDavRequest(connection.calendarUrl, connection.credentials, {
      method: "REPORT",
      depth: "1",
      body: queryXml,
    }));
  } catch (err) {
    if (err instanceof CalDavAuthError) await flagReconnect(churchId, supabase);
    throw err;
  }

  const events: CalendarEventPreview[] = [];

  for (const response of parseMultiStatus(text)) {
    const calendarData = responseProperty(response, "calendar-data");
    if (!calendarData?.trim()) continue;

    let href: string;
    try {
      href = assertICloudUrl(absoluteHref(response.href, connection.calendarUrl));
    } catch {
      continue;
    }
    const parsed = parseIcsEvents(calendarData).map((event) => ({
      ...event,
      href,
    }));

    // iCloud returns whole calendar objects, recurrence rules intact, so the
    // occurrences inside the window are worked out here.
    for (const occurrence of expandIcsEvents(parsed, startISO, endISO)) {
      events.push({
        googleEventId: buildAppleEventId(href, occurrence.occurrenceId),
        calendarId: connection.calendarUrl,
        title: occurrence.summary || "Untitled event",
        location: occurrence.location,
        startAt: occurrence.startAt,
        endAt: occurrence.endAt,
        allDay: occurrence.allDay,
        source: "apple",
      });
    }
  }

  return events.sort((a, b) => a.startAt.localeCompare(b.startAt));
}

function icsStamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function icsEscape(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** Folds a content line at 75 octets, as RFC 5545 requires. */
function foldLine(line: string): string {
  if (line.length <= 74) return line;
  const pieces: string[] = [line.slice(0, 74)];
  let rest = line.slice(74);
  while (rest.length > 73) {
    pieces.push(` ${rest.slice(0, 73)}`);
    rest = rest.slice(73);
  }
  if (rest) pieces.push(` ${rest}`);
  return pieces.join("\r\n");
}

export function buildEventIcs(input: {
  uid: string;
  title: string;
  location?: string;
  description?: string;
  startAt: string;
  endAt: string | null;
  now?: Date;
}): string {
  const start = new Date(input.startAt);
  const end = input.endAt
    ? new Date(input.endAt)
    : new Date(start.getTime() + 60 * 60 * 1000);

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//FaithForm//Announcements//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${input.uid}`,
    `DTSTAMP:${icsStamp(input.now ?? new Date())}`,
    `DTSTART:${icsStamp(start)}`,
    `DTEND:${icsStamp(end)}`,
    `SUMMARY:${icsEscape(input.title)}`,
    ...(input.location?.trim()
      ? [`LOCATION:${icsEscape(input.location.trim())}`]
      : []),
    ...(input.description?.trim()
      ? [`DESCRIPTION:${icsEscape(input.description.trim())}`]
      : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}

export async function insertAppleCalendarEvent(
  churchId: string,
  input: {
    title: string;
    location?: string;
    description?: string;
    startAt: string;
    endAt: string | null;
  },
  supabase?: SupabaseClient,
): Promise<CalendarEventPreview> {
  const connection = await getAppleConnection(churchId, supabase);
  if (!connection) {
    throw new CalDavError("iCloud Calendar is not connected.");
  }

  const uid = `${crypto.randomUUID()}@faithform.io`;
  const href = `${connection.calendarUrl.replace(/\/$/, "")}/${uid}.ics`;
  const ics = buildEventIcs({ uid, ...input });

  try {
    await calDavRequest(href, connection.credentials, {
      method: "PUT",
      body: ics,
      contentType: "text/calendar; charset=utf-8",
      headers: { "If-None-Match": "*" },
    });
  } catch (err) {
    if (err instanceof CalDavAuthError) await flagReconnect(churchId, supabase);
    throw err;
  }

  const start = new Date(input.startAt);
  return {
    googleEventId: buildAppleEventId(href, start.toISOString()),
    calendarId: connection.calendarUrl,
    title: input.title,
    location: input.location ?? "",
    startAt: start.toISOString(),
    endAt: input.endAt,
    source: "apple",
  };
}

/**
 * Rewrites the fields an announcement owns on an existing iCloud event.
 *
 * Only whole events, never one occurrence of a series: splitting a recurrence
 * from here would quietly rewrite a church's weekly service, so a repeating
 * event is left alone and the caller is told to edit it in Apple Calendar.
 */
export async function patchAppleCalendarEvent(
  churchId: string,
  input: {
    eventId: string;
    title: string;
    location: string;
    startAt: string;
    endAt: string | null;
  },
  supabase?: SupabaseClient,
): Promise<void> {
  const connection = await getAppleConnection(churchId, supabase);
  if (!connection) {
    throw new CalDavError("iCloud Calendar is not connected.");
  }

  const parsedId = parseAppleEventId(input.eventId);
  if (!parsedId) {
    throw new CalDavError("That is not an iCloud event.");
  }

  const href = assertICloudUrl(parsedId.href);

  let existing: { text: string; etag: string | null };
  try {
    existing = await calDavRequest(href, connection.credentials, {
      method: "GET",
      contentType: "text/calendar",
    });
  } catch (err) {
    if (err instanceof CalDavAuthError) await flagReconnect(churchId, supabase);
    throw err;
  }

  if (/^RRULE:/im.test(existing.text)) {
    throw new CalDavError(
      "This is a repeating iCloud event — change it in Apple Calendar so the whole series stays right.",
    );
  }

  const uid =
    existing.text.match(/^UID:(.+)$/im)?.[1]?.trim() ??
    `${crypto.randomUUID()}@faithform.io`;

  const ics = buildEventIcs({
    uid,
    title: input.title,
    location: input.location,
    startAt: input.startAt,
    endAt: input.endAt,
  });

  try {
    await calDavRequest(href, connection.credentials, {
      method: "PUT",
      body: ics,
      contentType: "text/calendar; charset=utf-8",
      // Only overwrite the version we just read — a change made in Apple
      // Calendar in the meantime should win rather than be silently lost.
      headers: existing.etag ? { "If-Match": `"${existing.etag}"` } : {},
    });
  } catch (err) {
    if (err instanceof CalDavAuthError) await flagReconnect(churchId, supabase);
    if (err instanceof CalDavError && err.status === 412) {
      throw new CalDavError(
        "That event changed in Apple Calendar while you were editing. Reload and try again.",
      );
    }
    throw err;
  }
}
