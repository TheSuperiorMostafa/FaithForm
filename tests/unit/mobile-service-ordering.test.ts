import assert from "node:assert/strict";
import test from "node:test";
import { getScheduleWindow, sortScheduleItems } from "../../lib/mobile/v1/schedule-service";
import { sortServiceTimes } from "../../lib/mobile/v1/discovery-service";
import type { FeedItemDto } from "../../lib/mobile/v1/contract";

function service(id: string, startAt: string): FeedItemDto {
  return {
    id, title: id, body: "", startAt, endAt: startAt,
    allDay: false, location: null, posterUrl: null, posterAltText: null, isPinned: false,
    visibility: "followers", publicationVersion: 1, publishedAt: null, isEvent: true,
    churchSlug: "target", churchName: "Target", churchTimezone: "America/New_York",
  };
}

test("schedule items sort by instant, not by string, across offsets", () => {
  const sorted = sortScheduleItems([
    // 15:00Z — later, though its string sorts first.
    { id: "b", startAt: "2026-10-04T10:00:00-05:00" },
    { id: "a", startAt: "2026-10-04T14:00:00.000Z" },
    { id: "c", startAt: "2026-10-03T23:00:00+00:00" },
  ]);
  assert.deepEqual(sorted.map((item) => item.id), ["c", "a", "b"]);
});

test("schedule items with equal or unreadable times stay stable and go last", () => {
  const sorted = sortScheduleItems([
    { id: "z", startAt: "not a date" },
    { id: "y", startAt: "2026-10-04T14:00:00Z" },
    { id: "x", startAt: "2026-10-04T14:00:00Z" },
  ]);
  assert.deepEqual(sorted.map((item) => item.id), ["x", "y", "z"]);
});

test("the schedule window returns services and events in date order", async () => {
  const result = await getScheduleWindow(
    { userId: "account", churchSlug: "target", from: "2026-10-01T00:00:00Z", to: "2026-11-01T00:00:00Z" },
    {
      church: async () => ({ id: "target-id", name: "Target", timezone: "America/New_York" }),
      relationship: async () => "joined",
      announcements: async () => [],
      services: async () => [
        service("service:late", "2026-10-18T14:00:00+00:00"),
        service("service:early", "2026-10-04T14:00:00+00:00"),
        service("service:middle", "2026-10-11T09:00:00-05:00"),
      ],
    },
  );
  assert.deepEqual(result.items.map((item) => item.id), ["service:early", "service:middle", "service:late"]);
});

test("service times run Sunday to Saturday, earliest first, comparing times numerically", () => {
  const sorted = sortServiceTimes([
    { campusSlug: "", dayOfWeek: 3, startTime: "19:00:00" },
    { campusSlug: "north", dayOfWeek: 0, startTime: "10:30:00" },
    { campusSlug: "", dayOfWeek: 0, startTime: "9:00" },
    { campusSlug: "south", dayOfWeek: 0, startTime: "08:00:00" },
  ]);
  assert.deepEqual(
    sorted.map((service) => `${service.dayOfWeek} ${service.startTime}`),
    ["0 08:00:00", "0 9:00", "0 10:30:00", "3 19:00:00"],
  );
});
