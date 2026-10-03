"use server";

import { revalidatePath } from "next/cache";

import { logActivity } from "@/lib/activity/log";
import { createMemberDuringAttendance } from "@/app/dashboard/people/actions";
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
import { featureActionError } from "@/lib/features/guard";
import { createClient } from "@/lib/supabase/server";
import { getChurchTimezone } from "@/lib/queries/attendance";
import { getCurrentChurchId } from "@/lib/auth/current-church";
import { isSundayDate } from "@/lib/utils/dates";
import { toUserError } from "@/lib/errors/user-error";
import { parseHeadcount } from "@/lib/attendance/headcount";

export type AttendanceEntryInput = {
  memberId: string;
  status: "present" | "absent";
  /** Marked as a first-time guest for this Sunday. */
  isFirstTimeGuest?: boolean;
};

export type AddMemberResult =
  | {
      ok: true;
      member: {
        id: string;
        first_name: string;
        last_name: string;
        phone: string | null;
        photo_url: string | null;
        attendance_count: number;
      };
    }
  | { ok: false; error: string };

export type SubmitAttendanceResult =
  | { ok: true }
  | { ok: false; error: string };

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

type ChurchContext =
  | { ok: false; error: string }
  | {
      ok: true;
      supabase: ReturnType<typeof createClient>;
      user: { id: string };
      churchId: string;
      timezone: string;
    };

async function resolveChurchContext(): Promise<ChurchContext> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "You must be signed in." };
  }

  const churchId = await getCurrentChurchId(supabase, user.id);

  if (!churchId) {
    return { ok: false, error: "No church linked to your account." };
  }

  // Mirrors the FeatureGate on the (record) layout, so submitting by replaying
  // the action cannot reach further than opening the page would.
  const featureError = await featureActionError("attendance", supabase);
  if (featureError) {
    return { ok: false, error: featureError };
  }

  const timezone = await getChurchTimezone(supabase, churchId);

  return { ok: true, supabase, user, churchId, timezone };
}

export async function addMember(input: {
  firstName: string;
  lastName: string;
  phone?: string;
}): Promise<AddMemberResult> {
  const result = await createMemberDuringAttendance(input);

  if (!result.ok) {
    return result;
  }

  revalidatePath(`/dashboard/attendance`);

  return {
    ok: true,
    member: {
      id: result.member.id,
      first_name: result.member.first_name,
      last_name: result.member.last_name,
      phone: result.member.phone,
      photo_url: result.member.photo_url,
      attendance_count: 0,
    },
  };
}

export async function submitAttendance(input: {
  serviceDate: string;
  entries: AttendanceEntryInput[];
  notes?: string;
  /** Correcting a Sunday that was already saved. */
  editing?: boolean;
  /**
   * "Just a number": how many came, with no names. Sent instead of entries,
   * never with them.
   */
  headcount?: number;
}): Promise<SubmitAttendanceResult> {
  const context = await resolveChurchContext();

  if (!context.ok) {
    return { ok: false, error: context.error };
  }

  const { supabase, churchId, timezone } = context;
  const { serviceDate, entries, notes, editing = false } = input;

  if (!isSundayDate(serviceDate, timezone)) {
    return { ok: false, error: "That date isn't a Sunday. Go back and pick a Sunday." };
  }

  if (input.headcount !== undefined) {
    if (entries.length > 0) {
      return { ok: false, error: "Save either a number or names, not both." };
    }
    const parsed = parseHeadcount(input.headcount);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    return saveHeadcount(supabase, churchId, serviceDate, parsed.count, notes, editing);
  }

  if (entries.length === 0) {
    return { ok: false, error: "Mark at least one person before saving." };
  }

  const memberIds = entries.map((entry) => entry.memberId);
  const { data: validMembers } = await supabase
    .from("members")
    .select("id")
    .eq("church_id", churchId)
    .in("id", memberIds);

  if ((validMembers?.length ?? 0) !== memberIds.length) {
    return {
      ok: false,
      error: "Someone on this list is no longer in People. Refresh the page and try again.",
    };
  }

  const { data: existing } = await supabase
    .from("attendance_records")
    .select("id")
    .eq("church_id", churchId)
    .eq("service_date", serviceDate)
    .maybeSingle();

  if (existing && !editing) {
    return {
      ok: false,
      error: "This Sunday was already saved. Open it and choose Edit attendance to make changes.",
    };
  }

  const result = existing
    ? await updateRecord(supabase, churchId, existing.id as string, entries, notes)
    : await createRecord(supabase, churchId, serviceDate, entries, notes);
  if (!result.ok) return result;

  if (!existing) {
    await logActivity({
      churchId,
      automationType: "Track Weekly Attendance",
      taskName: "Weekly attendance recorded",
      triggerSource: "attendance_module",
    });
  }

  revalidatePath("/dashboard/attendance");
  revalidatePath(`/dashboard/attendance/${serviceDate}`);
  revalidatePath("/dashboard/attendance/follow-up");

  return { ok: true };
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
  const context = await resolveChurchContext();
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

  revalidatePath(`/dashboard/attendance/${input.serviceDate}`);
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
  const context = await resolveChurchContext();
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

  revalidatePath(`/dashboard/attendance/${input.serviceDate}`);
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

/**
 * A Sunday counted as one number. The row carries the total and no names;
 * every reader already takes the sheet's total as a floor.
 *
 * A Sunday already saved by name is not overwritten by a number — that would
 * leave its names disagreeing with its total, and lose who was marked.
 */
async function saveHeadcount(
  supabase: Supabase,
  churchId: string,
  serviceDate: string,
  count: number,
  notes: string | undefined,
  editing: boolean,
): Promise<SubmitAttendanceResult> {
  const { data: existing, error: existingError } = await supabase
    .from("attendance_records")
    .select("id, attendance_entries(count)")
    .eq("church_id", churchId)
    .eq("service_date", serviceDate)
    .maybeSingle();

  if (existingError) {
    return {
      ok: false,
      error: toUserError(existingError, "We couldn't save attendance. Your number is still on this page"),
    };
  }

  if (existing && !editing) {
    return {
      ok: false,
      error: "This Sunday was already saved. Open it and choose Edit attendance to make changes.",
    };
  }

  if (existing) {
    const named = (existing.attendance_entries as { count: number }[] | null)?.[0]?.count ?? 0;
    if (named > 0) {
      return {
        ok: false,
        error: "This Sunday was counted by name. Edit the names instead, so nobody's mark is lost.",
      };
    }

    const { error } = await supabase
      .from("attendance_records")
      .update({
        total_present: count,
        total_absent: 0,
        ...(notes !== undefined ? { notes: notes.trim() || null } : {}),
      })
      .eq("id", existing.id as string)
      .eq("church_id", churchId);

    if (error) {
      return { ok: false, error: toUserError(error, "We couldn't save your changes. Nothing was changed") };
    }
  } else {
    const { error } = await supabase.from("attendance_records").insert({
      church_id: churchId,
      service_date: serviceDate,
      total_present: count,
      total_absent: 0,
      notes: notes?.trim() || null,
    });

    if (error) {
      return {
        ok: false,
        error: toUserError(error, "We couldn't save attendance. Your number is still on this page"),
      };
    }

    await logActivity({
      churchId,
      automationType: "Track Weekly Attendance",
      taskName: "Weekly attendance recorded",
      triggerSource: "attendance_module",
    });
  }

  revalidatePath("/dashboard/attendance");
  revalidatePath(`/dashboard/attendance/${serviceDate}`);
  revalidatePath("/dashboard/attendance/follow-up");

  return { ok: true };
}

function tally(entries: AttendanceEntryInput[]) {
  return {
    total_present: entries.filter((e) => e.status === "present").length,
    total_absent: entries.filter((e) => e.status === "absent").length,
  };
}

function entryRows(
  churchId: string,
  recordId: string,
  entries: AttendanceEntryInput[],
  includeFollowUpDefault: boolean,
) {
  return entries.map((entry) => ({
    record_id: recordId,
    church_id: churchId,
    member_id: entry.memberId,
    status: entry.status,
    is_first_time_guest: entry.isFirstTimeGuest === true,
    ...(includeFollowUpDefault ? { follow_up_requested: false } : {}),
  }));
}

/**
 * The Sunday and its names are saved together or not at all. Two inserts are
 * not a transaction, so if the names fail the Sunday row is removed again —
 * otherwise it would sit there "Completed" with nobody on it and refuse every
 * later attempt to save.
 */
async function createRecord(
  supabase: Supabase,
  churchId: string,
  serviceDate: string,
  entries: AttendanceEntryInput[],
  notes: string | undefined,
): Promise<SubmitAttendanceResult> {
  const { data: record, error: recordError } = await supabase
    .from("attendance_records")
    .insert({
      church_id: churchId,
      service_date: serviceDate,
      ...tally(entries),
      notes: notes?.trim() || null,
    })
    .select("id")
    .single();

  if (recordError || !record) {
    return {
      ok: false,
      error: toUserError(recordError, "We couldn't save attendance. Your marks are still on this page"),
    };
  }

  let { error: entriesError } = await supabase
    .from("attendance_entries")
    .insert(entryRows(churchId, record.id, entries, true));

  // Migration 0111 not applied: retry without the guest flag rather than
  // losing the whole Sunday.
  if (entriesError && /is_first_time_guest/i.test(entriesError.message)) {
    ({ error: entriesError } = await supabase.from("attendance_entries").insert(
      entries.map((entry) => ({
        record_id: record.id,
        church_id: churchId,
        member_id: entry.memberId,
        status: entry.status,
        follow_up_requested: false,
      })),
    ));
  }

  if (entriesError) {
    await supabase.from("attendance_records").delete().eq("id", record.id).eq("church_id", churchId);
    return {
      ok: false,
      error: toUserError(entriesError, "We couldn't save attendance. Your marks are still on this page"),
    };
  }

  return { ok: true };
}

/**
 * Correct a saved Sunday. Each person's row is updated in place (upsert on
 * record + member), so follow-up history on the row — texts already sent —
 * is kept. Totals are recounted from what is now on the sheet.
 */
async function updateRecord(
  supabase: Supabase,
  churchId: string,
  recordId: string,
  entries: AttendanceEntryInput[],
  notes: string | undefined,
): Promise<SubmitAttendanceResult> {
  let { error: upsertError } = await supabase
    .from("attendance_entries")
    .upsert(entryRows(churchId, recordId, entries, false), {
      onConflict: "record_id,member_id",
    });

  if (upsertError && /is_first_time_guest/i.test(upsertError.message)) {
    ({ error: upsertError } = await supabase.from("attendance_entries").upsert(
      entries.map((entry) => ({
        record_id: recordId,
        church_id: churchId,
        member_id: entry.memberId,
        status: entry.status,
      })),
      { onConflict: "record_id,member_id" },
    ));
  }

  if (upsertError) {
    return {
      ok: false,
      error: toUserError(upsertError, "We couldn't save your changes. Nothing was changed"),
    };
  }

  const { data: rows, error: readError } = await supabase
    .from("attendance_entries")
    .select("status")
    .eq("record_id", recordId)
    .eq("church_id", churchId);

  const statuses = (rows ?? []) as { status: "present" | "absent" }[];
  const { error: recordError } = await supabase
    .from("attendance_records")
    .update({
      ...(readError
        ? tally(entries)
        : {
            total_present: statuses.filter((r) => r.status === "present").length,
            total_absent: statuses.filter((r) => r.status === "absent").length,
          }),
      ...(notes !== undefined ? { notes: notes.trim() || null } : {}),
    })
    .eq("id", recordId)
    .eq("church_id", churchId);

  if (recordError) {
    return {
      ok: false,
      error: toUserError(recordError, "Your changes were saved, but the totals didn't update. Refresh to see them"),
    };
  }

  return { ok: true };
}
