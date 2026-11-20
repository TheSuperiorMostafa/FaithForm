import "../support/stub-server-only";

import assert from "node:assert/strict";
import test from "node:test";

import { planPdfColors } from "@/components/service-plans/pdf/plan-pdf";
import { planPdfFileName, renderPlanPdf, resolvePlanLogo } from "@/lib/service-plans/pdf";
import { buildTimeline } from "@/lib/service-plans/timing";
import type { Plan, PlanItem } from "@/lib/service-plans/types";
import { buildPlanView, presetDefaults } from "@/lib/service-plans/view";

const PERSON = "11111111-1111-4111-8111-111111111111";

function item(id: string, itemType: PlanItem["itemType"], title: string, lengthSeconds: number, extra: Partial<PlanItem> = {}): PlanItem {
  return {
    id,
    position: id,
    itemType,
    title,
    lengthSeconds,
    description: null,
    mediaUrl: null,
    song: null,
    leaders: [],
    updatedAt: "2026-11-20T00:00:00Z",
    updatedBy: null,
    ...extra,
  };
}

function fixture(announcementSeconds = 180): Plan {
  return {
    id: "plan-1",
    serviceTypeId: "type-1",
    serviceTypeName: "Sunday Morning",
    date: "2026-11-23",
    title: null,
    series: "Advent",
    isTemplate: false,
    shareVersion: 1,
    lastSharedVersion: null,
    targetSeconds: 75 * 60,
    times: [
      { id: "t1", kind: "service", label: "First Service", startsAt: "2026-11-23T15:00:00Z" },
      { id: "t2", kind: "service", label: "Second Service", startsAt: "2026-11-23T17:00:00Z" },
    ],
    items: [
      item("h1", "header", "Pre-service", 0),
      item("a1", "item", "Announcements", announcementSeconds, {
        leaders: [{ personId: PERSON, teamPositionId: null, name: "Jane Smith", positionLabel: null, photoUrl: null }],
      }),
      item("h2", "header", "Worship", 0),
      item("s1", "song", "Great Is Thy Faithfulness", 300, {
        description: "Full band, end on chorus.",
        song: {
          songId: "song-1",
          title: "Great Is Thy Faithfulness",
          author: null,
          ccliNumber: "18723",
          arrangementId: null,
          arrangementName: "Hymn",
          key: "D",
        },
      }),
      item("m1", "item", "Message", 1800, {
        leaders: [{ personId: PERSON, teamPositionId: null, name: "Jane Smith", positionLabel: null, photoUrl: null }],
      }),
    ],
    notes: [
      { id: "n1", itemId: "s1", category: "tech", body: "Lyrics on screen two.", updatedAt: "2026-11-20T00:00:00Z" },
      { id: "n2", itemId: null, category: "general", body: "Communion this week.", updatedAt: "2026-11-20T00:00:00Z" },
    ],
    team: [],
    updatedAt: "2026-11-20T00:00:00Z",
  };
}

test("renderPlanPdf renders a real PDF for every preset and orientation", async () => {
  const plan = fixture();
  for (const preset of ["full", "team", "person", "order"] as const) {
    const buffer = await renderPlanPdf({
      plan,
      options: { ...presetDefaults(preset), personId: PERSON, timeId: "t2" },
      churchName: "Grace Church",
      timeZone: "America/Chicago",
      logoSrc: null,
      orientation: preset === "full" ? "landscape" : "portrait",
      audience: preset === "person" ? "For Jane Smith" : null,
    });
    assert.ok(buffer.length > 1000, `${preset} PDF is not empty`);
    assert.equal(buffer.subarray(0, 4).toString("latin1"), "%PDF");
  }
});

test("printed start times come from buildTimeline: a longer item moves later items by exactly the difference", () => {
  const options = { ...presetDefaults("full"), timeId: "t1" };
  const before = buildPlanView(fixture(180), options);
  const after = buildPlanView(fixture(300), options);

  const timeline = buildTimeline(fixture(180).items, "2026-11-23T15:00:00Z");
  for (const row of before.rows) {
    const expected = timeline.byId.get(row.id)?.startsAt?.toISOString() ?? null;
    assert.equal(row.startsAt, expected, `${row.title} matches the timeline`);
  }

  const startOf = (view: typeof before, id: string) => Date.parse(view.rows.find((r) => r.id === id)!.startsAt!);
  assert.equal(startOf(after, "a1") - startOf(before, "a1"), 0, "Announcements itself does not move");
  assert.equal((startOf(after, "s1") - startOf(before, "s1")) / 1000, 120);
  assert.equal((startOf(after, "m1") - startOf(before, "m1")) / 1000, 120);
  assert.equal(after.totalSeconds - before.totalSeconds, 120);
});

test("file names, logo safety and brand contrast", async () => {
  assert.equal(planPdfFileName(fixture(), "order"), "sunday-morning-2026-11-23-order-of-service.pdf");
  // Only the project's own public storage is fetched; anything else prints without a logo.
  assert.equal(await resolvePlanLogo("http://169.254.169.254/latest/meta-data"), null);
  assert.equal(await resolvePlanLogo("not a url"), null);
  // A light church colour cannot carry white text, so navy stays.
  assert.equal(planPdfColors({ primary: "#FFEB3B" }).primary, "#002D5F");
  assert.equal(planPdfColors({ primary: "#4a148c", accent: "#abc" }).primary, "#4A148C");
  assert.equal(planPdfColors({ accent: "#abc" }).accent, "#AABBCC");
});
