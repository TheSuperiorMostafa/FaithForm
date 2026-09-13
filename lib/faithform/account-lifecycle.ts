import { createAdminClient } from "@/lib/supabase/admin";
import { VisitorError } from "@/lib/faithform/errors";
import { bumpAuthorizationVersion, requireActiveAccount, getVisitorAccount } from "@/lib/faithform/account";
import { accountRequestSchema } from "@/lib/faithform/schemas";
import { retireInstallationsForAccount } from "@/lib/faithform/push/installations";

/**
 * Export and deletion.
 *
 * The rule that shapes all of this: an account owns its *relationship* to a
 * church, not the church's record of a person. Deleting an account withdraws
 * the claim to be someone; it never deletes the `members` row, the attendance
 * that references it, or any financial history. Those belong to the church.
 *
 * This file records requests; `account-deletion.ts` carries deletions out.
 * What is deleted and what is kept is stated publicly on /account-deletion,
 * and the two must stay in step.
 */

export type AccountRequest = {
  id: string;
  kind: "export" | "deletion";
  status: "pending" | "processing" | "completed" | "failed" | "cancelled";
  requestedAt: string;
  completedAt: string | null;
};

const REQUEST_COLUMNS = "id, kind, status, requested_at, completed_at";

function mapRequest(row: Record<string, unknown>): AccountRequest {
  return {
    id: row.id as string,
    kind: row.kind as AccountRequest["kind"],
    status: row.status as AccountRequest["status"],
    requestedAt: row.requested_at as string,
    completedAt: (row.completed_at as string | null) ?? null,
  };
}

/**
 * Idempotent in two independent ways: the same idempotency key returns the
 * same row, and a partial unique index allows only one open request per kind.
 * Tapping "delete my account" twice joins the first request.
 */
export async function requestAccountAction(
  userId: string,
  input: unknown,
): Promise<AccountRequest> {
  const parsed = accountRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw new VisitorError("invalid_input", "Check your request.");
  }

  const account = await getVisitorAccount(userId);
  if (!account) throw new VisitorError("account_missing", "No visitor account.");
  if (account.status === "deleted") {
    throw new VisitorError("account_inactive", "This account is already deleted.");
  }

  const admin = createAdminClient();

  const existing = await admin
    .from("visitor_account_requests")
    .select(REQUEST_COLUMNS)
    .eq("account_id", account.id)
    .eq("kind", parsed.data.kind)
    .eq("idempotency_key", parsed.data.idempotencyKey)
    .maybeSingle();

  if (existing.data) return mapRequest(existing.data);

  const { data, error } = await admin
    .from("visitor_account_requests")
    .insert({
      account_id: account.id,
      kind: parsed.data.kind,
      idempotency_key: parsed.data.idempotencyKey,
      status: "pending",
    })
    .select(REQUEST_COLUMNS)
    .maybeSingle();

  if (error || !data) {
    // Either the same key raced, or one of this kind is already open. Both
    // mean "your request is already in hand", so return it rather than error.
    const open = await admin
      .from("visitor_account_requests")
      .select(REQUEST_COLUMNS)
      .eq("account_id", account.id)
      .eq("kind", parsed.data.kind)
      .in("status", ["pending", "processing"])
      .maybeSingle();

    if (open.data) return mapRequest(open.data);
    throw new VisitorError("unavailable", "Could not record your request.");
  }

  if (parsed.data.kind === "deletion") {
    await admin
      .from("visitor_accounts")
      .update({
        status: "deletion_requested",
        deletion_requested_at: new Date().toISOString(),
      })
      .eq("id", account.id);
    await bumpAuthorizationVersion(account.id, admin);

    // /account-deletion says the account stops working right away, and the
    // deletion itself waits for the next cron run. The notification worker
    // resolves recipients from relationships and live devices, not from
    // account status, so without this a deleted-in-waiting account would keep
    // receiving a church's announcements until then.
    await retireInstallationsForAccount(account.id, "account_deleted");
  }

  return mapRequest(data);
}

export type VisitorExport = {
  exportedAt: string;
  profile: {
    displayName: string | null;
    status: string;
    termsVersion: string | null;
    privacyVersion: string | null;
    autoAttendanceConsent: string;
    communicationPrefs: Record<string, boolean>;
  };
  churches: {
    churchName: string;
    state: string;
    joinedAt: string | null;
    updatedAt: string;
  }[];
  peopleLinks: { churchName: string; status: "active" | "revoked"; linkedAt: string }[];
};

/**
 * What the account may take with them: their own profile, their own
 * relationships, and whether a People link exists.
 *
 * Deliberately excluded: the linked `members` row and anything on it, pastoral
 * notes, attendance, giving, other accounts, staff data, invitation tokens,
 * and provider payloads. A People link is reported as a fact, not as a copy of
 * the church's record.
 */
export async function buildAccountExport(userId: string): Promise<VisitorExport> {
  const account = await getVisitorAccount(userId);
  if (!account) throw new VisitorError("account_missing", "No visitor account.");

  const admin = createAdminClient();

  const { data: relationships } = await admin
    .from("visitor_church_relationships")
    .select("state, joined_at, updated_at, churches!inner(name)")
    .eq("account_id", account.id)
    .order("updated_at", { ascending: false })
    .limit(200);

  const { data: links } = await admin
    .from("visitor_people_links")
    .select("is_active, linked_at, churches!inner(name)")
    .eq("account_id", account.id)
    .order("linked_at", { ascending: false })
    .limit(200);

  const churchName = (value: unknown): string => {
    const resolved = Array.isArray(value) ? value[0] : value;
    return ((resolved as { name?: string } | null)?.name as string) ?? "";
  };

  return {
    exportedAt: new Date().toISOString(),
    profile: {
      displayName: account.displayName,
      status: account.status,
      termsVersion: account.termsVersion,
      privacyVersion: account.privacyVersion,
      autoAttendanceConsent: account.autoAttendanceConsent,
      communicationPrefs: account.communicationPrefs,
    },
    churches: (relationships ?? []).map((row) => ({
      churchName: churchName(row.churches),
      state: row.state as string,
      joinedAt: (row.joined_at as string | null) ?? null,
      updatedAt: row.updated_at as string,
    })),
    peopleLinks: (links ?? []).map((row) => ({
      churchName: churchName(row.churches),
      status: row.is_active ? ("active" as const) : ("revoked" as const),
      linkedAt: row.linked_at as string,
    })),
  };
}

/*
 * Carrying out a deletion request is `account-deletion.ts`, run by the cron at
 * /api/webhooks/accounts/deletion. It deletes the Supabase Auth user and lets
 * the schema's foreign keys decide what goes with it and what a church keeps,
 * rather than deleting table by table from here; the reasons are in that file.
 */

export async function listAccountRequests(
  userId: string,
): Promise<AccountRequest[]> {
  const account = await requireActiveAccount(userId).catch(() => null);
  const resolved = account ?? (await getVisitorAccount(userId));
  if (!resolved) return [];

  const admin = createAdminClient();
  const { data } = await admin
    .from("visitor_account_requests")
    .select(REQUEST_COLUMNS)
    .eq("account_id", resolved.id)
    .order("requested_at", { ascending: false })
    .limit(20);

  return (data ?? []).map(mapRequest);
}
