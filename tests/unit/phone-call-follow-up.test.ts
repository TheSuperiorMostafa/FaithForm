import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { toCallListItem } from "@/app/dashboard/call-log/call-view";
import { isMissingHandledColumn } from "@/app/dashboard/call-log/handled";
import {
  describeCallFollowUp,
  sortCallsForFollowUp,
} from "@/lib/utils/call-score";
import {
  callerContactForViewer,
  formatCallTime,
  formatPhoneNumber,
  SHOW_FULL_CALLER_NUMBER_TO_ADMINS,
} from "@/lib/utils/voice-assistant";
import type { PhoneCallRow } from "@/types/voice-assistant";

function call(overrides: Partial<PhoneCallRow> = {}): PhoneCallRow {
  return {
    id: "call-1",
    caller_number: "+15025550123",
    duration_seconds: 92,
    outcome: null,
    sentiment: null,
    transcript: "User: Hello?",
    called_at: "2026-09-01T15:00:00.000Z",
    ai_score: 8,
    recording_url: null,
    call_successful: null,
    score_breakdown: { version: 3, score: 8, summary: "Asked for a hospital visit." },
    notes: null,
    scored_at: "2026-09-01T15:05:00.000Z",
    call_classification: "real",
    notify_pastor: true,
    urgency: "normal",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Who needs a call back
// ---------------------------------------------------------------------------

test("a real caller the rubric flagged needs a call back", () => {
  const view = describeCallFollowUp(call());
  assert.equal(view.needsCallBack, true);
  assert.equal(view.urgent, false);
  assert.equal(view.label, "Needs a call back");
  assert.equal(view.tone, "attention");
});

test("a caller in crisis is urgent and says so", () => {
  const view = describeCallFollowUp(call({ urgency: "high" }));
  assert.equal(view.needsCallBack, true);
  assert.equal(view.urgent, true);
  assert.equal(view.label, "Urgent: call back");
});

test("spam, silence and sales calls never need a call back, even flagged or urgent", () => {
  for (const kind of ["spam", "no_engagement", "vendor"] as const) {
    const view = describeCallFollowUp(
      call({ call_classification: kind, notify_pastor: true, urgency: "high" }),
    );
    assert.equal(view.needsCallBack, false, kind);
    assert.equal(view.urgent, false, kind);
  }
  assert.equal(describeCallFollowUp(call({ call_classification: "spam" })).label, "Spam");
  assert.equal(
    describeCallFollowUp(call({ call_classification: "no_engagement" })).label,
    "No one spoke",
  );
  assert.equal(describeCallFollowUp(call({ call_classification: "vendor" })).label, "Sales call");
});

test("a routine call the assistant answered does not need a call back", () => {
  const view = describeCallFollowUp(call({ notify_pastor: false, urgency: "low" }));
  assert.equal(view.needsCallBack, false);
  assert.equal(view.label, "Answered");
  assert.equal(view.tone, "done");
});

test("an urgent-sounding call without the notify flag is not a call back", () => {
  // The rubric's guard against robocalls that sound urgent.
  assert.equal(describeCallFollowUp(call({ notify_pastor: false, urgency: "high" })).needsCallBack, false);
});

test("a handled call leaves the call-back list", () => {
  const view = describeCallFollowUp(call({ urgency: "high" }), "2026-09-02T10:00:00.000Z");
  assert.equal(view.needsCallBack, false);
  assert.equal(view.urgent, false);
  assert.equal(view.handled, true);
  assert.equal(view.label, "Handled");
  assert.equal(view.tone, "done");
});

test("a database without migration 0070 reads the flags from the breakdown", () => {
  const view = describeCallFollowUp(
    call({
      call_classification: null,
      notify_pastor: null,
      urgency: null,
      score_breakdown: { version: 3, score: 6, call_type: "real", notify_pastor: true, urgency: "high" },
    }),
  );
  assert.equal(view.needsCallBack, true);
  assert.equal(view.urgent, true);
});

test("an unscored call is not sorted yet and needs nothing", () => {
  const view = describeCallFollowUp(
    call({ call_classification: null, notify_pastor: null, urgency: null, score_breakdown: null }),
  );
  assert.equal(view.needsCallBack, false);
  assert.equal(view.label, "Not sorted yet");
});

test("urgent calls come first, then the newest", () => {
  const sorted = sortCallsForFollowUp([
    { id: "old-normal", urgent: false, calledAt: "2026-09-01T10:00:00Z" },
    { id: "new-normal", urgent: false, calledAt: "2026-09-03T10:00:00Z" },
    { id: "old-urgent", urgent: true, calledAt: "2026-08-30T10:00:00Z" },
    { id: "new-urgent", urgent: true, calledAt: "2026-09-02T10:00:00Z" },
  ]);
  assert.deepEqual(
    sorted.map((c) => c.id),
    ["new-urgent", "old-urgent", "new-normal", "old-normal"],
  );
});

// ---------------------------------------------------------------------------
// Caller numbers (pending product decision)
// ---------------------------------------------------------------------------

test("numbers stay masked for everyone by default", () => {
  assert.equal(SHOW_FULL_CALLER_NUMBER_TO_ADMINS, false);
  assert.deepEqual(callerContactForViewer("+15025550123", { isAdmin: true }), {
    label: "Caller ending in 0123",
    dial: null,
  });
  assert.deepEqual(callerContactForViewer("+15025550123", { isAdmin: false }), {
    label: "Caller ending in 0123",
    dial: null,
  });
});

test("with the switch on, only church admins get the full number and a way to dial it", () => {
  assert.deepEqual(callerContactForViewer("+15025550123", { isAdmin: true }, true), {
    label: "(502) 555-0123",
    dial: "+15025550123",
  });
  assert.deepEqual(callerContactForViewer("+15025550123", { isAdmin: false }, true), {
    label: "Caller ending in 0123",
    dial: null,
  });
});

test("a missing number reads as an unknown caller and cannot be dialled", () => {
  assert.deepEqual(callerContactForViewer(null, { isAdmin: true }, true), {
    label: "Unknown caller",
    dial: null,
  });
});

test("phone numbers are formatted the way people write them", () => {
  assert.equal(formatPhoneNumber("+15025550123"), "(502) 555-0123");
  assert.equal(formatPhoneNumber("5025550123"), "(502) 555-0123");
  assert.equal(formatPhoneNumber("+44 20 7946 0958"), "+44 20 7946 0958");
});

test("the church's list item never carries the raw number while it is masked", () => {
  const item = toCallListItem(call(), null, { isAdmin: true });
  assert.equal(item.dial, null);
  assert.doesNotMatch(JSON.stringify(item), /5025550123/);
  assert.equal(item.summary, "Asked for a hospital visit.");
  assert.equal(item.needsCallBack, true);
});

test("call times read as today, yesterday, or a short date", () => {
  const now = new Date(2026, 8, 25, 18, 0);
  assert.match(formatCallTime(new Date(2026, 8, 25, 9, 5).toISOString(), now), /^Today, /);
  assert.match(formatCallTime(new Date(2026, 8, 24, 9, 5).toISOString(), now), /^Yesterday, /);
  assert.doesNotMatch(formatCallTime(new Date(2026, 8, 20, 9, 5).toISOString(), now), /Today|Yesterday/);
  assert.equal(formatCallTime("not a date", now), "");
});

// ---------------------------------------------------------------------------
// Mark as handled survives an unmigrated database
// ---------------------------------------------------------------------------

test("a missing handled column is recognised, so the page hides the button instead of failing", () => {
  assert.equal(isMissingHandledColumn({ code: "42703", message: "column phone_calls.handled_at does not exist" }), true);
  assert.equal(isMissingHandledColumn({ code: "PGRST204", message: "Could not find the 'handled_at' column" }), true);
  assert.equal(isMissingHandledColumn({ code: "23505", message: "duplicate key" }), false);
  assert.equal(isMissingHandledColumn(null), false);
});

test("marking handled keeps the admin, feature and church guards", () => {
  const actions = readFileSync("app/dashboard/call-log/actions.ts", "utf8");
  assert.match(actions, /requireChurchAuth\(\)/);
  assert.match(actions, /featureActionError\("voice_assistant"\)/);
  assert.match(actions, /if \(!auth\.isAdmin\)/);
  assert.match(actions, /\.eq\("church_id", auth\.churchId\)/);
  assert.doesNotMatch(actions, /error\.message/);
});

test("the migration only adds nullable columns", () => {
  const migration = readFileSync("supabase/migrations/0104_phone_call_handled.sql", "utf8");
  assert.match(migration, /add column if not exists handled_at timestamptz,/);
  assert.match(migration, /add column if not exists handled_by uuid references auth\.users \(id\) on delete set null/);
  assert.doesNotMatch(migration, /not null/i);
});

// ---------------------------------------------------------------------------
// What the church sees
// ---------------------------------------------------------------------------

test("the church's Phone Calls page hides the assistant's scores behind a staff-only section", () => {
  const page = readFileSync("app/dashboard/call-log/page.tsx", "utf8");
  assert.match(page, /title=\{CALL_LOG_TITLE\}/);
  assert.match(page, /isPlatformAdminUserId/);
  assert.match(page, /\{isStaff && \(\s*<AdvancedSection\s+title="Assistant quality \(for FaithForm staff\)"/);
  assert.match(page, /<RecentCallsBlock/);

  const list = readFileSync("components/voice-assistant/calls-list.tsx", "utf8");
  const detail = readFileSync("components/voice-assistant/call-detail-view.tsx", "utf8");
  for (const [name, source] of Object.entries({ page, list, detail })) {
    const visible = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(visible, /Retell/, `${name} names the vendor`);
  }
  assert.doesNotMatch(list, /min-w-\[720px\]|<table/);
});

test("old per-call links keep the call id", () => {
  const route = readFileSync("app/dashboard/voice-assistant/calls/[id]/route.ts", "utf8");
  assert.match(route, /\/dashboard\/call-log\/\$\{encodeURIComponent\(id\)\}/);
});
