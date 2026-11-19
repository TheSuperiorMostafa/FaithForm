import type { TranscriptSegment } from "@/lib/sermon-media/transcript";

/**
 * Burned-in caption cues for a clip, rebased so 0 is the clip's first frame.
 *
 * Built from word timing when the transcript has it. A segment without word
 * timing (staff corrected its text) is spread across its machine time in
 * proportion to word length and marked approximate so the editor can say so.
 * Words are never moved between cues to change what was said.
 */
export type CaptionCue = { start: number; end: number; text: string; approximate?: boolean };

const MAX_CHARS = 32;
const MAX_CUE_SEC = 2.6;

type TimedWord = { w: string; s: number; e: number; approximate: boolean };

function wordsFor(segment: TranscriptSegment): TimedWord[] {
  if (segment.words && segment.words.length > 0) {
    return segment.words.map((word) => ({ w: word.w, s: word.s, e: word.e, approximate: false }));
  }
  const tokens = segment.text.split(/\s+/).filter(Boolean);
  const weight = tokens.reduce((sum, token) => sum + token.length + 1, 0) || 1;
  const span = segment.end - segment.start;
  let cursor = segment.start;
  return tokens.map((token) => {
    const length = ((token.length + 1) / weight) * span;
    const word = { w: token, s: cursor, e: cursor + length, approximate: true };
    cursor += length;
    return word;
  });
}

const round3 = (value: number) => Math.round(value * 1000) / 1000;

export function buildCaptionCues(segments: TranscriptSegment[], clipStartSec: number, clipEndSec: number): CaptionCue[] {
  const words = segments
    .flatMap(wordsFor)
    .filter((word) => word.e > clipStartSec + 0.02 && word.s < clipEndSec - 0.02);
  const cues: CaptionCue[] = [];
  let current: TimedWord[] = [];
  const flush = () => {
    if (current.length === 0) return;
    const start = Math.max(0, current[0].s - clipStartSec);
    const end = Math.min(clipEndSec - clipStartSec, current[current.length - 1].e - clipStartSec);
    cues.push({
      start: round3(start),
      end: round3(Math.max(end, start + 0.3)),
      text: current.map((word) => word.w).join(" "),
      ...(current.some((word) => word.approximate) ? { approximate: true } : {}),
    });
    current = [];
  };
  for (const word of words) {
    const text = [...current.map((w) => w.w), word.w].join(" ");
    const tooLong = text.length > MAX_CHARS || (current.length > 0 && word.e - current[0].s > MAX_CUE_SEC);
    if (tooLong) flush();
    current.push(word);
    if (/[.!?;:]$/.test(word.w)) flush();
  }
  flush();
  // Never overlap: a cue ends where the next begins.
  for (let index = 0; index < cues.length - 1; index += 1) {
    if (cues[index].end > cues[index + 1].start) cues[index].end = cues[index + 1].start;
  }
  return cues.filter((cue) => cue.end > cue.start);
}

/**
 * Re-fit staff-corrected cues after a trim change: cues are kept on the
 * recording timeline, shifted by the change in start, and clipped to the new
 * length. Cues that fall entirely outside the new trim are dropped.
 */
export function rebaseCues(cues: CaptionCue[], oldStartSec: number, newStartSec: number, newDurationSec: number): CaptionCue[] {
  const shift = oldStartSec - newStartSec;
  return cues
    .map((cue) => ({ ...cue, start: round3(cue.start + shift), end: round3(cue.end + shift) }))
    .filter((cue) => cue.end > 0.05 && cue.start < newDurationSec - 0.05)
    .map((cue) => ({ ...cue, start: Math.max(0, cue.start), end: Math.min(newDurationSec, cue.end) }));
}

export function captionsToText(cues: CaptionCue[]): string {
  return cues.map((cue) => cue.text).join(" ");
}

/** A first draft of the Facebook caption: the clip's opening line and the church. */
export function draftCaption(excerpt: string, churchName: string | null): string {
  const clean = excerpt.replace(/\s+/g, " ").trim();
  const first = clean.match(/^.{20,200}?[.!?](?=\s|$)/)?.[0] ?? clean.slice(0, 180);
  const hook = first.length < clean.length && !/[.!?]$/.test(first) ? `${first}…` : first;
  return churchName ? `${hook}\n\n— ${churchName}` : hook;
}
