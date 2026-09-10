/**
 * Reading an iCloud calendar through its "Public Calendar" link.
 *
 * This is the no-password way in. A church turns on Public Calendar in Apple
 * Calendar and pastes the link it gets; FaithForm reads the calendar the way
 * any calendar app subscribes to one. Nothing is sent but a GET, and nothing
 * can be written back, which is the price of never asking for an Apple ID.
 *
 * Only links on icloud.com are accepted. The server fetches whatever URL is
 * stored here, so an open-ended "any calendar URL" field would let anyone with
 * admin access point FaithForm's servers at internal addresses.
 */

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;
/** A decade of a busy church calendar is well under this. */
const MAX_FEED_BYTES = 10 * 1024 * 1024;

export class CalendarFeedError extends Error {
  constructor(
    message: string,
    /** True when the link itself is dead, not just unreachable right now. */
    readonly gone = false,
  ) {
    super(message);
    this.name = "CalendarFeedError";
  }
}

function isICloudHost(url: URL): boolean {
  return (
    url.protocol === "https:" &&
    (url.hostname === "icloud.com" || url.hostname.endsWith(".icloud.com"))
  );
}

/**
 * Turns whatever was pasted into the https URL to fetch, or null when it is not
 * an iCloud public calendar link.
 *
 * Apple hands the link out as `webcal://p42-caldav.icloud.com/published/2/…`.
 * webcal is only a hint to open a calendar app; the calendar itself is served
 * over https at the same address.
 */
export function normalizeICloudFeedUrl(input: string): string | null {
  const raw = input.trim().replace(/^<|>$/g, "");
  if (!raw) return null;

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;

  let url: URL;
  try {
    url = new URL(withScheme.replace(/^(webcals?|http):\/\//i, "https://"));
  } catch {
    return null;
  }

  if (!isICloudHost(url)) return null;
  if (!url.pathname.startsWith("/published/")) return null;
  if (url.username || url.password) return null;

  url.hash = "";
  return url.toString();
}

/** The calendar's own name, when Apple includes one. */
export function calendarNameFromIcs(ics: string): string | null {
  const match = ics.match(/^X-WR-CALNAME(?:;[^:\r\n]*)?:(.*)$/im);
  const name = match?.[1]?.trim();
  return name ? name.replace(/\\([,;\\])/g, "$1") : null;
}

export async function fetchICloudFeed(feedUrl: string): Promise<string> {
  const normalized = normalizeICloudFeedUrl(feedUrl);
  if (!normalized) {
    throw new CalendarFeedError("That is not an iCloud calendar link.");
  }
  let target: string = normalized;

  let response: Response;
  for (let hop = 0; ; hop += 1) {
    try {
      response = await fetch(target, {
        method: "GET",
        headers: { Accept: "text/calendar, */*;q=0.5" },
        redirect: "manual",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        cache: "no-store",
      });
    } catch (err) {
      const timedOut = err instanceof Error && err.name === "TimeoutError";
      throw new CalendarFeedError(
        timedOut
          ? "iCloud did not answer in time. Try again in a moment."
          : "Could not reach iCloud. Try again in a moment.",
      );
    }

    const location = response.headers.get("location");
    if (response.status < 300 || response.status >= 400 || !location) break;

    const next: URL = new URL(location, target);
    if (hop >= MAX_REDIRECTS || !isICloudHost(next)) {
      throw new CalendarFeedError("iCloud sent that link somewhere FaithForm will not follow.");
    }
    target = next.toString();
  }

  // Turning Public Calendar off, or deleting the calendar, kills the link.
  // Apple answers 404 for that, and 400 for a link that was never whole.
  if (response.status === 404 || response.status === 410 || response.status === 400) {
    throw new CalendarFeedError(
      "iCloud says that calendar link no longer works. In Apple Calendar, check Public Calendar is still on, then copy the link again.",
      true,
    );
  }
  if (!response.ok) {
    throw new CalendarFeedError(`iCloud refused the calendar link (${response.status}).`);
  }

  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > MAX_FEED_BYTES) {
    throw new CalendarFeedError("That calendar is too large to read.");
  }

  const text = await response.text();
  if (text.length > MAX_FEED_BYTES) {
    throw new CalendarFeedError("That calendar is too large to read.");
  }
  if (!/BEGIN:VCALENDAR/i.test(text)) {
    throw new CalendarFeedError("That link did not return a calendar.");
  }

  return text;
}
