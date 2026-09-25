"use server";

import { revalidatePath } from "next/cache";

import { getChurchAuth } from "@/lib/auth/church";
import { featureActionError } from "@/lib/features/guard";
import {
  toVisitorResult,
  VisitorError,
  type VisitorResult,
} from "@/lib/faithform/errors";
import {
  isUserFacingError,
  toUserError,
  UserFacingError,
} from "@/lib/errors/user-error";
import {
  addClaimAsNewPerson,
  connectAppMember,
  listAppMembersNotInPeople,
  moveAppConnection,
  type AppMemberNotInPeople,
  type ConnectOutcome,
} from "@/lib/faithform/app-people";
import {
  approveClaim,
  listLinkAudit,
  listPendingClaims,
  rejectClaim,
  revokeLink,
  type StaffClaimRow,
} from "@/lib/faithform/people-claims";
import { MAX_PAGE_SIZE } from "@/lib/faithform/schemas";
import {
  listChurchRelationships,
  staffRelationshipDecision,
} from "@/lib/faithform/staff-relationships";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Staff resolution of People claims and visitor relationships.
 *
 * Gated on the People feature and on church admin, and every call re-derives
 * the church from the session. A claim id belonging to another tenant matches
 * no row in the services below, so authorization holds even if an id leaks.
 */

type StaffContext = { churchId: string; userId: string };

async function requirePeopleAdmin(): Promise<StaffContext> {
  const auth = await getChurchAuth();
  if (!auth) throw new Error("unauthenticated");

  const featureError = await featureActionError("people");
  if (featureError) throw new UserFacingError(featureError);

  if (!auth.isAdmin) throw new Error("forbidden");
  return { churchId: auth.churchId, userId: auth.userId };
}

/**
 * Domain errors carry sentences written for staff; anything else is logged
 * and replaced with a plain one, so no driver text reaches the page.
 */
function toStaffResult<T>(error: unknown, fallback: string): VisitorResult<T> {
  if (error instanceof VisitorError) return toVisitorResult(error);
  if (error instanceof Error && error.message === "unauthenticated") {
    return { ok: false, code: "unauthenticated", message: "You must be signed in." };
  }
  if (error instanceof Error && error.message === "forbidden") {
    return { ok: false, code: "forbidden", message: "Only church admins can change People." };
  }
  if (isUserFacingError(error)) {
    return { ok: false, code: "forbidden", message: error.message };
  }
  return { ok: false, code: "unavailable", message: toUserError(error, fallback) };
}

function revalidatePeople() {
  revalidatePath("/dashboard/people");
  // Join requests also render on the Member App page.
  revalidatePath("/dashboard/app");
  // Someone newly in People is someone the weekly sheet can mark.
  revalidatePath("/dashboard/attendance");
}

export async function getPendingClaims(): Promise<StaffClaimRow[]> {
  const auth = await getChurchAuth();
  if (!auth?.isAdmin) return [];
  const result = await listPendingClaims(auth.churchId, { limit: MAX_PAGE_SIZE }).catch(
    () => ({
      items: [],
      nextCursor: null,
    }),
  );
  return result.items;
}

/** Joined in the app, and neither in People nor waiting on a question. */
export async function getAppMembersNotInPeople(): Promise<AppMemberNotInPeople[]> {
  const auth = await getChurchAuth();
  if (!auth?.isAdmin) return [];
  return listAppMembersNotInPeople(auth.churchId).catch(() => []);
}

export async function approvePeopleClaim(input: {
  claimId: string;
  memberId: string;
  note?: string;
}): Promise<VisitorResult<null>> {
  try {
    const { churchId, userId } = await requirePeopleAdmin();
    await approveClaim({
      churchId,
      staffUserId: userId,
      claimId: input.claimId,
      memberId: input.memberId,
      note: input.note,
    });
    revalidatePeople();
    return { ok: true, data: null };
  } catch (error) {
    return toStaffResult(error, "We couldn't link this person.");
  }
}

/** "Nobody in People is this person": add them, linked, in one step. */
export async function addPeopleClaimAsNewPerson(input: {
  claimId: string;
  firstName: string;
  lastName: string;
}): Promise<VisitorResult<{ memberId: string }>> {
  try {
    const { churchId, userId } = await requirePeopleAdmin();
    const memberId = await addClaimAsNewPerson({
      churchId,
      staffUserId: userId,
      claimId: input.claimId,
      firstName: input.firstName,
      lastName: input.lastName,
    });
    revalidatePeople();
    return { ok: true, data: { memberId } };
  } catch (error) {
    return toStaffResult(error, "We couldn't add them to People.");
  }
}

/**
 * Adds someone who joined in the app to People. The same check as joining
 * applies: when a person by that name is already there, this opens a question
 * rather than a second record.
 */
export async function addAppMemberToPeople(input: {
  accountId: string;
}): Promise<VisitorResult<{ outcome: ConnectOutcome }>> {
  try {
    const { churchId, userId } = await requirePeopleAdmin();
    const outcome = await connectAppMember({
      churchId,
      accountId: input.accountId,
      staffUserId: userId,
    });
    revalidatePeople();
    return { ok: true, data: { outcome } };
  } catch (error) {
    return toStaffResult(error, "We couldn't add them to People.");
  }
}

/** Moves an app connection from one People record to the right one. */
export async function moveAppConnectionToPerson(input: {
  fromMemberId: string;
  toMemberId: string;
}): Promise<VisitorResult<null>> {
  try {
    const { churchId, userId } = await requirePeopleAdmin();
    await moveAppConnection({
      churchId,
      staffUserId: userId,
      fromMemberId: input.fromMemberId,
      toMemberId: input.toMemberId,
    });
    revalidatePeople();
    return { ok: true, data: null };
  } catch (error) {
    return toStaffResult(error, "We couldn't move the app connection.");
  }
}

export async function rejectPeopleClaim(input: {
  claimId: string;
  note?: string;
  dispute?: boolean;
}): Promise<VisitorResult<null>> {
  try {
    const { churchId, userId } = await requirePeopleAdmin();
    await rejectClaim({
      churchId,
      staffUserId: userId,
      claimId: input.claimId,
      note: input.note,
      dispute: input.dispute,
    });
    revalidatePeople();
    return { ok: true, data: null };
  } catch (error) {
    return toStaffResult(error, "We couldn't decline this request.");
  }
}

export async function revokePeopleLink(input: {
  linkId: string;
  reason?: string;
}): Promise<VisitorResult<null>> {
  try {
    const { churchId, userId } = await requirePeopleAdmin();
    await revokeLink({
      churchId,
      staffUserId: userId,
      linkId: input.linkId,
      reason: input.reason,
    });
    revalidatePeople();
    return { ok: true, data: null };
  } catch (error) {
    return toStaffResult(error, "We couldn't remove that link.");
  }
}

export async function getLinkHistory(memberId?: string) {
  const auth = await getChurchAuth();
  if (!auth?.isAdmin) return [];
  return listLinkAudit(auth.churchId, memberId).catch(() => []);
}

/** Join requests waiting on staff, read in the database rather than filtered from a page. */
export async function getPendingJoinRequests() {
  const auth = await getChurchAuth();
  if (!auth?.isAdmin) return { items: [], nextCursor: null };
  return listChurchRelationships(
    auth.churchId,
    { limit: MAX_PAGE_SIZE },
    { state: "pending" },
  ).catch(() => ({
    items: [],
    nextCursor: null,
  }));
}

/** What approving someone did in People, so the dashboard can say so. */
export type JoinApprovalPeopleOutcome = "linked" | "awaiting_staff" | "not_connected";

export async function decideVisitorRelationship(input: {
  accountId: string;
  action: "approve" | "reject" | "block" | "unblock" | "revoke";
  reason?: string;
}): Promise<VisitorResult<{ people: JoinApprovalPeopleOutcome } | null>> {
  try {
    const { churchId, userId } = await requirePeopleAdmin();
    await staffRelationshipDecision({
      churchId,
      staffUserId: userId,
      accountId: input.accountId,
      action: input.action,
      reason: input.reason,
    });
    revalidatePeople();

    if (input.action !== "approve") return { ok: true, data: null };

    // Approving makes them a member, and the database connects every new
    // member to People (0083). Report which way it went.
    const admin = createAdminClient();
    const [{ data: link }, { data: claim }] = await Promise.all([
      admin
        .from("visitor_people_links")
        .select("id")
        .eq("account_id", input.accountId)
        .eq("church_id", churchId)
        .eq("is_active", true)
        .maybeSingle(),
      admin
        .from("visitor_people_claims")
        .select("id")
        .eq("account_id", input.accountId)
        .eq("church_id", churchId)
        .in("status", ["pending", "disputed"])
        .maybeSingle(),
    ]);

    return {
      ok: true,
      data: {
        people: link ? "linked" : claim ? "awaiting_staff" : "not_connected",
      },
    };
  } catch (error) {
    return toStaffResult(error, "We couldn't save your decision.");
  }
}
