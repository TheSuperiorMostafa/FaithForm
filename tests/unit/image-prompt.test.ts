import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBackgroundPrompt,
  buildFullFlyerPrompt,
  NO_PEOPLE_RULE,
  resolveScene,
  TAG_SCENE_HINTS,
} from "@/lib/ai/image/prompt";
import { eventSocialSystemPrompt } from "@/lib/ai/prompts";
import { SOCIAL_BACKGROUND_TAGS } from "@/lib/social/constants";

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
// The photographic brief (restored from before the September rewrite)
// ---------------------------------------------------------------------------

test("every tag has a fallback scene", () => {
  for (const tag of SOCIAL_BACKGROUND_TAGS) {
    assert.ok(TAG_SCENE_HINTS[tag], `${tag} has a scene`);
  }
});

test("the one-shot prompts do not carry the image chat's no-people rule", () => {
  assert.ok(!buildFullFlyerPrompt({ ...base, mode: "flyer" }).includes(NO_PEOPLE_RULE));
  assert.ok(!buildBackgroundPrompt(base).includes(NO_PEOPLE_RULE));
});

test("a writer's scene is used and given the cinematic treatment", () => {
  const subject = "a set breakfast table with an open Bible in morning light.";
  const scene = resolveScene({ ...base, backgroundTag: "prayer", imageSubject: subject });
  assert.match(scene, /^a set breakfast table with an open Bible in morning light\. Shot cinematically/);
  const prompt = buildFullFlyerPrompt({ ...base, imageSubject: subject, mode: "flyer" });
  assert.match(prompt, /Cinematic background photograph: a set breakfast table/);
});

test("without a writer's scene the tag's scene is used", () => {
  assert.equal(resolveScene({ ...base, imageSubject: null }), TAG_SCENE_HINTS.youth);
});

test("the background is briefed as a real photograph", () => {
  const prompt = buildBackgroundPrompt(base);
  assert.match(prompt, /Ultra-realistic cinematic editorial photograph/);
  assert.match(prompt, /85mm lens/);
  assert.match(prompt, /Absolutely NO text/);
});

test("the flyer is briefed as a cinematic photo with designed type", () => {
  const prompt = buildFullFlyerPrompt({ ...base, mode: "flyer", season: "autumn" });
  assert.match(prompt, /Cinematic background photograph/);
  assert.match(prompt, /Photorealistic background, polished graphic-design overlay/);
  assert.match(prompt, /TYPOGRAPHY:/);
  assert.match(prompt, /central 80%/);
  assert.match(prompt, /Set it in autumn/);
  // The text it must set is still spelled out for it, and nothing else.
  assert.match(prompt, /"Youth Hangout"/);
  assert.match(prompt, /"Louisville Grace Church"/);
  assert.match(prompt, /"FRIDAY, OCTOBER 3"; "7:00 PM"; "The Loft"/);
  assert.match(prompt, /ONLY words allowed/);
  assert.match(prompt, /character for character/);
});

test("the flyer prints no location line when none was resolved", () => {
  const prompt = buildFullFlyerPrompt({ ...base, location: null, mode: "flyer" });
  assert.match(prompt, /"FRIDAY, OCTOBER 3"; "7:00 PM"\./);
  assert.doesNotMatch(prompt, /The Loft/);
});

test("the copywriter is asked for a photograph of this event", () => {
  const system = eventSocialSystemPrompt({
    churchName: "Louisville Grace Church",
    title: "Youth Hangout",
    when: "Friday, October 3 at 7:00 PM",
    location: "The Loft",
  });
  assert.match(system, /describing the photograph that should illustrate THIS event/);
  assert.match(system, /imageSubject is what actually gets photographed/);
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
  assert.doesNotMatch(plain, /brush-script/);
  assert.match(plain, /nothing added or removed/);
  const withPhrase = buildFullFlyerPrompt({ ...base, headline: "Coffee with the Pastor", mode: "flyer" });
  assert.match(withPhrase, /connecting words "with the" may be set smaller/);
});
