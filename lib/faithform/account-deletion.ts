import type { SupabaseClient } from "@supabase/supabase-js";

import { isBootstrapSuperAdminEmail } from "@/lib/auth/superadmin-emails";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Carries out the account deletions people ask for in the app.
 *
 * `requestAccountAction` (account-lifecycle.ts) records the request and stops
 * the account working at once. This file is the other half: the cron at
 * `/api/webhooks/accounts/deletion` calls `runAccountDeletions`, which finds
 * every request still waiting and finishes it. Apple (guideline 5.1.1(v)) and
 * Google Play both require that the deletion then really happens, and
 * /account-deletion promises it within 30 days; in practice it is the next
 * hourly run.
 *
 * ## The deletion is one Auth call, on purpose
 *
 * Deleting the person's Supabase Auth user removes their email and password,
 * and the database does the rest in the same transaction:
 * `visitor_accounts.user_id` cascades from `auth.users`, and every table that
 * references an account already says whether it is the account's own data
 * (`on delete cascade`: relationships, claims, People links, devices and their
 * push tokens, notification preferences, check-in detections, donor links and
 * donation attempts) or a church's record that outlives it (`on delete set
 * null`: attendance attempts, QR redemptions, the People link audit, invitation
 * acceptances, children's check-in). Migration 0073 moved the request row
 * itself to the second group, so the record that deletion was asked for and
 * done is kept, with nothing on it that points at a person.
 *
 * Nothing here deletes table by table. A list of deletes would be a second
 * copy of that classification, and the first new table it forgot would be
 * personal data left behind after we told someone it was gone.
 * `tests/policies/account-deletion-migration.test.ts` pins the classification
 * so that a future table has to choose a side.
 *
 * ## Why a church staff member keeps their sign-in
 *
 * The app and the church dashboard share one Supabase Auth user. A pastor who
 * tries the app and then deletes their app account still signs in to
 * /dashboard with that same email and password, and `church_users` and
 * `platform_admins` both cascade from `auth.users`. Deleting the Auth user
 * would silently remove them from their church, and if they were its only
 * admin, lock the church out of its own FaithForm with no one left to let
 * them back in.
 *
 * The rule is wider than current staff, because `auth.users` cascades into
 * church records too: `sermons.created_by` and `dashboard_usage_daily.user_id`.
 * Someone removed from a church's team keeps their sign-in and still authored
 * that church's sermons; deleting it would delete the sermons. So the rule is:
 * if deleting the Auth user would delete anything besides the app account
 * (`SIGN_IN_DEPENDENTS`, pinned against the migrations by
 * `tests/policies/account-deletion-migration.test.ts`), keep it.
 *
 * For those people the job deletes the `visitor_accounts` row instead. The
 * same foreign keys remove exactly the same app data, the sign-in survives,
 * and the request records `staff_account_retained` so the difference is
 * visible afterwards. If they open the app again, they start a new, empty
 * account.
 *
 * The check fails closed. `isPlatformAdminUserId` in lib/auth/superadmin.ts
 * treats a lookup error as "not an admin", which is right for a gate and wrong
 * here: an error must never be the reason a church loses its administrator or
 * its sermons. A failed lookup fails the attempt, and the next run asks again.
 *
 * ## Why the cron does this, and the request route does not
 *
 * Processing inside `POST /api/mobile/v1/account/requests` would delete the
 * Auth user in the middle of the phone's own request: the response it is
 * waiting for would describe an account that no longer exists, and a staff
 * member's next bootstrap would quietly create a fresh account while the app
 * still believed it was mid-deletion. The account already stops working the
 * moment the request is recorded, so waiting for the next run costs nothing
 * the person can notice. And the cron is the one path with retries, so there
 * is exactly one way a deletion happens and one way it fails.
 *
 * There is no grace period, because nothing in the product can cancel a
 * deletion request. If one is ever added, it belongs in `listDueRequests`.
 *
 * ## Logs
 *
 * Request ids, outcomes, counts and error codes only. Never an email, a user
 * id, an account id, or a provider's error message: a PostgREST or GoTrue
 * message can quote the row it failed on.
 */

export type DeletionOutcome =
  | "auth_user_deleted"
  | "staff_account_retained"
  | "account_already_removed";

/** Bounded so one run stays inside the function's time budget. */
export const DEFAULT_DELETION_BATCH = 25;
export const MAX_DELETION_BATCH = 100;

/**
 * A request left `processing` this long is from a run that died part way
 * through, and may be picked up again. Every step is safe to repeat.
 */
export const DELETION_LEASE_MS = 10 * 60 * 1000;

/**
 * Hourly retries for about a day. A deletion still failing after that is a bug
 * or a lasting outage, not bad luck: the request is marked `failed` and logged
 * as needing a person, well inside the 30 days /account-deletion promises.
 * Setting it back to `pending` retries it.
 */
export const MAX_DELETION_ATTEMPTS = 24;

type RequestStatus = "pending" | "processing";

export type DueDeletionRequest = {
  id: string;
  account_id: string | null;
  status: RequestStatus;
  attempts: number;
  started_at: string | null;
  requested_at: string;
  outcome: DeletionOutcome | null;
};

const REQUEST_COLUMNS = "id, account_id, status, attempts, started_at, requested_at, outcome";

export type DeletionLogger = {
  info: (message: string, fields: Record<string, unknown>) => void;
  error: (message: string, fields: Record<string, unknown>) => void;
};

const consoleLogger: DeletionLogger = {
  info: (message, fields) => console.info(message, fields),
  error: (message, fields) => console.error(message, fields),
};

export type AccountDeletionRunOptions = {
  client?: SupabaseClient;
  limit?: number;
  now?: () => Date;
  logger?: DeletionLogger;
};

export type AccountDeletionRunResult = {
  due: number;
  authUserDeleted: number;
  staffAccountRetained: number;
  alreadyRemoved: number;
  retrying: number;
  failed: number;
  skipped: number;
};

/**
 * A failure, named by the step and the provider's code. Never the provider's
 * message, which is left behind here on purpose.
 */
export class DeletionStepError extends Error {
  constructor(
    readonly step: string,
    readonly code: string,
  ) {
    super(`${step}:${code}`);
    this.name = "DeletionStepError";
  }
}

function codeOf(error: unknown): string {
  if (error && typeof error === "object") {
    const { code, status } = error as { code?: unknown; status?: unknown };
    if (typeof code === "string" && code.length > 0) {
      return code.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 40) || "unknown";
    }
    if (typeof status === "number") return `status_${status}`;
  }
  return "unknown";
}

function failure(step: string, error: unknown): DeletionStepError {
  return new DeletionStepError(step, codeOf(error));
}

/**
 * What is stored in `last_error` and logged. Built from the step and code, not
 * read from `.message`, so an error thrown from somewhere unexpected (a network
 * failure, a bug) cannot put its own text there.
 */
function describeFailure(error: unknown): string {
  return error instanceof DeletionStepError
    ? `${error.step}:${error.code}`
    : `unexpected:${codeOf(error)}`;
}

function isNotFound(error: unknown): boolean {
  const { code, status } = (error ?? {}) as { code?: unknown; status?: unknown };
  return status === 404 || code === "user_not_found";
}

// ---------------------------------------------------------------------------
// Finding and claiming work
// ---------------------------------------------------------------------------

/**
 * Every deletion request with work left: all `pending` ones, and `processing`
 * ones whose run has evidently died.
 *
 * Never-attempted requests first, then the least recently attempted, so one
 * request that keeps failing cannot hold the rest of the queue behind it.
 */
export async function listDueRequests(
  admin: SupabaseClient,
  now: Date,
  limit: number,
): Promise<DueDeletionRequest[]> {
  const pending = await admin
    .from("visitor_account_requests")
    .select(REQUEST_COLUMNS)
    .eq("kind", "deletion")
    .eq("status", "pending")
    .order("started_at", { ascending: true, nullsFirst: true })
    .order("requested_at", { ascending: true })
    .limit(limit);
  if (pending.error) throw failure("list_pending", pending.error);

  const staleBefore = new Date(now.getTime() - DELETION_LEASE_MS).toISOString();
  const stalled = await admin
    .from("visitor_account_requests")
    .select(REQUEST_COLUMNS)
    .eq("kind", "deletion")
    .eq("status", "processing")
    .lt("started_at", staleBefore)
    .order("started_at", { ascending: true })
    .limit(limit);
  if (stalled.error) throw failure("list_stalled", stalled.error);

  const rows = [
    ...((pending.data ?? []) as DueDeletionRequest[]),
    ...((stalled.data ?? []) as DueDeletionRequest[]),
  ];
  return rows
    .sort(
      (a, b) =>
        (a.started_at ?? "").localeCompare(b.started_at ?? "") ||
        a.requested_at.localeCompare(b.requested_at),
    )
    .slice(0, limit);
}

/**
 * Takes a request for this run, or reports that another run already did.
 *
 * The update only matches the row as it was read (same status, same attempt
 * count), so two overlapping runs (a slow hour, or someone invoking the route
 * by hand) cannot both work the same request.
 */
async function claimRequest(
  admin: SupabaseClient,
  request: DueDeletionRequest,
  now: Date,
): Promise<boolean> {
  const { data, error } = await admin
    .from("visitor_account_requests")
    .update({
      status: "processing",
      started_at: now.toISOString(),
      attempts: request.attempts + 1,
    })
    .eq("id", request.id)
    .eq("status", request.status)
    .eq("attempts", request.attempts)
    .select("id");
  if (error) throw failure("claim", error);
  return (data ?? []).length === 1;
}

// ---------------------------------------------------------------------------
// Who the sign-in belongs to
// ---------------------------------------------------------------------------

/**
 * Every table that `on delete cascade`s from `auth.users`, other than
 * `visitor_accounts` itself. A row in any of them means deleting the Auth user
 * would delete more than the app account: dashboard access (`church_users`,
 * `platform_admins`) or a church's own records (`sermons`,
 * `dashboard_usage_daily`).
 *
 * The policy test derives the real list from the migrations and fails if this
 * one falls behind, so a future table that cascades from `auth.users` cannot
 * be deleted by this job without someone deciding it should be.
 */
export const SIGN_IN_DEPENDENTS = [
  { table: "church_users", column: "user_id" },
  { table: "platform_admins", column: "user_id" },
  { table: "sermons", column: "created_by" },
  { table: "dashboard_usage_daily", column: "user_id" },
] as const;

type SignInIdentity = {
  /** Still present in Supabase Auth. */
  exists: boolean;
  /** Deleting it would take dashboard access or church records with it. */
  hasStaffAccess: boolean;
};

/**
 * Whether this Auth user may be deleted.
 *
 * A row in any `SIGN_IN_DEPENDENTS` table, or a bootstrap super-admin address
 * (named in code, not in a table), keeps it. Every lookup error throws (see
 * the file header).
 */
export async function inspectSignInIdentity(
  admin: SupabaseClient,
  userId: string,
): Promise<SignInIdentity> {
  let hasStaffAccess = false;

  for (const dependent of SIGN_IN_DEPENDENTS) {
    const { data, error } = await admin
      .from(dependent.table)
      .select(dependent.column)
      .eq(dependent.column, userId)
      .limit(1);
    if (error) throw failure(`dependents_${dependent.table}`, error);
    if ((data ?? []).length > 0) {
      hasStaffAccess = true;
      break;
    }
  }

  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error) {
    if (isNotFound(error)) {
      return { exists: false, hasStaffAccess };
    }
    throw failure("auth_lookup", error);
  }

  return {
    exists: Boolean(data.user),
    hasStaffAccess: hasStaffAccess || isBootstrapSuperAdminEmail(data.user?.email),
  };
}

// ---------------------------------------------------------------------------
// One request
// ---------------------------------------------------------------------------

/**
 * A church's People audit should say why a person's app link disappeared,
 * rather than show a link one day and nothing the next. Written before the
 * link rows go, and only for links not already recorded, so a retried run
 * does not write the same event twice. `account_id` on the event is nulled by
 * the same cascade that removes the link; the member it names is the
 * church's own record.
 */
async function recordLinkRevocations(
  admin: SupabaseClient,
  accountId: string,
): Promise<void> {
  const links = await admin
    .from("visitor_people_links")
    .select("id, church_id, member_id")
    .eq("account_id", accountId)
    .eq("is_active", true);
  if (links.error) throw failure("links_read", links.error);

  const active = (links.data ?? []) as { id: string; church_id: string; member_id: string }[];
  if (active.length === 0) return;

  const recorded = await admin
    .from("visitor_people_link_events")
    .select("link_id")
    .eq("action", "link_revoked_account_deleted")
    .in(
      "link_id",
      active.map((link) => link.id),
    );
  if (recorded.error) throw failure("link_events_read", recorded.error);

  const already = new Set(
    ((recorded.data ?? []) as { link_id: string | null }[]).map((row) => row.link_id),
  );
  const events = active
    .filter((link) => !already.has(link.id))
    .map((link) => ({
      church_id: link.church_id,
      account_id: accountId,
      link_id: link.id,
      member_id: link.member_id,
      action: "link_revoked_account_deleted",
      from_status: "active",
      to_status: "revoked",
      actor_type: "system",
    }));
  if (events.length === 0) return;

  const { error } = await admin.from("visitor_people_link_events").insert(events);
  if (error) throw failure("link_events_write", error);
}

/**
 * Export requests outlive the account too, so they must not carry a copy of
 * it. Nothing writes `payload` today; this keeps that true for a row that no
 * longer belongs to anyone, and closes an export nobody can now collect.
 */
async function closeExportRequests(
  admin: SupabaseClient,
  accountId: string,
): Promise<void> {
  const scrubbed = await admin
    .from("visitor_account_requests")
    .update({ payload: null })
    .eq("account_id", accountId)
    .eq("kind", "export");
  if (scrubbed.error) throw failure("exports_scrub", scrubbed.error);

  const cancelled = await admin
    .from("visitor_account_requests")
    .update({ status: "cancelled" })
    .eq("account_id", accountId)
    .eq("kind", "export")
    .in("status", ["pending", "processing"]);
  if (cancelled.error) throw failure("exports_cancel", cancelled.error);
}

/**
 * Written before the step it describes, so that a run which deletes the
 * account and then dies before recording completion leaves the answer behind.
 * Once the account is gone, the next run can no longer ask whether it was
 * staff; it reads this instead.
 */
async function recordOutcome(
  admin: SupabaseClient,
  requestId: string,
  outcome: DeletionOutcome,
): Promise<void> {
  const { error } = await admin
    .from("visitor_account_requests")
    .update({ outcome })
    .eq("id", requestId);
  if (error) throw failure("outcome_write", error);
}

async function deleteVisitorAccountRow(
  admin: SupabaseClient,
  accountId: string,
): Promise<void> {
  // A staff member's own claim and link events name their sign-in as the
  // actor. The account row's cascade does not reach that column, and the Auth
  // user is staying, so it is cleared here.
  const actor = await admin
    .from("visitor_people_link_events")
    .update({ actor_user_id: null })
    .eq("account_id", accountId)
    .eq("actor_type", "visitor");
  if (actor.error) throw failure("link_events_actor", actor.error);

  const { error } = await admin.from("visitor_accounts").delete().eq("id", accountId);
  if (error) throw failure("account_delete", error);
}

async function deleteAuthUser(admin: SupabaseClient, userId: string): Promise<void> {
  // A hard delete. A soft delete keeps the row in auth.users, which would keep
  // the email address and fire none of the cascades above.
  const { error } = await admin.auth.admin.deleteUser(userId, false);
  if (error && !isNotFound(error)) throw failure("auth_delete", error);
}

async function markCompleted(
  admin: SupabaseClient,
  requestId: string,
  now: Date,
): Promise<boolean> {
  const { data, error } = await admin
    .from("visitor_account_requests")
    .update({ status: "completed", completed_at: now.toISOString(), last_error: null })
    .eq("id", requestId)
    .eq("status", "processing")
    .select("id");
  if (error) throw failure("complete", error);
  return (data ?? []).length === 1;
}

/**
 * Finishes one claimed request. Safe to call again for the same request at any
 * point: every step either finds its work already done or does it again with
 * the same result.
 */
export async function processDeletionRequest(
  admin: SupabaseClient,
  request: DueDeletionRequest,
  now: Date,
): Promise<{ outcome: DeletionOutcome; recorded: boolean }> {
  const account = request.account_id
    ? await admin
        .from("visitor_accounts")
        .select("id, user_id")
        .eq("id", request.account_id)
        .maybeSingle()
    : { data: null, error: null };
  if (account.error) throw failure("account_read", account.error);

  if (!account.data) {
    // Already gone: an earlier run deleted it and stopped before recording
    // completion, or someone deleted the user by hand in Supabase. Either way
    // the cascade has already done the work, and all that is left is to say
    // so, using the earlier run's own answer if it left one.
    const outcome = request.outcome ?? "account_already_removed";
    if (!request.outcome) await recordOutcome(admin, request.id, outcome);
    return { outcome, recorded: await markCompleted(admin, request.id, now) };
  }

  const accountId = account.data.id as string;
  const userId = account.data.user_id as string;

  const identity = await inspectSignInIdentity(admin, userId);
  const outcome: DeletionOutcome = identity.hasStaffAccess
    ? "staff_account_retained"
    : "auth_user_deleted";
  await recordOutcome(admin, request.id, outcome);

  await closeExportRequests(admin, accountId);
  await recordLinkRevocations(admin, accountId);

  if (identity.hasStaffAccess || !identity.exists) {
    // Staff keep their sign-in (see the file header). An Auth user that is
    // already gone cannot be the thing that cascades, so the row is removed
    // directly; the foreign keys do the same work either way.
    await deleteVisitorAccountRow(admin, accountId);
  } else {
    await deleteAuthUser(admin, userId);
  }

  // `false` only if the request is no longer this run's to complete (an
  // overlapping run finished it first). The account is deleted either way; the
  // run logs it so the odd case is visible.
  //
  // A database without migration 0073 never gets this far: the outcome write
  // above fails on the missing column, so nothing is deleted, rather than the
  // Auth delete cascading away the request row that records it.
  return { outcome, recorded: await markCompleted(admin, request.id, now) };
}

/**
 * A failed attempt goes back in the queue or, after MAX_DELETION_ATTEMPTS, is
 * marked `failed` for a person to look at. Only the step and code are
 * stored.
 */
async function recordFailure(
  admin: SupabaseClient,
  requestId: string,
  attempts: number,
  description: string,
): Promise<"retrying" | "failed"> {
  const terminal = attempts >= MAX_DELETION_ATTEMPTS;

  await admin
    .from("visitor_account_requests")
    .update({ status: terminal ? "failed" : "pending", last_error: description.slice(0, 200) })
    .eq("id", requestId)
    .eq("status", "processing");
  // If even this write fails, the request stays `processing` and its lease
  // expiring puts it back in the queue: the same outcome, an hour later.

  return terminal ? "failed" : "retrying";
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/**
 * One cron invocation. Each request is claimed and processed on its own, and a
 * failure is recorded against that request alone: one account that cannot be
 * deleted never stops the others behind it.
 */
export async function runAccountDeletions(
  options: AccountDeletionRunOptions = {},
): Promise<AccountDeletionRunResult> {
  const admin = options.client ?? createAdminClient();
  const clock = options.now ?? (() => new Date());
  const logger = options.logger ?? consoleLogger;
  const limit = Math.min(
    Math.max(Math.trunc(options.limit ?? DEFAULT_DELETION_BATCH), 1),
    MAX_DELETION_BATCH,
  );

  const due = await listDueRequests(admin, clock(), limit);
  const result: AccountDeletionRunResult = {
    due: due.length,
    authUserDeleted: 0,
    staffAccountRetained: 0,
    alreadyRemoved: 0,
    retrying: 0,
    failed: 0,
    skipped: 0,
  };

  for (const request of due) {
    const attempt = request.attempts + 1;
    let claimed = false;

    try {
      claimed = await claimRequest(admin, request, clock());
      if (!claimed) {
        result.skipped += 1;
        continue;
      }

      const { outcome, recorded } = await processDeletionRequest(
        admin,
        { ...request, status: "processing", attempts: attempt },
        clock(),
      );

      if (outcome === "auth_user_deleted") result.authUserDeleted += 1;
      else if (outcome === "staff_account_retained") result.staffAccountRetained += 1;
      else result.alreadyRemoved += 1;

      logger.info("[account-deletion] completed", {
        requestId: request.id,
        outcome,
        attempt,
        ...(recorded ? {} : { requestRecord: "completed_elsewhere" }),
      });
    } catch (error) {
      const code = describeFailure(error);

      if (!claimed) {
        // Never claimed, so nothing was changed and nothing needs recording;
        // the next run sees the request exactly as this one did.
        result.skipped += 1;
        logger.error("[account-deletion] could not claim request", {
          requestId: request.id,
          error: code,
        });
        continue;
      }

      const state = await recordFailure(admin, request.id, attempt, code).catch(
        () => "retrying" as const,
      );
      result[state] += 1;

      logger.error(
        state === "failed"
          ? "[account-deletion] request needs a person: retries exhausted"
          : "[account-deletion] attempt failed; will retry",
        { requestId: request.id, attempt, error: code },
      );
    }
  }

  return result;
}
