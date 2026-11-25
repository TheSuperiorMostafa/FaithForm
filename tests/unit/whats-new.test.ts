import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { isFeatureKey, type FeatureKey } from "../../lib/features/catalog";
import { knownItemIds, pendingWhatsNew } from "../../lib/releases/pending";
import { RELEASES, WHATS_NEW_RECENT_DAYS, type WhatsNewRelease } from "../../lib/releases/whats-new";

const NOW = new Date("2026-11-25T15:00:00Z");
const EVERYTHING: FeatureKey[] = ["sermon_builder", "website", "people", "announcements"];

const sample: WhatsNewRelease[] = [
  {
    id: "update-2",
    title: "Update 2",
    date: "2026-11-20",
    items: [
      { id: "update-2/lessons", title: "Lessons", body: "Body.", feature: "sermon_builder", links: [{ href: "/dashboard/lesson-builder", label: "Build a lesson" }] },
      { id: "update-2/for-all", title: "For everyone", body: "Body." },
      {
        id: "update-2/maps",
        title: "Maps",
        body: "Body.",
        feature: ["announcements", "people"],
        links: [
          { href: "/dashboard/announcements", label: "Add an event", feature: "announcements" },
          { href: "/dashboard/people", label: "Open People", feature: "people" },
        ],
      },
    ],
  },
  {
    id: "update-1",
    title: "Update 1",
    date: "2026-11-01",
    items: [{ id: "update-1/website", title: "Website", body: "Body.", feature: "website" }],
  },
  {
    id: "update-0",
    title: "Update 0",
    date: "2026-06-01",
    items: [{ id: "update-0/old", title: "Old", body: "Body." }],
  },
];

test("shows the newest release, only with items whose feature this person can open", () => {
  const pending = pendingWhatsNew(sample, ["people"], new Set(), NOW);
  assert.equal(pending?.releaseId, "update-2");
  assert.deepEqual(pending?.items.map((item) => item.id), ["update-2/for-all", "update-2/maps"]);
});

test("an item with several features shows when any one is on, with a link they can open", () => {
  const pending = pendingWhatsNew(sample, ["people"], new Set(), NOW);
  const maps = pending?.items.find((item) => item.id === "update-2/maps");
  assert.deepEqual(maps?.link, { href: "/dashboard/people", label: "Open People" });
  const withEvents = pendingWhatsNew(sample, ["announcements", "people"], new Set(), NOW);
  assert.equal(withEvents?.items.find((item) => item.id === "update-2/maps")?.link?.label, "Add an event");
});

test("no pop-up once everything visible has been dismissed", () => {
  const seen = new Set(["update-2/for-all", "update-2/maps", "update-1/website"]);
  assert.equal(pendingWhatsNew(sample, ["people", "website"], seen, NOW), null);
});

test("no pop-up when every item depends on a feature that is off", () => {
  const gatedOnly = sample.map((release) => ({ ...release, items: release.items.filter((item) => item.feature) }));
  assert.equal(pendingWhatsNew(gatedOnly, [], new Set(), NOW), null);
});

test("a feature turned on later brings its item back while the release is recent", () => {
  const seen = new Set(["update-2/for-all", "update-2/maps"]);
  assert.equal(pendingWhatsNew(sample.slice(0, 1), ["people"], seen, NOW), null);
  const later = pendingWhatsNew(sample.slice(0, 1), ["people", "sermon_builder"], seen, NOW);
  assert.deepEqual(later?.items.map((item) => item.id), ["update-2/lessons"]);
  const tooLate = new Date(Date.parse("2026-11-20T00:00:00Z") + (WHATS_NEW_RECENT_DAYS + 1) * 86_400_000);
  assert.equal(pendingWhatsNew(sample.slice(0, 1), ["people", "sermon_builder"], seen, tooLate), null);
});

test("one dismissal covers older recent releases too, so there is never a second pop-up", () => {
  const pending = pendingWhatsNew(sample, ["website"], new Set(), NOW);
  assert.equal(pending?.releaseId, "update-2");
  assert.deepEqual(pending?.itemIds, ["update-2/for-all", "update-1/website"]);
  assert.equal(pendingWhatsNew(sample, ["website"], new Set(pending?.itemIds), NOW), null);
});

test("releases older than the recent window never show", () => {
  const pending = pendingWhatsNew(sample, EVERYTHING, new Set(), NOW);
  assert.ok(!pending?.itemIds.includes("update-0/old"));
});

test("the release file is well formed", () => {
  const ids = new Set<string>();
  const releaseIds = new Set<string>();
  // Must match whats_new_reads_item_id_check in migration 0178.
  const storable = /^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/;
  const sql = readFileSync("supabase/migrations/0178_whats_new_reads.sql", "utf8");
  assert.ok(sql.includes(storable.source.replace(/\\\//g, "/")), "item id pattern drifted from the migration");

  let previous = Infinity;
  for (const release of RELEASES) {
    assert.match(release.id, /^update-\d+$/);
    assert.ok(!releaseIds.has(release.id), `${release.id} is used twice`);
    releaseIds.add(release.id);
    assert.match(release.date, /^\d{4}-\d{2}-\d{2}$/);
    const time = Date.parse(`${release.date}T00:00:00Z`);
    assert.ok(time <= previous, "releases are newest first");
    previous = time;
    assert.ok(release.items.length > 0, `${release.id} has no items`);

    for (const item of release.items) {
      assert.ok(item.id.startsWith(`${release.id}/`), `${item.id} must start with ${release.id}/`);
      assert.match(item.id, storable);
      assert.ok(item.id.length <= 120);
      assert.ok(!ids.has(item.id), `${item.id} is used twice`);
      ids.add(item.id);
      assert.ok(item.title.length > 0 && item.title.length <= 60, `${item.id} title should be a few words`);
      assert.ok(item.body.length > 0 && item.body.length <= 280, `${item.id} body should be a sentence or two`);
      const features = item.feature === undefined ? [] : typeof item.feature === "string" ? [item.feature] : item.feature;
      for (const key of features) assert.ok(isFeatureKey(key), `${item.id}: unknown feature ${key}`);
      for (const link of item.links ?? []) {
        assert.ok(link.href.startsWith("/dashboard"), `${item.id}: links stay in the dashboard`);
        assert.ok(link.label.trim().length > 0);
        if (link.feature) assert.ok(features.includes(link.feature), `${item.id}: link feature is not one of the item's`);
      }
    }
  }
  assert.deepEqual(knownItemIds(RELEASES), ids);
});
