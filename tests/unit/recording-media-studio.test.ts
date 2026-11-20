import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { filterNavByFeatures, navItems } from "@/components/dashboard/nav-items";
import { CLIPS_HREF, clipHref, recordingPageHref, transcriptHref } from "@/lib/sermon-media/hrefs";
import { automaticSermonRange } from "@/lib/sermon-media/sermon-range";

const read = (path: string) => readFileSync(path, "utf8");
const seg = (start: number, end: number) => ({ start, end });

test("transcripts and clips live under Live > Recordings, not in the sidebar", () => {
  const all = filterNavByFeatures(navItems, ["live_stream", "sermon_media"]);
  assert.ok(!all.some((item) => item.label === "Transcripts" || item.label === "Clips"));
  assert.ok(!all.some((item) => /\/dashboard\/(transcripts|clips)\b/.test(item.href)));
  assert.equal(CLIPS_HREF, "/dashboard/live-streaming/recordings/clips");
  assert.equal(clipHref("c1"), "/dashboard/live-streaming/recordings/clips/c1");
  assert.equal(recordingPageHref("r1"), "/dashboard/live-streaming/recordings/r1");
  assert.equal(transcriptHref("r1"), "/dashboard/live-streaming/recordings/r1/transcript");
  assert.equal(transcriptHref("r1", 95.7), "/dashboard/live-streaming/recordings/r1/transcript?t=95");
  assert.equal(transcriptHref("r1", Number.NaN), "/dashboard/live-streaming/recordings/r1/transcript");
});

test("old Transcripts and Clips URLs redirect, and every new route has a loading state", () => {
  assert.match(read("app/dashboard/transcripts/page.tsx"), /redirect\(RECORDINGS_BASE_HREF\)/);
  assert.match(read("app/dashboard/transcripts/[id]/page.tsx"), /redirect\(transcriptHref\(/);
  assert.match(read("app/dashboard/clips/page.tsx"), /redirect\(/);
  assert.match(read("app/dashboard/clips/[clipId]/page.tsx"), /redirect\(clipHref\(clipId\)\)/);
  for (const dir of [
    "app/dashboard/live-streaming/recordings/clips",
    "app/dashboard/live-streaming/recordings/clips/[clipId]",
    "app/dashboard/live-streaming/recordings/[id]/transcript",
  ]) {
    assert.ok(existsSync(`${dir}/loading.tsx`), dir);
  }
});

test("the recording's More options holds the transcript and clips actions", () => {
  const review = read("components/live-streaming/recordings/recording-review.tsx");
  assert.match(review, /\{mediaSlot\}\s*<\/AdvancedSection>/);
  assert.match(read("app/dashboard/live-streaming/recordings/[id]/page.tsx"), /mediaSlot=\{showSermonMedia \? <RecordingMediaActions/);
});

test("the transcript page has no confirmation gate and no lesson or clip making", () => {
  const detail = read("components/transcripts/transcript-detail.tsx");
  assert.doesNotMatch(detail, /Make something from this sermon|makeLesson|makeClips|range_required/);
  const card = read("components/sermon-media/sermon-range-card.tsx");
  assert.doesNotMatch(card, /Needs your check|Confirm sermon times|Check the sermon times/);
  assert.doesNotMatch(read("app/api/sermon-media/recordings/[id]/lesson/route.ts"), /range_required/);
  assert.match(read("app/api/sermon-media/recordings/[id]/lesson/route.ts"), /lessonSourceRange\(state, transcript\)/);
});

test("making clips starts from the video: no transcript is needed first", () => {
  const route = read("app/api/sermon-media/recordings/[id]/clips/route.ts");
  const make = route.slice(route.indexOf('if (parsed.data.action === "make")'), route.indexOf("const transcript = await getTranscript"));
  assert.match(make, /requestClips\(/);
  assert.doesNotMatch(make, /transcript isn't ready/);
  const studio = read("lib/sermon-media/studio.ts");
  assert.match(studio, /manual: job\?\.params\?\.\[MAKE_CLIPS_PARAM\] === true/);
});

test("the sermon range is used directly: the detected one, else the whole recording", () => {
  const segments = [seg(0, 30), seg(30, 3600)];
  assert.deepEqual(
    automaticSermonRange({ suggestion: { startSec: 1200, endSec: 3000 }, durationSec: 3600, segments }),
    { startSec: 1200, endSec: 3000, whole: false },
  );
  // An uncertain guess is still the best guess.
  assert.deepEqual(
    automaticSermonRange({ suggestion: { startSec: 10, endSec: 9000 }, durationSec: 3600, segments }),
    { startSec: 10, endSec: 3600, whole: false },
  );
  assert.deepEqual(
    automaticSermonRange({ suggestion: { startSec: null, endSec: null }, durationSec: 3600, segments }),
    { startSec: 0, endSec: 3600, whole: true },
  );
  // No duration on record: the last word.
  assert.deepEqual(
    automaticSermonRange({ suggestion: { startSec: null, endSec: null }, durationSec: null, segments: [seg(0, 1834.56)] }),
    { startSec: 0, endSec: 1834.5, whole: true },
  );
  assert.equal(automaticSermonRange({ suggestion: { startSec: null, endSec: null }, durationSec: null, segments: [] }), null);
});
