"use server";

import { revalidatePath } from "next/cache";
import { getChurchAuth } from "@/lib/auth/church";
import { toUserError } from "@/lib/errors/user-error";
import { featureActionError } from "@/lib/features/guard";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  updateMemberAvailability,
  respondToSchedule,
  assignMemberToEvent,
  canManageGroupSchedule,
  getEventResponses,
  type ScheduleResponseStatus,
} from "@/lib/groups/volunteer-scheduling";
import {
  queueGroupAnnouncement,
  canSendGroupAnnouncement,
} from "@/lib/groups/announcement-notifications";

type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { data?: never } : { data: T }))
  | { ok: false; error: string };

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

/**
 * Update a member's availability (self-service only).
 * Members can ONLY update their own availability.
 */
export async function updateAvailability(
  membershipId: string,
  availability: string
): Promise<ActionResult> {
  const auth = await getChurchAuth();
  if (!auth) return fail("You must be signed in.");
  
  const featureError = await featureActionError("groups");
  if (featureError) return fail(featureError);
  
  try {
    const admin = createAdminClient();
    const result = await updateMemberAvailability(
      auth.userId,
      membershipId,
      availability,
      admin
    );
    
    if (!result.ok) {
      return fail(result.error || "Failed to update availability");
    }
    
    revalidatePath("/dashboard/groups");
    return { ok: true };
  } catch (error) {
    return fail(toUserError(error, "We couldn't update your availability."));
  }
}

/**
 * Respond to a schedule assignment (accept/decline/tentative).
 * Members can ONLY respond to their own assignments.
 */
export async function respondToScheduleAssignment(
  eventId: string,
  membershipId: string,
  status: ScheduleResponseStatus,
  note?: string
): Promise<ActionResult> {
  const auth = await getChurchAuth();
  if (!auth) return fail("You must be signed in.");
  
  const featureError = await featureActionError("groups");
  if (featureError) return fail(featureError);
  
  if (!["accepted", "declined", "tentative"].includes(status)) {
    return fail("Choose accept, decline, or tentative.");
  }
  
  try {
    const admin = createAdminClient();
    const result = await respondToSchedule(
      auth.userId,
      { eventId, membershipId, status, note },
      admin
    );
    
    if (!result.ok) {
      return fail(result.error || "Failed to respond");
    }
    
    revalidatePath("/dashboard/groups");
    revalidatePath(`/dashboard/groups/${eventId}`);
    return { ok: true };
  } catch (error) {
    return fail(toUserError(error, "We couldn't save your response."));
  }
}

/**
 * Assign a member to an event (manager only).
 */
export async function assignToEvent(
  eventId: string,
  membershipId: string,
  groupId: string
): Promise<ActionResult> {
  const auth = await getChurchAuth();
  if (!auth) return fail("You must be signed in.");
  
  const featureError = await featureActionError("groups");
  if (featureError) return fail(featureError);
  
  try {
    const admin = createAdminClient();
    const result = await assignMemberToEvent(
      auth.userId,
      eventId,
      membershipId,
      groupId,
      auth.churchId,
      admin
    );
    
    if (!result.ok) {
      return fail(result.error || "Failed to assign member");
    }
    
    revalidatePath("/dashboard/groups");
    revalidatePath(`/dashboard/groups/${groupId}`);
    return { ok: true };
  } catch (error) {
    return fail(toUserError(error, "We couldn't assign that member."));
  }
}

/**
 * Send an announcement to all group members (leaders only).
 */
export async function sendGroupAnnouncement(
  groupId: string,
  title: string,
  message: string
): Promise<ActionResult<{ recipientCount: number }>> {
  const auth = await getChurchAuth();
  if (!auth) return fail("You must be signed in.");
  
  const featureError = await featureActionError("groups");
  if (featureError) return fail(featureError);
  
  if (!title.trim() || title.length > 100) {
    return fail("Enter a title (up to 100 characters).");
  }
  
  if (!message.trim() || message.length > 500) {
    return fail("Enter a message (up to 500 characters).");
  }
  
  try {
    const admin = createAdminClient();
    
    // Check permission
    const canSend = await canSendGroupAnnouncement(
      auth.userId,
      groupId,
      auth.churchId,
      admin
    );
    
    if (!canSend) {
      return fail("Only group leaders can send announcements.");
    }
    
    // Queue notification
    const result = await queueGroupAnnouncement(
      {
        groupId,
        churchId: auth.churchId,
        title: title.trim(),
        message: message.trim(),
        actorUserId: auth.userId,
      },
      admin
    );
    
    if (!result.ok) {
      return fail(result.error || "Failed to send announcement");
    }
    
    revalidatePath("/dashboard/groups");
    revalidatePath(`/dashboard/groups/${groupId}`);
    
    return { ok: true, data: { recipientCount: result.recipientCount } };
  } catch (error) {
    return fail(toUserError(error, "We couldn't send that announcement."));
  }
}

/**
 * Get responses for an event (for display).
 */
export async function getScheduleResponses(
  eventId: string
): Promise<ActionResult<{
  responses: Array<{
    membershipId: string;
    userId: string;
    status: ScheduleResponseStatus;
    note: string | null;
    isAssigned: boolean;
    respondedAt: string | null;
  }>;
}>> {
  const auth = await getChurchAuth();
  if (!auth) return fail("You must be signed in.");
  
  const featureError = await featureActionError("groups");
  if (featureError) return fail(featureError);
  
  try {
    const admin = createAdminClient();
    const result = await getEventResponses(eventId, admin);
    
    if (result.error) {
      return fail(result.error);
    }
    
    return { ok: true, data: { responses: result.responses } };
  } catch (error) {
    return fail(toUserError(error, "We couldn't load responses."));
  }
}
