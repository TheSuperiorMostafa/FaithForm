import assert from "node:assert/strict";
import test from "node:test";

import { describeJob, expectedTranscribeSec, formatEta, type JobLike } from "@/lib/sermon-media/progress";
import { nextPostSlots, parseSchedule, zonedTimeToUtc } from "@/lib/sermon-media/schedule";
import { draftCaption } from "@/lib/sermon-media/captions";

test("posting slots follow the church's weekdays and time zone, skipping taken slots", () => {
  const tz = "America/New_York";
  // Sunday morning, before any weekday slot.
  const now = zonedTimeToUtc(2026, 11, 15, 11, 30, tz); // Sunday 15 Nov 2026
  const schedule = { days: [1, 2, 3, 4, 5], time: "12:00", per_day: 1 };
  const [first, second] = nextPostSlots(schedule, tz, [], now, 2);
  assert.equal(first.toISOString(), zonedTimeToUtc(2026, 11, 16, 12, 0, tz).toISOString(), "Monday noon");
  assert.equal(second.toISOString(), zonedTimeToUtc(2026, 11, 17, 12, 0, tz).toISOString(), "Tuesday noon");
  const [afterTaken] = nextPostSlots(schedule, tz, [first], now, 1);
  assert.equal(afterTaken.toISOString(), second.toISOString());
});

test("posting slots: two a day are four hours apart, and a slot already past today is skipped", () => {
  const tz = "America/Los_Angeles";
  const now = zonedTimeToUtc(2026, 11, 17, 13, 30, tz); // Tuesday 1:30 pm, after both of today's slots
  const slots = nextPostSlots({ days: [2, 3], time: "09:00", per_day: 2 }, tz, [], now, 3);
  assert.deepEqual(
    slots.map((d) => d.toISOString()),
    [
      zonedTimeToUtc(2026, 11, 18, 9, 0, tz).toISOString(),
      zonedTimeToUtc(2026, 11, 18, 13, 0, tz).toISOString(),
      zonedTimeToUtc(2026, 11, 24, 9, 0, tz).toISOString(),
    ],
  );
});

test("daylight saving: noon stays noon local across the November change", () => {
  const tz = "America/New_York";
  const before = zonedTimeToUtc(2026, 10, 30, 12, 0, tz);
  const after = zonedTimeToUtc(2026, 11, 2, 12, 0, tz);
  assert.equal(before.getUTCHours(), 16);
  assert.equal(after.getUTCHours(), 17);
});

test("a bad saved schedule falls back to weekdays at noon", () => {
  assert.deepEqual(parseSchedule({ days: [], time: "25:00" }), { days: [1, 2, 3, 4, 5], time: "12:00", per_day: 1 });
});

const job = (over: Partial<JobLike>): JobLike => ({
  kind: "transcribe", status: "running", stage: "asr", progress: 0.5,
  created_at: "2026-11-16T15:00:00Z", dispatched_at: "2026-11-16T15:00:00Z", started_at: "2026-11-16T15:00:00Z", finished_at: null,
  ...over,
});

test("progress reads in plain language with a time left that shrinks as work advances", () => {
  const start = Date.parse("2026-11-16T15:00:00Z");
  const early = describeJob(job({ stage: "download", progress: 0.1 }), 7200, start + 30_000)!;
  const late = describeJob(job({ stage: "asr", progress: 0.8 }), 7200, start + 120_000)!;
  assert.equal(early.label, "Downloading the recording");
  assert.equal(late.label, "Transcribing");
  assert.equal(late.percent, 80);
  assert.ok(early.etaSec! > late.etaSec!, `${early.etaSec} > ${late.etaSec}`);
  assert.equal(describeJob(job({ status: "succeeded" }), 7200)!.percent, 100);
  assert.equal(describeJob(job({ status: "queued", started_at: null, dispatched_at: null }), 7200)!.label, "Waiting to start");
  assert.ok(expectedTranscribeSec(7200) < 300, "a two-hour service is modelled at under five minutes");
  assert.equal(formatEta(30), "less than a minute left");
  assert.equal(formatEta(200), "about 3 minutes left");
});

test("the first caption draft is the clip's opening line and the church name", () => {
  const caption = draftCaption("Have you ever felt like what you bring to God is not enough? I remember when I was nineteen.", "Grace Church");
  assert.equal(caption, "Have you ever felt like what you bring to God is not enough?\n\n— Grace Church");
});
