"use server";

import { revalidatePath } from "next/cache";
import { getChurchAuth } from "@/lib/auth/church";
import { toUserError } from "@/lib/errors/user-error";
import { featureActionError } from "@/lib/features/guard";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createRecurringOccurrences,
  cancelOccurrence,
  editOccurrence,
  type RecurrenceFrequency,
} from "@/lib/announcements/recurring-events";
import { recordLocationUse } from "@/lib/announcements/location-suggestions";

type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { data?: never } : { data: T }))
  | { ok: false; error: string };

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

/**
 * Generate occurrences for a recurring event.
 * Called after creating a recurring announcement.
 */
export async function generateRecurringOccurrences(
  announcementId: string,
  frequency: RecurrenceFrequency,
  startDate: string,
  startTime: string | null,
  endTime: string | null,
  untilDate: string,
  allDay: boolean
): Promise<ActionResult<{ created: number; skipped: number }>> {
  const auth = await getChurchAuth();
  if (!auth?.isAdmin) return fail("Only church admins can create recurring events.");
  
  const featureError = await featureActionError("announcements");
  if (featureError) return fail(featureError);
  
  if (!["daily", "weekly", "monthly"].includes(frequency)) {
    return fail("Choose daily, weekly, or monthly.");
  }
  
  try {
    const admin = createAdminClient();
    
    // Verify announcement exists and belongs to this church
    const { data: announcement, error: checkError } = await admin
      .from("announcements")
      .select("id, church_id")
      .eq("id", announcementId)
      .eq("church_id", auth.churchId)
      .maybeSingle();
    
    if (checkError || !announcement) {
      return fail("Announcement not found.");
    }
    
    const result = await createRecurringOccurrences(
      {
        churchId: auth.churchId,
        announcementId,
        frequency,
        startDate,
        startTime,
        endTime,
        untilDate,
        timezone: auth.churchTimezone || "America/New_York",
        allDay,
      },
      admin
    );
    
    if (result.error) {
      return fail(result.error);
    }
    
    revalidatePath("/dashboard/announcements");
    revalidatePath(`/dashboard/announcements/${announcementId}`);
    
    return {
      ok: true,
      data: { created: result.created, skipped: result.skipped },
    };
  } catch (error) {
    return fail(toUserError(error, "We couldn't generate recurring events."));
  }
}

/**
 * Cancel a specific occurrence of a recurring event.
 */
export async function cancelRecurringOccurrence(
  occurrenceId: string,
  reason: string | null
): Promise<ActionResult> {
  const auth = await getChurchAuth();
  if (!auth?.isAdmin) return fail("Only church admins can cancel events.");
  
  const featureError = await featureActionError("announcements");
  if (featureError) return fail(featureError);
  
  try {
    const admin = createAdminClient();
    
    // Verify occurrence belongs to this church
    const { data: occurrence, error: checkError } = await admin
      .from("announcement_occurrences")
      .select("id, church_id, announcement_id")
      .eq("id", occurrenceId)
      .eq("church_id", auth.churchId)
      .maybeSingle();
    
    if (checkError || !occurrence) {
      return fail("Occurrence not found.");
    }
    
    const result = await cancelOccurrence(
      occurrenceId,
      auth.userId,
      reason,
      admin
    );
    
    if (!result.ok) {
      return fail(result.error || "Failed to cancel occurrence");
    }
    
    revalidatePath("/dashboard/announcements");
    revalidatePath(`/dashboard/announcements/${occurrence.announcement_id}`);
    
    return { ok: true };
  } catch (error) {
    return fail(toUserError(error, "We couldn't cancel that occurrence."));
  }
}

/**
 * Edit a specific occurrence (override parent details).
 */
export async function editRecurringOccurrence(
  occurrenceId: string,
  overrides: {
    title?: string;
    description?: string;
    location?: string;
    startAt?: string;
    endAt?: string | null;
  }
): Promise<ActionResult> {
  const auth = await getChurchAuth();
  if (!auth?.isAdmin) return fail("Only church admins can edit events.");
  
  const featureError = await featureActionError("announcements");
  if (featureError) return fail(featureError);
  
  try {
    const admin = createAdminClient();
    
    // Verify occurrence belongs to this church
    const { data: occurrence, error: checkError } = await admin
      .from("announcement_occurrences")
      .select("id, church_id, announcement_id")
      .eq("id", occurrenceId)
      .eq("church_id", auth.churchId)
      .maybeSingle();
    
    if (checkError || !occurrence) {
      return fail("Occurrence not found.");
    }
    
    const result = await editOccurrence(occurrenceId, overrides, admin);
    
    if (!result.ok) {
      return fail(result.error || "Failed to edit occurrence");
    }
    
    revalidatePath("/dashboard/announcements");
    revalidatePath(`/dashboard/announcements/${occurrence.announcement_id}`);
    
    return { ok: true };
  } catch (error) {
    return fail(toUserError(error, "We couldn't save those changes."));
  }
}

/**
 * List occurrences for a recurring announcement.
 */
export async function listAnnouncementOccurrences(
  announcementId: string
): Promise<ActionResult<Array<{
  id: string;
  occurrence_date: string;
  start_at: string;
  end_at: string | null;
  override_title: string | null;
  override_description: string | null;
  override_location: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
}>>> {
  const auth = await getChurchAuth();
  if (!auth) return fail("Not signed in.");
  
  const featureError = await featureActionError("announcements");
  if (featureError) return fail(featureError);
  
  try {
    const admin = createAdminClient();
    
    // Verify announcement belongs to this church
    const { data: announcement, error: checkError } = await admin
      .from("announcements")
      .select("id, church_id")
      .eq("id", announcementId)
      .eq("church_id", auth.churchId)
      .maybeSingle();
    
    if (checkError || !announcement) {
      return fail("Announcement not found.");
    }
    
    const { data: occurrences, error } = await admin
      .from("announcement_occurrences")
      .select("id, occurrence_date, start_at, end_at, override_title, override_description, override_location, cancelled_at, cancelled_by, cancel_reason")
      .eq("announcement_id", announcementId)
      .order("occurrence_date", { ascending: true });
    
    if (error) {
      console.error("[listAnnouncementOccurrences] Error:", error);
      return fail("Failed to load occurrences.");
    }
    
    return { ok: true, data: occurrences || [] };
  } catch (error) {
    return fail(toUserError(error, "We couldn't load the occurrences."));
  }
}

/**
 * Record that a location was used (for autocomplete suggestions).
 */
export async function trackLocationUsage(location: string): Promise<void> {
  try {
    const auth = await getChurchAuth();
    if (!auth) return;
    
    const admin = createAdminClient();
    await recordLocationUse(auth.churchId, location, admin);
  } catch (error) {
    // Non-critical, just log
    console.warn("[recurring-actions] Failed to track location:", error);
  }
}
