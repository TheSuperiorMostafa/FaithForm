"use server";

import { revalidatePath } from "next/cache";
import { getChurchAuth } from "@/lib/auth/church";
import { featureActionError } from "@/lib/features/guard";
import { createClient } from "@/lib/supabase/server";
import { toUserError } from "@/lib/errors/user-error";
import {
  validatePastorMessage,
  validateWelcomeMessage,
  type FirstTimeGuest,
} from "@/lib/attendance/first-time-guests";
import {
  resolvePastorNotifyPhone,
  sendPastorGuestNotice,
  sendWelcomeGuestTexts,
} from "@/lib/attendance/send-guest-texts";

export type GuestTextActionResult =
  | {
      ok: true;
      sent: number;
      skipped: number;
      failed: number;
      notConnected: boolean;
      /** Where the pastor text went, for the toast. */
      pastorDestination?: "church_phone" | "texting_phone";
    }
  | { ok: false; error: string };

async function resolveGuestContext() {
  const supabase = createClient();
  const denied = await featureActionError("attendance_follow_up", supabase);
  if (denied) return { ok: false as const, error: denied };
  const auth = await getChurchAuth(supabase);
  if (!auth) return { ok: false as const, error: "You must be signed in." };
  return { ok: true as const, supabase, churchId: auth.churchId };
}

/**
 * Texts the church phone with the list of first-time guests for this Sunday.
 * Destination: Settings → church phone, else the church's texting phone number.
 */
export async function notifyPastorOfFirstTimeGuests(input: {
  serviceDate: string;
  memberIds: string[];
  message: string;
}): Promise<GuestTextActionResult> {
  const context = await resolveGuestContext();
  if (!context.ok) return { ok: false, error: context.error };

  const checked = validatePastorMessage(input.message);
  if (!checked.ok) return { ok: false, error: checked.error };

  const memberIds = Array.from(new Set(input.memberIds.filter(Boolean)));
  if (memberIds.length === 0) {
    return { ok: false, error: "Pick at least one first-time guest." };
  }

  const guests = await loadFirstTimeGuests(
    context.supabase,
    context.churchId,
    input.serviceDate,
    memberIds,
  );
  if (!guests.ok) return guests;
  if (guests.guests.length === 0) {
    return {
      ok: false,
      error: "Those people aren't saved as first-time guests for this Sunday yet.",
    };
  }

  const destination = await resolvePastorNotifyPhone(context.churchId);
  if (!destination) {
    return {
      ok: false,
      error:
        "Add your church's phone number in Settings, or connect a texting phone, so we know where to send this.",
    };
  }

  const result = await sendPastorGuestNotice({
    churchId: context.churchId,
    phone: destination.phone,
    message: checked.message,
  });

  if (!result.ok) {
    if (result.notConnected) {
      return {
        ok: false,
        error:
          "Your church's texting phone isn't connected yet, so nothing was sent. Contact FaithForm support to connect it.",
      };
    }
    return {
      ok: false,
      error: toUserError(
        { message: result.error },
        "We couldn't text the pastor. Nothing was sent",
      ),
    };
  }

  revalidatePath(`/dashboard/attendance/follow-up/${input.serviceDate}`);
  return {
    ok: true,
    sent: 1,
    skipped: 0,
    failed: 0,
    notConnected: false,
    pastorDestination: destination.source,
  };
}

/**
 * Welcome texts to first-time guests who left a phone number when they were added.
 */
export async function sendWelcomeTextsToGuests(input: {
  serviceDate: string;
  memberIds: string[];
  message: string;
}): Promise<GuestTextActionResult> {
  const context = await resolveGuestContext();
  if (!context.ok) return { ok: false, error: context.error };

  const checked = validateWelcomeMessage(input.message);
  if (!checked.ok) return { ok: false, error: checked.error };

  const memberIds = Array.from(new Set(input.memberIds.filter(Boolean)));
  if (memberIds.length === 0) {
    return { ok: false, error: "Pick at least one first-time guest." };
  }

  const guests = await loadFirstTimeGuests(
    context.supabase,
    context.churchId,
    input.serviceDate,
    memberIds,
  );
  if (!guests.ok) return guests;

  const withPhone = guests.guests.filter((guest) => Boolean(guest.phone?.trim()));
  if (withPhone.length === 0) {
    return {
      ok: false,
      error: "None of those guests have a phone number on file.",
    };
  }

  const { data: church } = await context.supabase
    .from("churches")
    .select("name")
    .eq("id", context.churchId)
    .maybeSingle();
  const churchName = (church?.name as string | undefined)?.trim() || "our church";

  let summary: Awaited<ReturnType<typeof sendWelcomeGuestTexts>>;
  try {
    summary = await sendWelcomeGuestTexts({
      churchId: context.churchId,
      churchName,
      guests: withPhone,
      messageTemplate: checked.message,
    });
  } catch (err) {
    console.error("sendWelcomeTextsToGuests:", err);
    return {
      ok: false,
      error: "We couldn't send the welcome texts. Try again shortly.",
    };
  }

  if (summary.notConnected) {
    return {
      ok: false,
      error:
        "Your church's texting phone isn't connected yet, so nothing was sent. Contact FaithForm support to connect it.",
    };
  }

  revalidatePath(`/dashboard/attendance/follow-up/${input.serviceDate}`);
  return {
    ok: true,
    sent: summary.sent,
    skipped: summary.skipped,
    failed: summary.failed,
    notConnected: false,
  };
}

type Supabase = ReturnType<typeof createClient>;

async function loadFirstTimeGuests(
  supabase: Supabase,
  churchId: string,
  serviceDate: string,
  memberIds: string[],
): Promise<
  | { ok: true; guests: FirstTimeGuest[] }
  | { ok: false; error: string }
> {
  const { data: record, error: recordError } = await supabase
    .from("attendance_records")
    .select("id")
    .eq("church_id", churchId)
    .eq("service_date", serviceDate)
    .maybeSingle();

  if (recordError) {
    return {
      ok: false,
      error: toUserError(recordError, "We couldn't load this Sunday. Nothing was sent"),
    };
  }
  if (!record) {
    return {
      ok: false,
      error: "Attendance isn't saved for that Sunday yet. Save it first, then send texts.",
    };
  }

  const { data: entries, error: entriesError } = await supabase
    .from("attendance_entries")
    .select("member_id, is_first_time_guest, member:members(id, first_name, last_name, phone)")
    .eq("record_id", record.id)
    .eq("church_id", churchId)
    .in("member_id", memberIds);

  if (entriesError && /is_first_time_guest/i.test(entriesError.message)) {
    return {
      ok: false,
      error:
        "This church's database still needs an update before first-time guests can be texted. Contact FaithForm support.",
    };
  }

  if (entriesError) {
    return {
      ok: false,
      error: toUserError(entriesError, "We couldn't load the guests. Nothing was sent"),
    };
  }

  type Row = {
    member_id: string | null;
    is_first_time_guest: boolean | null;
    member:
      | { id: string; first_name: string; last_name: string; phone: string | null }
      | { id: string; first_name: string; last_name: string; phone: string | null }[]
      | null;
  };

  const guests: FirstTimeGuest[] = [];
  for (const row of (entries ?? []) as unknown as Row[]) {
    if (!row.is_first_time_guest || !row.member_id) continue;
    const raw = row.member;
    const member = Array.isArray(raw) ? raw[0] ?? null : raw;
    if (!member) continue;
    guests.push({
      memberId: member.id,
      firstName: member.first_name,
      lastName: member.last_name,
      phone: member.phone,
    });
  }

  return { ok: true, guests };
}

