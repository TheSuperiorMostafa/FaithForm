import assert from "node:assert/strict";
import test from "node:test";

import { calendarEditFor } from "@/lib/announcements/calendar-edit";
import { allDaySpan } from "@/lib/integrations/all-day";

const retreat = {
  title: "Men's retreat",
  location: "Camp Loucon",
  startAt: "2026-09-12T00:00:00.000Z",
  endAt: "2026-09-15T00:00:00.000Z",
};

test("publishing an untouched all-day event leaves the calendar alone", () => {
  // The form never sends an end for an all-day event, and never did.
  const edit = calendarEditFor({
    title: retreat.title,
    location: retreat.location,
    startAt: "2026-09-12T00:00:00.000Z",
    endAt: null,
    allDay: true,
    original: retreat,
  });
  assert.equal(edit.changed, false);
});

test("moving an all-day event keeps how many days it lasts", () => {
  const edit = calendarEditFor({
    title: retreat.title,
    location: retreat.location,
    startAt: "2026-09-19T00:00:00.000Z",
    endAt: null,
    allDay: true,
    original: retreat,
  });
  assert.equal(edit.changed, true);
  assert.equal(edit.endAt, "2026-09-22T00:00:00.000Z");
});

test("renaming an all-day event with no known end gives it one day", () => {
  const edit = calendarEditFor({
    title: "Picnic in the park",
    location: "",
    startAt: "2026-09-12T00:00:00.000Z",
    endAt: null,
    allDay: true,
    original: { title: "Picnic", location: "", startAt: "2026-09-12T00:00:00.000Z", endAt: "" },
  });
  assert.equal(edit.changed, true);
  assert.equal(edit.endAt, "2026-09-13T00:00:00.000Z");
});

test("timed events compare instants, not how the string was written", () => {
  const edit = calendarEditFor({
    title: "Youth night",
    location: "Gym",
    startAt: "2026-09-12T23:00:00.000Z",
    endAt: "2026-09-13T01:00:00.000Z",
    allDay: false,
    original: {
      title: "Youth night",
      location: "Gym",
      startAt: "2026-09-12T19:00:00-04:00",
      endAt: "2026-09-12T21:00:00-04:00",
    },
  });
  assert.equal(edit.changed, false);
  assert.equal(edit.endAt, "2026-09-13T01:00:00.000Z");
});

test("a timed event's new end is a change", () => {
  const edit = calendarEditFor({
    title: "Youth night",
    location: "Gym",
    startAt: "2026-09-12T23:00:00.000Z",
    endAt: "2026-09-13T02:00:00.000Z",
    allDay: false,
    original: {
      title: "Youth night",
      location: "Gym",
      startAt: "2026-09-12T23:00:00.000Z",
      endAt: "2026-09-13T01:00:00.000Z",
    },
  });
  assert.equal(edit.changed, true);
});

test("all-day spans are end-exclusive dates of at least one day", () => {
  assert.deepEqual(allDaySpan("2026-09-12T00:00:00.000Z", null), {
    start: "2026-09-12",
    end: "2026-09-13",
  });
  assert.deepEqual(
    allDaySpan("2026-09-12T00:00:00.000Z", "2026-09-15T00:00:00.000Z"),
    { start: "2026-09-12", end: "2026-09-15" },
  );
  // An end before the start is not an event length.
  assert.deepEqual(
    allDaySpan("2026-09-12T00:00:00.000Z", "2026-09-01T00:00:00.000Z"),
    { start: "2026-09-12", end: "2026-09-13" },
  );
});
