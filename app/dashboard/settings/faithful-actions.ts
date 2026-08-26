"use server";

import { revalidatePath } from "next/cache";

import { getChurchAuth } from "@/lib/auth/church";
import { toVisitorResult, type VisitorResult } from "@/lib/faithful/errors";
import {
  createCampus,
  deactivateCampus,
  listCampuses,
  updateCampus,
  type Campus,
} from "@/lib/faithful/campuses";
import { updateDiscoverySettings } from "@/lib/faithful/discovery";
import {
  issueInvitation,
  listInvitations,
  revokeInvitation,
  type IssuedInvitation,
} from "@/lib/faithful/invitations";
import { getCanonicalSiteUrl } from "@/lib/site-url";

/**
 * FaithForm administration for the Faithful visitor surface.
 *
 * Every action resolves the church from the caller's own session. No action
 * accepts a church id from the client, so a forged payload cannot reach
 * another tenant's configuration.
 */

type AdminContext = { churchId: string; userId: string };

async function requireChurchAdmin(): Promise<AdminContext> {
  const auth = await getChurchAuth();
  if (!auth) throw new Error("unauthenticated");
  if (!auth.isAdmin) throw new Error("forbidden");
  return { churchId: auth.churchId, userId: auth.userId };
}

function revalidateSettings() {
  revalidatePath("/dashboard/settings");
}

export async function saveDiscoverySettings(input: {
  isDiscoverable: boolean;
  publicSummary?: string | null;
  joinPolicy: "open" | "approval_required" | "invite_only";
}): Promise<VisitorResult<null>> {
  try {
    const { churchId } = await requireChurchAdmin();
    await updateDiscoverySettings(churchId, input);
    revalidateSettings();
    return { ok: true, data: null };
  } catch (error) {
    return toVisitorResult(error);
  }
}

export async function saveCampus(input: {
  campusId?: string;
  values: unknown;
}): Promise<VisitorResult<Campus>> {
  try {
    const { churchId } = await requireChurchAdmin();
    const campus = input.campusId
      ? await updateCampus(churchId, input.campusId, input.values)
      : await createCampus(churchId, input.values);
    revalidateSettings();
    return { ok: true, data: campus };
  } catch (error) {
    return toVisitorResult(error);
  }
}

export async function retireCampus(
  campusId: string,
): Promise<VisitorResult<null>> {
  try {
    const { churchId } = await requireChurchAdmin();
    await deactivateCampus(churchId, campusId);
    revalidateSettings();
    return { ok: true, data: null };
  } catch (error) {
    return toVisitorResult(error);
  }
}

export async function getCampusesForSettings(): Promise<Campus[]> {
  const auth = await getChurchAuth();
  if (!auth) return [];
  return listCampuses(auth.churchId).catch(() => []);
}

/**
 * The invitation link is returned here and nowhere else. It is not stored, and
 * re-opening this page cannot show it again — only the hash survives.
 */
export async function createVisitorInvitation(
  payload: unknown,
): Promise<VisitorResult<IssuedInvitation>> {
  try {
    const { churchId, userId } = await requireChurchAdmin();
    const invitation = await issueInvitation({
      churchId,
      staffUserId: userId,
      payload,
      baseUrl: getCanonicalSiteUrl(),
    });
    revalidateSettings();
    return { ok: true, data: invitation };
  } catch (error) {
    return toVisitorResult(error);
  }
}

export async function withdrawVisitorInvitation(
  invitationId: string,
): Promise<VisitorResult<null>> {
  try {
    const { churchId, userId } = await requireChurchAdmin();
    await revokeInvitation({ churchId, staffUserId: userId, invitationId });
    revalidateSettings();
    return { ok: true, data: null };
  } catch (error) {
    return toVisitorResult(error);
  }
}

export async function getInvitationsForSettings() {
  const auth = await getChurchAuth();
  if (!auth?.isAdmin) return { items: [], nextCursor: null };
  return listInvitations(auth.churchId).catch(() => ({
    items: [],
    nextCursor: null,
  }));
}
