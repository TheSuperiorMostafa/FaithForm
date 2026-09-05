import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildPhoneCallScoringSystem,
  CLASSIFICATION_DESCRIPTIONS,
  PHONE_CALL_SCORING_VERSION,
} from "@/lib/integrations/phone-call-scoring-prompt";
import { describeCallScore, formatCallScore } from "@/lib/utils/call-score";
import type { PhoneCallRow } from "@/types/voice-assistant";

const navItems = readFileSync("components/dashboard/nav-items.ts", "utf8");
const voiceLayout = readFileSync(
  "app/dashboard/voice-assistant/layout.tsx",
  "utf8",
);
const scorer = readFileSync("lib/integrations/score-phone-call.ts", "utf8");
const migration = readFileSync(
  "supabase/migrations/0070_phone_call_scoring_v2.sql",
  "utf8",
);

function call(overrides: Partial<PhoneCallRow> = {}): PhoneCallRow {
  return {
    id: "call-1",
    caller_number: "+15025550123",
    duration_seconds: 92,
    outcome: null,
    sentiment: null,
    transcript: "Hello, Louisville Grace, this is Katherine.",
    called_at: "2026-09-01T15:00:00.000Z",
    ai_score: null,
    recording_url: null,
    call_successful: null,
    score_breakdown: null,
    notes: null,
    scored_at: null,
    call_classification: null,
    notify_pastor: null,
    urgency: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// The rubric itself
// ---------------------------------------------------------------------------

test("the prompt names both parties, so a greeting is not read as the caller", () => {
  const system = buildPhoneCallScoringSystem({
    assistantName: "Katherine",
    churchName: "Louisville Grace Church",
    voiceGender: "female",
  });

  assert.match(system, /Katherine is the AGENT who answers the phone/);
  assert.match(system, /The other party is the CALLER/);
  assert.match(
    system,
    /if the transcript opens with a greeting from Louisville Grace Church, that is Katherine/,
  );
});

test("a refused scam is scored as a win for the church, not a failed call", () => {
  const system = buildPhoneCallScoringSystem({
    assistantName: "Katherine",
    churchName: "Louisville Grace Church",
    voiceGender: "female",
  });

  assert.match(system, /A scam that fails is a SUCCESS for the church/);
  assert.match(
    CLASSIFICATION_DESCRIPTIONS.spam,
    /a scam that fails is a win/i,
  );
});

test("pronouns follow the church's own voice setting rather than a default", () => {
  const female = buildPhoneCallScoringSystem({
    assistantName: "Katherine",
    churchName: "Grace",
    voiceGender: "female",
  });
  const male = buildPhoneCallScoringSystem({
    assistantName: "Samuel",
    churchName: "Grace",
    voiceGender: "male",
  });
  const unset = buildPhoneCallScoringSystem({
    assistantName: "Ash",
    churchName: "Grace",
    voiceGender: null,
  });

  assert.match(female, /contradicted herself/);
  assert.match(male, /contradicted himself/);
  assert.match(unset, /contradicted themselves/);
  assert.doesNotMatch(unset, /\bherself\b|\bhimself\b/);
});

// ---------------------------------------------------------------------------
// A silent line is a classification, not a missing one
// ---------------------------------------------------------------------------

test("an empty transcript is recorded as no_engagement instead of costing a model call", () => {
  const emptyTranscriptGuard = scorer.indexOf("if (!transcript)");
  const modelCall = scorer.indexOf("await aiGenerateObject(");

  assert.ok(emptyTranscriptGuard > 0, "the empty-transcript branch exists");
  assert.ok(
    emptyTranscriptGuard < modelCall,
    "it returns before any model call is made",
  );
  assert.match(scorer, /buildNoEngagementBreakdown/);
});

test("no_engagement is pinned to 5/neutral even when the model says otherwise", () => {
  assert.match(scorer, /call_type === "no_engagement"/);
  assert.match(scorer, /score: NO_ENGAGEMENT_SCORE/);
  assert.match(scorer, /label: "neutral"/);
  assert.match(scorer, /notify_pastor: false/);
});

// ---------------------------------------------------------------------------
// Two rubrics in one column
// ---------------------------------------------------------------------------

test("a call scored under the current rubric reads out of 10", () => {
  const view = describeCallScore(
    call({
      ai_score: 9,
      scored_at: "2026-09-01T15:05:00.000Z",
      call_classification: "real",
      notify_pastor: true,
      urgency: "normal",
      score_breakdown: {
        version: PHONE_CALL_SCORING_VERSION,
        score: 9,
        call_type: "real",
        label: "successful",
        summary: "A member asked about the food pantry hours.",
        caller_mood: "satisfied",
        flag_reason: null,
        notify_pastor: true,
        urgency: "normal",
        missing_knowledge: null,
      },
    }),
  );

  assert.equal(view.legacy, false);
  assert.equal(view.outOf, 10);
  assert.equal(formatCallScore(view), "9 / 10");
  assert.equal(view.classificationLabel, "Real call");
  assert.equal(view.needsAttention, true);
  assert.equal(view.urgencyLabel, "Needs a reply");
  assert.equal(view.summary, "A member asked about the food pantry hours.");
});

test("a call scored under the retired rubric says so instead of shrinking to a 7", () => {
  const view = describeCallScore(
    call({
      ai_score: 70,
      scored_at: "2026-05-01T15:05:00.000Z",
      score_breakdown: {
        version: 1,
        score: 70,
        rationale: "Answered the question but sounded scripted.",
      },
    }),
  );

  assert.equal(view.legacy, true);
  assert.equal(view.outOf, 100);
  assert.equal(formatCallScore(view), "70 / 100");
  assert.equal(view.classification, null);
  // Its rationale still has to reach the screen — it is all a v1 row ever said.
  assert.equal(view.summary, "Answered the question but sounded scripted.");
  // And it is left uncoloured: a converted rank is not a verdict.
  assert.equal(view.toneClass, "text-muted-foreground");
});

test("an unscored call shows a dash rather than a zero", () => {
  const view = describeCallScore(call());

  assert.equal(view.value, null);
  assert.equal(formatCallScore(view), "—");
  assert.equal(view.needsAttention, false);
});

test("the migration rescales old scores rather than dropping them", () => {
  assert.match(migration, /jsonb_build_object\('version', 1\)/);
  assert.match(migration, /greatest\(1, round\(ai_score \/ 10\.0\)\)/);
  // Stamping has to happen before the rescale, or the rescale cannot tell
  // which rows it has already touched.
  assert.ok(
    migration.indexOf("jsonb_build_object('version', 1)") <
      migration.indexOf("greatest(1, round(ai_score / 10.0))"),
  );
});

// ---------------------------------------------------------------------------
// Who sees what
// ---------------------------------------------------------------------------

test("the church's nav offers the call log, not the assistant's settings", () => {
  assert.match(navItems, /href: "\/dashboard\/call-log"/);
  assert.doesNotMatch(navItems, /href: "\/dashboard\/voice-assistant"/);
});

test("assistant settings send a church member back to the log", () => {
  assert.match(voiceLayout, /isPlatformAdminUserId/);
  assert.match(voiceLayout, /redirect\("\/dashboard\/call-log"\)/);
});
