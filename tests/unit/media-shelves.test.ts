import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  bestArtwork,
  resolveArtwork,
  type ArtworkSet,
} from "@/lib/media/artwork";
import {
  assembleBrowse,
  countTags,
  withContinueShelf,
  type BrowseItemInput,
  type BrowseLinks,
} from "@/lib/media/shelves";
import { slugifySeriesName } from "@/lib/stream/media-library";

const links: BrowseLinks = {
  itemBase: "/items",
  seriesBase: "/series",
  topicBase: "/topics",
  speakerBase: "/speakers",
  allSeries: "/series",
  allItems: "/items",
  live: "/live",
};

function item(id: string, overrides: Partial<BrowseItemInput> = {}): BrowseItemInput {
  return {
    id,
    title: `Message ${id}`,
    publishedAt: null,
    recordedAt: `2026-09-${id.padStart(2, "0")}T14:00:00Z`,
    durationSec: 3600,
    visibility: "public",
    seriesId: null,
    seriesName: null,
    seriesSlug: null,
    artwork: null,
    seriesArtwork: null,
    legacyPosterUrl: null,
    speakers: [],
    chapters: [],
    topics: [],
    ...overrides,
  };
}

test("item artwork wins, series artwork fills gaps, and legacy only fills wide", () => {
  assert.deepEqual(
    resolveArtwork(
      { poster: "item-poster", wide: null },
      { poster: "series-poster", wide: "series-wide", banner: "series-banner" },
      "legacy-wide",
    ),
    {
      poster: "item-poster",
      wide: "series-wide",
      banner: "series-banner",
    },
  );

  assert.deepEqual(resolveArtwork(null, null, "legacy-wide"), {
    poster: null,
    wide: "legacy-wide",
    banner: null,
  });
});

test("a tile reports the shape of fallback artwork instead of stretching it", () => {
  const artwork: ArtworkSet = { poster: null, wide: "wide", banner: "banner" };
  assert.deepEqual(bestArtwork(artwork, "poster"), { url: "wide", crop: "wide" });
});

test("browse shelves are ordered, bounded, and do not repeat the featured item", () => {
  const browse = assembleBrowse({
    items: [
      item("1", { recordedAt: "2026-09-01T14:00:00Z" }),
      item("2", {
        recordedAt: "2026-09-02T14:00:00Z",
        artwork: { wide: "latest-wide" },
      }),
    ],
    series: [],
    live: null,
    links,
  });

  assert.equal(browse.featured?.id, "2");
  assert.deepEqual(
    browse.shelves.find((shelf) => shelf.kind === "recent")?.tiles.map((tile) => tile.id),
    ["1"],
  );
});

test("tag counts fold case while preserving the spelling used most often", () => {
  const counted = countTags(
    [
      item("1", { topics: ["Prayer", "Grace"] }),
      item("2", { topics: ["prayer"] }),
      item("3", { topics: ["Prayer"] }),
    ],
    "topics",
  );

  assert.deepEqual(counted, [
    { label: "Prayer", count: 3 },
    { label: "Grace", count: 1 },
  ]);
});

test("continue watching is device-local, newest first, and excludes starts and finishes", () => {
  const browse = assembleBrowse({
    items: [item("1"), item("2"), item("3")],
    series: [],
    live: null,
    links,
  });
  const continued = withContinueShelf(
    browse,
    [
      { itemId: "1", positionSec: 20, durationSec: 3600, updatedAt: 30 },
      { itemId: "2", positionSec: 400, durationSec: 3600, updatedAt: 20 },
      { itemId: "3", positionSec: 3590, durationSec: 3600, updatedAt: 10 },
    ],
    links,
    [item("1"), item("2"), item("3")],
  );

  const shelf = continued.shelves[0];
  assert.equal(shelf?.kind, "continue");
  assert.deepEqual(shelf?.tiles.map((tile) => tile.id), ["2"]);
  assert.equal(shelf?.tiles[0]?.progress, 400 / 3600);
});

test("the featured item can still appear in Continue watching", () => {
  const latest = item("2", {
    recordedAt: "2026-09-02T14:00:00Z",
    artwork: { wide: "latest-wide" },
  });
  const items = [item("1"), latest];
  const browse = assembleBrowse({ items, series: [], live: null, links });

  assert.equal(browse.featured?.id, latest.id);
  assert.equal(browse.shelves[0]?.tiles.some((tile) => tile.id === latest.id), false);

  const continued = withContinueShelf(
    browse,
    [{ itemId: latest.id, positionSec: 300, durationSec: 3600, updatedAt: 10 }],
    links,
    items,
  );
  assert.equal(continued.shelves[0]?.kind, "continue");
  assert.equal(continued.shelves[0]?.tiles[0]?.id, latest.id);
});

test("series slugs match the migration backfill's base form", () => {
  assert.equal(slugifySeriesName("  Rooted!  "), "rooted");
  assert.equal(slugifySeriesName("***"), "series");
  assert.equal(slugifySeriesName("A".repeat(80)).length, 60);
});

test("migration 0080 suffixes from the stable base and versions every series edit", () => {
  const migration = readFileSync(
    new URL("../../supabase/migrations/0080_media_artwork_and_series.sql", import.meta.url),
    "utf8",
  );

  assert.match(migration, /candidate := left\(base_slug,/);
  assert.doesNotMatch(migration, /candidate := left\(candidate,/);
  assert.match(
    migration,
    /new\.mobile_publication_version := coalesce\(old\.mobile_publication_version, 1\) \+ 1/,
  );
  assert.match(migration, /alter column slug set not null/);
});
