import { createHash, randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  ApnsAdapter,
  FcmAdapter,
  type DeliveryResult,
  type PushAdapter,
  type PushMessage,
} from "@/lib/faithform/push/adapters";
import { invalidateToken } from "@/lib/faithform/push/installations";

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
      deep_link: `faithform://church/${input.churchSlug}/announcements`,
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
  churchId: string,
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
    // The id arrives from a request; only this church's queue is touched.
    .eq("church_id", churchId)
    .eq("subject_id", announcementId)
    .in("status", ["pending", "claimed"]);
}

type OutboxJob = {
  id: string;
  church_id: string;
  /** `announcement` unless a livestream or recording enqueued it (P15), or a group (P14). */
  subject_type?:
    | "announcement"
    | "stream_event"
    | "stream_recording"
    | "group_join_request"
    | "group_event";
  kind?: string;
  subject_id: string;
  target_visibility: "public" | "followers" | "members";
  /** Named recipients (P14 group notifications); null for a broadcast. */
  target_account_ids?: string[] | null;
  topic: "announcements" | "events" | "groups";
  title: string;
  body: string | null;
  deep_link: string;
  collapse_key: string;
  correlation_id: string;
  subject_version: number;
  attempts: number;
};

type PushRecipient = {
  installationId: string;
  provider: "apns" | "fcm";
  token: string;
  apnsEnvironment: "development" | "production" | null;
};

/**
 * An `.in(...)` list travels in the request URL, and 5,000 ids is ~185 KB of
 * it — past what the gateway accepts. Asked in slices, and any slice that fails
 * fails the whole lookup, so the job retries rather than going out to a partial
 * or unfiltered audience.
 */
const AUDIENCE_CHUNK = 200;

/**
 * Every row up to `max`, a page at a time. The hosted API returns at most
 * 1,000 rows per request whatever `.limit()` asks for, so a single read
 * silently stopped at 1,000 followers — and at 1,000 devices already reached,
 * after which a retry sent the rest the same push again.
 */
const PAGE_SIZE = 1000;

async function pagedRows(
  query: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: Record<string, unknown>[] | null; error: unknown }>,
  max: number,
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; from < max; from += PAGE_SIZE) {
    const { data, error } = await query(from, Math.min(from + PAGE_SIZE, max) - 1);
    if (error) throw new Error("push_audience_unavailable");
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE_SIZE) break;
  }
  return rows;
}

async function inChunks(
  ids: string[],
  query: (
    ids: string[],
  ) => PromiseLike<{ data: Record<string, unknown>[] | null; error: unknown }>,
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  for (let start = 0; start < ids.length; start += AUDIENCE_CHUNK) {
    const { data, error } = await query(ids.slice(start, start + AUDIENCE_CHUNK));
    if (error) throw new Error("push_audience_unavailable");
    rows.push(...(data ?? []));
  }
  return rows;
}

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
): Promise<PushRecipient[]> {
  if (job.target_account_ids && job.target_account_ids.length > 0) {
    return resolveTargetedRecipients(admin, job, job.target_account_ids);
  }

  const states =
    job.target_visibility === "members"
      ? ["joined"]
      : job.target_visibility === "followers"
        ? ["following", "joined"]
        : ["following", "joined"];

  const relationships = await pagedRows(
    (from, to) =>
      admin
        .from("visitor_church_relationships")
        .select("account_id")
        .eq("church_id", job.church_id)
        .in("state", states)
        .order("account_id")
        .range(from, to),
    5000,
  );
  const accountIds = relationships.map((row) => row.account_id as string);
  if (accountIds.length === 0) return [];

  // A preference row that says false removes the account. An absent row means
  // "not yet decided", which is the topic default (on). A failed read must not
  // read as "nobody opted out": that would notify people who said no.
  const optedOut = await inChunks(accountIds, (ids) =>
    admin
      .from("visitor_notification_preferences")
      .select("account_id")
      .eq("church_id", job.church_id)
      .eq("topic", job.topic)
      .eq("is_enabled", false)
      .in("account_id", ids),
  );

  const excluded = new Set(optedOut.map((row) => row.account_id as string));
  const eligible = accountIds.filter((id) => !excluded.has(id));
  if (eligible.length === 0) return [];

  const installations = await inChunks(eligible, (ids) =>
    admin
      .from("visitor_device_installations")
      .select("id, provider, provider_token, apns_environment")
      .in("account_id", ids)
      .eq("is_enabled", true)
      .is("invalidated_at", null)
      .limit(10000),
  );

  return (installations as Record<string, unknown>[])
    .filter((row) => Boolean(row.provider_token))
    .map((row) => ({
      installationId: row.id as string,
      provider: row.provider as "apns" | "fcm",
      token: row.provider_token as string,
      apnsEnvironment: row.apns_environment as PushRecipient["apnsEnvironment"],
    }));
}

/**
 * Named recipients (a group's leaders, one requester, the people who said
 * they were coming), re-checked now exactly as a broadcast is: the person
 * still has a usable relationship with the church, has not switched their
 * group messages off, and has a live installation.
 */
async function resolveTargetedRecipients(
  admin: SupabaseClient,
  job: OutboxJob,
  accountIds: string[],
): Promise<PushRecipient[]> {
  const [{ data: relationships, error: relationshipsError }, { data: switchedOff, error: switchedOffError }] = await Promise.all([
    admin
      .from("visitor_church_relationships")
      .select("account_id")
      .eq("church_id", job.church_id)
      .in("state", ["following", "pending", "joined"])
      .in("account_id", accountIds),
    admin
      .from("messaging_notification_preferences")
      .select("account_id")
      .eq("church_id", job.church_id)
      .eq("level", "off")
      .in("account_id", accountIds),
  ]);

  if (relationshipsError || switchedOffError) throw new Error("push_audience_unavailable");
  const off = new Set((switchedOff ?? []).map((row) => row.account_id as string));
  const eligible = (relationships ?? [])
    .map((row) => row.account_id as string)
    .filter((id) => !off.has(id));
  if (eligible.length === 0) return [];

  const { data: installations, error: installationsError } = await admin
    .from("visitor_device_installations")
    .select("id, provider, provider_token, apns_environment")
    .in("account_id", eligible)
    .eq("is_enabled", true)
    .is("invalidated_at", null)
    .limit(1000);
  if (installationsError) throw new Error("push_audience_unavailable");

  return ((installations ?? []) as Record<string, unknown>[])
    .filter((row) => Boolean(row.provider_token))
    .map((row) => ({
      installationId: row.id as string,
      provider: row.provider as "apns" | "fcm",
      token: row.provider_token as string,
      apnsEnvironment: row.apns_environment as PushRecipient["apnsEnvironment"],
    }));
}

/** True when the subject is still publishable at the version we enqueued. */
async function subjectIsStillCurrent(
  admin: SupabaseClient,
  job: OutboxJob,
): Promise<boolean> {
  // "Maria asked to join…" only while the request is still waiting; "you're
  // in" only once it was approved.
  if (job.subject_type === "group_join_request") {
    const { data } = await admin
      .from("group_join_requests")
      .select("status")
      .eq("id", job.subject_id)
      .eq("church_id", job.church_id)
      .maybeSingle();
    if (!data) return false;
    return job.kind === "group_request_approved" ? data.status === "approved" : data.status === "pending";
  }

  // "Thursday's gathering is cancelled" only while it still is.
  if (job.subject_type === "group_event") {
    const { data } = await admin
      .from("group_events")
      .select("status")
      .eq("id", job.subject_id)
      .eq("church_id", job.church_id)
      .maybeSingle();
    return Boolean(data && data.status === "cancelled");
  }

  // "Sunday Worship is live now" is only worth sending while it is.
  if (job.subject_type === "stream_event") {
    const { data } = await admin
      .from("stream_events")
      .select("status, mobile_visibility, mobile_unpublished_at, mobile_revoked_at")
      .eq("id", job.subject_id)
      .eq("church_id", job.church_id)
      .maybeSingle();
    return Boolean(
      data &&
        data.status === "live" &&
        data.mobile_visibility !== "none" &&
        !data.mobile_unpublished_at &&
        !data.mobile_revoked_at,
    );
  }

  // "…is now available to watch" only while it is published and playable.
  if (job.subject_type === "stream_recording") {
    const { data } = await admin
      .from("stream_recordings")
      .select(
        "status, mobile_playable, mobile_visibility, mobile_published_at, mobile_unpublished_at, deleted_at",
      )
      .eq("id", job.subject_id)
      .eq("church_id", job.church_id)
      .maybeSingle();
    return Boolean(
      data &&
        data.status === "ready" &&
        data.mobile_playable &&
        data.mobile_visibility !== "none" &&
        data.mobile_published_at &&
        !data.mobile_unpublished_at &&
        !data.deleted_at,
    );
  }

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

/** More than any one church's audience; the ceiling on what one job reads. */
const MAX_DEVICES = 20_000;

/**
 * Hands a claimed job back for the next pass without spending the attempt its
 * claim counted. Only the lease holder can, as with completion.
 */
async function releaseUnspent(admin: SupabaseClient, job: OutboxJob, leaseToken: string): Promise<void> {
  const at = new Date().toISOString();
  await admin
    .from("notification_outbox")
    .update({
      status: "pending",
      lease_token: null,
      lease_expires_at: null,
      attempts: Math.max(0, Number(job.attempts) - 1),
      next_attempt_at: at,
      updated_at: at,
    })
    .eq("id", job.id)
    .eq("lease_token", leaseToken);
}

/** Leaves room inside the 60-second function for the last sends and the bookkeeping. */
const SEND_BUDGET_MS = 40_000;
const SEND_CONCURRENCY = 8;

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
  /** Stop starting sends after this long; the function itself is killed at 60 s. */
  budgetMs?: number;
  now?: () => number;
}): Promise<WorkerResult> {
  const admin = options?.client ?? createAdminClient();
  const now = options?.now ?? Date.now;
  const deadline = now() + (options?.budgetMs ?? SEND_BUDGET_MS);
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

    // Claimed but not reached in time: handed back now rather than left to
    // sit out its lease, and without spending one of its attempts.
    if (now() >= deadline) {
      await releaseUnspent(admin, raw, leaseToken);
      result.retried += 1;
      continue;
    }

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

    // Who already has this notification. Without it every retry — one device's
    // 503, or the function killed mid-list — sent the whole audience the same
    // push again, up to five times, and the end of the list never got it.
    let reached: Record<string, unknown>[];
    let recipients: PushRecipient[];
    try {
      reached = await pagedRows(
        (from, to) =>
          admin
            .from("notification_delivery_attempts")
            .select("installation_id")
            .eq("outbox_id", raw.id)
            .in("outcome", ["sent", "permanent"])
            .order("installation_id")
            .range(from, to),
        MAX_DEVICES,
      );
      recipients = await resolveRecipients(admin, raw);
    } catch {
      await admin.rpc("complete_notification_job", {
        p_id: raw.id,
        p_lease_token: leaseToken,
        p_outcome: "retryable",
        p_error_category: "audience_unavailable",
      });
      result.retried += 1;
      continue;
    }
    const done = new Set(reached.map((row) => row.installation_id as string | null));
    const pending = recipients.filter((recipient) => !done.has(recipient.installationId));

    const message: PushMessage = {
      title: raw.title,
      body: raw.body,
      deepLink: raw.deep_link,
      collapseKey: raw.collapse_key,
      correlationId: raw.correlation_id,
    };

    let anyRetryable = false;
    let outOfTime = false;

    const sendOne = async (recipient: PushRecipient) => {
      const adapter = adapters[recipient.provider];
      const outcome: DeliveryResult = await adapter.send(recipient.token, message, recipient.apnsEnvironment);

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
    };

    // A few at a time: one by one, a few hundred devices outran the function.
    for (let start = 0; start < pending.length; start += SEND_CONCURRENCY) {
      if (now() >= deadline) {
        outOfTime = true;
        break;
      }
      await Promise.all(pending.slice(start, start + SEND_CONCURRENCY).map(sendOne));
    }

    // A job is only retried when a provider asked us to, or time ran out. The
    // retry reaches only the devices this pass did not, so a permanent failure
    // against one device is never a reason to re-notify everyone else.
    const jobOutcome = anyRetryable || outOfTime ? "retryable" : "sent";
    if (outOfTime && !anyRetryable) {
      // Progress is kept in the attempt rows, so running out of time is not a
      // failure and must not count toward the job's five attempts: a
      // broadcast needing six passes would otherwise end `failed` part-sent.
      await releaseUnspent(admin, raw, leaseToken);
    } else {
      await admin.rpc("complete_notification_job", {
        p_id: raw.id,
        p_lease_token: leaseToken,
        p_outcome: jobOutcome,
        p_error_category: anyRetryable ? "provider_retryable" : null,
      });
    }

    if (jobOutcome === "retryable") result.retried += 1;
    else result.sent += 1;
  }

  return result;
}
