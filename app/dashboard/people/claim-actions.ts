"use server";

import { revalidatePath } from "next/cache";

import { getChurchAuth } from "@/lib/auth/church";
import { featureActionError } from "@/lib/features/guard";
import { toVisitorResult, type VisitorResult } from "@/lib/faithful/errors";
import {
  approveClaim,
  listLinkAudit,
  listPendingClaims,
  rejectClaim,
  revokeLink,
  type StaffClaimRow,
} from "@/lib/faithful/people-claims";
import {
  listChurchRelationships,
  staffRelationshipDecision,
} from "@/lib/faithful/staff-relationships";

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
  if (featureError) throw new Error(featureError);

  if (!auth.isAdmin) throw new Error("forbidden");
  return { churchId: auth.churchId, userId: auth.userId };
}

function revalidatePeople() {
  revalidatePath("/dashboard/people");
  // Join requests also render on the Member App page.
  revalidatePath("/dashboard/app");
}

export async function getPendingClaims(): Promise<StaffClaimRow[]> {
  const auth = await getChurchAuth();
  if (!auth?.isAdmin) return [];
  const result = await listPendingClaims(auth.churchId).catch(() => ({
    items: [],
    nextCursor: null,
  }));
  return result.items;
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
    return toVisitorResult(error);
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
    return toVisitorResult(error);
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
    return toVisitorResult(error);
  }
}

export async function getLinkHistory(memberId?: string) {
  const auth = await getChurchAuth();
  if (!auth?.isAdmin) return [];
  return listLinkAudit(auth.churchId, memberId).catch(() => []);
}

export async function getVisitorRelationships() {
  const auth = await getChurchAuth();
  if (!auth?.isAdmin) return { items: [], nextCursor: null };
  return listChurchRelationships(auth.churchId).catch(() => ({
    items: [],
    nextCursor: null,
  }));
}

export async function decideVisitorRelationship(input: {
  accountId: string;
  action: "approve" | "reject" | "block" | "unblock" | "revoke";
  reason?: string;
}): Promise<VisitorResult<null>> {
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
    return { ok: true, data: null };
  } catch (error) {
    return toVisitorResult(error);
  }
}
