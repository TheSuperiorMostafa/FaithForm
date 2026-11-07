/**
 * Volunteer availability and schedule acceptance (B2, G1).
 * Members can set their own availability and accept/decline assignments.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type ScheduleResponseStatus = "pending" | "accepted" | "declined" | "tentative";

export interface VolunteerAvailability {
  membershipId: string;
  availability: string; // Free-form text up to 500 chars
}

export interface ScheduleResponse {
  eventId: string;
  membershipId: string;
  status: ScheduleResponseStatus;
  note?: string;
}

/**
 * Update a member's availability (self-service).
 * Members can ONLY update their own availability.
 */
export async function updateMemberAvailability(
  userId: string,
  membershipId: string,
  availability: string,
  db: SupabaseClient
): Promise<{ ok: boolean; error?: string }> {
  if (availability.length > 500) {
    return { ok: false, error: "Availability text too long (max 500 characters)" };
  }
  
  // Verify this membership belongs to the caller
  const { data: membership, error: checkError } = await db
    .from("group_memberships")
    .select("id, user_id")
    .eq("id", membershipId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  
  if (checkError) {
    return { ok: false, error: checkError.message };
  }
  
  if (!membership) {
    return { ok: false, error: "Membership not found or you don't have permission to edit it" };
  }
  
  // Update availability
  const { error: updateError } = await db
    .from("group_memberships")
    .update({ availability: availability.trim() })
    .eq("id", membershipId)
    .eq("user_id", userId); // Double-check ownership
  
  if (updateError) {
    return { ok: false, error: updateError.message };
  }
  
  return { ok: true };
}

/**
 * Get a member's availability.
 */
export async function getMemberAvailability(
  membershipId: string,
  db: SupabaseClient
): Promise<{ availability: string | null; error?: string }> {
  const { data, error } = await db
    .from("group_memberships")
    .select("availability")
    .eq("id", membershipId)
    .eq("status", "active")
    .maybeSingle();
  
  if (error) {
    return { availability: null, error: error.message };
  }
  
  return { availability: data?.availability || null };
}

/**
 * Respond to a schedule assignment (accept/decline/tentative).
 * Members can ONLY respond to their own assignments.
 */
export async function respondToSchedule(
  userId: string,
  response: ScheduleResponse,
  db: SupabaseClient
): Promise<{ ok: boolean; error?: string }> {
  if (response.note && response.note.length > 500) {
    return { ok: false, error: "Response note too long (max 500 characters)" };
  }
  
  // Verify this membership belongs to the caller
  const { data: membership, error: checkError } = await db
    .from("group_memberships")
    .select("id, user_id, group_id, church_id")
    .eq("id", response.membershipId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  
  if (checkError) {
    return { ok: false, error: checkError.message };
  }
  
  if (!membership) {
    return { ok: false, error: "Membership not found or you don't have permission" };
  }
  
  // Verify event exists and belongs to the group
  const { data: event, error: eventError } = await db
    .from("group_events")
    .select("id, group_id")
    .eq("id", response.eventId)
    .eq("group_id", membership.group_id)
    .maybeSingle();
  
  if (eventError) {
    return { ok: false, error: eventError.message };
  }
  
  if (!event) {
    return { ok: false, error: "Event not found" };
  }
  
  // Check if response already exists
  const { data: existing } = await db
    .from("group_event_responses")
    .select("id")
    .eq("event_id", response.eventId)
    .eq("membership_id", response.membershipId)
    .maybeSingle();
  
  const now = new Date().toISOString();
  
  if (existing) {
    // Update existing response
    const { error: updateError } = await db
      .from("group_event_responses")
      .update({
        status: response.status,
        response_note: response.note || null,
        responded_at: now,
      })
      .eq("id", existing.id)
      .eq("membership_id", response.membershipId); // Double-check ownership
    
    if (updateError) {
      return { ok: false, error: updateError.message };
    }
  } else {
    // Create new response
    const { error: insertError } = await db
      .from("group_event_responses")
      .insert({
        church_id: membership.church_id,
        group_id: membership.group_id,
        event_id: response.eventId,
        user_id: userId,
        member_id: null, // Will be set by trigger if member_id exists
        membership_id: response.membershipId,
        status: response.status,
        response_note: response.note || null,
        responded_at: now,
      });
    
    if (insertError) {
      return { ok: false, error: insertError.message };
    }
  }
  
  return { ok: true };
}

/**
 * Assign a member to an event (manager only).
 */
export async function assignMemberToEvent(
  managerId: string,
  eventId: string,
  membershipId: string,
  groupId: string,
  churchId: string,
  db: SupabaseClient
): Promise<{ ok: boolean; error?: string }> {
  // Verify manager has permission
  const canAssign = await canManageGroupSchedule(managerId, groupId, churchId, db);
  if (!canAssign) {
    return { ok: false, error: "You don't have permission to assign members" };
  }
  
  // Verify membership exists and is active
  const { data: membership, error: membershipError } = await db
    .from("group_memberships")
    .select("id, user_id")
    .eq("id", membershipId)
    .eq("group_id", groupId)
    .eq("status", "active")
    .maybeSingle();
  
  if (membershipError) {
    return { ok: false, error: membershipError.message };
  }
  
  if (!membership) {
    return { ok: false, error: "Member not found in group" };
  }
  
  // Check if assignment already exists
  const { data: existing } = await db
    .from("group_event_responses")
    .select("id, status")
    .eq("event_id", eventId)
    .eq("membership_id", membershipId)
    .maybeSingle();
  
  const now = new Date().toISOString();
  
  if (existing) {
    // Update to mark as assigned
    const { error: updateError } = await db
      .from("group_event_responses")
      .update({
        is_assigned: true,
        assigned_by: managerId,
        assigned_at: now,
      })
      .eq("id", existing.id);
    
    if (updateError) {
      return { ok: false, error: updateError.message };
    }
  } else {
    // Create new assignment
    const { error: insertError } = await db
      .from("group_event_responses")
      .insert({
        church_id: churchId,
        group_id: groupId,
        event_id: eventId,
        user_id: membership.user_id,
        membership_id: membershipId,
        status: "pending",
        is_assigned: true,
        assigned_by: managerId,
        assigned_at: now,
      });
    
    if (insertError) {
      return { ok: false, error: insertError.message };
    }
  }
  
  return { ok: true };
}

/**
 * Check if a user can manage group schedules.
 */
export async function canManageGroupSchedule(
  userId: string,
  groupId: string,
  churchId: string,
  db: SupabaseClient
): Promise<boolean> {
  const { data: membership } = await db
    .from("group_memberships")
    .select("role")
    .eq("group_id", groupId)
    .eq("church_id", churchId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  
  if (!membership) return false;
  
  const role = membership.role as string;
  return role === "leader" || role === "co_leader" || role === "manager";
}

/**
 * Get responses for an event.
 */
export async function getEventResponses(
  eventId: string,
  db: SupabaseClient
): Promise<{
  responses: Array<{
    membershipId: string;
    userId: string;
    status: ScheduleResponseStatus;
    note: string | null;
    isAssigned: boolean;
    respondedAt: string | null;
  }>;
  error?: string;
}> {
  const { data, error } = await db
    .from("group_event_responses")
    .select("membership_id, user_id, status, response_note, is_assigned, responded_at")
    .eq("event_id", eventId)
    .order("responded_at", { ascending: false, nullsFirst: false });
  
  if (error) {
    return { responses: [], error: error.message };
  }
  
  return {
    responses: (data || []).map((r) => ({
      membershipId: r.membership_id as string,
      userId: r.user_id as string,
      status: r.status as ScheduleResponseStatus,
      note: r.response_note,
      isAssigned: r.is_assigned,
      respondedAt: r.responded_at,
    })),
  };
}
