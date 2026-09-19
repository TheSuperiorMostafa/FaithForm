import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { ChatProviderError, type ChatProvider } from "@/lib/messaging/provider";
import { getChatProvider } from "@/lib/messaging/stream-provider";
import { HANDLERS, type SyncJob } from "@/lib/messaging/sync/handlers";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The messaging outbox worker.
 *
 * Claims a bounded batch under a lease (`claim_messaging_sync_jobs`, FOR
 * UPDATE SKIP LOCKED), runs each job's reconciler, and completes it:
 *
 *   done       the provider now matches FaithForm
 *   retry      the provider was unavailable, rate-limited, or refused our
 *              credentials — back off (15 s doubling, capped at an hour)
 *   failed     the job itself is malformed, or ran out of attempts — left for
 *              a person, visible on the Groups settings page
 *
 * Two entry points share this: the scheduled route drains whatever is due,
 * and request handlers call `syncNow` for the subjects they just changed, so a
 * person who joins a group sees its conversation before the response returns.
 * Either failing leaves the job queued for the other.
 *
 * Logs are structured and content-free: a job's kind, outcome and counts, and
 * the job's own id. Never a person, a token, or a message.
 */

export type SyncRunResult = {
  configured: boolean;
  claimed: number;
  done: number;
  retried: number;
  failed: number;
  durationMs: number;
};

type Outcome = "done" | "retry" | "failed";

function classify(error: unknown): { outcome: Outcome; category: string } {
  if (error instanceof ChatProviderError) {
    // Credentials refused: retrying cannot help until an operator fixes them,
    // but it must not be lost either — the backoff carries it to the cap.
    if (error.category === "invalid") return { outcome: "failed", category: "provider_invalid" };
    return { outcome: "retry", category: `provider_${error.category}` };
  }
  if (error instanceof Error && error.message === "malformed subject") {
    return { outcome: "failed", category: "malformed_subject" };
  }
  return { outcome: "retry", category: "internal" };
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ChatProviderError("unavailable", "timed out")), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function runMessagingSync(options: {
  limit?: number;
  dedupeKeys?: string[];
  /** Stop claiming new work after this many milliseconds. */
  budgetMs?: number;
  provider?: ChatProvider | null;
  client?: SupabaseClient;
  now?: () => Date;
} = {}): Promise<SyncRunResult> {
  const started = Date.now();
  const provider = options.provider === undefined ? getChatProvider() : options.provider;
  const result: SyncRunResult = { configured: Boolean(provider), claimed: 0, done: 0, retried: 0, failed: 0, durationMs: 0 };
  // Unconfigured: jobs stay queued, untouched, until credentials exist. A
  // claim here would only burn attempts against a provider that is not there.
  if (!provider) return result;

  const admin = options.client ?? createAdminClient();
  const budget = options.budgetMs ?? 45_000;
  const lease = randomUUID();
  const now = options.now ?? (() => new Date());

  const { data: jobs, error } = await admin.rpc("claim_messaging_sync_jobs", {
    p_lease_token: lease,
    p_limit: Math.min(Math.max(options.limit ?? 25, 1), 100),
    p_lease_seconds: 120,
    p_dedupe_keys: options.dedupeKeys?.length ? options.dedupeKeys : null,
  });
  if (error) {
    console.error("[messaging] claim failed");
    return { ...result, durationMs: Date.now() - started };
  }

  const enqueue = async (
    churchId: string | null,
    kind: string,
    subject: string,
    payload: Record<string, unknown> = {},
    delaySeconds = 0,
  ) => {
    await admin.rpc("enqueue_messaging_sync", {
      p_church_id: churchId,
      p_kind: kind,
      p_subject: subject,
      p_payload: payload,
      p_delay_seconds: delaySeconds,
    });
  };

  for (const job of (jobs ?? []) as SyncJob[]) {
    result.claimed += 1;
    const jobStarted = Date.now();
    let outcome: Outcome = "done";
    let category: string | null = null;
    let detail: Record<string, number> | undefined;

    if (Date.now() - started > budget) {
      // Out of time: hand it straight back rather than letting the lease run.
      outcome = "retry";
      category = "budget_exhausted";
    } else {
      const handler = HANDLERS[job.kind];
      if (!handler) {
        outcome = "failed";
        category = "unknown_kind";
      } else {
        try {
          const handled = await withTimeout(
            handler({ admin, provider, now: now(), enqueue }, job),
            20_000,
          );
          detail = handled.detail;
        } catch (caught) {
          ({ outcome, category } = classify(caught));
        }
      }
    }

    await admin.rpc("complete_messaging_sync_job", {
      p_id: job.id,
      p_lease_token: lease,
      p_outcome: outcome,
      p_error: category,
    });

    if (outcome === "done") result.done += 1;
    else if (outcome === "retry") result.retried += 1;
    else result.failed += 1;

    const line = {
      job: job.id,
      kind: job.kind,
      outcome,
      attempt: job.attempts,
      ms: Date.now() - jobStarted,
      ...(category ? { reason: category } : {}),
      ...(detail ?? {}),
    };
    if (outcome === "done") console.info("[messaging] reconciled", JSON.stringify(line));
    else console.warn("[messaging] reconcile deferred", JSON.stringify(line));
  }

  result.durationMs = Date.now() - started;
  return result;
}

/**
 * Reconciles specific subjects now, best effort. Never throws: the outbox row
 * already exists, so a failure here only means the scheduled worker finishes
 * the job instead.
 */
export async function syncNow(dedupeKeys: string[], options: { budgetMs?: number } = {}): Promise<void> {
  if (dedupeKeys.length === 0) return;
  try {
    await runMessagingSync({ dedupeKeys, limit: dedupeKeys.length * 2, budgetMs: options.budgetMs ?? 6_000 });
  } catch {
    // The queued job is the record of what must happen; the scheduled worker
    // will run it. Said out loud so an inline failure is still visible.
    console.warn("[messaging] inline reconcile deferred to the scheduled worker");
  }
}

export function dedupeKey(kind: string, subject: string): string {
  return `${kind}:${subject}`;
}
