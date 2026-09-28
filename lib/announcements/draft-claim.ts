import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";

type ClaimStatus = "claimed" | "already_created" | "needs_review";

/** Reserve the church/week before making a provider draft. */
export async function claimWeeklyDraft(
  churchId: string,
  weekStartKey: string,
  force: boolean,
  admin: SupabaseClient = createAdminClient(),
): Promise<{ status: ClaimStatus; claimId: string }> {
  const claimId = randomUUID();
  const { data, error } = await admin.rpc("claim_weekly_announcement_draft", {
    p_church_id: churchId,
    p_week_start: weekStartKey,
    p_claim_id: claimId,
    p_force: force,
  });
  if (error) throw new Error("Weekly draft claim failed");
  if (data !== "claimed" && data !== "already_created" && data !== "needs_review") {
    throw new Error("Weekly draft claim returned an unexpected state");
  }
  return { status: data, claimId };
}

/** Store the provider id and church marker in one database transaction. */
export async function completeWeeklyDraft(
  churchId: string,
  weekStartKey: string,
  claimId: string,
  draftId: string,
  admin: SupabaseClient = createAdminClient(),
): Promise<void> {
  const { error } = await admin.rpc("complete_weekly_announcement_draft", {
    p_church_id: churchId,
    p_week_start: weekStartKey,
    p_claim_id: claimId,
    p_draft_id: draftId,
  });
  if (error) throw new Error("Weekly draft completion failed");
}

/** A failed provider response may still have saved a draft. Require review. */
export async function markWeeklyDraftUncertain(
  churchId: string,
  weekStartKey: string,
  claimId: string,
  admin: SupabaseClient = createAdminClient(),
): Promise<void> {
  const { error } = await admin.rpc("mark_weekly_announcement_draft_uncertain", {
    p_church_id: churchId,
    p_week_start: weekStartKey,
    p_claim_id: claimId,
  });
  if (error) throw new Error("Weekly draft uncertain-state update failed");
}
