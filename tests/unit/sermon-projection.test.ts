import assert from "node:assert/strict";
import test from "node:test";

import {
  __testing,
  type SermonOutlineDto,
} from "@/lib/sermons/v1/sermon-service";

const { projectOutline, projectQuestions } = __testing;

test("the outline allowlist keeps a preacher's private fields private", () => {
  // The real column is free-form JSONB written by a generator. Anything not on
  // the allowlist must not reach a phone, however plausible its name.
  const outline = projectOutline({
    intro: "We begin with a question.",
    points: [{ title: "Grace finds us", summary: "Luke 15", scripture: "Luke 15:20" }],
    application: "Go and do likewise.",
    closing: "Amen.",
    styleNotes: "Slow down here — you always rush this bit.",
    modelUsed: "claude-opus-5",
    audience: "Sunday evening, mostly older",
    manuscript: "Full text nobody but the preacher should read.",
  }) as SermonOutlineDto;

  const serialized = JSON.stringify(outline);
  assert.equal(serialized.includes("Slow down here"), false);
  assert.equal(serialized.includes("claude-opus-5"), false);
  assert.equal(serialized.includes("Sunday evening"), false);
  assert.equal(serialized.includes("Full text nobody"), false);

  assert.equal(outline.intro, "We begin with a question.");
  assert.equal(outline.points.length, 1);
  assert.equal(outline.points[0]?.title, "Grace finds us");
});

test("a point carries only its heading, summary and scripture", () => {
  const outline = projectOutline({
    points: [
      {
        title: "One",
        summary: "First",
        scripture: "John 1:1",
        privateNote: "do not read this out",
      },
    ],
  }) as SermonOutlineDto;

  assert.deepEqual(outline.points[0], {
    title: "One",
    summary: "First",
    scripture: "John 1:1",
  });
});

test("a point with no heading is a formatting artefact, not a point", () => {
  const outline = projectOutline({
    intro: "Something",
    points: [{ summary: "orphaned" }, { title: "Real", summary: "kept" }],
  }) as SermonOutlineDto;

  assert.equal(outline.points.length, 1);
  assert.equal(outline.points[0]?.title, "Real");
});

test("`body` stands in for a missing `summary`, since the builder writes both", () => {
  const outline = projectOutline({
    points: [{ title: "One", body: "written as body" }],
  }) as SermonOutlineDto;
  assert.equal(outline.points[0]?.summary, "written as body");
});

test("an outline with nothing left after the allowlist is null, not an empty shell", () => {
  // Otherwise the app draws a heading over a blank card.
  assert.equal(projectOutline({ styleNotes: "only private things" }), null);
  assert.equal(projectOutline({ points: [] }), null);
  assert.equal(projectOutline(null), null);
  assert.equal(projectOutline("not an object"), null);
  assert.equal(projectOutline([1, 2, 3]), null);
});

test("whitespace-only fields read as absent", () => {
  assert.equal(projectOutline({ intro: "   ", points: [] }), null);
});

test("questions are read from either shape the builder has written", () => {
  const wrapped = projectQuestions({
    questions: [{ category: "application", question: "What changes tomorrow?" }],
  });
  assert.deepEqual(wrapped, [
    { category: "application", question: "What changes tomorrow?" },
  ]);

  const bare = projectQuestions([
    { category: "warmup", question: "How was your week?" },
  ]);
  assert.equal(bare.length, 1);

  const strings = projectQuestions(["Just a string question"]);
  assert.deepEqual(strings, [
    { category: "general", question: "Just a string question" },
  ]);
});

test("an unrecognised category is kept rather than dropping the question", () => {
  // A small group losing its questions because a label was unfamiliar would be
  // absurd, so `category` is free text on both sides of the contract.
  const questions = projectQuestions({
    questions: [{ category: "something-new", question: "Still a question" }],
  });
  assert.equal(questions[0]?.category, "something-new");
});

test("a question with no text is dropped", () => {
  const questions = projectQuestions({
    questions: [{ category: "warmup", question: "  " }, { category: "x" }],
  });
  assert.equal(questions.length, 0);
});

test("malformed question payloads produce an empty list, never a throw", () => {
  assert.deepEqual(projectQuestions(null), []);
  assert.deepEqual(projectQuestions("nonsense"), []);
  assert.deepEqual(projectQuestions({ questions: "nonsense" }), []);
  assert.deepEqual(projectQuestions(42), []);
});
