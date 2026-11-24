"use server";

import { revalidatePath } from "next/cache";
import { logFollowUpSendCredits } from "@/lib/activity/credits";

import { checkedInOtherwise, getPresenceOnDate } from "@/lib/attendance/presence";
import { validateFollowUpOverride } from "@/lib/attendance/follow-up-message";
import { sendAttendanceFollowUpTexts } from "@/lib/attendance/send-follow-up-texts";
import { toUserError } from "@/lib/errors/user-error";
import { featureActionError } from "@/lib/features/guard";
import { getChurchAuth } from "@/lib/auth/church";
import { getFamilyMinorIds, getPriorConsecutiveAbsences } from "@/lib/queries/attendance";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type SendFollowUpsResult =
  | {
      ok: true;
      requested: number;
      /** Text requests accepted by the gateway; handset confirmation is separate. */
      sent: number;
      /** The church has no texting phone of its own, so nothing was sent. */
      notConnected: boolean;
      requiresAppCheck: boolean;
    }
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
  /**
   * One message for this send, with `[Name]` for each first name. Checked by
   * the same rules as the church's saved messages, and never saved over them.
   */
  message?: string;
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

  let messageTemplate: string | undefined;
  if (input.message !== undefined) {
    const checked = validateFollowUpOverride(String(input.message));
    if (!checked.ok) return { ok: false, error: checked.error };
    messageTemplate = checked.message;
  }

  const { data: record } = await supabase
    .from("attendance_records")
    .select("id")
    .eq("church_id", auth.churchId)
    .eq("service_date", input.serviceDate)
    .maybeSingle();

  if (!record) {
    return { ok: false, error: "Attendance isn't saved for that Sunday yet. Count it first, then send texts." };
  }

  // Who the log will show as the sender. Staff accounts carry no profile row,
  // so the display name comes from the account itself, with email as the
  // dependable fallback.
  const { data: authData } = await supabase.auth.getUser();
  const authUser = authData.user;
  const senderName =
    (authUser?.user_metadata?.full_name as string | undefined)?.trim() ||
    (authUser?.user_metadata?.name as string | undefined)?.trim() ||
    authUser?.email ||
    null;

  const admin = createAdminClient();

  const loadEntries = (columns: string) =>
    admin
      .from("attendance_entries")
      .select(columns)
      .eq("record_id", record.id)
      .eq("church_id", auth.churchId)
      .in("member_id", memberIds);

  // Delivery tracking arrived in migration 0014. Where it is missing, the
  // request flag is the only record that someone was contacted, so it stands in
  // for the send timestamp — otherwise the same person could be texted on every
  // visit to this page.
  let trackingDelivery = true;
  let { data: entries, error: entriesError } = await loadEntries(
    "id, member_id, status, follow_up_requested, follow_up_sent_at",
  );

  if (entriesError && /follow_up_sent_at/i.test(entriesError.message)) {
    trackingDelivery = false;
    ({ data: entries, error: entriesError } = await loadEntries(
      "id, member_id, status, follow_up_requested",
    ));
  }

  if (entriesError) {
    return { ok: false, error: toUserError(entriesError, "We couldn't load who missed. Nothing was sent.") };
  }

  type EntryRow = {
    id: string;
    member_id: string | null;
    status: string;
    follow_up_requested: boolean;
    follow_up_sent_at?: string | null;
  };

  // Someone the app, a code, the kiosk or a room checked in was there, whatever
  // the sheet says. Checked here as well as on the page, so a stale page
  // cannot text them.
  const presence = await getPresenceOnDate(supabase, auth.churchId, input.serviceDate);

  const absentees = ((entries ?? []) as unknown as EntryRow[]).filter(
    (entry): entry is EntryRow & { member_id: string } => {
      if (entry.status !== "absent" || !entry.member_id) return false;
      if (checkedInOtherwise(presence?.get(entry.member_id)).length > 0) return false;
      return trackingDelivery ? !entry.follow_up_sent_at : !entry.follow_up_requested;
    },
  );

  let minorIds: Set<string>;
  try {
    minorIds = await getFamilyMinorIds(
      admin,
      auth.churchId,
      absentees.map((entry) => entry.member_id),
    );
  } catch (error) {
    return { ok: false, error: toUserError(error, "We couldn't check who can receive a follow-up text. Nothing was sent.") };
  }
  const eligible = absentees.filter((entry) => !minorIds.has(entry.member_id));

  if (eligible.length === 0) {
    return {
      ok: false,
      error: "Nobody you picked can receive a follow-up text for this service.",
    };
  }

  const eligibleIds = eligible.map((entry) => entry.id);

  let { error: markError } = await admin
    .from("attendance_entries")
    .update({ follow_up_requested: true, follow_up_error: null })
    .in("id", eligibleIds);

  if (markError && /follow_up_error/i.test(markError.message)) {
    ({ error: markError } = await admin
      .from("attendance_entries")
      .update({ follow_up_requested: true })
      .in("id", eligibleIds));
  }

  if (markError) {
    return { ok: false, error: toUserError(markError, "We couldn't start the texts. Nothing was sent.") };
  }

  const eligibleMemberIds = eligible.map((entry) => entry.member_id);

  const [priorAbsences, { data: memberRows }] = await Promise.all([
    getPriorConsecutiveAbsences(
      supabase,
      auth.churchId,
      input.serviceDate,
      eligibleMemberIds,
    ),
    admin
      .from("members")
      .select("id, first_name, last_name, phone")
      .eq("church_id", auth.churchId)
      .in("id", eligibleMemberIds),
  ]);

  const memberById = new Map(
    (memberRows ?? []).map((row) => [row.id as string, row]),
  );

  let summary: Awaited<ReturnType<typeof sendAttendanceFollowUpTexts>>;
  try {
    summary = await sendAttendanceFollowUpTexts(
      auth.churchId,
      eligible.map((entry) => {
        const member = memberById.get(entry.member_id);
        const firstName = (member?.first_name as string | undefined) ?? "Friend";
        const lastName = (member?.last_name as string | null | undefined) ?? "";
        return {
          entryId: entry.id as string,
          memberId: entry.member_id,
          firstName,
          fullName: `${firstName} ${lastName}`.trim(),
          phone: (member?.phone as string | null | undefined) ?? null,
          consecutiveAbsent:
            (priorAbsences.get(entry.member_id) ?? 0) + 1,
        };
      }),
      {
        serviceDate: input.serviceDate,
        userId: auth.userId,
        name: senderName,
      },
      { messageTemplate },
    );
  } catch (err) {
    console.error("sendFollowUps:", err);
    return {
      ok: false,
      error:
        "The follow-ups were saved, but the texts could not be sent. Try again shortly.",
    };
  }

  await logFollowUpSendCredits({
    churchId: auth.churchId,
    serviceDate: input.serviceDate,
    sent: summary.sent,
    texted: summary.texted,
  });

  revalidatePath("/dashboard/attendance/follow-up");
  revalidatePath(`/dashboard/attendance/follow-up/${input.serviceDate}`);
  revalidatePath(`/dashboard/attendance/${input.serviceDate}`);
  revalidatePath("/dashboard/attendance");

  return {
    ok: true,
    requested: eligible.length,
    sent: summary.sent,
    notConnected: summary.notConnected,
    requiresAppCheck: summary.requiresAppCheck,
  };
}
