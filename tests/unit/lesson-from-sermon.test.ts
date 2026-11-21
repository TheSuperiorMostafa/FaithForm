import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { generateObject } from "ai";
import { MockLanguageModelV3 } from "ai/test";

import { describeLessonFailure } from "@/lib/lesson-builder/failure";
import {
  groundedLessonProblem,
  groundLesson,
  LESSON_DRAFT_LIMITS,
  recordingLessonSchema,
} from "@/lib/sermon-media/lesson";
import type { TranscriptSegment } from "@/lib/sermon-media/transcript";

/**
 * Regression: "Make the lesson" from a past sermon failed with "We couldn't
 * make the lesson from this sermon". The Anthropic provider does not send
 * maxItems / maxLength / pattern to the model, but the AI SDK validated the
 * reply against them, so a long sermon whose point cited more than 40
 * segments (or a 9th question, a long summary, "[s000123") threw
 * NoObjectGeneratedError and the whole lesson was lost.
 */

const id = (n: number) => `s${String(n).padStart(6, "0")}`;
const ids = (count: number, from: number) => Array.from({ length: count }, (_, i) => id(from + i));

// ~40 minutes of preaching in short caption segments, as the worker makes them.
const SENTENCES = [
  "Turn with me to John chapter 6 verses 1 through 14.",
  "When we face something impossible most of us feel how small we are.",
  "Philip did the math and it did not work, and that is where faith begins.",
  "A boy brought five loaves and two fish and he offered what he had.",
  "Paul says in 2 Corinthians 12 that his grace is sufficient for you.",
  "This week bring Jesus the small thing you have been hiding from him.",
];
const segments: TranscriptSegment[] = Array.from({ length: 480 }, (_, i) => ({
  id: id(1000 + i),
  start: 1800 + i * 5,
  end: 1805 + i * 5,
  text: SENTENCES[i % SENTENCES.length],
}));

const longSermonReply = {
  title: "More Than Enough",
  intro: { text: "We all feel small before the impossible.", evidence: ids(60, 1000) },
  points: Array.from({ length: 9 }, (_, p) => ({
    title: `Point ${p + 1}`,
    summary: `${"The pastor explained this at length. ".repeat(90)}`,
    evidence: [`[${id(1060 + p * 45)} 35:00]`, ...ids(44, 1061 + p * 45)],
    scripture: [{ ref: "John 6:1-14", evidence: [id(1000)] }],
  })),
  application: { text: "Bring Jesus the small thing.", evidence: [id(1005)] },
  closing: { text: "", evidence: [] },
  main_scripture: Array.from({ length: 5 }, () => ({ ref: "John 6:1-14", evidence: [id(1000)] })),
  quotes: [{ text: "His grace is sufficient for you.", evidence: [id(1004)] }],
  questions: Array.from({ length: 10 }, (_, q) => ({
    category: "application" as const,
    question: `What small thing could you offer this week (${q})?`,
    evidence: [id(1005)],
  })),
  insufficient: false,
};

function mockModel(reply: unknown) {
  return new MockLanguageModelV3({
    doGenerate: async () =>
      ({
        content: [{ type: "text", text: JSON.stringify(reply) }],
        finishReason: { unified: "stop", raw: "end_turn" },
        usage: { inputTokens: { total: 30_000 }, outputTokens: { total: 6_000 } },
        warnings: [],
      }) as never,
  });
}

test("a long sermon's lesson reply is accepted and fitted, not rejected", async () => {
  const { object } = await generateObject({ model: mockModel(longSermonReply), schema: recordingLessonSchema, prompt: "x" });
  const lesson = groundLesson(object, segments);

  assert.equal(groundedLessonProblem(lesson, object), null);
  assert.equal(lesson.outline.points.length, LESSON_DRAFT_LIMITS.points);
  assert.equal(lesson.questions.length, LESSON_DRAFT_LIMITS.questions);
  assert.ok(lesson.evidence.intro.length <= LESSON_DRAFT_LIMITS.evidence);
  for (const evidence of lesson.evidence.points) {
    assert.ok(evidence.length > 0 && evidence.length <= LESSON_DRAFT_LIMITS.evidence);
    assert.ok(evidence.every((segmentId) => /^s\d{1,7}$/.test(segmentId)), "cited ids are reduced to segment ids");
  }
  assert.ok(lesson.evidence.points[0].includes(id(1060)), "an id written as '[s001060 35:00]' still counts");
  for (const point of lesson.outline.points) assert.ok(point.summary.length <= LESSON_DRAFT_LIMITS.text);
  assert.deepEqual(lesson.scriptureRefs, ["John 6:1-14"]);
});

test("the failure log names the cause without the model's reply", async () => {
  const badReply = { ...longSermonReply, questions: [{ category: "Discussion", question: "Secret sermon words?", evidence: [] }] };
  const error = await generateObject({ model: mockModel(badReply), schema: recordingLessonSchema, prompt: "x" }).then(
    () => null,
    (caught: unknown) => caught,
  );
  assert.ok(error, "an invalid reply still fails");
  const details = describeLessonFailure(error, "generate");
  assert.equal(details.stage, "generate");
  assert.equal(details.name, "AI_NoObjectGeneratedError");
  assert.equal(details.cause, "AI_TypeValidationError");
  assert.ok(details.issues?.some((issue) => issue.startsWith("questions.0.category")));
  assert.ok(!JSON.stringify(details).includes("Secret sermon words"), "reply text is never logged");
});

test("the lesson route is allowed to run as long as a lesson takes to write", () => {
  const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as { functions: Record<string, { maxDuration: number }> };
  const route = readFileSync("app/api/lessons/route.ts", "utf8");
  // vercel.json's "app/api/**/route.ts" entry caps routes at 30s; a lesson
  // from a 30–45 minute sermon takes one to three minutes to write.
  assert.equal(vercel.functions["app/api/lessons/route.ts"]?.maxDuration, 300);
  assert.match(route, /export const maxDuration = 300;/);
});
