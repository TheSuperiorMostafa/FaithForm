import assert from "node:assert/strict";
import test from "node:test";
import {
  expandIcsEvents,
  icsDateTimeToISO,
  parseIcsEvents,
} from "@/lib/integrations/ics";

function calendar(...events: string[]): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Apple Inc.//iOS 18.0//EN",
    ...events,
    "END:VCALENDAR",
  ].join("\r\n");
}

const SUNDAY_SERVICE = [
  "BEGIN:VEVENT",
  "UID:sunday-service@example.org",
  "DTSTART;TZID=America/New_York:20260301T100000",
  "DTEND;TZID=America/New_York:20260301T113000",
  "RRULE:FREQ=WEEKLY;BYDAY=SU",
  "SUMMARY:Sunday Service",
  "LOCATION:Sanctuary",
  "END:VEVENT",
].join("\r\n");

test("a folded line is rejoined before it is parsed", () => {
  const ics = calendar(
    [
      "BEGIN:VEVENT",
      "UID:folded@example.org",
      "DTSTART:20260804T200000Z",
      "SUMMARY:Back to School Night for Every Family in the Whole",
      "  Congregation",
      "END:VEVENT",
    ].join("\r\n"),
  );

  const [event] = parseIcsEvents(ics);
  assert.equal(
    event?.summary,
    "Back to School Night for Every Family in the Whole Congregation",
  );
});

test("escaped commas and newlines come back as written", () => {
  const ics = calendar(
    [
      "BEGIN:VEVENT",
      "UID:escapes@example.org",
      "DTSTART:20260804T200000Z",
      "SUMMARY:Potluck\\, then prayer",
      "DESCRIPTION:Bring a dish.\\nStay for coffee.",
      "END:VEVENT",
    ].join("\r\n"),
  );

  const [event] = parseIcsEvents(ics);
  assert.equal(event?.summary, "Potluck, then prayer");
  assert.equal(event?.description, "Bring a dish.\nStay for coffee.");
});

test("a TZID start resolves to the right UTC instant", () => {
  const ics = calendar(
    [
      "BEGIN:VEVENT",
      "UID:tz@example.org",
      "DTSTART;TZID=America/New_York:20260804T160000",
      "DTEND;TZID=America/New_York:20260804T170000",
      "SUMMARY:Staff meeting",
      "END:VEVENT",
    ].join("\r\n"),
  );

  const [event] = parseIcsEvents(ics);
  assert.ok(event);
  // 4pm in New York during daylight saving is 20:00 UTC.
  assert.equal(icsDateTimeToISO(event.start), "2026-08-04T20:00:00.000Z");
});

test("a weekly service keeps its local hour across the DST change", () => {
  const occurrences = expandIcsEvents(
    parseIcsEvents(calendar(SUNDAY_SERVICE)),
    "2026-03-01T00:00:00.000Z",
    "2026-03-31T00:00:00.000Z",
  );

  // Eastern time moves to DST on 8 March 2026: 10am local is 15:00 UTC before
  // and 14:00 UTC after. A church that shows up at ten does not care which.
  assert.equal(occurrences[0]?.startAt, "2026-03-01T15:00:00.000Z");
  assert.equal(occurrences[1]?.startAt, "2026-03-08T14:00:00.000Z");
  assert.equal(occurrences[2]?.startAt, "2026-03-15T14:00:00.000Z");
  assert.equal(occurrences.length, 5);
});

test("only occurrences inside the window come back", () => {
  const occurrences = expandIcsEvents(
    parseIcsEvents(calendar(SUNDAY_SERVICE)),
    "2026-04-05T00:00:00.000Z",
    "2026-04-19T23:59:59.000Z",
  );

  assert.deepEqual(
    occurrences.map((o) => o.startAt),
    [
      "2026-04-05T14:00:00.000Z",
      "2026-04-12T14:00:00.000Z",
      "2026-04-19T14:00:00.000Z",
    ],
  );
});

test("an excluded date is skipped and an override replaces its occurrence", () => {
  const ics = calendar(
    [
      "BEGIN:VEVENT",
      "UID:youth@example.org",
      "DTSTART;TZID=America/New_York:20260304T183000",
      "DTEND;TZID=America/New_York:20260304T200000",
      "RRULE:FREQ=WEEKLY;BYDAY=WE",
      "EXDATE;TZID=America/New_York:20260311T183000",
      "SUMMARY:Youth Group",
      "LOCATION:Youth Room",
      "END:VEVENT",
    ].join("\r\n"),
    [
      "BEGIN:VEVENT",
      "UID:youth@example.org",
      "RECURRENCE-ID;TZID=America/New_York:20260318T183000",
      "DTSTART;TZID=America/New_York:20260318T190000",
      "DTEND;TZID=America/New_York:20260318T203000",
      "SUMMARY:Youth Group at the park",
      "LOCATION:Riverside Park",
      "END:VEVENT",
    ].join("\r\n"),
  );

  const occurrences = expandIcsEvents(
    parseIcsEvents(ics),
    "2026-03-01T00:00:00.000Z",
    "2026-03-31T00:00:00.000Z",
  );

  const starts = occurrences.map((o) => o.startAt);
  assert.equal(starts.includes("2026-03-11T22:30:00.000Z"), false);
  const moved = occurrences.find((o) => o.summary === "Youth Group at the park");
  assert.equal(moved?.startAt, "2026-03-18T23:00:00.000Z");
  assert.equal(moved?.location, "Riverside Park");
  // 4 Wednesdays in range, one excluded, one replaced in place.
  assert.equal(occurrences.length, 3);
});

test("COUNT and UNTIL both stop a series", () => {
  const counted = expandIcsEvents(
    parseIcsEvents(
      calendar(
        [
          "BEGIN:VEVENT",
          "UID:counted@example.org",
          "DTSTART:20260302T150000Z",
          "DTEND:20260302T160000Z",
          "RRULE:FREQ=DAILY;COUNT=3",
          "SUMMARY:Prayer week",
          "END:VEVENT",
        ].join("\r\n"),
      ),
    ),
    "2026-03-01T00:00:00.000Z",
    "2026-04-01T00:00:00.000Z",
  );
  assert.equal(counted.length, 3);

  const untilled = expandIcsEvents(
    parseIcsEvents(
      calendar(
        [
          "BEGIN:VEVENT",
          "UID:untilled@example.org",
          "DTSTART:20260302T150000Z",
          "DTEND:20260302T160000Z",
          "RRULE:FREQ=WEEKLY;UNTIL=20260316T150000Z",
          "SUMMARY:Lent study",
          "END:VEVENT",
        ].join("\r\n"),
      ),
    ),
    "2026-03-01T00:00:00.000Z",
    "2026-04-01T00:00:00.000Z",
  );
  assert.equal(untilled.length, 3);
});

test("a monthly rule can name the third Sunday", () => {
  const occurrences = expandIcsEvents(
    parseIcsEvents(
      calendar(
        [
          "BEGIN:VEVENT",
          "UID:potluck@example.org",
          "DTSTART;TZID=America/New_York:20260315T120000",
          "DTEND;TZID=America/New_York:20260315T140000",
          "RRULE:FREQ=MONTHLY;BYDAY=3SU",
          "SUMMARY:Potluck",
          "END:VEVENT",
        ].join("\r\n"),
      ),
    ),
    "2026-03-01T00:00:00.000Z",
    "2026-05-31T00:00:00.000Z",
  );

  assert.deepEqual(
    occurrences.map((o) => o.startAt.slice(0, 10)),
    ["2026-03-15", "2026-04-19", "2026-05-17"],
  );
});

test("a service set up years ago still shows up this month", () => {
  // The ordinary church calendar: one VEVENT from 2016 with no end, asked
  // about a decade later. Stepping week by week from 2016 would run out of
  // iterations long before reaching the window.
  const occurrences = expandIcsEvents(
    parseIcsEvents(
      calendar(
        [
          "BEGIN:VEVENT",
          "UID:long-running@example.org",
          "DTSTART;TZID=America/New_York:20160103T100000",
          "DTEND;TZID=America/New_York:20160103T113000",
          "RRULE:FREQ=WEEKLY;BYDAY=SU",
          "SUMMARY:Sunday Service",
          "END:VEVENT",
        ].join("\r\n"),
      ),
    ),
    "2026-08-01T00:00:00.000Z",
    "2026-08-31T23:59:59.000Z",
  );

  assert.deepEqual(
    occurrences.map((o) => o.startAt.slice(0, 10)),
    ["2026-08-02", "2026-08-09", "2026-08-16", "2026-08-23", "2026-08-30"],
  );
});

test("a daily series from years back is not truncated away", () => {
  const occurrences = expandIcsEvents(
    parseIcsEvents(
      calendar(
        [
          "BEGIN:VEVENT",
          "UID:morning-prayer@example.org",
          "DTSTART:20180101T120000Z",
          "DTEND:20180101T123000Z",
          "RRULE:FREQ=DAILY",
          "SUMMARY:Morning Prayer",
          "END:VEVENT",
        ].join("\r\n"),
      ),
    ),
    "2026-08-01T00:00:00.000Z",
    "2026-08-07T23:59:59.000Z",
  );

  assert.equal(occurrences.length, 7);
  assert.equal(occurrences[0]?.startAt, "2026-08-01T12:00:00.000Z");
});

test("a fortnightly rule keeps its phase after fast-forwarding", () => {
  const occurrences = expandIcsEvents(
    parseIcsEvents(
      calendar(
        [
          "BEGIN:VEVENT",
          "UID:fortnightly@example.org",
          "DTSTART:20260107T150000Z",
          "DTEND:20260107T160000Z",
          "RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=WE",
          "SUMMARY:Elders",
          "END:VEVENT",
        ].join("\r\n"),
      ),
    ),
    "2026-04-01T00:00:00.000Z",
    "2026-04-30T23:59:59.000Z",
  );

  // From 7 January every other Wednesday: 4 Feb, 18 Feb, 4 Mar, 18 Mar,
  // 1 Apr, 15 Apr, 29 Apr.
  assert.deepEqual(
    occurrences.map((o) => o.startAt.slice(0, 10)),
    ["2026-04-01", "2026-04-15", "2026-04-29"],
  );
});

test("COUNT is measured from the first occurrence, not from the window", () => {
  // Twelve weeks from January runs out in March, so a window in June is empty
  // even though the rule itself looks open-ended from inside that window.
  const occurrences = expandIcsEvents(
    parseIcsEvents(
      calendar(
        [
          "BEGIN:VEVENT",
          "UID:twelve-weeks@example.org",
          "DTSTART:20260106T150000Z",
          "DTEND:20260106T160000Z",
          "RRULE:FREQ=WEEKLY;COUNT=12",
          "SUMMARY:Membership class",
          "END:VEVENT",
        ].join("\r\n"),
      ),
    ),
    "2026-06-01T00:00:00.000Z",
    "2026-06-30T23:59:59.000Z",
  );

  assert.equal(occurrences.length, 0);
});

test("an all-day event covers its whole day", () => {
  const [occurrence] = expandIcsEvents(
    parseIcsEvents(
      calendar(
        [
          "BEGIN:VEVENT",
          "UID:vbs@example.org",
          "DTSTART;VALUE=DATE:20260713",
          "DTEND;VALUE=DATE:20260718",
          "SUMMARY:Vacation Bible School",
          "END:VEVENT",
        ].join("\r\n"),
      ),
    ),
    "2026-07-01T00:00:00.000Z",
    "2026-07-31T00:00:00.000Z",
  );

  assert.equal(occurrence?.allDay, true);
  assert.equal(occurrence?.startAt, "2026-07-13T00:00:00.000Z");
  assert.equal(occurrence?.endAt, "2026-07-18T00:00:00.000Z");
});

test("a cancelled event is not an event", () => {
  const occurrences = expandIcsEvents(
    parseIcsEvents(
      calendar(
        [
          "BEGIN:VEVENT",
          "UID:called-off@example.org",
          "DTSTART:20260804T200000Z",
          "STATUS:CANCELLED",
          "SUMMARY:Board meeting",
          "END:VEVENT",
        ].join("\r\n"),
      ),
    ),
    "2026-08-01T00:00:00.000Z",
    "2026-08-31T00:00:00.000Z",
  );

  assert.equal(occurrences.length, 0);
});

test("an alarm inside an event cannot overwrite its start", () => {
  const ics = calendar(
    [
      "BEGIN:VEVENT",
      "UID:alarmed@example.org",
      "DTSTART:20260804T200000Z",
      "SUMMARY:Elders meeting",
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      "TRIGGER:-PT15M",
      "SUMMARY:Reminder",
      "END:VALARM",
      "END:VEVENT",
    ].join("\r\n"),
  );

  const [event] = parseIcsEvents(ics);
  assert.equal(event?.summary, "Elders meeting");
  assert.equal(icsDateTimeToISO(event!.start), "2026-08-04T20:00:00.000Z");
});

test("an unknown timezone falls back rather than dropping the event", () => {
  const [event] = parseIcsEvents(
    calendar(
      [
        "BEGIN:VEVENT",
        "UID:custom-tz@example.org",
        "DTSTART;TZID=Made/Up:20260804T160000",
        "SUMMARY:Imported from somewhere else",
        "END:VEVENT",
      ].join("\r\n"),
    ),
  );

  assert.equal(icsDateTimeToISO(event!.start), "2026-08-04T16:00:00.000Z");
});
