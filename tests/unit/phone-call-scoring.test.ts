import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildPhoneCallScoringSystem,
  CLASSIFICATION_DESCRIPTIONS,
  FIRST_SORTED_SCORING_VERSION,
  NAMES_FROM_TRANSCRIPT_ONLY,
  PHONE_CALL_SCORING_VERSION,
} from "@/lib/integrations/phone-call-scoring-prompt";
import {
  phoneCallScoreSchema,
  scoringContextFromSettings,
} from "@/lib/integrations/score-phone-call";
import {
  describeCallScore,
  formatCallScore,
  isLegacyCallScore,
  isOutdatedCallScore,
  isOutdatedScoreBreakdown,
} from "@/lib/utils/call-score";
import type { PhoneCallRow } from "@/types/voice-assistant";

const navItems = readFileSync("components/dashboard/nav-items.ts", "utf8");
const voiceLayout = readFileSync(
  "app/dashboard/voice-assistant/layout.tsx",
  "utf8",
);
const scorer = readFileSync("lib/integrations/score-phone-call.ts", "utf8");
const actions = readFileSync("app/dashboard/voice-assistant/actions.ts", "utf8");
const callsBlock = readFileSync(
  "components/voice-assistant/recent-calls-block.tsx",
  "utf8",
);
const explainer = readFileSync(
  "components/voice-assistant/scoring-explainer.tsx",
  "utf8",
);
const migration = readFileSync(
  "supabase/migrations/0070_phone_call_scoring_v2.sql",
  "utf8",
);
const detailView = readFileSync(
  "components/voice-assistant/call-detail-view.tsx",
  "utf8",
);
const callLogPage = readFileSync("app/dashboard/call-log/page.tsx", "utf8");
const csvExport = readFileSync(
  "app/api/dashboard/voice-assistant/calls/export/route.ts",
  "utf8",
);
const scoringPrompt = readFileSync(
  "lib/integrations/phone-call-scoring-prompt.ts",
  "utf8",
);
const callScore = readFileSync("lib/utils/call-score.ts", "utf8");

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

test("the prompt says which transcript label is which party, so a greeting is not read as the caller", () => {
  const system = buildPhoneCallScoringSystem({
    churchName: "Louisville Grace Church",
    assistantNameHint: "Katherine",
    voiceGender: "female",
  });

  assert.match(
    system,
    /Lines that start with "Agent:" are the church's AI phone assistant/,
  );
  assert.match(system, /Lines that start with "User:" are the caller/);
  assert.match(
    system,
    /A greeting from Louisville Grace Church is the assistant speaking, not the caller introducing themselves/,
  );
});

test("the saved assistant name is a hint the transcript has to confirm, never a fact", () => {
  // A pilot church read "Vonda" all over its call summaries and nobody knew
  // who that was. Version 2 told the model the saved name was the agent and to
  // name it in every summary, whether or not anyone on the call said it.
  const system = buildPhoneCallScoringSystem({
    churchName: "Louisville Grace Church",
    assistantNameHint: "Vonda",
    voiceGender: "female",
  });

  assert.doesNotMatch(system, /as the agent/i);
  assert.doesNotMatch(system, /Vonda is/);
  assert.match(system, /Refer to the assistant as "the assistant"/);

  // The name appears on exactly one line, and that line makes it conditional
  // on the assistant saying it in the transcript.
  const lines = system.split("\n").filter((line) => line.includes("Vonda"));
  assert.equal(lines.length, 1);
  assert.match(
    lines[0],
    /That is a hint, not a fact about this call: use "Vonda" only if an "Agent:" line in this transcript has the assistant say it/,
  );
});

test("callers and everyone else are named only when the transcript names them", () => {
  const system = buildPhoneCallScoringSystem({
    churchName: "Grace",
    assistantNameHint: null,
  });

  assert.match(
    system,
    /Use the caller's name only if the caller says it in the transcript/,
  );
  assert.match(system, /only if that name is said in the transcript/);
  assert.match(system, /Never invent, guess, or fill in a name/);
  assert.match(
    system,
    /A name that appears only in Retell's summary, or only in these instructions, does not count/,
  );
});

test("a church with no saved name gets no name in the prompt at all", () => {
  const system = buildPhoneCallScoringSystem({
    churchName: "Grace",
    assistantNameHint: null,
  });

  assert.doesNotMatch(system, /The church calls its assistant/);
  // The old fallback phrase read like a title and got repeated as one.
  assert.doesNotMatch(system, /AI receptionist/);
});

test("a linked agent's saved name and voice never reach the prompt", () => {
  // A linked agent is built in Retell and FaithForm never sends it either
  // setting, so neither says anything about who answered the phone.
  const context = scoringContextFromSettings(
    { name: "Louisville Grace Church" },
    { assistant_name: "Vonda", voice_gender: "female", agent_mode: "linked" },
  );

  assert.deepEqual(context, {
    churchName: "Louisville Grace Church",
    assistantNameHint: null,
    voiceGender: null,
  });

  const system = buildPhoneCallScoringSystem(context);
  assert.doesNotMatch(system, /Vonda/);
  assert.doesNotMatch(system, /\bherself\b|\bhimself\b/);
});

test("a managed agent's saved name is passed along as a hint", () => {
  assert.deepEqual(
    scoringContextFromSettings(
      { name: "  Grace Church " },
      { assistant_name: "  Katherine ", voice_gender: "female", agent_mode: "managed" },
    ),
    {
      churchName: "Grace Church",
      assistantNameHint: "Katherine",
      voiceGender: "female",
    },
  );
  assert.deepEqual(scoringContextFromSettings(null, null), {
    churchName: "the church",
    assistantNameHint: null,
    voiceGender: null,
  });
  assert.equal(
    scoringContextFromSettings({ name: "Grace" }, { assistant_name: "   " })
      .assistantNameHint,
    null,
  );
});

test("the scorer reads the agent mode, so a linked church's name is dropped", () => {
  assert.match(scorer, /\.select\("assistant_name, voice_gender, agent_mode"\)/);
  assert.match(scorer, /return scoringContextFromSettings\(church, settings\)/);
});

test("the name rule covers every field the model writes, not just the summary", () => {
  const system = buildPhoneCallScoringSystem({
    churchName: "Grace",
    assistantNameHint: "Katherine",
  });

  assert.match(
    system,
    /These rules apply to every field you write: summary, flag_reason, and missing_knowledge/,
  );
  assert.match(system, /STEP 4: Write it up, following the NAMES rules in every field/);

  // Repeated on the output schema, where the model reads it as it writes.
  const written = ["summary", "flag_reason", "missing_knowledge"] as const;
  for (const field of written) {
    const description = phoneCallScoreSchema.shape[field].description ?? "";
    assert.ok(
      description.includes(NAMES_FROM_TRANSCRIPT_ONLY),
      `${field} carries the name rule`,
    );
  }
});

test("a refused scam is scored as a win for the church, not a failed call", () => {
  const system = buildPhoneCallScoringSystem({
    churchName: "Louisville Grace Church",
    assistantNameHint: "Katherine",
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
    churchName: "Grace",
    assistantNameHint: "Katherine",
    voiceGender: "female",
  });
  const male = buildPhoneCallScoringSystem({
    churchName: "Grace",
    assistantNameHint: "Samuel",
    voiceGender: "male",
  });
  const unset = buildPhoneCallScoringSystem({
    churchName: "Grace",
    assistantNameHint: "Ash",
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
  // Someone should ring back, but nobody is in crisis, so nothing is flagged.
  assert.equal(view.urgent, false);
  assert.equal(view.summary, "A member asked about the food pantry hours.");
});

test("only a caller in crisis is marked urgent", () => {
  const scored = (
    urgency: "high" | "normal" | "low",
    notifyPastor: boolean,
  ) =>
    call({
      ai_score: 7,
      scored_at: "2026-09-01T15:05:00.000Z",
      call_classification: "real",
      notify_pastor: notifyPastor,
      urgency,
      score_breakdown: {
        version: PHONE_CALL_SCORING_VERSION,
        score: 7,
        call_type: "real",
        notify_pastor: notifyPastor,
        urgency,
      },
    });

  assert.equal(describeCallScore(scored("high", true)).urgent, true);
  assert.equal(describeCallScore(scored("normal", true)).urgent, false);
  assert.equal(describeCallScore(scored("low", false)).urgent, false);
  // A robocall that sounds urgent is not someone the church needs to hear
  // about, and the rubric says so with notify_pastor.
  assert.equal(describeCallScore(scored("high", false)).urgent, false);

  // A database without migration 0070 has only the breakdown to go on.
  const preMigration = call({
    ai_score: 6,
    scored_at: "2026-09-01T15:05:00.000Z",
    score_breakdown: {
      version: PHONE_CALL_SCORING_VERSION,
      score: 6,
      call_type: "real",
      notify_pastor: true,
      urgency: "high",
    },
  });
  assert.equal(describeCallScore(preMigration).urgent, true);
});

test("calls scored by the previous prompt are offered for re-scoring but still read as sorted", () => {
  // Version 2 wrote the summaries that named the assistant by its saved name.
  // Their kind and score are real judgements, so they keep their colour and
  // their kind, but the re-score button has to pick them up.
  assert.ok(PHONE_CALL_SCORING_VERSION > 2);
  assert.equal(FIRST_SORTED_SCORING_VERSION, 2);

  const previousPrompt = call({
    ai_score: 8,
    scored_at: "2026-09-01T15:05:00.000Z",
    call_classification: "real",
    score_breakdown: {
      version: 2,
      score: 8,
      call_type: "real",
      summary: "Vonda answered and gave the service times.",
    },
  });

  assert.equal(isLegacyCallScore(previousPrompt), false);
  assert.equal(isOutdatedCallScore(previousPrompt), true);

  const view = describeCallScore(previousPrompt);
  assert.equal(view.legacy, false);
  assert.equal(view.classificationLabel, "Real call");
  assert.notEqual(view.toneClass, "text-muted-foreground");

  // A call the current prompt judged is not offered again, and a call nobody
  // has scored yet is left to the scorer rather than the re-score button.
  assert.equal(
    isOutdatedCallScore(
      call({
        ai_score: 8,
        scored_at: "2026-09-18T15:05:00.000Z",
        score_breakdown: { version: PHONE_CALL_SCORING_VERSION, score: 8 },
      }),
    ),
    false,
  );
  assert.equal(isOutdatedCallScore(call()), false);

  // The action sees only the breakdown, and has to agree with the button.
  assert.equal(isOutdatedScoreBreakdown({ version: 2, score: 8 }), true);
  assert.equal(isOutdatedScoreBreakdown({ version: 1, score: 7 }), true);
  assert.equal(isOutdatedScoreBreakdown(null), true);
  assert.equal(
    isOutdatedScoreBreakdown({ version: PHONE_CALL_SCORING_VERSION, score: 8 }),
    false,
  );
});

test("a call the retired rubric scored is shown on the converted 1–10 scale, uncoloured", () => {
  // Migration 0070 already turned this row's 70 into a 7 and stamped it
  // version 1. Labelling that 7 "/100" is how every older call in a church's
  // log came to read "5/100", "3/100", "10/100".
  const view = describeCallScore(
    call({
      ai_score: 7,
      scored_at: "2026-05-01T15:05:00.000Z",
      score_breakdown: {
        version: 1,
        score: 70,
        rationale: "Answered the question but sounded scripted.",
      },
    }),
  );

  assert.equal(view.legacy, true);
  assert.equal(view.outOf, 10);
  assert.equal(formatCallScore(view), "7 / 10");
  assert.equal(view.classification, null);
  // Its rationale still has to reach the screen: it is all a v1 row ever said.
  assert.equal(view.summary, "Answered the question but sounded scripted.");
  // And it is left uncoloured: a converted rank is not a verdict.
  assert.equal(view.toneClass, "text-muted-foreground");
});

test("a score 0070 never converted keeps the scale it was given on", () => {
  const view = describeCallScore(
    call({
      ai_score: 70,
      scored_at: "2026-05-01T15:05:00.000Z",
      score_breakdown: { version: 1, score: 70, rationale: "Fine." },
    }),
  );

  assert.equal(view.legacy, true);
  assert.equal(formatCallScore(view), "70 / 100");
});

test("a scored row with no rubric stamp at all counts as legacy", () => {
  const row = call({
    ai_score: 6,
    scored_at: "2026-05-01T15:05:00.000Z",
    score_breakdown: { score: 6, rationale: "Okay." },
  });

  assert.equal(isLegacyCallScore(row), true);
  assert.equal(describeCallScore(row).legacy, true);
});

test("a row scored by the current rubric is not legacy, and an unscored one is not either", () => {
  assert.equal(isLegacyCallScore(call()), false);
  assert.equal(
    isLegacyCallScore(
      call({
        ai_score: 9,
        scored_at: "2026-09-01T15:05:00.000Z",
        score_breakdown: { version: PHONE_CALL_SCORING_VERSION, score: 9 },
      }),
    ),
    false,
  );
});

test("older calls can be re-scored in one sitting, a round at a time", () => {
  // The action judges a handful per round so no request runs long enough to
  // be cut off, and the button loops until the action reports none left.
  assert.match(actions, /export async function rescoreLegacyPhoneCalls\(/);
  assert.match(actions, /force: true, admin/);
  // The button's count and the action's pick use one rule, so every call
  // scored under an older prompt, not only the unsorted ones, is re-scored.
  assert.match(actions, /isOutdatedScoreBreakdown\(/);
  assert.match(callsBlock, /calls\.filter\(isOutdatedCallScore\)/);
  assert.match(callsBlock, /rescoreLegacyPhoneCalls\(\)/);
  assert.match(callsBlock, /Re-score \$\{olderCount\} older call/);
  assert.match(callsBlock, /title=\{OLDER_SCORE_NOTE\}/);
  assert.match(callsBlock, /remaining === 0 \|\| result\.rescored === 0/);
});

test("the explainer no longer promises a /100 that the migration removed", () => {
  assert.doesNotMatch(explainer, /shown out of 100/);
  assert.match(explainer, /Re-score older calls/);
  assert.match(explainer, /Not yet sorted/);
});

test("an unscored call shows a dash rather than a zero", () => {
  const view = describeCallScore(call());

  assert.equal(view.value, null);
  assert.equal(formatCallScore(view), "");
  assert.equal(view.urgent, false);
});

// ---------------------------------------------------------------------------
// "Needs a reply" is gone from every phone surface
// ---------------------------------------------------------------------------

/** Comments may record the history; only what reaches a church is checked. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

test("no phone log surface says a call needs a reply", () => {
  // A pilot church asked for it to go. The flag is still saved; it is just
  // never shown.
  const surfaces = {
    callsBlock,
    explainer,
    detailView,
    callLogPage,
    csvExport,
    scoringPrompt,
    callScore,
  };
  for (const [name, source] of Object.entries(surfaces)) {
    assert.doesNotMatch(
      withoutComments(source),
      /needs? a reply/i,
      `${name} says "needs a reply"`,
    );
  }
  assert.doesNotMatch(explainer, /AttentionBadge/);
});

test("the log still marks a crisis, and nothing else about urgency", () => {
  assert.match(explainer, /export function UrgentBadge/);
  assert.match(explainer, /if \(!view\.urgent\) return null/);
  assert.match(callsBlock, /<UrgentBadge view=\{score\} \/>/);
  assert.match(detailView, /<UrgentBadge view=\{score\} \/>/);
  // The detail page's Urgency row read "Needs a reply" on most real calls.
  assert.doesNotMatch(detailView, />Urgency</);
});

test("the header no longer counts calls waiting on a reply", () => {
  assert.doesNotMatch(callLogPage, /notify_pastor/);
  assert.doesNotMatch(callLogPage, /calls need/);
});

test("the CSV marks urgent calls and drops the reply columns", () => {
  assert.doesNotMatch(csvExport, /"Needs a reply"/);
  assert.doesNotMatch(csvExport, /"Urgency"/);
  assert.match(csvExport, /"Urgent",/);
  assert.match(csvExport, /score\.urgent \? "Yes" : ""/);
});

test("the notify_pastor flag is still saved (it now feeds \"Needs a call back\", never a reply badge)", () => {
  assert.match(scorer, /notify_pastor: z\.boolean\(\)/);
  assert.match(scorer, /notify_pastor: breakdown\.notify_pastor/);
  assert.match(scorer, /urgency: breakdown\.urgency/);
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
