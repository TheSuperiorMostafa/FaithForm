import assert from "node:assert/strict";
import test from "node:test";
import {
  formatEventsHtml,
  formatWeeklyEmailEventBlock,
} from "@/lib/email/announcement-template";
import { formatEventStart } from "@/lib/queries/announcements";

const AUG_4_4PM_ET = "2026-08-04T20:00:00.000Z";

test("an event start reads as a date and a start time", () => {
  assert.equal(
    formatEventStart(AUG_4_4PM_ET, "America/New_York"),
    "August 4th 4:00PM",
  );
});

test("ordinals follow English, including the teens", () => {
  const at = (day: string) =>
    formatEventStart(`2026-08-${day}T20:00:00.000Z`, "America/New_York");
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
    formatEventStart("2026-08-05T01:00:00.000Z", "America/New_York"),
    "August 4th 9:00PM",
  );
});

test("the weekly email never prints an end time", () => {
  const event = {
    title: "Back to School Night",
    location: "Fellowship Hall",
    startAt: AUG_4_4PM_ET,
    endAt: "2026-08-04T21:00:00.000Z",
  };

  const plain = formatWeeklyEmailEventBlock(event, "America/New_York");
  assert.equal(plain.includes("August 4th 4:00PM"), true);
  assert.equal(plain.includes("5:00"), false);
  assert.equal(plain.includes("–"), false);

  const html = formatEventsHtml([event], "America/New_York");
  assert.equal(html.includes("August 4th 4:00PM"), true);
  assert.equal(html.includes("5:00"), false);
});
