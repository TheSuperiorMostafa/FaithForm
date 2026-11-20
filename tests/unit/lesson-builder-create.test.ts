import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { parseNewLessonRequest } from "@/lib/lesson-builder/create-lesson";

const RECORDING = "3f1c2b8e-6a4d-4c2e-9b1a-7d5e8f9a0b1c";
const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

test("a lesson from a past sermon needs only the sermon", () => {
  const parsed = parseNewLessonRequest({ source: "sermon", recording_id: RECORDING });
  assert.deepEqual(parsed, { ok: true, data: { source: "sermon", recording_id: RECORDING } });
});

test("a past-sermon lesson ignores passages, series and date sent with it", () => {
  const parsed = parseNewLessonRequest({
    source: "sermon",
    recording_id: RECORDING,
    scripture_refs: ["John 3:16"],
    series_id: RECORDING,
    sermon_date: "2026-11-22",
  });
  assert.ok(parsed.ok);
  assert.deepEqual(Object.keys(parsed.data).sort(), ["recording_id", "source"]);
});

test("a past-sermon lesson must name a sermon", () => {
  const parsed = parseNewLessonRequest({ source: "sermon", recording_id: "not-a-sermon" });
  assert.deepEqual(parsed, { ok: false, error: "Choose one of your past sermons." });
  assert.equal(parseNewLessonRequest({ source: "sermon" }).ok, false);
});

test("a new lesson needs a title and passages, but no series or date", () => {
  const parsed = parseNewLessonRequest({
    source: "scripture",
    title: "  Living water ",
    scripture_refs: ["John 4:1-26"],
    translation: "BSB",
  });
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.data, {
    source: "scripture",
    title: "Living water",
    scripture_refs: ["John 4:1-26"],
    translation: "BSB",
  });
});

test("an older request without a source is a new lesson, and its series and date are dropped", () => {
  const parsed = parseNewLessonRequest({
    title: "Living water",
    scripture_refs: ["John 4:1-26"],
    translation: "BSB",
    sermon_date: "2026-11-22",
    series_id: RECORDING,
  });
  assert.ok(parsed.ok);
  assert.equal(parsed.data.source, "scripture");
  assert.ok(!("sermon_date" in parsed.data) && !("series_id" in parsed.data));
});

test("a new lesson explains what is missing or unreadable", () => {
  assert.deepEqual(parseNewLessonRequest({ source: "scripture", title: " ", scripture_refs: ["John 4"], translation: "BSB" }), {
    ok: false,
    error: "Give the lesson a title.",
  });
  assert.deepEqual(parseNewLessonRequest({ source: "scripture", title: "Water", scripture_refs: [], translation: "BSB" }), {
    ok: false,
    error: "Add at least one Bible passage.",
  });
  assert.deepEqual(
    parseNewLessonRequest({ source: "scripture", title: "Water", scripture_refs: ["somewhere in the middle"], translation: "BSB" }),
    { ok: false, error: 'We couldn\'t read the passage "somewhere in the middle".' },
  );
  assert.equal(parseNewLessonRequest(null).ok, false);
});

test("the new-lesson form offers two starts and no series or lesson date", () => {
  const form = read("components/lesson-builder/new-lesson-form.tsx");
  assert.doesNotMatch(form, /series_id|sermon_date|DatePicker|Lesson date|Series/);
  assert.match(form, /source: "sermon", recording_id/);
  assert.match(form, /source: "scripture"/);

  const route = read("app/api/lessons/route.ts");
  assert.doesNotMatch(route, /series_id|sermon_date/);
  assert.match(route, /requireRecordingAccess\(input\.recording_id, "edit"\)/, "a past sermon is checked against the church");
});
