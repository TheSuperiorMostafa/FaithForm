import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { getStaffRecording, updateRecordingDetails } from "@/lib/stream/recording-publication";
import { getStreamEvent, updateStreamEvent } from "@/lib/stream/events";
import { readScheduledDetails, ScheduledDetailsError } from "@/lib/stream/scheduled-details-input";

const churchId = "church-a", recordingId = "recording-a", eventId = "event-a";
function database(t: TestContext) {
  const state = { readFails: false, missing: false, speakers: ["Pastor A", "Doe, Jane"], patches: [] as Record<string, unknown>[], reads: 0 };
  t.mock.method(globalThis, "fetch", async (resource: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(resource instanceof Request ? resource.url : String(resource));
    assert.equal(url.hostname, "tag-persistence.example.test");
    if (url.pathname.endsWith("/churches")) return Response.json({ slug: "qa-church" });
    const recording = url.pathname.endsWith("/stream_recordings");
    assert.ok(recording || url.pathname.endsWith("/stream_events"));
    if (recording || init?.method === "PATCH" || url.searchParams.get("select") === "speaker_tags") {
      assert.equal(url.searchParams.get("church_id"), `eq.${churchId}`);
    }
    assert.equal(url.searchParams.get("id"), `eq.${recording ? recordingId : eventId}`);
    if (init?.method === "PATCH") {
      const patch = JSON.parse(String(init.body)) as Record<string, unknown>;
      state.patches.push(patch);
      if (patch.speaker_tags) state.speakers = patch.speaker_tags as string[];
      if (recording) return Response.json([{ id: recordingId }]);
      assert.equal(url.searchParams.get("status"), "eq.scheduled");
      return Response.json({ id: eventId, church_id: churchId, title: "Sunday", speaker_tags: state.speakers, chapter_tags: patch.chapter_tags ?? [], topic_tags: patch.topic_tags ?? [] });
    }
    state.reads++;
    if (state.readFails) return Response.json({ code: "XX000", message: "injected read failure" }, { status: 400 });
    if (state.missing) return Response.json(null);
    return Response.json(recording ? {
      id: recordingId, title: "Sunday", status: "ready", source_kind: "file", duration_sec: 120,
      mobile_playable: true, mobile_rendition_verified_at: "2026-11-13T00:00:00Z", speaker_tags: state.speakers,
      chapter_tags: ["John 3:1, 16"], topic_tags: ["Grace, mercy"], created_at: "2026-11-13T00:00:00Z",
    } : { id: eventId, church_id: churchId, title: "Sunday", speaker_tags: state.speakers, chapter_tags: ["John 3:1, 16"], topic_tags: ["Grace, mercy"] });
  });
  return { state, db: createClient("https://tag-persistence.example.test", "safe-test-key", { auth: { persistSession: false, autoRefreshToken: false } }) };
}

test("recording and upcoming reads retain every stored speaker alongside legacy first-speaker compatibility", async t => {
  const { state, db } = database(t);
  const recording = await getStaffRecording(churchId, recordingId, db);
  assert.deepEqual(recording?.speakers, state.speakers);
  assert.equal(recording?.speaker, "Pastor A");
  const event = await getStreamEvent(eventId, db);
  assert.deepEqual(event?.speakers, state.speakers);
  assert.equal(event?.speaker, "Pastor A");
});

test("explicit recording tags preserve commas and case, trim whitespace and support clearing all names", async t => {
  const { state, db } = database(t);
  const result = await updateRecordingDetails({ churchId, recordingId,
    speakers: [" Pastor A ", "Doe, Jane", "Pastor A"], chapters: ["John 3:1, 16"], topics: ["Grace, mercy", "HOPE"],
  }, db);
  assert.equal(result.ok, true);
  assert.deepEqual(state.patches, [{ speaker_tags: ["Pastor A", "Doe, Jane"], chapter_tags: ["John 3:1, 16"], topic_tags: ["Grace, mercy", "HOPE"] }]);
  assert.equal(state.reads, 0);
  assert.equal((await updateRecordingDetails({ churchId, recordingId, speakers: [], chapters: [], topics: [] }, db)).ok, true);
  assert.deepEqual(state.patches[1], { speaker_tags: [], chapter_tags: [], topic_tags: [] });
});

test("invalid or oversized recording tags refuse the save before any reads or writes", async t => {
  const { state, db } = database(t);
  for (const invalid of [
    { speakers: ["x".repeat(121)] }, { speakers: Array.from({ length: 21 }, (_, i) => `Speaker ${i}`) },
    { topics: ["x".repeat(81)] }, { chapters: Array.from({ length: 21 }, (_, i) => `John ${i}`) },
    { topics: "bad payload" }, { speakers: [42] },
  ]) {
    const result = await updateRecordingDetails({ churchId, recordingId, ...invalid } as Parameters<typeof updateRecordingDetails>[0], db);
    assert.equal(result.ok, false);
  }
  assert.deepEqual(state.patches, []);
  assert.equal(state.reads, 0);
});

test("a legacy recording name edit preserves remaining names and a read failure cannot erase them", async t => {
  const { state, db } = database(t);
  state.readFails = true;
  const failed = await updateRecordingDetails({ churchId, recordingId, title: "Edited title", speaker: "Pastor B" }, db);
  assert.equal(failed.ok, false);
  assert.deepEqual(state.patches, []);
  state.readFails = false;
  assert.equal((await updateRecordingDetails({ churchId, recordingId, speaker: "Pastor B" }, db)).ok, true);
  assert.deepEqual(state.patches[0], { speaker_tags: ["Pastor B", "Doe, Jane"] });
});

test("upcoming explicit arrays replace all names while legacy name edits safely preserve the others", async t => {
  const { state, db } = database(t);
  await updateStreamEvent(eventId, churchId, { speakers: ["A, B", "Pastor C"], chapters: ["John 3:1, 16"] }, db, "scheduled");
  assert.deepEqual(state.patches[0], { speaker_tags: ["A, B", "Pastor C"], chapter_tags: ["John 3:1, 16"] });
  state.readFails = true;
  await assert.rejects(updateStreamEvent(eventId, churchId, { speaker: "Replacement" }, db, "scheduled"), /saved speaker names/);
  assert.equal(state.patches.length, 1);
  state.readFails = false;
  await updateStreamEvent(eventId, churchId, { speaker: "Replacement" }, db, "scheduled");
  assert.deepEqual(state.patches[1], { speaker_tags: ["Replacement", "Pastor C"] });
  await updateStreamEvent(eventId, churchId, { speakers: [] }, db, "scheduled");
  assert.deepEqual(state.patches[2], { speaker_tags: [] });
});

function form(values: Record<string, string>) {
  const result = new FormData(); result.set("title", "Sunday");
  for (const [key, value] of Object.entries(values)) result.set(key, value);
  return result;
}

test("upcoming JSON takes precedence over legacy CSV and keeps commas and explicit empty arrays", () => {
  const read = readScheduledDetails(form({ speaker: "Old first name", chapters: "Old, CSV", topics: "Old, CSV",
    speakers_json: JSON.stringify(["Pastor A", "Doe, Jane"]), chapters_json: JSON.stringify(["John 3:1, 16"]), topics_json: JSON.stringify(["Grace, mercy", "HOPE"]),
  }));
  assert.deepEqual(read.speakers, ["Pastor A", "Doe, Jane"]);
  assert.equal(read.speaker, "Pastor A");
  assert.deepEqual(read.chapters, ["John 3:1, 16"]);
  assert.deepEqual(read.topics, ["Grace, mercy", "HOPE"]);
  const cleared = readScheduledDetails(form({ speaker: "Old first name", speakers_json: "[]", chapters_json: "[]", topics_json: "[]" }));
  assert.deepEqual(cleared.speakers, []); assert.deepEqual(cleared.chapters, []); assert.deepEqual(cleared.topics, []);
  const legacy = readScheduledDetails(form({ speaker: "Doe, Jane", chapters: "John 3, Romans 8", topics: "Hope, Grace" }));
  assert.equal(legacy.speaker, "Doe, Jane"); assert.equal(legacy.speakers, undefined);
  assert.deepEqual(legacy.chapters, ["John 3", "Romans 8"]);
});

test("malformed JSON or tag limits are rejected instead of falling back to stale legacy values", () => {
  const invalidCases: Record<string, string>[] = [
    { speakers_json: "{" }, { speakers_json: JSON.stringify(["x".repeat(121)]) }, { speakers_json: JSON.stringify([42]) },
    { topics_json: JSON.stringify(Array.from({ length: 21 }, (_, i) => `Topic ${i}`)) }, { chapters_json: JSON.stringify(["x".repeat(81)]) },
  ];
  for (const invalid of invalidCases) assert.throws(() => readScheduledDetails(form(invalid)), ScheduledDetailsError);
});
