import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import { VisitorError, type VisitorErrorCode } from "@/lib/faithform/errors";

/**
 * People who joined in the app (migration 0083).
 *
 * Joining a church makes an account one of its people: on the way into
 * `joined`, the database either links the account to a new People record made
 * from its name, or — when someone by that name is already in People, or there
 * is no name — opens a claim for staff (`connect_app_member`). What is left
 * for staff lives here:
 *
 *   - answering a claim with "someone new";
 *   - adding someone the automatic path could not (it failed, or a claim was
 *     declined, or the database joined them before 0083);
 *   - moving a connection to the person it should have been.
 *
 * Every write is a single database function, so a People record, its link and
 * the audit row appear together or not at all, and nothing here — like
 * nothing anywhere — links an account to an existing record without a staff
 * member naming that record.
 */

export type ConnectOutcome =
  | "linked"
  | "already_linked"
  | "awaiting_staff"
  | "not_joined"
  | "account_inactive";

const CONNECT_OUTCOMES: readonly ConnectOutcome[] = [
  "linked",
  "already_linked",
  "awaiting_staff",
  "not_joined",
  "account_inactive",
];

/** The database raises these by name; each is a thing staff can act on. */
const RAISED: Record<string, { code: VisitorErrorCode; message: string }> = {
  claim_not_found: { code: "claim_not_found", message: "That request was not found." },
  claim_resolved: { code: "conflict", message: "That request was already answered." },
  already_linked: { code: "already_linked", message: "This person is already connected to People." },
  first_name_required: { code: "invalid_input", message: "Enter at least a first name." },
  member_not_found: { code: "invalid_input", message: "That person is not in your People list." },
  not_linked: { code: "conflict", message: "That person is not connected to the app any more." },
  member_already_claimed: {
    code: "member_already_claimed",
    message: "Someone else in the app is already connected to that person.",
  },
  invalid_target: { code: "invalid_input", message: "Choose a different person." },
};

function toDomainError(message: string | undefined, fallback: string): VisitorError {
  for (const [raised, mapped] of Object.entries(RAISED)) {
    if (message?.includes(raised)) return new VisitorError(mapped.code, mapped.message);
  }
  return new VisitorError("unavailable", fallback);
}

/**
 * Runs the same decision the join trigger runs, on a staff member's behalf.
 * A same-name person already in People still becomes a claim rather than a
 * second record: staff asked to add someone, not to skip the check.
 */
export async function connectAppMember(input: {
  churchId: string;
  accountId: string;
  staffUserId: string;
}): Promise<ConnectOutcome> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("connect_app_member", {
    p_account_id: input.accountId,
    p_church_id: input.churchId,
    p_actor_user_id: input.staffUserId,
  });

  if (error) throw toDomainError(error.message, "Could not add them to People.");
  const outcome = data as string;
  if (!(CONNECT_OUTCOMES as readonly string[]).includes(outcome)) {
    throw new VisitorError("unavailable", "Could not add them to People.");
  }
  return outcome as ConnectOutcome;
}

export async function addClaimAsNewPerson(input: {
  churchId: string;
  staffUserId: string;
  claimId: string;
  firstName: string;
  lastName: string;
}): Promise<string> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("add_people_claim_as_new_person", {
    p_church_id: input.churchId,
    p_claim_id: input.claimId,
    p_staff_user_id: input.staffUserId,
    p_first_name: input.firstName,
    p_last_name: input.lastName,
  });

  if (error || typeof data !== "string") {
    throw toDomainError(error?.message, "Could not add them to People.");
  }
  return data;
}

export async function moveAppConnection(input: {
  churchId: string;
  staffUserId: string;
  fromMemberId: string;
  toMemberId: string;
}): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.rpc("move_people_link", {
    p_church_id: input.churchId,
    p_from_member_id: input.fromMemberId,
    p_to_member_id: input.toMemberId,
    p_staff_user_id: input.staffUserId,
  });

  if (error) throw toDomainError(error.message, "Could not move the app connection.");
}

export type AppConnection = {
  linkedAt: string;
};

/**
 * Who in People is on the app: every active link for the church, by person.
 * Read through the caller's own session — staff may read their church's links
 * under row security, and nobody else's.
 */
export async function listAppConnections(
  supabase: SupabaseClient,
  churchId: string,
): Promise<Map<string, AppConnection>> {
  const { data, error } = await supabase
    .from("visitor_people_links")
    .select("member_id, linked_at")
    .eq("church_id", churchId)
    .eq("is_active", true)
    .limit(5000);

  const connections = new Map<string, AppConnection>();
  if (error) {
    console.error("listAppConnections:", error.message);
    return connections;
  }

  for (const row of (data ?? []) as Record<string, unknown>[]) {
    connections.set(row.member_id as string, { linkedAt: row.linked_at as string });
  }
  return connections;
}

export type AppMemberNotInPeople = {
  accountId: string;
  displayName: string | null;
  joinedAt: string | null;
};

/**
 * Members of the church in the app who are in nobody's People record and
 * have no question open about it — the ones the automatic path could not
 * place. Normally empty; the People page lists them so they are never
 * invisible.
 */
export async function listAppMembersNotInPeople(
  churchId: string,
): Promise<AppMemberNotInPeople[]> {
  const admin = createAdminClient();

  const [joined, links, claims] = await Promise.all([
    admin
      .from("visitor_church_relationships")
      .select("account_id, joined_at, visitor_accounts!inner(display_name, status)")
      .eq("church_id", churchId)
      .eq("state", "joined")
      .order("joined_at", { ascending: false })
      .limit(1000),
    admin
      .from("visitor_people_links")
      .select("account_id")
      .eq("church_id", churchId)
      .eq("is_active", true)
      .limit(5000),
    admin
      .from("visitor_people_claims")
      .select("account_id")
      .eq("church_id", churchId)
      .in("status", ["pending", "disputed"])
      .limit(1000),
  ]);

  if (joined.error || links.error || claims.error) {
    console.error(
      "listAppMembersNotInPeople:",
      joined.error?.message ?? links.error?.message ?? claims.error?.message,
    );
    return [];
  }

  const placed = new Set<string>([
    ...((links.data ?? []) as Record<string, unknown>[]).map((row) => row.account_id as string),
    ...((claims.data ?? []) as Record<string, unknown>[]).map((row) => row.account_id as string),
  ]);

  const result: AppMemberNotInPeople[] = [];
  for (const row of (joined.data ?? []) as Record<string, unknown>[]) {
    const accountId = row.account_id as string;
    if (placed.has(accountId)) continue;
    const account = row.visitor_accounts as
      | { display_name: string | null; status: string }
      | { display_name: string | null; status: string }[];
    const resolved = Array.isArray(account) ? account[0] : account;
    // An account on its way out is not someone to add.
    if (resolved?.status && resolved.status !== "active") continue;
    result.push({
      accountId,
      displayName: resolved?.display_name ?? null,
      joinedAt: (row.joined_at as string | null) ?? null,
    });
  }
  return result;
}
