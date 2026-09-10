import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  APPLE_FEED_CALENDAR_ID,
  eventsFromAppleFeed,
  isReadOnlyAppleEventId,
} from "@/lib/integrations/apple-calendar";
import {
  calendarNameFromIcs,
  CalendarFeedError,
  fetchICloudFeed,
  normalizeICloudFeedUrl,
} from "@/lib/integrations/apple-feed";

const TOKEN = "AcGEBg-ryzF63EYuGV_LyT0qvX6tUAPfGZJrSU";

/** Shaped like a real iCloud public feed: zone names, a series, an override. */
const FEED = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//caldav.icloud.com//CALDAVJ 2632B909//EN",
  "X-WR-CALNAME:Grace Church\\, Events",
  "BEGIN:VEVENT",
  "UID:potluck-1@icloud.com",
  "DTSTART;TZID=America/New_York:20260912T180000",
  "DTEND;TZID=America/New_York:20260912T200000",
  "SUMMARY:Fall potluck",
  "LOCATION:Fellowship Hall",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:youth-weekly@icloud.com",
  "DTSTART;TZID=America/New_York:20260902T190000",
  "DTEND;TZID=America/New_York:20260902T203000",
  "RRULE:FREQ=WEEKLY;BYDAY=WE",
  "SUMMARY:Youth night",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:picnic@icloud.com",
  "DTSTART;VALUE=DATE:20260919",
  "DTEND;VALUE=DATE:20260920",
  "SUMMARY:Church picnic",
  "END:VEVENT",
  "END:VCALENDAR",
  "",
].join("\r\n");

test("a pasted link becomes the https address Apple serves it on", () => {
  const https = `https://p38-calendars.icloud.com/published/2/${TOKEN}`;
  assert.equal(normalizeICloudFeedUrl(`webcal://p38-calendars.icloud.com/published/2/${TOKEN}`), https);
  assert.equal(normalizeICloudFeedUrl(`  webcal://p38-calendars.icloud.com/published/2/${TOKEN}\n`), https);
  assert.equal(normalizeICloudFeedUrl(`http://p38-calendars.icloud.com/published/2/${TOKEN}`), https);
  assert.equal(normalizeICloudFeedUrl(`p38-calendars.icloud.com/published/2/${TOKEN}`), https);
  assert.equal(normalizeICloudFeedUrl(https), https);
});

test("anything that is not an iCloud public calendar link is refused", () => {
  for (const input of [
    "",
    "not a link",
    `https://evil.example/published/2/${TOKEN}`,
    `https://icloud.com.evil.example/published/2/${TOKEN}`,
    "https://p38-caldav.icloud.com/1234/calendars/home/",
    `https://user:pass@p38-calendars.icloud.com/published/2/${TOKEN}`,
    `ftp://p38-calendars.icloud.com/published/2/${TOKEN}`,
    "https://calendar.google.com/calendar/ical/x/public/basic.ics",
  ]) {
    assert.equal(normalizeICloudFeedUrl(input), null, input);
  }
});

test("the calendar's own name is read from the feed", () => {
  assert.equal(calendarNameFromIcs(FEED), "Grace Church, Events");
  assert.equal(calendarNameFromIcs("BEGIN:VCALENDAR\r\nEND:VCALENDAR"), null);
});

type Seen = { url: string; headers: Headers };

async function withFetch(respond: (seen: Seen) => Response, run: (seen: Seen[]) => Promise<void>) {
  const original = globalThis.fetch;
  const seen: Seen[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const entry = { url: String(input), headers: new Headers(init?.headers) };
    seen.push(entry);
    return respond(entry);
  }) as typeof fetch;
  try {
    await run(seen);
  } finally {
    globalThis.fetch = original;
  }
}

const LINK = `webcal://p38-calendars.icloud.com/published/2/${TOKEN}`;

test("a live link is read with a plain GET and no login of any kind", async () => {
  await withFetch(
    () => new Response(FEED, { status: 200, headers: { "content-type": "text/calendar" } }),
    async (seen) => {
      const text = await fetchICloudFeed(LINK);
      assert.match(text, /BEGIN:VCALENDAR/);
      assert.equal(seen.length, 1);
      assert.equal(seen[0]?.url, `https://p38-calendars.icloud.com/published/2/${TOKEN}`);
      assert.equal(seen[0]?.headers.get("authorization"), null);
      assert.equal(seen[0]?.headers.get("cookie"), null);
    },
  );
});

test("a link whose sharing was turned off says how to fix it", async () => {
  await withFetch(
    () => new Response("", { status: 404 }),
    async () => {
      const failure = await fetchICloudFeed(LINK).catch((err: unknown) => err);
      assert.ok(failure instanceof CalendarFeedError);
      assert.equal((failure as CalendarFeedError).gone, true);
      assert.match((failure as Error).message, /Public Calendar/);
    },
  );
});

test("redirects are followed only while they stay on iCloud", async () => {
  await withFetch(
    (seen) =>
      seen.url.includes("p38-")
        ? new Response(null, {
            status: 301,
            headers: { location: `https://p12-calendars.icloud.com/published/2/${TOKEN}` },
          })
        : new Response(FEED, { status: 200 }),
    async (seen) => {
      await fetchICloudFeed(LINK);
      assert.equal(seen.length, 2);
      assert.match(seen[1]?.url ?? "", /^https:\/\/p12-calendars\.icloud\.com\//);
    },
  );

  await withFetch(
    () => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } }),
    async (seen) => {
      await assert.rejects(fetchICloudFeed(LINK), CalendarFeedError);
      assert.equal(seen.length, 1, "the internal address was never requested");
    },
  );
});

test("a page that is not a calendar is not accepted as one", async () => {
  await withFetch(
    () => new Response("<html>Sign in</html>", { status: 200, headers: { "content-type": "text/html" } }),
    async () => {
      await assert.rejects(fetchICloudFeed(LINK), /did not return a calendar/);
    },
  );
});

test("feed events are read-only, keyed by UID, and never carry the link", () => {
  const events = eventsFromAppleFeed(
    FEED,
    "2026-09-01T00:00:00.000Z",
    "2026-09-30T00:00:00.000Z",
  );

  assert.ok(events.length >= 5, `expected the series to expand, got ${events.length}`);
  assert.ok(events.every((event) => event.readOnly === true));
  assert.ok(events.every((event) => event.source === "apple"));
  assert.ok(events.every((event) => event.calendarId === APPLE_FEED_CALENDAR_ID));
  assert.ok(events.every((event) => isReadOnlyAppleEventId(event.googleEventId)));
  assert.ok(events.every((event) => !event.googleEventId.includes("published")));

  const potluck = events.find((event) => event.title === "Fall potluck");
  // A one-off event's id does not change when it is moved in Apple Calendar.
  assert.equal(potluck?.googleEventId, "apple:feed:potluck-1@icloud.com");
  assert.equal(potluck?.startAt, "2026-09-12T22:00:00.000Z");

  const youth = events.filter((event) => event.title === "Youth night");
  assert.ok(youth.length >= 4);
  assert.equal(new Set(youth.map((event) => event.googleEventId)).size, youth.length);
  assert.ok(youth.every((event) => event.googleEventId.startsWith("apple:feed:youth-weekly@icloud.com#")));

  const picnic = events.find((event) => event.title === "Church picnic");
  assert.equal(picnic?.allDay, true);
});

test("CalDAV ids and Google ids are never mistaken for read-only ones", () => {
  assert.equal(isReadOnlyAppleEventId("apple:https://p52-caldav.icloud.com/9/calendars/church/evt.ics"), false);
  assert.equal(isReadOnlyAppleEventId("abc123googleid"), false);
});

test("nothing tries to write to a calendar connected by link", () => {
  const actions = readFileSync("app/dashboard/announcements/actions.ts", "utf8");
  assert.match(actions, /!isReadOnlyAppleEventId\(payload\.googleEventId\)/);

  const calendar = readFileSync("lib/integrations/calendar.ts", "utf8");
  assert.match(calendar, /status\.apple\.connected && !status\.apple\.readOnly/);

  const apple = readFileSync("lib/integrations/apple-calendar.ts", "utf8");
  const patch = apple.slice(apple.indexOf("export async function patchAppleCalendarEvent"));
  assert.match(patch, /isReadOnlyAppleEventId\(input\.eventId\)/);
  assert.match(apple, /if \(loaded\.mode === "public_link"\) throw new CalDavError\(READ_ONLY_ICLOUD_MESSAGE\)/);
});

test("the link is stored like a key, never in the metadata browsers see", () => {
  const actions = readFileSync("app/dashboard/settings/apple-calendar-actions.ts", "utf8");
  const connect = actions.slice(actions.indexOf("export async function connectAppleCalendarLinkAction"));
  assert.match(connect, /accessToken: inspected\.feedUrl/);

  const metadataBlock = connect.slice(
    connect.indexOf("const metadata: AppleIntegrationMetadata"),
    connect.indexOf("try {", connect.indexOf("const metadata: AppleIntegrationMetadata")),
  );
  assert.doesNotMatch(metadataBlock, /feedUrl|calendar_url|published/);

  const tokens = readFileSync("lib/integrations/tokens.ts", "utf8");
  const appleBranch = tokens.indexOf('if (provider === "apple")');
  const returned = tokens.slice(
    tokens.indexOf("return {", appleBranch),
    tokens.indexOf("};", tokens.indexOf("return {", appleBranch)),
  );
  // What the browser gets for iCloud: health flags, mode, Apple ID, name.
  assert.deepEqual(
    [...returned.matchAll(/^\s+(\.\.\.common|\w+):/gm)].map((m) => m[1]),
    ["mode", "apple_id", "calendar_name"],
  );
  assert.doesNotMatch(returned, /access_token|calendar_url|feed/i);
});
