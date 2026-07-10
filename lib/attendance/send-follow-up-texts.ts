import { getFollowUpMessageTemplates } from "@/lib/queries/follow-up-settings";
import { isSmsConfigured, sendSms } from "@/lib/sms/send-sms";
import { pickFollowUpMessage } from "@/lib/sms/follow-up-messages";
import { createAdminClient } from "@/lib/supabase/admin";

export type FollowUpMember = {
  entryId: string;
  firstName: string;
  phone: string | null;
  consecutiveAbsent: number;
};

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
      await admin
        .from("attendance_entries")
        .update({ follow_up_error: "SMS is not configured on the server" })
        .eq("id", member.entryId);
    }
    return;
  }

  for (const member of members) {
    if (!member.entryId) continue;

    if (!member.phone?.trim()) {
      await admin
        .from("attendance_entries")
        .update({ follow_up_error: "No phone number on file" })
        .eq("id", member.entryId);
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

      const { error: updateError } = await admin
        .from("attendance_entries")
        .update(sentUpdate)
        .eq("id", member.entryId);

      if (updateError) {
        console.error(
          "[attendance-follow-up] could not mark sent:",
          updateError.message,
        );
        await admin
          .from("attendance_entries")
          .update({
            follow_up_sent_at: new Date().toISOString(),
            follow_up_error: null,
          })
          .eq("id", member.entryId);
      }
    } else {
      await admin
        .from("attendance_entries")
        .update({ follow_up_error: result.error })
        .eq("id", member.entryId);
    }
  }
}
