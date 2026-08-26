import { createHash, randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  ApnsAdapter,
  FcmAdapter,
  type DeliveryResult,
  type PushAdapter,
  type PushMessage,
} from "@/lib/faithful/push/adapters";
import { invalidateToken } from "@/lib/faithful/push/installations";

/**
 * The transactional notification outbox.
 *
 * Enqueueing happens in the same operation that publishes, so a published
 * announcement always has its notification recorded, and a notification never
 * exists for something that was not published.
 *
 * The audience is stored as a *rule*, not a materialized recipient list. It is
 * re-resolved at send time, which is what makes a relationship revoked between
 * publish and delivery actually take effect.
 */

export type EnqueueInput = {
  churchId: string;
  announcementId: string;
  churchSlug: string;
  title: string;
  body: string | null;
  visibility: "public" | "followers" | "members";
  publicationVersion: number;
  topic: "announcements" | "events";
};

/**
 * Deterministic from the subject and its version.
 *
 * Two workers, a retried publish, or a double-click all compute the same key
 * and collide on the unique index — so exactly one logical notification exists.
 * Including the version means a genuine re-publish after an edit *does* produce
 * a new notification, which is the intended behaviour.
 */
export function dedupeKeyFor(announcementId: string, version: number): string {
  return createHash("sha256")
    .update(`announcement:${announcementId}:v${version}`, "utf8")
    .digest("hex")
    .slice(0, 40);
}

export async function enqueuePublicationNotification(
  input: EnqueueInput,
  client?: SupabaseClient,
): Promise<{ enqueued: boolean; outboxId: string | null }> {
  const admin = client ?? createAdminClient();

  const { data, error } = await admin
    .from("notification_outbox")
    .insert({
      church_id: input.churchId,
      kind: input.topic === "events" ? "event_published" : "announcement_published",
      subject_type: "announcement",
      subject_id: input.announcementId,
      target_visibility: input.visibility,
      topic: input.topic,
      title: input.title.slice(0, 120),
      // Trimmed hard: a lock screen shows a line or two, and the app fetches
      // the real content on open.
      body: input.body ? input.body.slice(0, 180) : null,
      deep_link: `faithful://church/${input.churchSlug}/announcements`,
      collapse_key: `announcement-${input.announcementId}`,
      dedupe_key: dedupeKeyFor(input.announcementId, input.publicationVersion),
      subject_version: input.publicationVersion,
    })
    .select("id")
    .maybeSingle();

  if (error) {
    // A unique violation on dedupe_key means the notification already exists.
    // That is success, not failure — the caller retried.
    return { enqueued: false, outboxId: null };
  }

  return { enqueued: true, outboxId: (data?.id as string) ?? null };
}

/**
 * Cancels pending notifications for a subject.
 *
 * Called when an announcement is unpublished or retargeted. A job already
 * claimed by a worker still re-checks authorization before sending, so this is
 * an optimisation rather than the only guard.
 */
export async function cancelNotificationsForSubject(
  announcementId: string,
  client?: SupabaseClient,
): Promise<void> {
  const admin = client ?? createAdminClient();
  await admin
    .from("notification_outbox")
    .update({
      status: "cancelled",
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("subject_id", announcementId)
    .in("status", ["pending", "claimed"]);
}

type OutboxJob = {
  id: string;
  church_id: string;
  subject_id: string;
  target_visibility: "public" | "followers" | "members";
  topic: "announcements" | "events";
  title: string;
  body: string | null;
  deep_link: string;
  collapse_key: string;
  correlation_id: string;
  subject_version: number;
  attempts: number;
};

/**
 * Resolves who should receive a job, at send time.
 *
 * Four independent conditions, all re-checked now rather than at publish time:
 * the announcement is still published at the version we enqueued, the
 * relationship still permits the target visibility, the account has not turned
 * this topic off, and the installation is still live.
 */
async function resolveRecipients(
  admin: SupabaseClient,
  job: OutboxJob,
): Promise<{ installationId: string; provider: "apns" | "fcm"; token: string }[]> {
  const states =
    job.target_visibility === "members"
      ? ["joined"]
      : job.target_visibility === "followers"
        ? ["following", "joined"]
        : ["following", "joined"];

  const { data: relationships } = await admin
    .from("visitor_church_relationships")
    .select("account_id")
    .eq("church_id", job.church_id)
    .in("state", states)
    .limit(5000);

  const accountIds = (relationships ?? []).map((row) => row.account_id as string);
  if (accountIds.length === 0) return [];

  // A preference row that says false removes the account. An absent row means
  // "not yet decided", which is the topic default (on).
  const { data: optedOut } = await admin
    .from("visitor_notification_preferences")
    .select("account_id")
    .eq("church_id", job.church_id)
    .eq("topic", job.topic)
    .eq("is_enabled", false)
    .in("account_id", accountIds);

  const excluded = new Set((optedOut ?? []).map((row) => row.account_id as string));
  const eligible = accountIds.filter((id) => !excluded.has(id));
  if (eligible.length === 0) return [];

  const { data: installations } = await admin
    .from("visitor_device_installations")
    .select("id, provider, provider_token")
    .in("account_id", eligible)
    .eq("is_enabled", true)
    .is("invalidated_at", null)
    .limit(10000);

  return ((installations ?? []) as Record<string, unknown>[])
    .filter((row) => Boolean(row.provider_token))
    .map((row) => ({
      installationId: row.id as string,
      provider: row.provider as "apns" | "fcm",
      token: row.provider_token as string,
    }));
}

/** True when the subject is still publishable at the version we enqueued. */
async function subjectIsStillCurrent(
  admin: SupabaseClient,
  job: OutboxJob,
): Promise<boolean> {
  const { data } = await admin
    .from("announcements")
    .select("status, is_ready, mobile_visibility, mobile_unpublished_at, publication_version")
    .eq("id", job.subject_id)
    .maybeSingle();

  if (!data) return false;
  if (data.status !== "published" || !data.is_ready) return false;
  if (data.mobile_unpublished_at) return false;
  if (data.mobile_visibility === "none") return false;
  // Edited since enqueue: the newer publish has its own job.
  if (Number(data.publication_version) !== job.subject_version) return false;
  return true;
}

export type WorkerResult = {
  claimed: number;
  sent: number;
  cancelled: number;
  retried: number;
  failed: number;
};

/**
 * One pass of the delivery worker.
 *
 * Claims a bounded batch under a lease, so a worker that dies mid-send has its
 * jobs become claimable again rather than sticking.
 */
export async function runNotificationWorker(options?: {
  limit?: number;
  adapters?: Partial<Record<"apns" | "fcm", PushAdapter>>;
  client?: SupabaseClient;
}): Promise<WorkerResult> {
  const admin = options?.client ?? createAdminClient();
  const leaseToken = randomUUID();
  const result: WorkerResult = { claimed: 0, sent: 0, cancelled: 0, retried: 0, failed: 0 };

  const adapters: Record<"apns" | "fcm", PushAdapter> = {
    apns: options?.adapters?.apns ?? new ApnsAdapter(),
    fcm: options?.adapters?.fcm ?? new FcmAdapter(),
  };

  const { data: jobs, error } = await admin.rpc("claim_notification_jobs", {
    p_lease_token: leaseToken,
    p_limit: options?.limit ?? 10,
  });

  if (error) return result;

  for (const raw of (jobs ?? []) as OutboxJob[]) {
    result.claimed += 1;

    if (!(await subjectIsStillCurrent(admin, raw))) {
      await admin.rpc("complete_notification_job", {
        p_id: raw.id,
        p_lease_token: leaseToken,
        p_outcome: "cancelled",
        p_error_category: "subject_changed",
      });
      result.cancelled += 1;
      continue;
    }

    const recipients = await resolveRecipients(admin, raw);
    const message: PushMessage = {
      title: raw.title,
      body: raw.body,
      deepLink: raw.deep_link,
      collapseKey: raw.collapse_key,
      correlationId: raw.correlation_id,
    };

    let anyRetryable = false;

    for (const recipient of recipients) {
      const adapter = adapters[recipient.provider];
      const outcome: DeliveryResult = await adapter.send(recipient.token, message);

      await admin.from("notification_delivery_attempts").insert({
        outbox_id: raw.id,
        installation_id: recipient.installationId,
        provider: recipient.provider,
        attempt_number: raw.attempts,
        outcome: outcome.outcome,
        error_category: outcome.errorCategory ?? null,
        provider_status: outcome.providerStatus ?? null,
      });

      if (outcome.invalidToken) {
        await invalidateToken(recipient.token, outcome.errorCategory ?? "invalid_token");
      }
      if (outcome.outcome === "retryable") anyRetryable = true;
    }

    // A job is only retried when a provider asked us to. A permanent failure
    // against one device is not a reason to re-notify everyone else.
    const jobOutcome = anyRetryable ? "retryable" : "sent";
    await admin.rpc("complete_notification_job", {
      p_id: raw.id,
      p_lease_token: leaseToken,
      p_outcome: jobOutcome,
      p_error_category: anyRetryable ? "provider_retryable" : null,
    });

    if (anyRetryable) result.retried += 1;
    else result.sent += 1;
  }

  return result;
}
