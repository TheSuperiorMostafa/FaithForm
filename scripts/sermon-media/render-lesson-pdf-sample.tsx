/**
 * Renders a recording-grounded lesson through the existing PDF exporter, for
 * visual comparison with the reference handout. Usage:
 *   pnpm exec tsx scripts/sermon-media/render-lesson-pdf-sample.tsx <out.pdf>
 * Uses the public-domain passage lookup (no database).
 */
import { writeFileSync } from "node:fs";

import { groundLesson, type RecordingLessonDraft } from "@/lib/sermon-media/lesson";
import { renderSermonPdf } from "@/lib/sermon/export-pdf";
import { resolveExportPassages } from "@/lib/sermon/passages";
import type { TranscriptSegment } from "@/lib/sermon-media/transcript";
import type { Sermon } from "@/types/sermon";

const seg = (id: string, start: number, text: string): TranscriptSegment => ({ id, start, end: start + 9, text });
const transcript = [
  seg("s000100", 1860, "Would you turn with me to John chapter 6, verses 1 through 14."),
  seg("s000101", 1875, "When we face something impossible, most of us feel the weight of how small we are."),
  seg("s000102", 1900, "Philip did the math. Half a year's wages wouldn't buy enough bread. Recognize your limitation."),
  seg("s000103", 1960, "Paul learned that in 2 Corinthians 12, verse 9: my grace is sufficient for you."),
  seg("s000104", 2010, "Andrew found a boy with five loaves and two fish. Offer what you have, even if it looks small."),
  seg("s000105", 2080, "Jesus gave thanks and broke the bread, and everyone ate and was satisfied. Trust him to multiply it."),
  seg("s000106", 2150, "This week, name one place you feel inadequate and bring it to Jesus instead of hiding it."),
  seg("s000107", 2200, "His provision is always more than enough. Let's pray."),
];
const draft: RecordingLessonDraft = {
  title: "More Than Enough",
  intro: { text: "When we face something impossible, most of us feel how small we are. In John 6 a hungry crowd and a small lunch show what Jesus does with what we bring him.", evidence: ["s000100", "s000101"] },
  points: [
    { title: "Recognize Your Limitation", summary: "Philip did the math and saw the gap. Admitting what we can't do is where faith starts.", evidence: ["s000102"], scripture: [{ ref: "2 Corinthians 12:9", evidence: ["s000103"] }] },
    { title: "Offer What You Have", summary: "A boy brought five loaves and two fish. Our part is to offer what we have, even when it looks small.", evidence: ["s000104"], scripture: [] },
    { title: "Trust Jesus to Multiply It", summary: "Jesus gave thanks, broke the bread, and everyone ate and was satisfied.", evidence: ["s000105"], scripture: [] },
  ],
  application: { text: "This week, name one place you feel inadequate and bring it to Jesus instead of hiding it.", evidence: ["s000106"] },
  closing: { text: "His provision is always more than enough.", evidence: ["s000107"] },
  main_scripture: [{ ref: "John 6:1-14", evidence: ["s000100"] }],
  quotes: [{ text: "His provision is always more than enough.", evidence: ["s000107"] }],
  questions: [],
  insufficient: false,
};

const lesson = groundLesson(draft, transcript);
const sermon = {
  id: "00000000-0000-4000-8000-000000000001",
  title: lesson.outline.title,
  scripture_refs: lesson.scriptureRefs.filter((ref) => ref.startsWith("John")),
  sermon_date: "2026-09-27",
  outline: lesson.outline,
  content: null,
  kind: "simple",
} as unknown as Sermon;

async function main() {
  const passages = await resolveExportPassages(sermon.scripture_refs, "BSB");
  writeFileSync(process.argv[2], await renderSermonPdf(sermon, passages));
  console.log(JSON.stringify({ points: lesson.outline.points.length, refs: lesson.scriptureRefs, passages: passages.map((p) => ({ ref: p.ref, t: p.translation, fallback: p.fallback, verses: p.verses.length })) }));
}

void main();
