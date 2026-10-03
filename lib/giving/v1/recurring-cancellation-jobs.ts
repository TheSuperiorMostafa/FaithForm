import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import { stripeGivingProvider, type GivingPaymentProvider } from "@/lib/giving/v1/payment-provider";

const TABLE = "giving_recurring_cancellation_jobs";
const PAGE_SIZE = 1000;
const LIVE_STATUSES = ["active", "trialing", "past_due", "paused", "unpaid", "incomplete"];
const validAccount = (id: unknown): id is string => typeof id === "string" && /^acct_[A-Za-z0-9]+$/.test(id);
const validSubscription = (id: unknown): id is string => typeof id === "string" && /^sub_[A-Za-z0-9]+$/.test(id);

type Target = { stripe_account_id: string; stripe_subscription_id: string };

async function allRows(query: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await query(from, from + PAGE_SIZE - 1);
    if (error) throw new Error("recurring_cancellation_targets_unavailable");
    const page = (data ?? []) as Record<string, unknown>[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

/** Durable handoff before account deletion. Jobs contain no account/donor identity. */
export async function enqueueRecurringGiftCancellationsForAccount(input: {
  accountId: string;
  client?: SupabaseClient;
}): Promise<{ queued: number }> {
  const admin = input.client ?? createAdminClient();
  const links = await allRows((from, to) => admin.from("giving_donor_links")
    .select("donor_id, church_id").eq("account_id", input.accountId).is("revoked_at", null)
    .order("id").range(from, to));
  const churchSubscriptions = new Map<string, Set<string>>();
  function remember(churchId: unknown, subscriptionId: unknown) {
    if (typeof churchId !== "string" || !churchId || !validSubscription(subscriptionId)) {
      throw new Error("recurring_cancellation_target_invalid");
    }
    const ids = churchSubscriptions.get(churchId) ?? new Set<string>();
    ids.add(subscriptionId);
    churchSubscriptions.set(churchId, ids);
  }
  for (const link of links) {
    if (typeof link.church_id !== "string" || !link.church_id || typeof link.donor_id !== "string" || !link.donor_id) {
      throw new Error("recurring_cancellation_owner_invalid");
    }
    const subscriptions = await allRows((from, to) => admin.from("giving_subscriptions")
      .select("stripe_subscription_id").eq("church_id", link.church_id).eq("donor_id", link.donor_id)
      .in("status", LIVE_STATUSES).order("id").range(from, to));
    for (const subscription of subscriptions) remember(link.church_id, subscription.stripe_subscription_id);
  }
  // Attachment precedes webhook projection, so an interrupted webhook cannot hide a gift.
  const attempts = await allRows((from, to) => admin.from("giving_recurring_attempts")
    .select("church_id, stripe_subscription_id").eq("account_id", input.accountId)
    .order("id").range(from, to));
  for (const attempt of attempts) {
    if (attempt.stripe_subscription_id !== null) remember(attempt.church_id, attempt.stripe_subscription_id);
  }
  const targets: Target[] = [];
  for (const [churchId, ids] of churchSubscriptions) {
    const { data: church, error } = await admin.from("churches").select("stripe_account_id")
      .eq("id", churchId).maybeSingle();
    if (error || !validAccount(church?.stripe_account_id)) throw new Error("recurring_cancellation_account_unavailable");
    for (const subscriptionId of ids) targets.push({ stripe_account_id: church.stripe_account_id, stripe_subscription_id: subscriptionId });
  }
  for (let start = 0; start < targets.length; start += PAGE_SIZE) {
    const { error } = await admin.from(TABLE).upsert(targets.slice(start, start + PAGE_SIZE), {
      onConflict: "stripe_account_id,stripe_subscription_id", ignoreDuplicates: true,
    });
    if (error) throw new Error("recurring_cancellation_enqueue_failed");
  }
  return { queued: targets.length };
}

type CancellationJob = Target & { id: string; attempts: number; lease_token: string };
export type CancellationWorkerResult = { claimed: number; completed: number; retried: number; leaseLost: number };

/** A expired/crashed worker leaves its jobs claimable; failures never become terminal. */
export async function runRecurringGiftCancellationWorker(input: {
  client?: SupabaseClient;
  provider?: GivingPaymentProvider;
  limit?: number;
  now?: () => number;
  budgetMs?: number;
} = {}): Promise<CancellationWorkerResult> {
  const admin = input.client ?? createAdminClient();
  const provider = input.provider ?? stripeGivingProvider;
  const now = input.now ?? Date.now;
  const leaseToken = randomUUID();
  const limit = Number.isFinite(input.limit) ? Math.max(1, Math.min(100, Math.trunc(input.limit!))) : 25;
  const deadline = now() + (input.budgetMs ?? 40_000);
  const { data, error } = await admin.rpc("claim_recurring_gift_cancellations", { p_lease_token: leaseToken, p_limit: limit });
  if (error) throw new Error("recurring_cancellation_claim_failed");
  const result: CancellationWorkerResult = { claimed: 0, completed: 0, retried: 0, leaseLost: 0 };
  for (const job of (data ?? []) as CancellationJob[]) {
    result.claimed++;
    if (job.lease_token !== leaseToken) { result.leaseLost++; continue; }
    let completed = false;
    const exhausted = now() >= deadline;
    if (!exhausted && validAccount(job.stripe_account_id) && validSubscription(job.stripe_subscription_id)) {
      completed = await provider.cancelSubscription(job.stripe_account_id, job.stripe_subscription_id).catch(() => false);
    }
    const at = now();
    const retryMs = exhausted ? 0 : Math.min(60_000 * 2 ** Math.min(6, Math.max(0, job.attempts - 1)), 3_600_000);
    const { data: updated, error: writeError } = await admin.from(TABLE).update({
      status: completed ? "completed" : "pending",
      completed_at: completed ? new Date(at).toISOString() : null,
      next_attempt_at: new Date(at + retryMs).toISOString(),
      last_error: completed ? null : exhausted ? "worker_budget_exhausted" : "provider_unavailable",
      lease_token: null, lease_expires_at: null,
    }).eq("id", job.id).eq("status", "processing").eq("lease_token", leaseToken)
      .gt("lease_expires_at", new Date(at).toISOString()).select("id");
    if (writeError) throw new Error("recurring_cancellation_result_failed");
    if (!updated?.length) result.leaseLost++;
    else if (completed) result.completed++;
    else result.retried++;
  }
  return result;
}
