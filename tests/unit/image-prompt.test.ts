import assert from "node:assert/strict";
import test from "node:test";

import {
  ART_DIRECTION,
  buildBackgroundPrompt,
  buildFullFlyerPrompt,
  NO_PEOPLE_RULE,
  PEOPLE_WORDS,
  resolveScene,
  TAG_SCENE_HINTS,
} from "@/lib/ai/image/prompt";
import { eventSocialSystemPrompt } from "@/lib/ai/prompts";
import { SOCIAL_BACKGROUND_TAGS, SOCIAL_TEMPLATE_KEYS } from "@/lib/social/constants";

const base = {
  title: "Youth Hangout",
  headline: "Youth Hangout",
  backgroundTag: "youth" as const,
  churchName: "Louisville Grace Church",
  primaryColor: "#1e3a5f",
  accentColor: "#c9a227",
  dateLine: "FRIDAY, OCTOBER 3",
  timeLine: "7:00 PM",
  location: "The Loft",
};

// ---------------------------------------------------------------------------
// Nobody in the picture
// ---------------------------------------------------------------------------

test("no fallback motif describes people", () => {
  for (const tag of SOCIAL_BACKGROUND_TAGS) {
    const hint = TAG_SCENE_HINTS[tag];
    assert.ok(hint, `${tag} has a motif`);
    assert.doesNotMatch(hint, PEOPLE_WORDS, `${tag}: "${hint}"`);
  }
});

test("every generated prompt carries the no-people rule", () => {
  for (const key of SOCIAL_TEMPLATE_KEYS) {
    const flyer = buildFullFlyerPrompt({ ...base, mode: "flyer", templateKey: key });
    const background = buildBackgroundPrompt({ ...base, templateKey: key });
    assert.ok(flyer.includes(NO_PEOPLE_RULE), `${key} flyer`);
    assert.ok(background.includes(NO_PEOPLE_RULE), `${key} background`);
    assert.ok(flyer.includes(ART_DIRECTION[key]), `${key} flyer art direction`);
  }
});

test("a writer's motif about people is set aside for the tag's design motif", () => {
  assert.equal(
    resolveScene({ ...base, imageSubject: "teenagers together laughing on a couch" }),
    TAG_SCENE_HINTS.youth,
  );
  assert.equal(
    resolveScene({ ...base, imageSubject: "silhouettes of hands raised in worship" }),
    TAG_SCENE_HINTS.youth,
  );
});

test("a writer's motif about things is used as written", () => {
  const subject = "a set breakfast table with an open Bible in morning light.";
  assert.equal(
    resolveScene({ ...base, backgroundTag: "prayer", imageSubject: subject }),
    "a set breakfast table with an open Bible in morning light",
  );
  const prompt = buildFullFlyerPrompt({ ...base, imageSubject: subject, mode: "flyer" });
  assert.match(prompt, /VISUAL MOTIF: a set breakfast table/);
});

test("the flyer is briefed as design, not photography", () => {
  const prompt = buildFullFlyerPrompt({ ...base, mode: "flyer" });
  assert.match(prompt, /graphic design/i);
  assert.match(prompt, /TYPOGRAPHY:/);
  assert.match(prompt, /central 80%/);
  assert.doesNotMatch(prompt, /Photorealistic background/);
  assert.doesNotMatch(prompt, /golden-hour/);
  // The text it must set is still spelled out for it.
  assert.match(prompt, /"Youth Hangout"/);
  assert.match(prompt, /"Louisville Grace Church"/);
  assert.match(prompt, /Date: "FRIDAY, OCTOBER 3"/);
});

test("the copywriter is told the same rule, with examples that contain nobody", () => {
  const system = eventSocialSystemPrompt({
    churchName: "Louisville Grace Church",
    title: "Youth Hangout",
    when: "Friday, October 3 at 7:00 PM",
    location: "The Loft",
  });
  assert.match(system, /Never people/);
  assert.doesNotMatch(system, /what people are doing/);
  assert.doesNotMatch(system, /teenagers together/);
  assert.doesNotMatch(system, /Prefer hands, silhouettes/);
});
