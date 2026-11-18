import type { AudioEvent, TranscriptGap, TranscriptSegment } from "@/lib/sermon-media/transcript";

/**
 * Ranks short, standalone excerpts from inside the confirmed sermon.
 *
 * Words first: a clear opening, a complete thought, a practical insight, a
 * story, emotional weight, and context a stranger can follow. Applause,
 * laughter and cheering are secondary and only add to a strong excerpt — a
 * quiet, clean moment is never penalized for silence. Weak evidence means
 * fewer suggestions, not filler. The score is an editorial hint, never a
 * promise of engagement; staff choose.
 */
export type ClipSuggestion = {
  startSec: number;
  endSec: number;
  excerpt: string;
  score: number;
  reason: string;
  signals: Record<string, number>;
};

type Sentence = { start: number; end: number; text: string; uncertain: boolean };

const MIN_SEC = 20;
const MAX_SEC = 75;
const TARGET_SEC = 45;

const WEAK_OPENING = /^(?:and|but|so|because|or|which|that|this|these|those|it|he|she|they|them|him|her|then|also|yeah|um|uh|y|pero|entonces|porque|eso|esto)\b/i;
const BACKREFERENCE = /\b(?:as i (?:said|mentioned)|like i said|earlier|last week|point (?:number )?(?:one|two|three|four|\d)|(?:first|second|third|fourth|next) point|go back to|we(?:'ve| have) been looking at|como dije)\b/i;
const PRACTICAL = /\b(?:you can|you need to|this week|here'?s (?:the|what)|the key is|if you|when you|start|stop|remember|choose|decide|practice|ask yourself|take a moment|today you|puedes|esta semana|recuerda)\b/i;
const STORY = /\b(?:i remember|when i was|years ago|one day|there was a|let me tell you|my (?:wife|husband|son|daughter|dad|father|mom|mother|grandmother|grandfather|friend)|a few weeks ago|growing up|recuerdo|cuando yo era|hab[ií]a una vez)\b/i;
const EMOTION = /\b(?:love|loved|fear|afraid|hope|grace|broken|tears|cried|forgive|forgiven|joy|pain|lost|healed|alone|shame|free|freedom|mercy|weep|grief|amor|esperanza|gracia|perd[oó]n|miedo|gozo)\b/gi;
const QUESTION_OPENING = /^[^.!?]{8,140}\?/;

export function suggestClips(input: {
  segments: TranscriptSegment[];
  gaps: TranscriptGap[];
  audioEvents: AudioEvent[];
  rangeStartSec: number;
  rangeEndSec: number;
  max?: number;
}): ClipSuggestion[] {
  const sentences = toSentences(input.segments);
  if (sentences.length === 0) return [];
  const blocked = input.gaps.filter((gap) => gap.reason === "missing_audio" || gap.reason === "discontinuity");

  const candidates: ClipSuggestion[] = [];
  for (let i = 0; i < sentences.length; i += 1) {
    for (let j = i; j < sentences.length; j += 1) {
      const start = sentences[i].start;
      const end = sentences[j].end;
      const duration = end - start;
      if (duration > MAX_SEC) break;
      if (duration < MIN_SEC) continue;
      if (start < input.rangeStartSec || end > input.rangeEndSec) continue;
      if (blocked.some((gap) => gap.end > start && gap.start < end)) continue;
      const window = sentences.slice(i, j + 1);
      const scored = score(window, input.audioEvents, start, end);
      if (scored) candidates.push(scored);
    }
  }

  // Best first; no two suggestions share more than a fifth of their time.
  candidates.sort((a, b) => b.score - a.score);
  const chosen: ClipSuggestion[] = [];
  const limit = input.max ?? 6;
  for (const candidate of candidates) {
    if (candidate.score < 2.2) break;
    const overlaps = chosen.some((other) => {
      const shared = Math.min(other.endSec, candidate.endSec) - Math.max(other.startSec, candidate.startSec);
      return shared > 0.2 * Math.min(other.endSec - other.startSec, candidate.endSec - candidate.startSec);
    });
    if (!overlaps) chosen.push(candidate);
    if (chosen.length >= limit) break;
  }
  return chosen;
}

function toSentences(segments: TranscriptSegment[]): Sentence[] {
  const out: Sentence[] = [];
  for (const segment of segments) {
    const uncertain = Boolean(segment.flags?.some((flag) => flag === "uncertain" || flag === "noise" || flag === "music"));
    if (segment.words && segment.words.length > 0) {
      let current: { start: number; words: string[] } | null = null;
      for (const word of segment.words) {
        current = current ?? { start: word.s, words: [] };
        current.words.push(word.w);
        if (/[.!?]$/.test(word.w)) {
          out.push({ start: current.start, end: word.e, text: current.words.join(" "), uncertain });
          current = null;
        }
      }
      if (current) {
        const last = segment.words[segment.words.length - 1];
        out.push({ start: current.start, end: last.e, text: current.words.join(" "), uncertain });
      }
    } else if (segment.text.trim()) {
      out.push({ start: segment.start, end: segment.end, text: segment.text.trim(), uncertain });
    }
  }
  return out;
}

function score(window: Sentence[], events: AudioEvent[], start: number, end: number): ClipSuggestion | null {
  const text = window.map((sentence) => sentence.text).join(" ");
  const first = window[0].text;
  const last = window[window.length - 1].text;
  if (window.some((sentence) => sentence.uncertain)) return null;
  if (text.split(/\s+/).length < 35) return null;

  const signals: Record<string, number> = {};
  signals.clear_opening = WEAK_OPENING.test(first) ? -1.2 : QUESTION_OPENING.test(first) ? 1.3 : 0.8;
  signals.complete_thought = /[.!?]["']?$/.test(last) && !/\b(?:and|but|so|because|the|a|to)[.!?]?$/i.test(last) ? 1 : -1.5;
  signals.practical = Math.min(1.5, (text.match(new RegExp(PRACTICAL.source, "gi"))?.length ?? 0) * 0.6);
  signals.story = STORY.test(text) ? 1.4 : 0;
  signals.emotion = Math.min(1.2, (text.match(EMOTION)?.length ?? 0) * 0.3);
  signals.standalone = BACKREFERENCE.test(text) ? -1.5 : 0.5;
  signals.length_fit = 0.6 - Math.abs(end - start - TARGET_SEC) / 60;

  const reaction = events.filter(
    (event) =>
      ["applause", "laughter", "cheering", "crowd"].includes(event.label) &&
      event.score >= 0.5 &&
      event.start >= start - 1 &&
      event.start <= end + 4,
  );
  // Secondary: a reaction strengthens an excerpt, it never makes one.
  signals.reaction = reaction.length > 0 ? Math.min(0.8, reaction.length * 0.4) : 0;

  const total = Object.values(signals).reduce((sum, value) => sum + value, 0);
  return {
    startSec: round2(start),
    endSec: round2(end),
    excerpt: text.length > 600 ? `${text.slice(0, 597)}…` : text,
    score: round2(total),
    reason: explain(signals, reaction.map((event) => event.label)),
    signals: Object.fromEntries(Object.entries(signals).map(([key, value]) => [key, round2(value)])),
  };
}

function explain(signals: Record<string, number>, reactions: string[]): string {
  const parts: string[] = [];
  if (signals.clear_opening >= 1.3) parts.push("opens with a question");
  else if (signals.clear_opening > 0) parts.push("starts cleanly");
  if (signals.story > 0) parts.push("tells a story");
  if (signals.practical >= 0.6) parts.push("gives a practical step");
  if (signals.emotion >= 0.6) parts.push("carries real emotion");
  if (signals.complete_thought > 0) parts.push("finishes the thought");
  if (signals.standalone > 0) parts.push("makes sense on its own");
  if (reactions.includes("laughter")) parts.push("the room laughed");
  else if (reactions.includes("applause") || reactions.includes("cheering")) parts.push("the room responded");
  const picked = parts.slice(0, 3);
  if (picked.length === 0) return "A complete moment from the sermon.";
  const sentence = picked.length === 1 ? picked[0] : `${picked.slice(0, -1).join(", ")} and ${picked[picked.length - 1]}`;
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}

const round2 = (value: number) => Math.round(value * 100) / 100;
