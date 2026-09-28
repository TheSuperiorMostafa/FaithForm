import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  claimWeeklyDraft,
  completeWeeklyDraft,
  markWeeklyDraftUncertain,
} from "@/lib/announcements/draft-claim";

test("claim id follows completion and uncertain provider updates", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const admin = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return { data: name === "claim_weekly_announcement_draft" ? "claimed" : null, error: null };
    },
  } as unknown as SupabaseClient;

  const { status, claimId } = await claimWeeklyDraft("church", "2026-09-28", false, admin);
  assert.equal(status, "claimed");
  assert.match(claimId, /^[0-9a-f-]{36}$/);
  await markWeeklyDraftUncertain("church", "2026-09-28", claimId, admin);
  await completeWeeklyDraft("church", "2026-09-28", claimId, "provider-id", admin);
  assert.deepEqual(calls.map((call) => call.name), [
    "claim_weekly_announcement_draft",
    "mark_weekly_announcement_draft_uncertain",
    "complete_weekly_announcement_draft",
  ]);
  assert.equal(calls.every((call) => call.args.p_claim_id === claimId), true);
  assert.equal(calls[2].args.p_draft_id, "provider-id");
});

test("an unavailable claim fails before a provider draft can be attempted", async () => {
  const admin = {
    rpc: async () => ({ data: null, error: { message: "database unavailable" } }),
  } as unknown as SupabaseClient;
  await assert.rejects(
    claimWeeklyDraft("church", "2026-09-28", false, admin),
    /Weekly draft claim failed/,
  );
});
