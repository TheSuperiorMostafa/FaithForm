import "../support/stub-server-only";

import assert from "node:assert/strict";
import test from "node:test";

import { chartHasContent, chartUnits, mergeChordLine, parseChartLines } from "@/lib/service-plans/songs/chart";
import { planHasMaterials, sharedSongItems, shareShowsMaterials, shareViewOptions } from "@/lib/service-plans/share";
import type { Plan, PlanItem } from "@/lib/service-plans/types";
import { buildPlanView } from "@/lib/service-plans/view";

// Invented placeholder words only.

test("a chord line above words merges by column, with shared indentation removed", () => {
  assert.deepEqual(mergeChordLine("  Ab        Db", "  Lanterns glow along"), [
    { chord: "Ab", text: "Lanterns g" },
    { chord: "Db", text: "low along" },
  ]);
  // Words before the first chord keep their own segment; a chord past the end prints with no words.
  assert.deepEqual(mergeChordLine("      G           D", "Over the hill"), [
    { chord: null, text: "Over t" },
    { chord: "G", text: "he hill" },
    { chord: "D", text: "" },
  ]);
  // Tabs count as four spaces on both lines.
  assert.deepEqual(mergeChordLine("\tC", "\tRest"), [{ chord: "C", text: "Rest" }]);
});

test("a chord line with no words under it stays a chord row", () => {
  const lines = parseChartLines("Intro\nG  C  D\n\nVerse 1\n[G]Rest and [C]sing");
  assert.deepEqual(lines.map((l) => l.kind), ["section", "chords", "blank", "section", "lyric"]);
  // A chord line followed by an inline-chord line is not merged into it.
  const mixed = parseChartLines("G   C\n[D]Rest and sing");
  assert.deepEqual(mixed.map((l) => l.kind), ["chords", "lyric"]);
});

test("ChordPro section and comment directives typed into the chart read as headings", () => {
  const lines = parseChartLines("{start_of_chorus}\n[G]Rest and sing\n{end_of_chorus}\n{c: Bridge}\n{title: ignored}");
  assert.deepEqual(lines[0], { kind: "section", text: "Chorus" });
  assert.deepEqual(lines[2], { kind: "section", text: "Bridge" });
  assert.equal(lines.length, 3);
  assert.equal(chartHasContent("Verse 1\n{c: Chorus}"), false);
});

test("units keep each chord on the first word of its segment, so lines wrap between words", () => {
  assert.deepEqual(chartUnits([{ chord: "G", text: "Rest and " }, { chord: "C", text: "sing" }]), [
    { chord: "G", word: "Rest", space: true },
    { chord: null, word: "and", space: true },
    { chord: "C", word: "sing", space: false },
  ]);
});

function item(id: string, itemType: PlanItem["itemType"], song: PlanItem["song"] = null, leaders: PlanItem["leaders"] = []): PlanItem {
  return {
    id,
    position: id,
    itemType,
    title: id,
    lengthSeconds: itemType === "header" ? 0 : 300,
    description: null,
    mediaUrl: null,
    song,
    leaders,
    updatedAt: "2026-11-20T00:00:00Z",
    updatedBy: null,
  };
}

const SONG = { songId: "song-1", title: "Morning Light", author: null, ccliNumber: null, arrangementId: null, arrangementName: null, key: "G" };
const JANE = "11111111-1111-4111-8111-111111111111";

function plan(): Plan {
  return {
    id: "plan-1",
    serviceTypeId: "type-1",
    serviceTypeName: "Sunday Morning",
    date: "2026-11-23",
    title: null,
    series: null,
    isTemplate: false,
    shareVersion: 1,
    lastSharedVersion: null,
    targetSeconds: null,
    times: [{ id: "t1", kind: "service", label: "Service", startsAt: "2026-11-23T15:00:00Z" }],
    items: [
      item("w", "header"),
      item("s1", "song", SONG, [{ personId: JANE, teamPositionId: null, name: "Jane", positionLabel: null, photoUrl: null }]),
      item("s2", "song", { ...SONG, songId: "song-2" }),
      item("a1", "item"),
    ],
    notes: [],
    team: [],
    files: [],
    updatedAt: "2026-11-20T00:00:00Z",
  };
}

test("share links show song charts only for rows their view shows, never on Order only", () => {
  const p = plan();
  const full = buildPlanView(p, shareViewOptions({ preset: "full", categories: [], person_id: null }));
  assert.deepEqual(sharedSongItems(p, full).map((i) => i.id), ["s1", "s2"]);

  const person = buildPlanView(p, shareViewOptions({ preset: "person", categories: [], person_id: JANE }));
  assert.deepEqual(sharedSongItems(p, person).map((i) => i.id), ["s1"]);

  const order = buildPlanView(p, shareViewOptions({ preset: "order", categories: [], person_id: null }));
  assert.deepEqual(sharedSongItems(p, order), []);

  assert.equal(shareShowsMaterials("order"), false);
  assert.equal(shareShowsMaterials("team"), true);
  assert.equal(planHasMaterials(p), true);
  assert.equal(planHasMaterials({ files: [], items: [item("a", "item")] }), false);
});
