import assert from "node:assert/strict";
import test from "node:test";
import {
  formatEventsHtml,
  formatWeeklyEmailEventBlock,
} from "@/lib/email/announcement-template";
import {
  formatEventWhen,
  formatEventWhenForPrompt,
} from "@/lib/queries/announcements";

const AUG_4_4PM_ET = "2026-08-04T20:00:00.000Z";
const AUG_4_5PM_ET = "2026-08-04T21:00:00.000Z";

test("an event start reads as a date and a start time", () => {
  assert.equal(
    formatEventWhen(AUG_4_4PM_ET, null, "America/New_York"),
    "August 4th 4:00PM",
  );
});

test("ordinals follow English, including the teens", () => {
  const at = (day: string) =>
    formatEventWhen(`2026-08-${day}T20:00:00.000Z`, null, "America/New_York");
  assert.equal(at("01").startsWith("August 1st"), true);
  assert.equal(at("02").startsWith("August 2nd"), true);
  assert.equal(at("03").startsWith("August 3rd"), true);
  assert.equal(at("11").startsWith("August 11th"), true);
  assert.equal(at("12").startsWith("August 12th"), true);
  assert.equal(at("13").startsWith("August 13th"), true);
  assert.equal(at("21").startsWith("August 21st"), true);
});

test("the church timezone decides the date, not the worker's UTC clock", () => {
  // 1am UTC on the 5th is still the evening of the 4th in New York, and the
  // weekly draft is written by a cron run that only ever knows UTC.
  assert.equal(
    formatEventWhen("2026-08-05T01:00:00.000Z", null, "America/New_York"),
    "August 4th 9:00PM",
  );
});

test("an end time is never printed, even when the calendar gave one", () => {
  // The email lists a whole week; a span per line is noise. What a reader
  // scans for is when to turn up.
  assert.equal(
    formatEventWhen(AUG_4_4PM_ET, AUG_4_5PM_ET, "America/New_York"),
    "August 4th 4:00PM",
  );
});

test("an event running past midnight still reads as its start", () => {
  assert.equal(
    formatEventWhen(
      "2026-08-05T02:00:00.000Z",
      "2026-08-05T05:00:00.000Z",
      "America/New_York",
    ),
    "August 4th 10:00PM",
  );
});

test("an all-day event prints its own date, never the evening before", () => {
  // Google sends a date-only event as midnight UTC. Read in a western zone
  // that instant is the previous evening, which is how "August 4th, all day"
  // became "August 3rd 8:00PM" on flyers and in the email.
  assert.equal(
    formatEventWhen("2026-08-04T00:00:00.000Z", null, "America/New_York", true),
    "August 4th (all day)",
  );
});

test("the weekly email prints only the start of an event", () => {
  const event = {
    title: "Back to School Night",
    location: "Fellowship Hall",
    startAt: AUG_4_4PM_ET,
    endAt: AUG_4_5PM_ET,
  };

  const plain = formatWeeklyEmailEventBlock(event, "America/New_York");
  assert.equal(plain.includes("August 4th 4:00PM"), true);
  assert.equal(plain.includes("5:00"), false);

  const html = formatEventsHtml([event], "America/New_York");
  assert.equal(html.includes("August 4th 4:00PM"), true);
  assert.equal(html.includes("5:00"), false);
});

test("the weekly email leaves off an end time the calendar never gave", () => {
  const event = {
    title: "Prayer Room Open",
    location: "Chapel",
    startAt: AUG_4_4PM_ET,
    endAt: null,
  };

  assert.equal(
    formatWeeklyEmailEventBlock(event, "America/New_York"),
    "Prayer Room Open\nAugust 4th 4:00PM\nChapel",
  );
});

test("the weekly email shows an all-day event as a date", () => {
  const event = {
    title: "Church Picnic",
    location: "Riverside Park",
    startAt: "2026-08-04T00:00:00.000Z",
    endAt: "2026-08-05T00:00:00.000Z",
    allDay: true,
  };

  const plain = formatWeeklyEmailEventBlock(event, "America/New_York");
  assert.equal(plain.includes("August 4th (all day)"), true);
  assert.equal(plain.includes("August 3rd"), false);
  assert.equal(plain.includes(":00"), false);
});

test("the caption prompt states the weekday rather than leaving it to be guessed", () => {
  // A model handed "Aug 4" with no weekday and no year works one out from
  // whatever calendar its training left it with — and August 4th is a Tuesday
  // in 2026 but a Monday in 2025.
  const when = formatEventWhenForPrompt(
    AUG_4_4PM_ET,
    AUG_4_5PM_ET,
    "America/New_York",
  );
  assert.equal(when.includes("Tuesday"), true);
  assert.equal(when.includes("2026"), true);
  assert.equal(when.includes("4:00 PM"), true);
  assert.equal(when.includes("5:00 PM"), true);
});

test("the caption prompt reads an all-day date in UTC and says it has no time", () => {
  const when = formatEventWhenForPrompt(
    "2026-08-04T00:00:00.000Z",
    null,
    "America/New_York",
    true,
  );
  assert.equal(when.includes("Tuesday"), true);
  assert.equal(when.includes("August 4"), true);
  assert.equal(when.includes("all day"), true);
});
