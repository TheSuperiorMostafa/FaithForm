import assert from "node:assert/strict";
import test from "node:test";
import {
  absoluteHref,
  parseMultiStatus,
  responseProperty,
} from "@/lib/integrations/caldav";
import {
  buildAppleEventId,
  buildEventIcs,
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
