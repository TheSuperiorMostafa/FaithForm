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
    title: "Sunday service", seriesId: null, newSeriesName: "", speaker: null, description: null, chapters: [], topics: [],
  });
  assert.deepEqual(readScheduledDetails(details({ title: "Sunday", series_id: "__new__", new_series_name: "  Hope  " })), {
    title: "Sunday", seriesId: "__new__", newSeriesName: "Hope", speaker: null, description: null, chapters: [], topics: [],
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

test("recording details normalize whitespace, deduplicate tags, and allow clearing optional values", () => {
  const parsed = readScheduledDetails(details({ title: "Sunday", speaker: "  Pastor John  ", description: "  A new beginning.  ", chapters: "John 3, Romans 8, John 3, ", topics: "Grace, Prayer, Grace" }));
  assert.equal(parsed.speaker, "Pastor John");
  assert.equal(parsed.description, "A new beginning.");
  assert.deepEqual(parsed.chapters, ["John 3", "Romans 8"]);
  assert.deepEqual(parsed.topics, ["Grace", "Prayer"]);
  const cleared = readScheduledDetails(details({ title: "Sunday", speaker: " ", description: " ", chapters: " , ", topics: "" }));
  assert.equal(cleared.speaker, null);
  assert.equal(cleared.description, null);
  assert.deepEqual(cleared.chapters, []);
  assert.deepEqual(cleared.topics, []);
});

test("speaker, description and tag limits are enforced before uploading artwork or writing", () => {
  const invalid: Record<string, string>[] = [
    { speaker: "x".repeat(121) }, { description: "x".repeat(2001) },
    { chapters: "x".repeat(81) }, { topics: "x".repeat(81) },
    { topics: Array.from({ length: 21 }, (_, index) => `topic-${index}`).join(",") },
  ];
  for (const values of invalid) assert.throws(() => readScheduledDetails(details({ title: "Sunday", ...values })), ScheduledDetailsError);
});

test("recording and weekly recurrence inherit the new details while recording overrides survive", () => {
  const sql = readFileSync("supabase/migrations/0135_upcoming_service_recording_details.sql", "utf8");
  assert.match(sql, /WHERE id = NEW.stream_event_id AND church_id = NEW.church_id/);
  assert.match(sql, /NEW.mobile_summary := COALESCE\(NULLIF\(BTRIM\(NEW.mobile_summary\), ''\), service.description\)/);
  for (const column of ["speaker_tags", "chapter_tags", "topic_tags"]) {
    assert.ok(sql.includes(`IF COALESCE(cardinality(NEW.${column}), 0) = 0 THEN NEW.${column} := service.${column}`));
  }
  assert.doesNotMatch(sql, /BEFORE UPDATE|AFTER UPDATE/);
  const recurrence = readFileSync("lib/stream/go-live.ts", "utf8");
  for (const property of ["speaker_tags", "description", "chapter_tags", "topic_tags"]) assert.ok(recurrence.includes(`liveEvent.${property}`));
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
    async single() { return { data: { id: "event", church_id: "church", series_id: "series", artwork_url: "wide", speaker_tags: ["Pastor John"], description: "Hope", chapter_tags: ["John 3"], topic_tags: ["Grace"] }, error: null }; },
  };
  const db = { from(table: string) { assert.equal(table, "stream_events"); return query; } };
  const event = await updateStreamEvent("event", "church", { title: "New title", seriesId: "series", artworkUrl: "wide", speaker: "Pastor John", description: "Hope", chapters: ["John 3"], topics: ["Grace"] }, db as never, "scheduled");
  assert.deepEqual(updates, { title: "New title", series_id: "series", artwork_url: "wide", speaker_tags: ["Pastor John"], description: "Hope", chapter_tags: ["John 3"], topic_tags: ["Grace"] });
  assert.deepEqual(filters, [["id", "event"], ["church_id", "church"], ["status", "scheduled"]]);
  assert.equal(event.seriesId, "series");
  assert.equal(event.artworkUrl, "wide");
  assert.equal(event.speaker, "Pastor John");
  assert.equal(event.description, "Hope");
  assert.deepEqual(event.chapters, ["John 3"]);
  assert.deepEqual(event.topics, ["Grace"]);
});
