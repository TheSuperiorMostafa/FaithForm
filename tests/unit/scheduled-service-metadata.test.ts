import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readScheduledDetails, ScheduledDetailsError } from "../../lib/stream/scheduled-details-input";

function details(values: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
}

test("scheduled service details normalize title and support clearing or creating series", () => {
  assert.deepEqual(readScheduledDetails(details({ title: "  Sunday service  " })), {
    title: "Sunday service", seriesId: null, newSeriesName: "",
  });
  assert.deepEqual(readScheduledDetails(details({ title: "Sunday", series_id: "__new__", new_series_name: "  Hope  " })), {
    title: "Sunday", seriesId: "__new__", newSeriesName: "Hope",
  });
});

test("scheduled metadata rejects blank/oversized titles and invalid series selections", () => {
  const invalidDetails: Record<string, string>[] = [
    { title: " " }, { title: "x".repeat(121) },
    { title: "Sunday", series_id: "other-church-series" },
    { title: "Sunday", series_id: "__new__", new_series_name: "" },
    { title: "Sunday", series_id: "__new__", new_series_name: "x".repeat(121) },
  ];
  for (const values of invalidDetails) {
    assert.throws(() => readScheduledDetails(details(values)), ScheduledDetailsError);
  }
  assert.equal(readScheduledDetails(details({ title: "x".repeat(120) })).title.length, 120);
});

test("scheduled writes require admin, church ownership, and a still-scheduled row", () => {
  const source = readFileSync("app/dashboard/live-streaming/actions.ts", "utf8");
  const action = source.split("export async function updateScheduledStream(")[1].split("export async function cancelScheduledStream(")[0];
  assert.match(action, /requireStreamAccess\(\)/);
  assert.match(action, /if \(!auth\.isAdmin\)/);
  assert.match(action, /event\.churchId !== auth\.churchId/);
  assert.match(action, /event\.status !== "scheduled"/);
  assert.match(action, /updateStreamEvent\(eventId, auth\.churchId, metadata, db, "scheduled"\)/);
  const helper = readFileSync("lib/stream/scheduled-details.ts", "utf8");
  assert.match(helper, /\.eq\("id", seriesId\)\.eq\("church_id", churchId\)/);
  assert.match(helper, /normalizeSiteImage/);
  assert.match(helper, /ARTWORK_CROPS/);
  assert.match(helper, /file instanceof File/);
});

test("recording inheritance is insert-only, scoped to the church, and preserves overrides", () => {
  const sql = readFileSync("supabase/migrations/0133_upcoming_service_metadata.sql", "utf8");
  assert.match(sql, /WHERE id = NEW.stream_event_id AND church_id = NEW.church_id/);
  assert.match(sql, /BEFORE INSERT ON public.stream_recordings/);
  assert.match(sql, /NEW.series_id := COALESCE\(NEW.series_id, service.series_id\)/);
  for (const crop of ["poster", "wide", "banner"]) {
    assert.match(sql, new RegExp(`NEW.artwork_${crop}_url := COALESCE\\(NEW.artwork_${crop}_url, service.artwork_${crop}_url`));
  }
  const simulated = readFileSync("lib/stream/simulated.ts", "utf8");
  assert.doesNotMatch(simulated, /artwork_url/);
  assert.match(simulated, /sourceUrl: event.simulated_playout_url/);
});

test("upcoming metadata update keeps unrelated scheduling and platform fields untouched", async () => {
  const { updateStreamEvent } = await import("../../lib/stream/events");
  const filters: Array<[string, unknown]> = [];
  let updates: Record<string, unknown> = {};
  const query = {
    update(value: Record<string, unknown>) { updates = value; return this; },
    eq(key: string, value: unknown) { filters.push([key, value]); return this; },
    select() { return this; },
    async single() { return { data: { id: "event", church_id: "church", series_id: "series", artwork_url: "wide" }, error: null }; },
  };
  const db = { from(table: string) { assert.equal(table, "stream_events"); return query; } };
  const event = await updateStreamEvent("event", "church", { title: "New title", seriesId: "series", artworkUrl: "wide" }, db as never, "scheduled");
  assert.deepEqual(updates, { title: "New title", series_id: "series", artwork_url: "wide" });
  assert.deepEqual(filters, [["id", "event"], ["church_id", "church"], ["status", "scheduled"]]);
  assert.equal(event.seriesId, "series");
  assert.equal(event.artworkUrl, "wide");
});
