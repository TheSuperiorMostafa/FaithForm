import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";

export type OperationsCheck = { name: string; count: number | null; ok: boolean };
export type OperationsHealth = { ok: boolean; checkedAt: string; checks: OperationsCheck[] };

/** Read-only queue health. Results contain counts, never customer or job payloads. */
export async function checkOperationsHealth(input: {
  client?: SupabaseClient;
  now?: Date;
} = {}): Promise<OperationsHealth> {
  const client = input.client ?? createAdminClient({ signal: AbortSignal.timeout(15_000) });
  const now = input.now ?? new Date();
  const before = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();
  const count = (table: string) => client.from(table).select("*", { count: "exact", head: true });
  const probes = [
    ["payment_events_terminal", () => count("stripe_webhook_events").eq("status", "terminal")],
    ["payment_events_overdue", () => count("stripe_webhook_events").eq("status", "retryable")
      .or(`next_retry_at.is.null,next_retry_at.lte.${before(30)}`)],
    ["payment_event_leases_stalled", () => count("stripe_webhook_events").eq("status", "processing")
      .lte("lease_expires_at", before(15))],
    ["receipts_terminal", () => count("giving_donations").eq("status", "succeeded")
      .not("donor_email", "is", null).eq("receipt_delivery_status", "terminal")
      .or("receipt_last_error_code.is.null,receipt_last_error_code.neq.emails_disabled")],
    ["receipts_pending_overdue", () => count("giving_donations").eq("status", "succeeded")
      .not("donor_email", "is", null).eq("receipt_delivery_status", "pending").lte("created_at", before(60))],
    ["receipts_retry_overdue", () => count("giving_donations").eq("status", "succeeded")
      .not("donor_email", "is", null).eq("receipt_delivery_status", "retryable")
      .or(`receipt_next_retry_at.is.null,receipt_next_retry_at.lte.${before(30)}`)],
    ["receipts_leases_stalled", () => count("giving_donations").eq("receipt_delivery_status", "sending")
      .lte("receipt_claimed_at", before(30))],
    ["notifications_failed", () => count("notification_outbox").eq("status", "failed")],
    ["notifications_overdue", () => count("notification_outbox").eq("status", "pending")
      .lte("next_attempt_at", before(15))],
    ["notification_leases_stalled", () => count("notification_outbox").eq("status", "claimed")
      .lte("lease_expires_at", before(15))],
    ["gift_cancellations_overdue", () => count("giving_recurring_cancellation_jobs").eq("status", "pending")
      .lte("next_attempt_at", before(120))],
    ["gift_cancellation_leases_stalled", () => count("giving_recurring_cancellation_jobs").eq("status", "processing")
      .lte("lease_expires_at", before(75))],
    ["account_deletions_failed", () => count("visitor_account_requests").eq("kind", "deletion").eq("status", "failed")],
    ["account_deletions_overdue", () => count("visitor_account_requests").eq("kind", "deletion").eq("status", "pending")
      .lte("requested_at", before(24 * 60))],
    ["account_deletion_leases_stalled", () => count("visitor_account_requests").eq("kind", "deletion").eq("status", "processing")
      .lte("started_at", before(75))],
    ["messaging_failed", () => count("messaging_sync_jobs").eq("status", "failed")],
    ["messaging_overdue", () => count("messaging_sync_jobs").eq("status", "pending")
      .lte("next_attempt_at", before(15))],
    ["messaging_leases_stalled", () => count("messaging_sync_jobs").eq("status", "running")
      .lte("lease_expires_at", before(15))],
    ["stream_preparation_stalled", () => count("stream_sessions").eq("status", "preparing")
      .lte("created_at", before(15))],
  ] as const;

  const checks = await Promise.all(probes.map(async ([name, query]): Promise<OperationsCheck> => {
    try {
      const result = await query();
      if (result.error || !Number.isInteger(result.count) || result.count! < 0) {
        return { name, count: null, ok: false };
      }
      return { name, count: result.count, ok: result.count === 0 };
    } catch {
      return { name, count: null, ok: false };
    }
  }));
  return { ok: checks.every(check => check.ok), checkedAt: now.toISOString(), checks };
}
