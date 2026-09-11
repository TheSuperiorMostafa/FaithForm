import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  absoluteHref,
  calDavRequest,
  CalDavAuthError,
  CalDavError,
  parseMultiStatus,
  responseProperty,
  toEntityTag,
} from "@/lib/integrations/caldav";
import {
  buildAppleEventId,
  buildEventIcs,
  discoverAppleCalendars,
  isAppleEventId,
  parseAppleEventId,
} from "@/lib/integrations/apple-calendar";
import { parseIcsEvents } from "@/lib/integrations/ics";

/** Shaped like what iCloud actually returns, prefixes and all. */
const CALENDAR_LIST = `<?xml version="1.0" encoding="UTF-8"?>
<multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <response>
    <href>/1234567890/calendars/</href>
    <propstat>
      <prop>
        <displayname></displayname>
        <resourcetype><collection/></resourcetype>
      </prop>
      <status>HTTP/1.1 200 OK</status>
    </propstat>
  </response>
  <response>
    <href>/1234567890/calendars/church-events/</href>
    <propstat>
      <prop>
        <displayname>Church &amp; Staff</displayname>
        <resourcetype><collection/><C:calendar/></resourcetype>
        <current-user-privilege-set><privilege><read/></privilege><privilege><write/></privilege></current-user-privilege-set>
        <C:supported-calendar-component-set><C:comp name="VEVENT"/></C:supported-calendar-component-set>
      </prop>
      <status>HTTP/1.1 200 OK</status>
    </propstat>
  </response>
  <response>
    <href>/1234567890/calendars/tasks/</href>
    <propstat>
      <prop>
        <displayname>Reminders</displayname>
        <resourcetype><collection/><C:calendar/></resourcetype>
        <C:supported-calendar-component-set><C:comp name="VTODO"/></C:supported-calendar-component-set>
      </prop>
      <status>HTTP/1.1 200 OK</status>
    </propstat>
  </response>
</multistatus>`;

test("a multistatus body yields one entry per response", () => {
  const responses = parseMultiStatus(CALENDAR_LIST);
  assert.equal(responses.length, 3);
  assert.deepEqual(
    responses.map((r) => r.href),
    [
      "/1234567890/calendars/",
      "/1234567890/calendars/church-events/",
      "/1234567890/calendars/tasks/",
    ],
  );
});

test("properties are read by local name and unescaped", () => {
  const [, churchCalendar] = parseMultiStatus(CALENDAR_LIST);
  assert.ok(churchCalendar);
  assert.equal(
    responseProperty(churchCalendar, "displayname"),
    "Church & Staff",
  );
  assert.match(
    responseProperty(churchCalendar, "supported-calendar-component-set") ?? "",
    /name="VEVENT"/,
  );
  assert.match(
    responseProperty(churchCalendar, "current-user-privilege-set") ?? "",
    /<write\/>/,
  );
});

test("a namespace-prefixed body parses the same way", () => {
  const prefixed = `<?xml version="1.0"?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:response>
    <D:href>/9/calendars/home/</D:href>
    <D:propstat><D:prop><D:displayname>Home</D:displayname></D:prop></D:propstat>
  </D:response>
</D:multistatus>`;

  const [response] = parseMultiStatus(prefixed);
  assert.equal(response?.href, "/9/calendars/home/");
  assert.equal(responseProperty(response!, "displayname"), "Home");
});

test("hrefs resolve against the collection they came from", () => {
  assert.equal(
    absoluteHref(
      "/1234567890/calendars/church-events/abc.ics",
      "https://p52-caldav.icloud.com/1234567890/calendars/church-events/",
    ),
    "https://p52-caldav.icloud.com/1234567890/calendars/church-events/abc.ics",
  );
  assert.equal(
    absoluteHref(
      "https://p52-caldav.icloud.com/9/calendars/",
      "https://caldav.icloud.com/9/principal/",
    ),
    "https://p52-caldav.icloud.com/9/calendars/",
  );
});

test("calendar-data survives the round trip out of the XML", () => {
  const report = `<?xml version="1.0"?>
<multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <response>
    <href>/9/calendars/church/evt.ics</href>
    <propstat>
      <prop>
        <getetag>"C=12@U=abc"</getetag>
        <C:calendar-data>BEGIN:VCALENDAR&#13;
VERSION:2.0&#13;
BEGIN:VEVENT&#13;
UID:evt@example.org&#13;
DTSTART:20260804T200000Z&#13;
SUMMARY:Prayer &amp; Praise&#13;
END:VEVENT&#13;
END:VCALENDAR&#13;
</C:calendar-data>
      </prop>
      <status>HTTP/1.1 200 OK</status>
    </propstat>
  </response>
</multistatus>`;

  const [response] = parseMultiStatus(report);
  assert.equal(response?.etag, "C=12@U=abc");

  const [event] = parseIcsEvents(responseProperty(response!, "calendar-data")!);
  assert.equal(event?.uid, "evt@example.org");
  assert.equal(event?.summary, "Prayer & Praise");
});

test("an event id round-trips its calendar object and occurrence", () => {
  const href = "https://p52-caldav.icloud.com/9/calendars/church/evt.ics";
  const id = buildAppleEventId(href, "2026-08-04T20:00:00.000Z");

  assert.equal(isAppleEventId(id), true);
  assert.equal(isAppleEventId("abc123googleid"), false);
  assert.deepEqual(parseAppleEventId(id), {
    href,
    occurrenceId: "2026-08-04T20:00:00.000Z",
  });
});

test("a written event escapes its own text and folds long lines", () => {
  const ics = buildEventIcs({
    uid: "new@faithform.io",
    title: "Potluck, then prayer",
    location: "Fellowship Hall; upstairs",
    startAt: "2026-08-04T20:00:00.000Z",
    endAt: "2026-08-04T21:30:00.000Z",
    now: new Date("2026-08-01T09:00:00.000Z"),
  });

  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /DTSTART:20260804T200000Z/);
  assert.match(ics, /DTEND:20260804T213000Z/);
  assert.match(ics, /SUMMARY:Potluck\\, then prayer/);
  assert.match(ics, /LOCATION:Fellowship Hall\\; upstairs/);

  // What we write has to survive being read back.
  const [event] = parseIcsEvents(ics);
  assert.equal(event?.summary, "Potluck, then prayer");
  assert.equal(event?.location, "Fellowship Hall; upstairs");

  const long = buildEventIcs({
    uid: "long@faithform.io",
    title: "A".repeat(200),
    startAt: "2026-08-04T20:00:00.000Z",
    endAt: null,
  });
  for (const line of long.split("\r\n")) {
    assert.ok(line.length <= 75, `line too long: ${line.length}`);
  }
  assert.equal(parseIcsEvents(long)[0]?.summary, "A".repeat(200));
});

test("an event with no end is given an hour", () => {
  const ics = buildEventIcs({
    uid: "open@faithform.io",
    title: "Open prayer",
    startAt: "2026-08-04T20:00:00.000Z",
    endAt: null,
  });
  assert.match(ics, /DTEND:20260804T210000Z/);
});

// ---------------------------------------------------------------------------
// Requests: status handling, redirects, and entity tags
// ---------------------------------------------------------------------------

type Seen = { url: string; method: string; auth: string | null; body: string | undefined };

/** Swaps global fetch for a scripted one for the length of `run`. */
async function withFetch(
  respond: (seen: Seen) => Response,
  run: (seen: Seen[]) => Promise<void>,
) {
  const original = globalThis.fetch;
  const seen: Seen[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const entry: Seen = {
      url: String(input),
      method: init?.method ?? "GET",
      auth: headers.get("authorization"),
      body: typeof init?.body === "string" ? init.body : undefined,
    };
    seen.push(entry);
    return respond(entry);
  }) as typeof fetch;
  try {
    await run(seen);
  } finally {
    globalThis.fetch = original;
  }
}

const creds = { username: "pastor@icloud.com", password: "abcdabcdabcdabcd" };

test("an ETag goes back in If-Match exactly as iCloud sent it", () => {
  assert.equal(toEntityTag('"C=12@U=abc"'), '"C=12@U=abc"');
  assert.equal(toEntityTag('W/"weak-1"'), 'W/"weak-1"');
  // A bare value, as parseMultiStatus hands back, gets its quotes once.
  assert.equal(toEntityTag("C=12@U=abc"), '"C=12@U=abc"');
  assert.notEqual(toEntityTag('"C=12@U=abc"'), '""C=12@U=abc""');
});

test("only a 401 counts as a refused login; a 403 keeps the connection", async () => {
  await withFetch(
    () => new Response("", { status: 401 }),
    async () => {
      await assert.rejects(
        calDavRequest("https://p52-caldav.icloud.com/9/calendars/", creds, { method: "PROPFIND" }),
        CalDavAuthError,
      );
    },
  );

  await withFetch(
    () => new Response("read-only", { status: 403 }),
    async () => {
      const failure = await calDavRequest(
        "https://p52-caldav.icloud.com/9/calendars/shared/evt.ics",
        creds,
        { method: "PUT", body: "BEGIN:VCALENDAR" },
      ).catch((err: unknown) => err);
      assert.ok(failure instanceof CalDavError);
      assert.ok(!(failure instanceof CalDavAuthError));
      assert.equal((failure as CalDavError).status, 403);
    },
  );
});

test("a redirect to another iCloud host is followed with the login and the same request", async () => {
  await withFetch(
    (seen) =>
      seen.url.startsWith("https://caldav.icloud.com/")
        ? new Response(null, {
            status: 301,
            headers: { location: "https://p52-caldav.icloud.com/9/principal/" },
          })
        : new Response("<multistatus/>", { status: 207, headers: { etag: '"e1"' } }),
    async (seen) => {
      const result = await calDavRequest("https://caldav.icloud.com/.well-known/caldav", creds, {
        method: "PROPFIND",
        depth: "0",
        body: "<propfind/>",
        followRedirect: (url) => url.hostname.endsWith(".icloud.com"),
      });

      assert.equal(result.status, 207);
      assert.equal(result.etag, '"e1"');
      assert.equal(seen.length, 2);
      assert.equal(seen[1]?.url, "https://p52-caldav.icloud.com/9/principal/");
      assert.equal(seen[1]?.method, "PROPFIND");
      assert.equal(seen[1]?.body, "<propfind/>");
      assert.equal(seen[1]?.auth, seen[0]?.auth);
      assert.match(seen[1]?.auth ?? "", /^Basic /);
    },
  );
});

test("a redirect off Apple is refused before the login is sent there", async () => {
  await withFetch(
    () =>
      new Response(null, { status: 302, headers: { location: "https://attacker.example/steal" } }),
    async (seen) => {
      await assert.rejects(
        calDavRequest("https://caldav.icloud.com/.well-known/caldav", creds, {
          method: "PROPFIND",
          followRedirect: (url) => url.hostname.endsWith(".icloud.com"),
        }),
        CalDavError,
      );
      assert.equal(seen.length, 1);
      assert.ok(seen.every((entry) => !entry.url.includes("attacker.example")));
    },
  );
});

// ---------------------------------------------------------------------------
// Writing events
// ---------------------------------------------------------------------------

test("an all-day event is written as dates, not as midnight UTC", () => {
  const ics = buildEventIcs({
    uid: "retreat@faithform.io",
    title: "Men's retreat",
    startAt: "2026-09-12T00:00:00.000Z",
    endAt: "2026-09-15T00:00:00.000Z",
    allDay: true,
  });

  assert.match(ics, /DTSTART;VALUE=DATE:20260912\r\n/);
  assert.match(ics, /DTEND;VALUE=DATE:20260915\r\n/);
  assert.doesNotMatch(ics, /DTSTART:2026/);

  const [event] = parseIcsEvents(ics);
  assert.equal(event?.start.dateOnly, true);
  assert.equal(event?.end?.day, 15);
});

test("an all-day event with no end, or a bad one, is one day long", () => {
  for (const endAt of [null, "2026-09-12T00:00:00.000Z", "2026-09-10T00:00:00.000Z"]) {
    const ics = buildEventIcs({
      uid: "picnic@faithform.io",
      title: "Picnic",
      startAt: "2026-09-12T00:00:00.000Z",
      endAt,
      allDay: true,
    });
    assert.match(ics, /DTEND;VALUE=DATE:20260913\r\n/, `end ${endAt}`);
  }
});

test("a rewrite carries the event's notes and a higher sequence", () => {
  const ics = buildEventIcs({
    uid: "evt@example.org",
    title: "Prayer",
    description: "Bring a friend",
    startAt: "2026-08-04T20:00:00.000Z",
    endAt: null,
    sequence: 3,
  });
  assert.match(ics, /DESCRIPTION:Bring a friend/);
  assert.match(ics, /SEQUENCE:3/);
});

test("long lines fold by bytes and never split a character", () => {
  const title = `Café de oración 🙏 ${"é".repeat(60)} ${"🙏".repeat(20)}`;
  const ics = buildEventIcs({
    uid: "unicode@faithform.io",
    title,
    startAt: "2026-08-04T20:00:00.000Z",
    endAt: null,
  });

  for (const line of ics.split("\r\n")) {
    assert.ok(Buffer.byteLength(line, "utf8") <= 75, `line is ${Buffer.byteLength(line, "utf8")} bytes`);
    assert.doesNotMatch(line, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/, "a surrogate pair was split");
  }
  assert.equal(parseIcsEvents(ics)[0]?.summary, title);
});

test("a one-off event's id does not carry its start time", () => {
  const href = "https://p52-caldav.icloud.com/9/calendars/church/evt.ics";
  const id = buildAppleEventId(href, "");

  assert.equal(id, `apple:${href}`);
  assert.deepEqual(parseAppleEventId(id), { href, occurrenceId: "" });
});

test("the patch path sends the ETag through toEntityTag and keeps the notes", () => {
  const source = readFileSync("lib/integrations/apple-calendar.ts", "utf8");
  const patch = source.slice(source.indexOf("export async function patchAppleCalendarEvent"));
  assert.match(patch, /"If-Match": toEntityTag\(existing\.etag\)/);
  assert.doesNotMatch(patch, /"If-Match": `"\$\{existing\.etag\}"`/);
  assert.match(patch, /description: before\?\.description/);
});

// ---------------------------------------------------------------------------
// Discovery against what iCloud really sends
// ---------------------------------------------------------------------------

/**
 * iCloud's own dialect: single-quoted attributes, default namespaces declared
 * inline, a 404 propstat listing the properties it lacks as self-closing tags
 * with attributes, and the scheduling and notification collections sitting
 * beside the calendars. Every one of these had a way of emptying the list.
 */
const ICLOUD_PRINCIPAL = `<?xml version='1.0' encoding='UTF-8'?>
<multistatus xmlns='DAV:'>
  <response>
    <href>/</href>
    <propstat>
      <prop>
        <current-user-principal>
          <href>/123456789/principal/</href>
        </current-user-principal>
      </prop>
      <status>HTTP/1.1 200 OK</status>
    </propstat>
  </response>
</multistatus>`;

const ICLOUD_HOME = `<?xml version='1.0' encoding='UTF-8'?>
<multistatus xmlns='DAV:'>
  <response>
    <href>/123456789/principal/</href>
    <propstat>
      <prop>
        <calendar-home-set xmlns='urn:ietf:params:xml:ns:caldav'>
          <href xmlns='DAV:'>https://p52-caldav.icloud.com/123456789/calendars/</href>
        </calendar-home-set>
      </prop>
      <status>HTTP/1.1 200 OK</status>
    </propstat>
  </response>
</multistatus>`;

const ICLOUD_LIST = `<?xml version='1.0' encoding='UTF-8'?>
<multistatus xmlns='DAV:'>
  <response>
    <href>/123456789/calendars/</href>
    <propstat>
      <prop>
        <supported-calendar-component-set xmlns='urn:ietf:params:xml:ns:caldav'/>
        <current-user-privilege-set/>
      </prop>
      <status>HTTP/1.1 404 Not Found</status>
    </propstat>
    <propstat>
      <prop>
        <displayname></displayname>
        <resourcetype>
          <collection/>
        </resourcetype>
      </prop>
      <status>HTTP/1.1 200 OK</status>
    </propstat>
  </response>
  <response>
    <href>/123456789/calendars/home/</href>
    <propstat>
      <prop>
        <displayname>Home</displayname>
        <resourcetype>
          <collection/>
          <calendar xmlns='urn:ietf:params:xml:ns:caldav'/>
        </resourcetype>
        <current-user-privilege-set>
          <privilege><read/></privilege>
          <privilege><write/></privilege>
        </current-user-privilege-set>
        <supported-calendar-component-set xmlns='urn:ietf:params:xml:ns:caldav'>
          <comp name='VEVENT'/>
        </supported-calendar-component-set>
      </prop>
      <status>HTTP/1.1 200 OK</status>
    </propstat>
  </response>
  <response>
    <href>/123456789/calendars/1A2B3C4D-church-events/</href>
    <propstat>
      <prop>
        <displayname>Church Events</displayname>
        <resourcetype><collection/><C:calendar xmlns:C='urn:ietf:params:xml:ns:caldav'/></resourcetype>
        <current-user-privilege-set><privilege><read/></privilege><privilege><write-content/></privilege></current-user-privilege-set>
        <C:supported-calendar-component-set xmlns:C='urn:ietf:params:xml:ns:caldav'><C:comp name="VEVENT"/><C:comp name="VTODO"/></C:supported-calendar-component-set>
      </prop>
      <status>HTTP/1.1 200 OK</status>
    </propstat>
  </response>
  <response>
    <href>/123456789/calendars/tasks/</href>
    <propstat>
      <prop>
        <displayname>Reminders</displayname>
        <resourcetype><collection/><calendar xmlns='urn:ietf:params:xml:ns:caldav'/></resourcetype>
        <supported-calendar-component-set xmlns='urn:ietf:params:xml:ns:caldav'><comp name='VTODO'/></supported-calendar-component-set>
      </prop>
      <status>HTTP/1.1 200 OK</status>
    </propstat>
  </response>
  <response>
    <href>/123456789/calendars/inbox/</href>
    <propstat>
      <prop>
        <displayname>Inbox</displayname>
        <resourcetype><collection/><schedule-inbox xmlns='urn:ietf:params:xml:ns:caldav'/></resourcetype>
      </prop>
      <status>HTTP/1.1 200 OK</status>
    </propstat>
  </response>
  <response>
    <href>/123456789/calendars/outbox/</href>
    <propstat>
      <prop>
        <displayname>Outbox</displayname>
        <resourcetype><collection/><schedule-outbox xmlns='urn:ietf:params:xml:ns:caldav'/></resourcetype>
      </prop>
      <status>HTTP/1.1 200 OK</status>
    </propstat>
  </response>
  <response>
    <href>/123456789/calendars/notification/</href>
    <propstat>
      <prop>
        <displayname>notification</displayname>
        <resourcetype><collection/><notification xmlns='http://calendarserver.org/ns/'/></resourcetype>
      </prop>
      <status>HTTP/1.1 200 OK</status>
    </propstat>
  </response>
  <response>
    <href>/123456789/calendars/9F8E7D6C-holidays/</href>
    <propstat>
      <prop>
        <displayname>US Holidays</displayname>
        <resourcetype><collection/><subscribed xmlns='http://calendarserver.org/ns/'/></resourcetype>
        <supported-calendar-component-set xmlns='urn:ietf:params:xml:ns:caldav'><comp name='VEVENT'/></supported-calendar-component-set>
      </prop>
      <status>HTTP/1.1 200 OK</status>
    </propstat>
  </response>
</multistatus>`;

test("a property missing under 404 is not read out of a self-closing placeholder", () => {
  const [home] = parseMultiStatus(ICLOUD_LIST);
  assert.ok(home);
  // The 404 block lists this property as `<... xmlns='…'/>`. It must read as
  // absent, not as everything between that tag and the next closing one.
  assert.equal(responseProperty(home, "supported-calendar-component-set"), null);
  assert.equal(responseProperty(home, "current-user-privilege-set"), null);
  assert.match(responseProperty(home, "resourcetype") ?? "", /<collection\/>/);
});

test("discovery walks iCloud's three hops and keeps only the calendars that hold events", async () => {
  await withFetch(
    (seen) => {
      if (seen.url === "https://caldav.icloud.com/.well-known/caldav") {
        return new Response(null, {
          status: 301,
          headers: { location: "https://caldav.icloud.com/" },
        });
      }
      if (seen.url === "https://caldav.icloud.com/") {
        return new Response(ICLOUD_PRINCIPAL, { status: 207 });
      }
      if (seen.url === "https://caldav.icloud.com/123456789/principal/") {
        return new Response(ICLOUD_HOME, { status: 207 });
      }
      if (seen.url === "https://p52-caldav.icloud.com/123456789/calendars/") {
        return new Response(ICLOUD_LIST, { status: 207 });
      }
      return new Response("unexpected " + seen.url, { status: 500 });
    },
    async (seen) => {
      const discovery = await discoverAppleCalendars(creds);

      assert.equal(
        discovery.calendarHomeUrl,
        "https://p52-caldav.icloud.com/123456789/calendars/",
      );
      assert.deepEqual(
        discovery.calendars.map((calendar) => [calendar.name, calendar.writable]),
        [
          ["Home", true],
          ["Church Events", true],
          ["US Holidays", false],
        ],
      );
      assert.equal(
        discovery.calendars[0]?.url,
        "https://p52-caldav.icloud.com/123456789/calendars/home/",
      );

      // Every hop carried the login, and the listing went to the partition
      // host iCloud named rather than back to the generic one.
      assert.ok(seen.every((entry) => entry.auth?.startsWith("Basic ")));
      assert.equal(seen.at(-1)?.url, "https://p52-caldav.icloud.com/123456789/calendars/");
      assert.equal(seen.at(-1)?.method, "PROPFIND");
    },
  );
});

test("a list with nothing but reminders and scheduling collections says so", async () => {
  const onlyTasks = ICLOUD_LIST.replace(/<response>\s*<href>\/123456789\/calendars\/(?:home|1A2B3C4D-church-events|9F8E7D6C-holidays)\/<\/href>[\s\S]*?<\/response>/g, "");
  const originalError = console.error;
  console.error = () => {};
  try {
    await withFetch(
      (seen) =>
        seen.url.endsWith("/.well-known/caldav")
          ? new Response(ICLOUD_PRINCIPAL, { status: 207 })
          : seen.url.endsWith("/principal/")
            ? new Response(ICLOUD_HOME, { status: 207 })
            : new Response(onlyTasks, { status: 207 }),
      async () => {
        await assert.rejects(
          discoverAppleCalendars(creds),
          (err: unknown) =>
            err instanceof CalDavError &&
            /no calendars we can read/.test(err.message),
        );
      },
    );
  } finally {
    console.error = originalError;
  }
});
