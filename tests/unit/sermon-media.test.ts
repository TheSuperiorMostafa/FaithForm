import assert from "node:assert/strict";
import test from "node:test";

import { buildCaptionCues, rebaseCues } from "@/lib/sermon-media/captions";
import { suggestClips } from "@/lib/sermon-media/clip-suggest";
import { signJobToken, verifyJobToken } from "@/lib/sermon-media/job-token";
import { suggestSermonRange } from "@/lib/sermon-media/sermon-range";
import { buildTimeline, sliceTimeline } from "@/lib/sermon-media/timeline";
import {
  applyTranscriptEdits,
  checkTranscript,
  segmentsInRange,
  type TranscriptGap,
  type TranscriptSegment,
} from "@/lib/sermon-media/transcript";

// ---------------------------------------------------------------------------
// Fixture: a representative service on the recording timeline.
//   0–25 min   worship (repeated lyric lines, music)
//   25–31 min  welcome and announcements
//   31–71 min  sermon on John 6, closing prayer ending in "Amen."
//   71–80 min  closing song
// ---------------------------------------------------------------------------

let n = 0;
const id = () => `s${String(++n).padStart(6, "0")}`;

function speech(start: number, end: number, sentences: string[], flags?: TranscriptSegment["flags"]): TranscriptSegment[] {
  const out: TranscriptSegment[] = [];
  const step = (end - start) / sentences.length;
  sentences.forEach((text, index) => {
    const s = start + index * step;
    const e = s + step - 0.2;
    const tokens = text.split(" ");
    const per = (e - s) / tokens.length;
    out.push({
      id: id(),
      start: round(s),
      end: round(e),
      text,
      words: tokens.map((w, k) => ({ w, s: round(s + k * per), e: round(s + (k + 1) * per - 0.02), p: 0.95 })),
      flags,
    });
  });
  return out;
}
const round = (v: number) => Math.round(v * 1000) / 1000;
const repeat = <T,>(items: T[], times: number) => Array.from({ length: times }, () => items).flat();

const sermonFiller = [
  "Jesus looked up and saw the crowd and he asked Philip where they would buy bread for all of these people today.",
  "Philip did the math and he told Jesus that even half a year of wages would not be enough for everyone here.",
  "Andrew found a boy with five small barley loaves and two fish and he wondered how far they could ever go.",
  "Jesus took what was offered and he gave thanks and the people ate as much as they wanted that whole evening.",
];
const storyClip = [
  "Have you ever felt like what you bring to God is simply not enough?",
  "I remember when I was nineteen and my dad lost his job and we had nothing in the pantry but rice and hope.",
  "My mother set the table anyway and she thanked God for the rice with tears in her eyes and real joy in her voice.",
  "This week you can bring God the small thing you have been hiding and trust him with it because he multiplies what we offer.",
];

const segments: TranscriptSegment[] = [
  ...speech(30, 25 * 60, repeat(["You are more than enough for me", "Your grace is all I need tonight", "Holy holy holy is the Lord"], 60), ["music"]),
  ...speech(25 * 60, 31 * 60, repeat(["Good morning church it is so good to see you here today.", "Next week we have the men's breakfast at eight and you can sign up in the lobby."], 12)),
  ...speech(31 * 60, 31 * 60 + 40, [
    "Would you turn with me to John chapter 6 verse 1 this morning.",
    "John 6 is the feeding of the five thousand and it is a passage about what happens when we offer what we have.",
  ]),
  ...speech(31 * 60 + 40, 50 * 60, repeat(sermonFiller, 20)),
  ...speech(50 * 60, 51 * 60, storyClip),
  ...speech(51 * 60, 70 * 60, repeat(sermonFiller, 20)),
  ...speech(70 * 60, 71 * 60, [
    "Let's pray together.",
    "Father thank you that you take what we have and make it more than enough in your hands.",
    "We offer you our small gifts this week in Jesus name. Amen.",
  ]),
  ...speech(71 * 60 + 10, 80 * 60, repeat(["You are more than enough for me", "Your grace is all I need tonight"], 40), ["music"]),
];
const gaps: TranscriptGap[] = [{ start: 0, end: 30, reason: "music" }];

// ---------------------------------------------------------------------------

test("the timeline matches the player: runs break at takes and sequence gaps, with no holes", () => {
  const seg = (takeId: string, seq: number, startedAt: string) => ({ id: `${takeId}-${seq}`, takeId, seq, startedAt, durationSec: 6, storagePath: `${takeId}/${seq}` });
  const timeline = buildTimeline([
    seg("a", 0, "2026-11-15T15:00:00Z"),
    seg("a", 1, "2026-11-15T15:00:06Z"),
    seg("a", 3, "2026-11-15T15:00:18Z"), // seq 2 lost
    seg("b", 0, "2026-11-15T15:10:00Z"), // reconnect, ten minutes later
  ]);
  assert.equal(timeline.runs.length, 3);
  assert.deepEqual(timeline.runs.map((run) => run.timelineStartSec), [0, 12, 18]);
  assert.deepEqual(timeline.gaps.map((gap) => gap.reason), ["missing_segment", "discontinuity"]);
  assert.equal(timeline.durationSec, 24, "the reconnect's wall-clock gap is not on the timeline");

  const slice = sliceTimeline(timeline, 13, 19);
  assert.deepEqual(slice.runs.map((run) => run.index), [1, 2]);
  assert.equal(slice.runs[0].segments[0].timelineStartSec, 12);
});

test("transcript checks reject overlap, out-of-range and misplaced words", () => {
  const base = { attempt_id: "00000000-0000-4000-8000-000000000000", language: "en", engine: "test", duration_sec: 100, gaps: [], audio_events: [], metrics: {} };
  assert.deepEqual(checkTranscript({ ...base, segments: [{ id: "s1", start: 0, end: 5, text: "a" }, { id: "s2", start: 5, end: 9, text: "b" }] }, 100), []);
  assert.ok(checkTranscript({ ...base, segments: [{ id: "s1", start: 0, end: 5, text: "a" }, { id: "s2", start: 4, end: 9, text: "b" }] }, 100).length > 0);
  assert.ok(checkTranscript({ ...base, segments: [{ id: "s1", start: 0, end: 500, text: "a" }] }, 100).length > 0);
  assert.ok(checkTranscript({ ...base, segments: [{ id: "s1", start: 10, end: 12, text: "a", words: [{ w: "a", s: 20, e: 21 }] }] }, 100).length > 0);
});

test("edits change text but never machine times, and drop word timing only where text changed", () => {
  const sample = segments.slice(0, 3);
  const result = applyTranscriptEdits(sample, [{ id: sample[1].id, text: "  Your grace is   all I need  " }, { id: sample[2].id, text: sample[2].text }]);
  assert.ok(result);
  assert.equal(result.segments[1].text, "Your grace is all I need");
  assert.equal(result.segments[1].start, sample[1].start);
  assert.equal(result.segments[1].end, sample[1].end);
  assert.equal(result.segments[1].words, undefined);
  assert.ok(result.segments[1].flags?.includes("edited"));
  assert.deepEqual(result.segments[2], sample[2], "unchanged text keeps its words");
  assert.equal(result.touchedStartSec, sample[1].start);
  assert.equal(applyTranscriptEdits(sample, [{ id: sample[0].id, text: sample[0].text }]), null);
});

test("range slicing keeps only words inside the confirmed sermon", () => {
  const segment = segments.find((s) => s.start >= 31 * 60)!;
  const cut = segment.start + (segment.end - segment.start) / 2;
  const sliced = segmentsInRange([segment], cut, segment.end + 10);
  assert.equal(sliced.length, 1);
  assert.ok(sliced[0].start >= cut - 0.01);
  assert.ok(sliced[0].text.length < segment.text.length);
  assert.ok(sliced[0].words!.every((word) => word.s >= cut - 0.01));
});

test("sermon range: finds the opening Scripture and the closing amen", () => {
  const suggestion = suggestSermonRange({ segments, gaps, audioEvents: [], durationSec: 80 * 60 });
  assert.equal(suggestion.status, "suggested");
  assert.ok(Math.abs(suggestion.startSec! - 31 * 60) <= 45, `start ${suggestion.startSec}`);
  assert.ok(Math.abs(suggestion.endSec! - 71 * 60) <= 20, `end ${suggestion.endSec}`);
  const kinds = suggestion.evidence.map((item) => item.kind);
  assert.ok(kinds.includes("opening_scripture") || kinds.includes("opening_phrase"));
  assert.ok(kinds.includes("closing_prayer"));
});

test("sermon range: uncertain without cues, failed without speech", () => {
  const plain = speech(0, 12 * 60, repeat(sermonFiller, 10));
  const uncertain = suggestSermonRange({ segments: plain, gaps: [], audioEvents: [], durationSec: 12 * 60 });
  assert.equal(uncertain.status, "uncertain");
  const music = suggestSermonRange({ segments: segments.slice(0, 50), gaps, audioEvents: [], durationSec: 20 * 60 });
  assert.equal(music.status, "failed");
});

test("clip suggestions stay inside the sermon, prefer the complete story, and explain why", () => {
  const range = { start: 31 * 60, end: 71 * 60 };
  const clips = suggestClips({ segments: segmentsInRange(segments, range.start, range.end), gaps, audioEvents: [], rangeStartSec: range.start, rangeEndSec: range.end });
  assert.ok(clips.length >= 1);
  for (const clip of clips) {
    assert.ok(clip.startSec >= range.start && clip.endSec <= range.end);
    assert.ok(clip.endSec - clip.startSec >= 20 && clip.endSec - clip.startSec <= 75);
    assert.ok(clip.reason.length > 0);
  }
  const best = clips[0];
  assert.ok(best.startSec >= 50 * 60 - 1 && best.endSec <= 51 * 60 + 1, `best clip at ${best.startSec}`);
  assert.match(best.reason, /story/);
  assert.match(best.reason, /question/);
});

test("clip suggestions: weak evidence gives fewer, missing audio excludes, reactions only add", () => {
  const range = { start: 31 * 60, end: 71 * 60 };
  const inRange = segmentsInRange(segments, range.start, range.end);
  const baseline = suggestClips({ segments: inRange, gaps: [], audioEvents: [], rangeStartSec: range.start, rangeEndSec: range.end });
  const blocked = suggestClips({ segments: inRange, gaps: [{ start: 50 * 60 + 10, end: 50 * 60 + 12, reason: "missing_audio" }], audioEvents: [], rangeStartSec: range.start, rangeEndSec: range.end });
  assert.ok(!blocked.some((clip) => clip.startSec < 50 * 60 + 12 && clip.endSec > 50 * 60 + 10));
  const applause = suggestClips({ segments: inRange, gaps: [], audioEvents: [{ start: 51 * 60 - 1, end: 51 * 60 + 2, label: "applause", score: 0.9 }], rangeStartSec: range.start, rangeEndSec: range.end });
  assert.ok(applause[0].score >= baseline[0].score);
  const thin = suggestClips({ segments: speech(0, 120, ["and so that is it.", "um yeah.", "but then."]), gaps: [], audioEvents: [], rangeStartSec: 0, rangeEndSec: 120 });
  assert.equal(thin.length, 0, "no filler when nothing is strong");
});

test("captions are rebased to the clip and follow a trim change", () => {
  const story = segments.filter((s) => s.start >= 50 * 60 && s.end <= 51 * 60);
  const start = story[0].start;
  const end = story[1].end;
  const cues = buildCaptionCues(story, start, end);
  assert.ok(cues.length > 3);
  assert.ok(cues[0].start >= 0 && cues[0].start < 0.5);
  assert.ok(cues.at(-1)!.end <= end - start + 0.001);
  for (let i = 1; i < cues.length; i += 1) assert.ok(cues[i].start >= cues[i - 1].end - 0.001, "no overlap");
  assert.equal(cues.map((cue) => cue.text).join(" "), `${story[0].text} ${story[1].text}`, "every word, in order, nothing added");

  const moved = rebaseCues(cues, start, start + 2, end - start - 2);
  assert.ok(moved.every((cue) => cue.start >= 0 && cue.end <= end - start - 2 + 0.001));
  assert.equal(moved[0].text === cues[0].text ? moved[0].start : 0, Math.max(0, cues[0].start - 2));
});

test("job tokens bind to one job and lease and expire", () => {
  process.env.SERMON_MEDIA_WORKER_SECRET = "x".repeat(48);
  const token = signJobToken({ jobId: "job-1", leaseToken: "lease-1", nowSeconds: 1000 });
  assert.deepEqual(verifyJobToken(token, "job-1", 1001), { leaseToken: "lease-1" });
  assert.equal(verifyJobToken(token, "job-2", 1001), null);
  assert.equal(verifyJobToken(token, "job-1", 1000 + 7 * 3600), null);
  assert.equal(verifyJobToken(`${token.slice(0, -2)}xx`, "job-1", 1001), null);
});

test("sermon range: a preview before announcements is not the start; the closing prayer and handover are the end", () => {
  // Shape of a real service (Gospel Light, 2 Aug 2026): the preacher previews the
  // text before announcements, reads it after them, and the worship leader thanks
  // God "for the preaching of His Word" after the closing prayer.
  const s = (start: number, text: string, flags?: TranscriptSegment["flags"]) => speech(start, start + 8, [text], flags)[0];
  const body = Array.from({ length: 300 }, (_, i) => s(1480 + i * 9.5, "Be sober minded and watchful because your adversary the devil prowls around like a roaring lion seeking someone to devour today."));
  const real: TranscriptSegment[] = [
    ...speech(0, 1200, repeat(["Bless the Lord oh my soul", "Worship his holy name"], 40), ["music"]),
    s(1263, "And then I'll be back after the announcements with the preaching from 1 Peter 5, verses 8 to 14."),
    s(1462, "We come to the last part of 1 Peter and allow me to read the text today. 1 Peter 5, 8 to 14."),
    ...body,
    s(4352, "Lead them to Jesus, your Son, today. We ask and pray all this in Jesus' name. Amen."),
    s(4362, "Amen. We thank God for the preaching of His Word. Pastor Jason has chosen a song."),
    ...speech(4470, 4700, repeat(["Christ our hope in life and death", "Christ he lives"], 20), ["music"]),
  ];
  const r = suggestSermonRange({ segments: real, gaps: [], audioEvents: [], durationSec: 4915 });
  assert.equal(r.status, "suggested");
  assert.ok(Math.abs(r.startSec! - 1462) <= 2, `start ${r.startSec}`);
  assert.ok(Math.abs(r.endSec! - 4360) <= 2, `end ${r.endSec}`);
});
