/**
 * Group announcement notifications (G2).
 * Send announcements to all active group members through the notification outbox.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";

export interface GroupAnnouncementNotification {
  groupId: string;
  churchId: string;
  title: string;
  message: string;
  deepLink?: string;
  actorUserId: string;
}

/**
 * Queue a group announcement notification to all active members.
 * Respects member notification preferences and church isolation.
 */
export async function queueGroupAnnouncement(
  notification: GroupAnnouncementNotification,
  db: SupabaseClient
): Promise<{ ok: boolean; recipientCount: number; error?: string }> {
  try {
    // Validate group exists and belongs to church
    const { data: group } = await db
      .from("groups")
      .select("id, name, church_id")
      .eq("id", notification.groupId)
      .eq("church_id", notification.churchId)
      .eq("is_active", true)
      .maybeSingle();
    
    if (!group) {
      return { ok: false, recipientCount: 0, error: "Group not found or inactive" };
    }
    
    // Get all active members with accounts
    const { data: memberships, error: membershipsError } = await db
      .from("group_memberships")
      .select("account_id, user_id")
      .eq("group_id", notification.groupId)
      .eq("church_id", notification.churchId)
      .eq("status", "active")
      .not("account_id", "is", null)
      .limit(200); // Max per batch
    
    if (membershipsError) {
      return { ok: false, recipientCount: 0, error: membershipsError.message };
    }
    
    if (!memberships || memberships.length === 0) {
      return { ok: false, recipientCount: 0, error: "No active members with accounts" };
    }
    
    // Extract unique account IDs
    const accountIds = Array.from(
      new Set(
        memberships
          .map((m) => m.account_id as string | null)
          .filter((id): id is string => id !== null)
      )
    );
    
    if (accountIds.length === 0) {
      return { ok: false, recipientCount: 0, error: "No valid recipient accounts" };
    }
    
    // Verify all accounts are active and related to this church
    const { data: activeAccounts, error: accountsError } = await db
      .from("visitor_accounts")
      .select("id")
      .eq("status", "active")
      .in("id", accountIds);
    
    if (accountsError) {
      return { ok: false, recipientCount: 0, error: accountsError.message };
    }
    
    const validAccountIds = (activeAccounts || []).map((a) => a.id as string);
    
    if (validAccountIds.length === 0) {
      return { ok: false, recipientCount: 0, error: "No active recipient accounts" };
    }
    
    // Verify church relationships
    const { data: relationships, error: relationshipsError } = await db
      .from("visitor_church_relationships")
      .select("account_id")
      .eq("church_id", notification.churchId)
      .in("account_id", validAccountIds)
      .in("state", ["following", "pending", "joined"]);
    
    if (relationshipsError) {
      return { ok: false, recipientCount: 0, error: relationshipsError.message };
    }
    
    const finalAccountIds = (relationships || []).map((r) => r.account_id as string);
    
    if (finalAccountIds.length === 0) {
      return { ok: false, recipientCount: 0, error: "No valid church relationships" };
    }
    
    // Create dedupe key (group + timestamp bucket)
    const bucket = Math.floor(Date.now() / 60_000); // 1-minute buckets
    const dedupeKey = createHash("sha256")
      .update(`group-announcement:${notification.groupId}:${bucket}`)
      .digest("hex");
    
    // Insert notification into outbox
    const { error: insertError } = await db.from("notification_outbox").insert({
      church_id: notification.churchId,
      kind: "group_announcement",
      subject_type: "group",
      subject_id: notification.groupId,
      target_visibility: "members",
      target_account_ids: finalAccountIds,
      topic: "groups",
      title: notification.title,
      body: notification.message,
      deep_link: notification.deepLink || `faithform://groups/${notification.groupId}`,
      collapse_key: `group-${notification.groupId}`,
      dedupe_key: dedupeKey,
    });
    
    if (insertError) {
      // Check if it's a duplicate (expected for retries)
      if (insertError.code === "23505") {
        return { ok: true, recipientCount: finalAccountIds.length };
      }
      return { ok: false, recipientCount: 0, error: insertError.message };
    }
    
    return { ok: true, recipientCount: finalAccountIds.length };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[group-announcements] Failed to queue notification:", msg);
    return { ok: false, recipientCount: 0, error: msg };
  }
}

/**
 * Check if a user can send announcements to a group.
 * Only group leaders/managers can send announcements.
 */
export async function canSendGroupAnnouncement(
  userId: string,
  groupId: string,
  churchId: string,
  db: SupabaseClient
): Promise<boolean> {
  // Check if user is a leader or co-leader of the group
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
