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
  assert.match(prompt, /HERO SCENE: a set breakfast table/);
});

test("the flyer is briefed as a cinematic photo with designed type", () => {
  const prompt = buildFullFlyerPrompt({ ...base, mode: "flyer", season: "autumn" });
  assert.match(prompt, /cinematic hero image/i);
  assert.match(prompt, /Photographic and richly detailed/);
  assert.match(prompt, /TYPOGRAPHY:/);
  assert.match(prompt, /central 80%/);
  assert.match(prompt, /Set it in autumn/);
  // The text it must set is still spelled out for it, and nothing else.
  assert.match(prompt, /"Youth Hangout"/);
  assert.match(prompt, /"Louisville Grace Church"/);
  assert.match(prompt, /"FRIDAY, OCTOBER 3" · "7:00 PM" · "The Loft"/);
  assert.match(prompt, /ONLY words allowed/);
  assert.match(prompt, /character for character/);
});

test("the flyer prints no location line when none was resolved", () => {
  const prompt = buildFullFlyerPrompt({ ...base, location: null, mode: "flyer" });
  assert.match(prompt, /"FRIDAY, OCTOBER 3" · "7:00 PM"\./);
  assert.doesNotMatch(prompt, /The Loft/);
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

test("the caption brief asks for the real details, a call to action and hashtags", () => {
  const system = eventSocialSystemPrompt({
    churchName: "Grace Community Church of the Nazarene",
    title: "Ladies Bible Study",
    when: "Thursday, October 29, 2026 from 6:30 PM to 8:00 PM",
    whenDisplay: "Thursday, October 29 · 6:30 PM – 8:00 PM",
    location: "4308 Taylorsville Rd, Louisville, KY 40220",
    churchCity: "Louisville, KY",
  });
  assert.match(system, /Date & time line \(copy exactly\): Thursday, October 29 · 6:30 PM – 8:00 PM/);
  assert.match(system, /Place line \(copy exactly\): 4308 Taylorsville Rd, Louisville, KY 40220/);
  assert.match(system, /\(Louisville, KY\)/);
  assert.match(system, /call to action/);
  assert.match(system, /hashtags/);
  assert.doesNotMatch(system, /No hashtags/);
  assert.doesNotMatch(system, /do NOT list them out/);
});

test("a guessed church address is offered but never printed as the place", () => {
  const system = eventSocialSystemPrompt({
    churchName: "Grace",
    title: "Fall Festival",
    when: "Saturday, October 31, 2026",
    location: "4308 Taylorsville Rd, Louisville, KY 40220",
    locationAssumed: true,
  });
  assert.match(system, /Place line: none given/);
  assert.match(system, /leave the 📍 line out/);
});

test("a script accent is offered only for connecting words the title really has", () => {
  const plain = buildFullFlyerPrompt({ ...base, headline: "Ladies Bible Study", mode: "flyer" });
  assert.doesNotMatch(plain, /elegant script/);
  assert.match(plain, /nothing added or removed/);
  const withPhrase = buildFullFlyerPrompt({ ...base, headline: "Coffee with the Pastor", mode: "flyer" });
  assert.match(withPhrase, /connecting words "with the" may be set smaller/);
});
