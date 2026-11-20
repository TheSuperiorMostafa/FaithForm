import assert from "node:assert/strict";
import test from "node:test";

import { compareKeys, isValidKey, keyBetween, keysBetween } from "../../lib/service-plans/fractional-index";
import {
  buildTimeline,
  formatDuration,
  nextWeekdayOnOrAfter,
  overTargetSeconds,
  parseDuration,
} from "../../lib/service-plans/timing";
import type { Plan, PlanItem } from "../../lib/service-plans/types";
import { buildPlanView, presetDefaults } from "../../lib/service-plans/view";

const item = (id: string, itemType: PlanItem["itemType"], lengthSeconds: number, extra: Partial<PlanItem> = {}): PlanItem => ({
  id,
  position: id,
  itemType,
  title: id,
  lengthSeconds,
  description: null,
  mediaUrl: null,
  song: null,
  leaders: [],
  updatedAt: "",
  updatedBy: null,
  ...extra,
});

test("start time is the service time plus every earlier non-header length", () => {
  const items = [
    item("pre", "header", 0),
    item("welcome", "item", 120),
    item("announcements", "item", 180),
    item("worship", "header", 0),
    item("song1", "song", 300),
    item("song2", "song", 240),
  ];
  const tl = buildTimeline(items, "2026-11-22T14:00:00.000Z");
  assert.equal(tl.byId.get("welcome")?.offsetSeconds, 0);
  assert.equal(tl.byId.get("announcements")?.offsetSeconds, 120);
  assert.equal(tl.byId.get("song1")?.startsAt?.toISOString(), "2026-11-22T14:05:00.000Z");
  assert.equal(tl.byId.get("pre")?.startsAt, null, "headers carry no time");
  assert.equal(tl.byId.get("pre")?.subtotalSeconds, 300);
  assert.equal(tl.byId.get("worship")?.subtotalSeconds, 540);
  assert.equal(tl.totalSeconds, 840);
});

test("changing Announcements from 3:00 to 5:00 moves every later start by exactly two minutes", () => {
  const make = (len: number) => [item("welcome", "item", 120), item("announcements", "item", len), item("song", "song", 300), item("message", "item", 1800)];
  const before = buildTimeline(make(180), "2026-11-22T14:00:00.000Z");
  const after = buildTimeline(make(300), "2026-11-22T14:00:00.000Z");
  for (const id of ["song", "message"]) {
    assert.equal(after.byId.get(id)!.startsAt!.getTime() - before.byId.get(id)!.startsAt!.getTime(), 120_000);
  }
  assert.equal(after.byId.get("welcome")!.startsAt!.getTime(), before.byId.get("welcome")!.startsAt!.getTime());
});

test("lengths read and print the way people write them", () => {
  assert.equal(formatDuration(180), "3:00");
  assert.equal(formatDuration(65), "1:05");
  assert.equal(formatDuration(3900), "1:05:00");
  assert.equal(parseDuration("3"), 180);
  assert.equal(parseDuration("3:30"), 210);
  assert.equal(parseDuration("1:02:03"), 3723);
  assert.equal(parseDuration("90s"), 90);
  assert.equal(parseDuration("2 min"), 120);
  assert.equal(parseDuration("3:75"), null);
  assert.equal(parseDuration("soon"), null);
  assert.equal(overTargetSeconds(4800, 4500), 300);
  assert.equal(overTargetSeconds(4800, null), null);
});

test("next occurrence of the type's usual day", () => {
  assert.equal(nextWeekdayOnOrAfter("2026-11-20", 0), "2026-11-22"); // Friday → Sunday
  assert.equal(nextWeekdayOnOrAfter("2026-11-22", 0), "2026-11-22");
  assert.equal(nextWeekdayOnOrAfter("2026-11-23", 3), "2026-11-25");
});

test("fractional keys sort between their neighbours and stay valid", () => {
  const first = keyBetween(null, null);
  const second = keyBetween(first, null);
  const between = keyBetween(first, second);
  assert.ok(compareKeys(first, between) < 0 && compareKeys(between, second) < 0);
  const top = keyBetween(null, first);
  assert.ok(top < first);

  // Repeated inserts into the same gap keep working.
  let lo = first;
  const hi = second;
  for (let i = 0; i < 200; i++) {
    const k = keyBetween(lo, hi);
    assert.ok(lo < k && k < hi);
    assert.ok(isValidKey(k));
    assert.match(k, /^[0-9A-Za-z]+$/);
    lo = k;
  }

  const spread = keysBetween(null, null, 50);
  assert.deepEqual([...spread].sort(compareKeys), spread);
  assert.equal(new Set(spread).size, 50);
});

function plan(): Plan {
  return {
    id: "p",
    serviceTypeId: "t",
    serviceTypeName: "Sunday Morning",
    date: "2026-11-22",
    title: null,
    series: null,
    isTemplate: false,
    shareVersion: 3,
    lastSharedVersion: 2,
    targetSeconds: 3600,
    times: [{ id: "t1", kind: "service", label: "Service", startsAt: "2026-11-22T14:00:00.000Z" }],
    items: [
      item("h1", "header", 0, { title: "Pre-Service" }),
      item("a", "item", 180, {
        title: "Announcements",
        leaders: [{ personId: "mike", teamPositionId: null, name: "Pastor Mike", positionLabel: null, photoUrl: null }],
      }),
      item("h2", "header", 0, { title: "Worship" }),
      item("s", "song", 300, {
        leaders: [{ personId: null, teamPositionId: "keys", name: "Keys", positionLabel: "Worship · Keys", photoUrl: null }],
      }),
    ],
    notes: [
      { id: "n1", itemId: "a", category: "tech", body: "Slide loop starts at 8:55", updatedAt: "" },
      { id: "n2", itemId: "a", category: "worship", body: "Band on stage", updatedAt: "" },
      { id: "n3", itemId: null, category: "general", body: "Communion Sunday", updatedAt: "" },
    ],
    team: [
      { id: "m1", teamId: "w", teamName: "Worship", positionId: "keys", positionName: "Keys", personId: "jo", personName: "Jo", status: "confirmed" },
    ],
    updatedAt: "",
  };
}

test("a team view never carries a note category the team may not see", () => {
  const view = buildPlanView(plan(), { ...presetDefaults("team"), categories: ["general", "tech"] });
  const notes = view.rows.flatMap((r) => r.notes.map((n) => n.category));
  assert.deepEqual(notes, ["tech"]);
  assert.ok(!JSON.stringify(view).includes("Band on stage"), "the worship note is not in the payload at all");
});

test("order only shows titles and times, no notes or leaders", () => {
  const view = buildPlanView(plan(), presetDefaults("order"));
  assert.ok(view.rows.every((r) => r.notes.length === 0 && r.leaders.length === 0 && r.description === null));
  assert.equal(view.planNotes.length, 0);
});

test("person view: only what they lead, through a position they fill, at the real start time", () => {
  const view = buildPlanView(plan(), { ...presetDefaults("person"), personId: "jo" });
  const items = view.rows.filter((r) => r.itemType !== "header");
  assert.deepEqual(items.map((r) => r.id), ["s"]);
  assert.equal(items[0].startsAt, "2026-11-22T14:03:00.000Z");
  assert.deepEqual(view.rows.map((r) => r.id), ["h2", "s"], "empty sections are dropped");
});
