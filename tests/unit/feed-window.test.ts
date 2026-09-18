import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { appFeedEndsAt, hasLeftAppFeed } from "@/lib/faithform/feed-window";

/**
 * The dashboard and the push hook decide "already over" in TypeScript; the
 * feed decides it in SQL (0076). These pin the two to the same rule, and pin
 * the case that prompted it: last month's recurring walk, published from the
 * calendar grid's leading days, notified everyone and then showed nothing.
 */

const now = new Date("2026-09-18T17:00:00.000Z");

test("an event with an end time is listed until it ends", () => {
  const input = {
    startAt: "2026-09-18T16:00:00.000Z",
    endAt: "2026-09-18T18:00:00.000Z",
    allDay: false,
  };
  assert.equal(hasLeftAppFeed(input, now), false);
  assert.equal(hasLeftAppFeed(input, new Date("2026-09-18T18:00:00.000Z")), true);
});

test("without an end time, a timed event is listed for a day after it starts", () => {
  const input = { startAt: "2026-09-17T18:00:00.000Z", endAt: null, allDay: false };
  assert.equal(appFeedEndsAt(input)?.toISOString(), "2026-09-18T18:00:00.000Z");
  assert.equal(hasLeftAppFeed(input, now), false);
});

test("an all-day event is listed for two days, covering the local day everywhere", () => {
  const input = { startAt: "2026-09-17T00:00:00.000Z", endAt: null, allDay: true };
  assert.equal(appFeedEndsAt(input)?.toISOString(), "2026-09-19T00:00:00.000Z");
  assert.equal(hasLeftAppFeed(input, now), false);
});

test("an occurrence from last month has left the feed", () => {
  const input = {
    startAt: "2026-08-30T10:30:00.000Z",
    endAt: "2026-08-30T11:00:00.000Z",
    allDay: false,
  };
  assert.equal(hasLeftAppFeed(input, now), true);
});

test("an upcoming event has not", () => {
  const input = {
    startAt: "2026-09-20T10:30:00.000Z",
    endAt: "2026-09-20T11:00:00.000Z",
    allDay: false,
  };
  assert.equal(hasLeftAppFeed(input, now), false);
});

test("no start means nothing to decide, so it is not treated as over", () => {
  assert.equal(appFeedEndsAt({ startAt: null, endAt: null, allDay: false }), null);
  assert.equal(hasLeftAppFeed({ startAt: "", endAt: null, allDay: false }, now), false);
});

test("the SQL feed applies the same intervals this module does", () => {
  const sql = readFileSync("supabase/migrations/0079_mobile_announcement_schedule.sql", "utf8");
  assert.match(sql, /interval '2 days' else interval '1 day'/);
});

test("the push hook does not notify about an event that is already over", () => {
  const hook = readFileSync("lib/faithform/push/publish-hook.ts", "utf8");
  const guardAt = hook.indexOf("if (hasLeftAppFeed(input))");
  const enqueueAt = hook.indexOf("await enqueuePublicationNotification(");
  assert.ok(guardAt > 0, "the hook must check whether the event is over");
  assert.ok(guardAt < enqueueAt, "the check must come before anything is enqueued");
});
