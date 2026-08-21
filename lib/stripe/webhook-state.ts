import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

export type StripeEventClaim = {
  claimed: boolean;
  claimToken: string | null;
  attempt: number;
  status: "processing" | "processed" | "retryable" | "terminal";
};

export async function claimStripeEvent(
  eventId: string,
  eventType: string,
  client: SupabaseClient = createAdminClient(),
): Promise<StripeEventClaim> {
  const { data, error } = await client.rpc("claim_stripe_webhook_event", {
    p_event_id: eventId,
    p_event_type: eventType,
    p_lease_seconds: 300,
  });
  if (error || !data?.[0]) throw new Error("stripe_event_claim_failed");
  const row = data[0] as {
    claimed: boolean;
    claim_token: string | null;
    attempt: number;
    event_status: StripeEventClaim["status"];
  };
  return {
    claimed: row.claimed,
    claimToken: row.claim_token,
    attempt: row.attempt,
    status: row.event_status,
  };
}

export async function completeStripeEvent(
  input: {
    eventId: string;
    claimToken: string;
    status: "processed" | "retryable" | "terminal";
    failureCategory?: string | null;
    errorCode?: string | null;
    nextRetryAt?: string | null;
  },
  client: SupabaseClient = createAdminClient(),
): Promise<void> {
  const { data, error } = await client.rpc("complete_stripe_webhook_event", {
    p_event_id: input.eventId,
    p_claim_token: input.claimToken,
    p_status: input.status,
    p_failure_category: input.failureCategory ?? null,
    p_error_code: input.errorCode ?? null,
    p_next_retry_at: input.nextRetryAt ?? null,
  });
  if (error || data !== true) throw new Error("stripe_event_completion_failed");
}

export function stripeRetryAt(attempt: number, now = Date.now()): string {
  const delayMs = Math.min(60_000 * 2 ** Math.max(0, attempt - 1), 60 * 60 * 1000);
  return new Date(now + delayMs).toISOString();
}

export function safeStripeFailure(error: unknown): {
  category: string;
  code: string;
} {
  if (error instanceof Error) {
    return {
      category: "handler",
      code: error.name.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80) || "Error",
    };
  }
  return { category: "handler", code: "UnknownError" };
}
