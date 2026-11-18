import assert from "node:assert/strict";
import test from "node:test";

import { clamp, formatLength, formatTime, parseTime } from "@/components/sermon-media/time";

test("formatTime shows m:ss under an hour and h:mm:ss after", () => {
  assert.equal(formatTime(0), "0:00");
  assert.equal(formatTime(5.9), "0:05");
  assert.equal(formatTime(75), "1:15");
  assert.equal(formatTime(1862), "31:02");
  assert.equal(formatTime(3725), "1:02:05");
  assert.equal(formatTime(4248), "1:10:48");
  assert.equal(formatTime(-3), "0:00");
  assert.equal(formatTime(Number.NaN), "0:00");
});

test("parseTime reads h:mm:ss, m:ss and plain seconds", () => {
  assert.equal(parseTime("1:02:05"), 3725);
  assert.equal(parseTime("62:05"), 3725);
  assert.equal(parseTime("31:02"), 1862);
  assert.equal(parseTime("45"), 45);
  assert.equal(parseTime("45.5"), 45.5);
  assert.equal(parseTime(" 1:2:3 "), 3723);
  assert.equal(parseTime("0:00"), 0);
});

test("parseTime rejects what it can't read", () => {
  assert.equal(parseTime(""), null);
  assert.equal(parseTime("abc"), null);
  assert.equal(parseTime("1:60"), null);
  assert.equal(parseTime("1:02:75"), null);
  assert.equal(parseTime("1:2:3:4"), null);
  assert.equal(parseTime("-5"), null);
  assert.equal(parseTime("1.5:00"), null);
  assert.equal(parseTime("1::00"), null);
});

test("formatTime and parseTime round-trip whole seconds", () => {
  for (const value of [0, 9, 59, 60, 599, 3599, 3600, 7322, 36000]) {
    assert.equal(parseTime(formatTime(value)), value);
  }
});

test("formatLength and clamp", () => {
  assert.equal(formatLength(1), "1 second");
  assert.equal(formatLength(45), "45 seconds");
  assert.equal(formatLength(60), "1 min");
  assert.equal(formatLength(92), "1 min 32 s");
  assert.equal(formatLength(3725), "1 h 2 min");
  assert.equal(clamp(5, 10, 20), 10);
  assert.equal(clamp(25, 10, 20), 20);
  assert.equal(clamp(15, 10, 20), 15);
});
