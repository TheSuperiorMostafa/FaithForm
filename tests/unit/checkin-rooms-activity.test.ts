import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  activityActionLabel,
  buildActivityFeed,
  buildRoomAlerts,
  capacityAlertMessage,
  formatActivityTime,
  openRosterSessions,
  unusualActivityMessage,
} from "@/lib/checkin/rooms-activity";
import type { CheckinSessionRow, ChurchLocation } from "@/types/checkin";

function session(overrides: Partial<CheckinSessionRow> = {}): CheckinSessionRow {
  return {
    id: "s1",
    memberId: "tim",
    firstName: "Tim",
    lastName: "Doe",
    householdId: "h1",
    householdName: "The Doe Family",
    locationId: "nursery",
    locationName: "Nursery",
    status: "checked_in",
    localServiceDate: "2026-09-25",
    preCheckedInAt: null,
    checkedInAt: "2026-09-25T14:00:00Z",
    checkedOutAt: null,
    checkinMethod: "staff",
    checkoutMethod: null,
    checkoutOverrideReason: null,
    medicalNotes: null,
    ...overrides,
  };
}

function room(overrides: Partial<ChurchLocation> = {}): ChurchLocation {
  return {
    id: "nursery",
    name: "Nursery",
    description: null,
    sortOrder: 0,
    capacity: 12,
    isDefaultAdultLocation: false,
    isActive: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Activity feed from session timestamps
// ---------------------------------------------------------------------------

test("activity feed turns check-in and checkout timestamps into newest-first events", () => {
  const events = buildActivityFeed([
    session({
      id: "a",
      firstName: "Anna",
      checkedInAt: "2026-09-25T14:00:00Z",
      checkedOutAt: "2026-09-25T15:30:00Z",
      status: "checked_out",
      checkoutMethod: "code",
    }),
    session({
      id: "b",
      firstName: "Ben",
      checkedInAt: "2026-09-25T14:10:00Z",
      status: "checked_in",
    }),
  ]);

  assert.equal(events.length, 3);
  assert.equal(events[0].kind, "checked_out");
  assert.equal(events[0].childName, "Anna Doe");
  assert.equal(events[1].kind, "checked_in");
  assert.equal(events[1].childName, "Ben Doe");
  assert.equal(events[2].kind, "checked_in");
  assert.equal(events[2].childName, "Anna Doe");
});

test("override pickups are a separate activity kind with the written reason", () => {
  const events = buildActivityFeed([
    session({
      status: "checked_out",
      checkedInAt: "2026-09-25T14:00:00Z",
      checkedOutAt: "2026-09-25T15:00:00Z",
      checkoutMethod: "override",
      checkoutOverrideReason: "  Grandma without the code  ",
    }),
  ]);

  const pickup = events.find((event) => event.kind === "released_without_code");
  assert.ok(pickup);
  assert.equal(pickup.reason, "Grandma without the code");
  assert.equal(activityActionLabel("released_without_code"), "Released without a code");
  assert.equal(activityActionLabel("checked_out"), "Picked up");
  assert.equal(activityActionLabel("checked_in"), "Checked in");
});

test("pre-check-ins without an arrival do not appear in the activity feed", () => {
  const events = buildActivityFeed([
    session({
      status: "pre_checked_in",
      checkedInAt: null,
      preCheckedInAt: "2026-09-25T13:50:00Z",
    }),
  ]);
  assert.deepEqual(events, []);
});

test("open roster keeps only children still in a room", () => {
  const open = openRosterSessions([
    session({ id: "in", status: "checked_in" }),
    session({ id: "way", status: "pre_checked_in", checkedInAt: null }),
    session({
      id: "out",
      status: "checked_out",
      checkedOutAt: "2026-09-25T15:00:00Z",
    }),
  ]);
  assert.deepEqual(
    open.map((row) => row.id),
    ["in", "way"],
  );
});

// ---------------------------------------------------------------------------
// Capacity and unusual-activity alerts
// ---------------------------------------------------------------------------

test("rooms at or over capacity become dashboard alerts", () => {
  const nursery = room({ capacity: 2 });
  const preschool = room({ id: "pre", name: "Preschool", capacity: 10 });
  const open = [
    session({ id: "1", locationId: "nursery", locationName: "Nursery" }),
    session({ id: "2", memberId: "a", firstName: "A", locationId: "nursery", locationName: "Nursery" }),
    session({ id: "3", memberId: "b", firstName: "B", locationId: "nursery", locationName: "Nursery" }),
  ];

  const alerts = buildRoomAlerts(open, [nursery, preschool]);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].kind, "over");
  if (alerts[0].kind === "over") {
    assert.equal(alerts[0].count, 3);
    assert.equal(alerts[0].capacity, 2);
    assert.equal(capacityAlertMessage(alerts[0]), "Nursery is over capacity (3 / 2).");
  }
});

test("a room exactly at capacity is full, not over", () => {
  const nursery = room({ capacity: 1 });
  const alerts = buildRoomAlerts(
    [session({ locationId: "nursery", locationName: "Nursery" })],
    [nursery],
  );
  assert.equal(alerts[0].kind, "full");
  if (alerts[0].kind === "full") {
    assert.equal(capacityAlertMessage(alerts[0]), "Nursery is full (1 / 1).");
  }
});

test("closed rooms and rooms without a capacity never alert", () => {
  const closed = room({ isActive: false, capacity: 1 });
  const uncapped = room({ id: "hall", name: "Hall", capacity: null });
  const alerts = buildRoomAlerts(
    [
      session({ locationId: "nursery", locationName: "Nursery" }),
      session({ id: "2", locationId: "hall", locationName: "Hall" }),
    ],
    [closed, uncapped],
  );
  assert.deepEqual(alerts, []);
});

test("no-code releases in today's activity become an unusual-activity alert", () => {
  const activity = buildActivityFeed([
    session({
      status: "checked_out",
      checkedOutAt: "2026-09-25T15:00:00Z",
      checkoutMethod: "override",
      checkoutOverrideReason: "Forgot the code",
    }),
  ]);
  const alerts = buildRoomAlerts([], [room()], activity);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].kind, "released_without_code");
  if (alerts[0].kind === "released_without_code") {
    assert.equal(unusualActivityMessage(alerts[0]), "1 child was released without a pickup code today.");
  }
});

test("activity times use the church timezone", () => {
  // 14:00 UTC is 10:00 AM in America/New_York (EDT).
  assert.equal(formatActivityTime("2026-09-25T14:00:00Z", "America/New_York"), "10:00 AM");
});

// ---------------------------------------------------------------------------
// Rooms page composition
// ---------------------------------------------------------------------------

const page = readFileSync("app/dashboard/checkin/locations/page.tsx", "utf8");
const manager = readFileSync("components/checkin/locations-manager.tsx", "utf8");
const loading = readFileSync("app/dashboard/checkin/locations/loading.tsx", "utf8");
const desk = readFileSync("components/checkin/checkin-desk.tsx", "utf8");

test("Rooms puts the interactive roster and activity above room settings", () => {
  assert.match(page, /includeClosed: true/);
  assert.match(page, /<RosterBoard/);
  assert.match(page, /<ActivityFeed/);
  assert.match(page, /<RoomAlerts/);
  assert.match(page, /<LocationsManager/);
  assert.match(page, /buildActivityFeed\(daySessions\)/);
  assert.match(page, /openRosterSessions\(daySessions\)/);

  const rosterAt = page.indexOf("<RosterBoard");
  const activityAt = page.indexOf("<ActivityFeed");
  const settingsAt = page.indexOf("<LocationsManager");
  assert.ok(rosterAt > 0 && activityAt > rosterAt && settingsAt > activityAt);
});

test("room settings live behind AdvancedSection and no longer show read-only occupancy", () => {
  assert.match(manager, /<AdvancedSection/);
  assert.match(manager, /ROOM_SETTINGS_TITLE/);
  assert.doesNotMatch(manager, /occupancy/);
  assert.doesNotMatch(manager, /joinNames/);
  assert.doesNotMatch(manager, /Nobody is in this room right now/);
});

test("Rooms loading skeleton mirrors Active now, activity, and room settings", () => {
  assert.match(loading, /ACTIVE_NOW_TITLE/);
  assert.match(loading, /ACTIVITY_TITLE/);
  assert.match(loading, /ROOM_SETTINGS_TITLE/);
  assert.match(loading, /<SkeletonContainer className="flex w-full flex-col gap-8"/);
  assert.doesNotMatch(loading, /max-w-(3xl|5xl|6xl)/);
});

test("Check-in desk still keeps its own search flow and roster", () => {
  assert.match(desk, /DESK_SEARCH_LABEL|Find a family/);
  assert.match(desk, /<RosterBoard/);
  assert.match(desk, /In the rooms now/);
});
