"use server";

import { revalidatePath } from "next/cache";

import { logActivity } from "@/lib/activity/log";
import { createMember } from "@/app/dashboard/people/actions";
import { createClient } from "@/lib/supabase/server";
import { getChurchTimezone } from "@/lib/queries/attendance";
import { getCurrentChurchId } from "@/lib/queries/dashboard";
import { isSundayDate } from "@/lib/utils/dates";

export type AttendanceEntryInput = {
  memberId: string;
  status: "present" | "absent";
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

  const timezone = await getChurchTimezone(supabase, churchId);

  return { ok: true, supabase, user, churchId, timezone };
}

export async function addMember(input: {
  firstName: string;
  lastName: string;
  phone?: string;
}): Promise<AddMemberResult> {
  const result = await createMember(input);

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
}): Promise<SubmitAttendanceResult> {
  const context = await resolveChurchContext();

  if (!context.ok) {
    return { ok: false, error: context.error };
  }

  const { supabase, churchId, timezone } = context;
  const { serviceDate, entries, notes } = input;

  if (!isSundayDate(serviceDate, timezone)) {
    return { ok: false, error: "Invalid service date." };
  }

  if (entries.length === 0) {
    return { ok: false, error: "No attendance entries to save." };
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
      error: "One or more members are invalid for this church.",
    };
  }

  const { data: existing } = await supabase
    .from("attendance_records")
    .select("id")
    .eq("church_id", churchId)
    .eq("service_date", serviceDate)
    .maybeSingle();

  if (existing) {
    return {
      ok: false,
      error: "Attendance for this Sunday has already been submitted.",
    };
  }

  const totalPresent = entries.filter((e) => e.status === "present").length;
  const totalAbsent = entries.filter((e) => e.status === "absent").length;

  const { data: record, error: recordError } = await supabase
    .from("attendance_records")
    .insert({
      church_id: churchId,
      service_date: serviceDate,
      total_present: totalPresent,
      total_absent: totalAbsent,
      notes: notes?.trim() || null,
    })
    .select("id")
    .single();

  if (recordError || !record) {
    return {
      ok: false,
      error: recordError?.message ?? "Could not save attendance record.",
    };
  }

  const entryRows = entries.map((entry) => ({
    record_id: record.id,
    church_id: churchId,
    member_id: entry.memberId,
    status: entry.status,
    // Follow-ups are chosen afterwards, on the pastor's Follow-up page.
    follow_up_requested: false,
  }));

  const { error: entriesError } = await supabase
    .from("attendance_entries")
    .insert(entryRows);

  if (entriesError) {
    return {
      ok: false,
      error: entriesError.message ?? "Could not save attendance entries.",
    };
  }

  await logActivity({
    churchId,
    automationType: "Track Weekly Attendance",
    taskName: "Weekly attendance recorded",
    triggerSource: "attendance_module",
  });

  revalidatePath("/dashboard/attendance");
  revalidatePath(`/dashboard/attendance/${serviceDate}`);
  revalidatePath("/dashboard/attendance/follow-up");

  return { ok: true };
}
