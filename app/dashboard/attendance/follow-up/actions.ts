"use server";

import { revalidatePath } from "next/cache";

import { sendAttendanceFollowUpTexts } from "@/lib/attendance/send-follow-up-texts";
import { featureActionError } from "@/lib/features/guard";
import { getChurchAuth } from "@/lib/auth/church";
import { getPriorConsecutiveAbsences } from "@/lib/queries/attendance";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type SendFollowUpsResult =
  | { ok: true; requested: number }
  | { ok: false; error: string };

/**
 * Marks the chosen absentees for follow-up and texts them.
 *
 * Someone already contacted for this service is skipped rather than texted
 * twice — the page is a working list a pastor comes back to, not a one-shot
 * form, so re-submitting it must be safe.
 */
export async function sendFollowUps(input: {
  serviceDate: string;
  memberIds: string[];
}): Promise<SendFollowUpsResult> {
  const denied = await featureActionError("attendance_follow_up");
  if (denied) return { ok: false, error: denied };

  const supabase = createClient();
  const auth = await getChurchAuth(supabase);
  if (!auth) return { ok: false, error: "You must be signed in." };

  const memberIds = Array.from(new Set(input.memberIds.filter(Boolean)));
  if (memberIds.length === 0) {
    return { ok: false, error: "Pick at least one person to follow up with." };
  }

  const { data: record } = await supabase
    .from("attendance_records")
    .select("id")
    .eq("church_id", auth.churchId)
    .eq("service_date", input.serviceDate)
    .maybeSingle();

  if (!record) {
    return { ok: false, error: "No attendance saved for that Sunday yet." };
  }

  const admin = createAdminClient();

  const { data: entries, error: entriesError } = await admin
    .from("attendance_entries")
    .select("id, member_id, status, follow_up_sent_at")
    .eq("record_id", record.id)
    .eq("church_id", auth.churchId)
    .in("member_id", memberIds);

  if (entriesError) return { ok: false, error: entriesError.message };

  const eligible = (entries ?? []).filter(
    (entry) => entry.status === "absent" && !entry.follow_up_sent_at,
  );

  if (eligible.length === 0) {
    return {
      ok: false,
      error: "Everyone you picked has already been contacted.",
    };
  }

  const { error: markError } = await admin
    .from("attendance_entries")
    .update({ follow_up_requested: true, follow_up_error: null })
    .in(
      "id",
      eligible.map((entry) => entry.id),
    );

  if (markError) return { ok: false, error: markError.message };

  const eligibleMemberIds = eligible.map((entry) => entry.member_id as string);

  const [priorAbsences, { data: memberRows }] = await Promise.all([
    getPriorConsecutiveAbsences(
      supabase,
      auth.churchId,
      input.serviceDate,
      eligibleMemberIds,
    ),
    admin
      .from("members")
      .select("id, first_name, phone")
      .eq("church_id", auth.churchId)
      .in("id", eligibleMemberIds),
  ]);

  const memberById = new Map(
    (memberRows ?? []).map((row) => [row.id as string, row]),
  );

  try {
    await sendAttendanceFollowUpTexts(
      auth.churchId,
      eligible.map((entry) => {
        const member = memberById.get(entry.member_id as string);
        return {
          entryId: entry.id as string,
          firstName: (member?.first_name as string | undefined) ?? "Friend",
          phone: (member?.phone as string | null | undefined) ?? null,
          consecutiveAbsent:
            (priorAbsences.get(entry.member_id as string) ?? 0) + 1,
        };
      }),
    );
  } catch (err) {
    console.error("sendFollowUps:", err);
    return {
      ok: false,
      error:
        "The follow-ups were saved, but the texts could not be sent. Try again shortly.",
    };
  }

  revalidatePath("/dashboard/attendance/follow-up");
  revalidatePath(`/dashboard/attendance/${input.serviceDate}`);
  revalidatePath("/dashboard/attendance");

  return { ok: true, requested: eligible.length };
}
