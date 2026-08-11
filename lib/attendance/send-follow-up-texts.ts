import { getFollowUpMessageTemplates } from "@/lib/queries/follow-up-settings";
import { isSmsConfigured, sendSms } from "@/lib/sms/send-sms";
import { pickFollowUpMessage } from "@/lib/sms/follow-up-messages";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";

export type FollowUpMember = {
  entryId: string;
  firstName: string;
  phone: string | null;
  consecutiveAbsent: number;
};

function isMissingDeliveryColumn(message: string): boolean {
  return /follow_up_(sent_at|error|sms_id)/i.test(message);
}

/**
 * Records the outcome of one text against its attendance entry.
 *
 * Delivery tracking arrived in migration 0014, and a database that never got it
 * rejects the whole update — which would leave someone marked for follow-up but
 * with nothing to show they had been contacted, so the next visit to the page
 * would offer to text them again. Where the columns are missing, keeping
 * `follow_up_requested` set is the record, and it is enough for the page to
 * treat them as done.
 */
async function recordOutcome(
  admin: SupabaseClient,
  entryId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await admin
    .from("attendance_entries")
    .update(patch)
    .eq("id", entryId);

  if (!error) return;

  if (isMissingDeliveryColumn(error.message)) {
    console.warn(
      "[attendance-follow-up] delivery columns are missing — run `pnpm db:attendance-follow-up` to record send results.",
    );
    return;
  }

  console.error("[attendance-follow-up] could not record outcome:", error.message);
}

export async function sendAttendanceFollowUpTexts(
  churchId: string,
  members: FollowUpMember[],
): Promise<void> {
  if (members.length === 0) return;

  const admin = createAdminClient();
  const templates = await getFollowUpMessageTemplates(churchId, admin);

  if (!isSmsConfigured()) {
    console.warn(
      "[attendance-follow-up] SMS is not configured — follow-ups saved but texts were not sent.",
    );
    for (const member of members) {
      if (!member.entryId) continue;
      await recordOutcome(admin, member.entryId, {
        follow_up_error: "SMS is not configured on the server",
      });
    }
    return;
  }

  for (const member of members) {
    if (!member.entryId) continue;

    if (!member.phone?.trim()) {
      await recordOutcome(admin, member.entryId, {
        follow_up_error: "No phone number on file",
      });
      continue;
    }

    const message = pickFollowUpMessage(
      member.firstName,
      member.consecutiveAbsent,
      templates,
    );
    const result = await sendSms(member.phone, message);

    if (result.ok) {
      const sentUpdate: Record<string, unknown> = {
        follow_up_sent_at: new Date().toISOString(),
        follow_up_error: null,
      };
      if (result.messageId) {
        sentUpdate.follow_up_sms_id = result.messageId;
      }
      await recordOutcome(admin, member.entryId, sentUpdate);
    } else {
      await recordOutcome(admin, member.entryId, {
        follow_up_error: result.error,
      });
    }
  }
}
