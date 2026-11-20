import type { AudioEvent, TranscriptGap, TranscriptSegment } from "@/lib/sermon-media/transcript";

/**
 * Suggests where the sermon starts and ends, with the evidence for it.
 *
 * Deterministic and explainable on purpose: staff confirm or adjust the range,
 * so every suggestion carries the moments that support it. The core is the
 * longest stretch of continuous talking (worship has music, repeated lyric
 * lines and low word density). The edges are then pulled to the nearest
 * opening cue (a Scripture reading, "turn with me to…", "today's message") and
 * closing cue (the closing prayer and its amen). Weak evidence returns
 * `uncertain` and the dashboard asks staff to choose.
 */
export type RangeEvidence = {
  kind:
    | "speech_block"
    | "opening_scripture"
    | "opening_phrase"
    | "closing_prayer"
    | "closing_phrase"
    | "music_before"
    | "music_after";
  atSec: number;
  segmentId?: string;
  text: string;
};

export type RangeSuggestion = {
  status: "suggested" | "uncertain" | "failed";
  startSec: number | null;
  endSec: number | null;
  confidence: number;
  evidence: RangeEvidence[];
};

const WINDOW_SEC = 30;
const MIN_SERMON_SEC = 10 * 60;
const BRIDGE_SEC = 120;

const BOOKS =
  "genesis|exodus|leviticus|numbers|deuteronomy|joshua|judges|ruth|samuel|kings|chronicles|ezra|nehemiah|esther|job|psalms?|proverbs|ecclesiastes|song of (?:songs|solomon)|isaiah|jeremiah|lamentations|ezekiel|daniel|hosea|joel|amos|obadiah|jonah|micah|nahum|habakkuk|zephaniah|haggai|zechariah|malachi|matthew|mark|luke|john|acts|romans|corinthians|galatians|ephesians|philippians|colossians|thessalonians|timothy|titus|philemon|hebrews|james|peter|jude|revelation|g[eé]nesis|[eé]xodo|salmos?|proverbios|isa[ií]as|mateo|marcos|lucas|juan|hechos|romanos|corintios|g[aá]latas|efesios|filipenses|colosenses|hebreos|santiago|pedro|apocalipsis";

const SCRIPTURE = new RegExp(
  `\\b(?:${BOOKS})\\b\\s+(?:chapter\\s+|cap[ií]tulo\\s+)?\\d{1,3}(?:\\s*(?::|verse|verses|vers[ií]culos?|,)\\s*\\d{1,3})?`,
  "i",
);
const OPENING = [
  /\b(?:turn|open)\s+(?:with me\s+)?(?:in|to)\s+(?:your\s+)?bibles?\b/i,
  /\bturn with me to\b/i,
  /\bopen (?:up )?your bibles?\b/i,
  /\b(?:today'?s|this morning'?s|our)\s+(?:message|sermon|text|passage)\b/i,
  /\bif you have your bibles?\b/i,
  /\babr(?:an|amos) (?:sus|nuestras) biblias\b/i,
  /\bel mensaje de (?:hoy|esta ma[nñ]ana)\b/i,
];
const CLOSING_PRAYER = [
  /\blet(?:'s| us) pray\b/i,
  /\bbow (?:your|our) heads\b/i,
  /\b(?:vamos a orar|oremos|inclinemos)\b/i,
];
const CLOSING_PHRASE = [
  /\b(?:would you|please) stand\b/i,
  /\bas the (?:band|worship team|team|musicians) (?:comes?|come up)\b/i,
  /\b(?:announcements|offering|communion|next week|see you next)\b/i,
  /\b(?:pónganse de pie|anuncios|ofrenda|santa cena)\b/i,
];
const AMEN = /\b(?:amen|amén)\b[.!]?\s*$/i;
// "I'll be back after the announcements with the preaching from 1 Peter 5" names
// the text but is a preview, not the start (seen in a real service).
const PREVIEW = /\b(?:i'?ll be back|after (?:the )?announcements|later (?:on|today|this morning)|in a (?:little )?while|coming up|despu[eé]s de los anuncios)\b/i;
// The prayer that closes the sermon, and the handover after it.
const NAME_AMEN = /\b(?:in )?jes[uú]s'? ?(?:'s )?(?:precious |holy )?(?:name|nombre)\b.*\b(?:amen|amén)\b[.!]?\s*$/i;
const HANDOVER = /\b(?:thank (?:god|you,? lord) for (?:the preaching|his word|the word)|gracias a dios por (?:la predicaci[oó]n|su palabra))\b/i;

export function suggestSermonRange(input: {
  segments: TranscriptSegment[];
  gaps: TranscriptGap[];
  audioEvents: AudioEvent[];
  durationSec: number;
}): RangeSuggestion {
  const { segments, durationSec } = input;
  if (segments.length === 0 || durationSec <= 0) {
    return { status: "failed", startSec: null, endSec: null, confidence: 0, evidence: [] };
  }

  const talk = talkWindows(input);
  const core = longestTalkBlock(talk);
  if (!core || core.endSec - core.startSec < MIN_SERMON_SEC / 2) {
    return { status: "failed", startSec: null, endSec: null, confidence: 0, evidence: [] };
  }

  const evidence: RangeEvidence[] = [
    { kind: "speech_block", atSec: core.startSec, text: `About ${Math.round((core.endSec - core.startSec) / 60)} minutes of continuous speaking` },
  ];

  // Opening: the earliest strong cue near the start of the block.
  let startSec = core.startSec;
  let confidence = 0.35;
  const opening = segments.find(
    (segment) =>
      segment.start >= core.startSec - 300 &&
      segment.start <= core.startSec + 600 &&
      !PREVIEW.test(segment.text) &&
      (OPENING.some((pattern) => pattern.test(segment.text)) || SCRIPTURE.test(segment.text)),
  );
  if (opening) {
    const isScripture = SCRIPTURE.test(opening.text) && !OPENING.some((pattern) => pattern.test(opening.text));
    evidence.push({
      kind: isScripture ? "opening_scripture" : "opening_phrase",
      atSec: opening.start,
      segmentId: opening.id,
      text: excerpt(opening.text),
    });
    // Begin at the sentence before the cue when it is part of the same talk
    // ("Good morning, church. Turn with me…"), never before the block's music.
    const lead = segments.filter((segment) => segment.end <= opening.start && segment.start >= Math.max(core.startSec - 60, opening.start - 45));
    startSec = lead.length > 0 ? lead[0].start : opening.start;
    confidence += 0.25;
  }

  // Closing: the closing prayer's amen, else a closing phrase, else the block end.
  let endSec = core.endSec;
  const tail = segments.filter((segment) => segment.start >= core.endSec - 600 && segment.start <= core.endSec + 180);
  const prayerIndex = tail.findIndex((segment) => CLOSING_PRAYER.some((pattern) => pattern.test(segment.text)));
  // The handover ("We thank God for the preaching of His Word") ends the sermon;
  // the "in Jesus' name, Amen" just before it is the closing prayer's end.
  const handover = tail.find((segment) => HANDOVER.test(segment.text));
  const nameAmen = tail.filter((segment) => NAME_AMEN.test(segment.text.trim()) && (!handover || segment.end <= handover.start + 1)).at(-1);
  if (handover || nameAmen) {
    const anchor = nameAmen ?? handover!;
    endSec = nameAmen ? nameAmen.end : handover!.start;
    evidence.push({ kind: "closing_prayer", atSec: anchor.start, segmentId: anchor.id, text: excerpt(anchor.text) });
    if (handover) evidence.push({ kind: "closing_phrase", atSec: handover.start, segmentId: handover.id, text: excerpt(handover.text) });
    confidence += handover && nameAmen ? 0.3 : 0.2;
  } else if (prayerIndex >= 0) {
    const prayer = tail[prayerIndex];
    const amen = tail.slice(prayerIndex).find((segment) => AMEN.test(segment.text.trim()));
    endSec = amen ? amen.end : Math.min(core.endSec + 60, prayer.end + 120);
    evidence.push({ kind: "closing_prayer", atSec: prayer.start, segmentId: prayer.id, text: excerpt(prayer.text) });
    confidence += amen ? 0.25 : 0.15;
  } else {
    const phrase = tail.find((segment) => CLOSING_PHRASE.some((pattern) => pattern.test(segment.text)));
    if (phrase) {
      endSec = phrase.start;
      evidence.push({ kind: "closing_phrase", atSec: phrase.start, segmentId: phrase.id, text: excerpt(phrase.text) });
      confidence += 0.1;
    }
  }

  const musicBefore = musicNear(input, startSec - 240, startSec);
  if (musicBefore) {
    evidence.push({ kind: "music_before", atSec: musicBefore, text: "Music or singing just before" });
    confidence += 0.1;
  }
  const musicAfter = musicNear(input, endSec, endSec + 240);
  if (musicAfter) {
    evidence.push({ kind: "music_after", atSec: musicAfter, text: "Music or singing just after" });
    confidence += 0.05;
  }

  if (endSec - startSec >= 20 * 60) confidence += 0.05;
  if (endSec <= startSec) endSec = core.endSec;
  confidence = Math.min(1, Math.round(confidence * 100) / 100);
  const long = endSec - startSec >= MIN_SERMON_SEC;
  return {
    status: long && confidence >= 0.6 ? "suggested" : "uncertain",
    startSec: round1(Math.max(0, startSec)),
    endSec: round1(Math.min(durationSec, endSec)),
    confidence,
    evidence: evidence.sort((a, b) => a.atSec - b.atSec),
  };
}

type Window = { startSec: number; talk: boolean };

function talkWindows(input: {
  segments: TranscriptSegment[];
  gaps: TranscriptGap[];
  audioEvents: AudioEvent[];
  durationSec: number;
}): Window[] {
  const count = Math.ceil(input.durationSec / WINDOW_SEC);
  const words = new Array<number>(count).fill(0);
  const music = new Array<number>(count).fill(0);
  const lines: string[][] = Array.from({ length: count }, () => []);

  for (const segment of input.segments) {
    const index = Math.min(count - 1, Math.floor(segment.start / WINDOW_SEC));
    const flagged = segment.flags?.includes("music") || segment.flags?.includes("noise");
    if (!flagged) words[index] += segment.text.match(/\S+/g)?.length ?? 0;
    else music[index] += segment.end - segment.start;
    lines[index].push(segment.text.toLowerCase().replace(/[^\p{L}\s]/gu, "").trim());
  }
  const addMusic = (start: number, end: number) => {
    for (let t = Math.floor(start / WINDOW_SEC); t <= Math.floor(end / WINDOW_SEC) && t < count; t += 1) {
      const overlap = Math.min(end, (t + 1) * WINDOW_SEC) - Math.max(start, t * WINDOW_SEC);
      if (overlap > 0) music[t] += overlap;
    }
  };
  for (const gap of input.gaps) if (gap.reason === "music") addMusic(gap.start, gap.end);
  for (const event of input.audioEvents) {
    if ((event.label === "music" || event.label === "singing") && event.score >= 0.5) addMusic(event.start, event.end);
  }

  // Short lines repeated inside two minutes are lyrics, not preaching. Long
  // sentences are left alone: a preacher may repeat a point, a song repeats a
  // line of a few words.
  const repeated = lines.map((_, index) => {
    const around = lines
      .slice(Math.max(0, index - 2), index + 3)
      .flat()
      .filter((line) => line.length > 12 && line.length <= 80);
    const seen = new Map<string, number>();
    for (const line of around) seen.set(line, (seen.get(line) ?? 0) + 1);
    return [...seen.values()].some((n) => n >= 3);
  });

  return words.map((n, index) => {
    const wpm = (n / WINDOW_SEC) * 60;
    return {
      startSec: index * WINDOW_SEC,
      talk: wpm >= 70 && music[index] < WINDOW_SEC * 0.4 && !repeated[index],
    };
  });
}

function longestTalkBlock(windows: Window[]): { startSec: number; endSec: number } | null {
  let best: { startSec: number; endSec: number } | null = null;
  let current: { startSec: number; endSec: number } | null = null;
  let quiet = 0;
  for (const window of windows) {
    if (window.talk) {
      current = current ?? { startSec: window.startSec, endSec: window.startSec + WINDOW_SEC };
      current.endSec = window.startSec + WINDOW_SEC;
      quiet = 0;
    } else if (current) {
      quiet += WINDOW_SEC;
      if (quiet > BRIDGE_SEC) {
        if (!best || current.endSec - current.startSec > best.endSec - best.startSec) best = current;
        current = null;
        quiet = 0;
      }
    }
  }
  if (current && (!best || current.endSec - current.startSec > best.endSec - best.startSec)) best = current;
  return best;
}

function musicNear(
  input: { gaps: TranscriptGap[]; audioEvents: AudioEvent[]; segments: TranscriptSegment[] },
  fromSec: number,
  toSec: number,
): number | null {
  const gap = input.gaps.find((g) => g.reason === "music" && g.end > fromSec && g.start < toSec);
  if (gap) return gap.start;
  const event = input.audioEvents.find(
    (e) => (e.label === "music" || e.label === "singing") && e.score >= 0.5 && e.end > fromSec && e.start < toSec,
  );
  if (event) return event.start;
  const flagged = input.segments.find((s) => s.flags?.includes("music") && s.end > fromSec && s.start < toSec);
  return flagged ? flagged.start : null;
}

function excerpt(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 140 ? `${clean.slice(0, 137)}…` : clean;
}

const round1 = (value: number) => Math.round(value * 10) / 10;

/**
 * The sermon range FaithForm uses without asking anyone: the suggestion when
 * there is one (even an uncertain one is the best guess), otherwise the whole
 * recording. Staff can still move it on the transcript page, but nothing waits
 * for them to. Null only when the recording has no usable length.
 */
export function automaticSermonRange(input: {
  suggestion: { startSec: number | null; endSec: number | null };
  durationSec: number | null;
  segments: Array<{ start: number; end: number }>;
}): { startSec: number; endSec: number; whole: boolean } | null {
  const lastWord = input.segments.reduce((max, segment) => Math.max(max, segment.end), 0);
  const total = input.durationSec && input.durationSec > 0 ? input.durationSec : lastWord;
  const { startSec, endSec } = input.suggestion;
  if (startSec !== null && endSec !== null && Number.isFinite(startSec) && Number.isFinite(endSec)) {
    const start = Math.max(0, startSec);
    const end = total > 0 ? Math.min(endSec, total) : endSec;
    if (end - start >= 1) return { startSec: round1(start), endSec: round1(end), whole: false };
  }
  if (!(total >= 1)) return null;
  return { startSec: 0, endSec: Math.floor(total * 10) / 10, whole: true };
}
