"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getChurchTimezone } from "@/lib/queries/attendance";
import { getCurrentChurchId } from "@/lib/queries/dashboard";
import { isSundayDate } from "@/lib/utils/dates";

export type AttendanceEntryInput = {
  memberId: string;
  status: "present" | "absent";
  followUp: boolean;
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
  const context = await resolveChurchContext();

  if (!context.ok) {
    return { ok: false, error: context.error };
  }

  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  const phone = input.phone?.trim() || null;

  if (!firstName || !lastName) {
    return { ok: false, error: "First and last name are required." };
  }

  const admin = createAdminClient();

  const { data, error } = await admin
    .from("members")
    .insert({
      church_id: context.churchId,
      first_name: firstName,
      last_name: lastName,
      phone,
      is_active: true,
    })
    .select("id, first_name, last_name, phone, photo_url")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Could not add member." };
  }

  revalidatePath("/dashboard/attendance");

  return { ok: true, member: { ...data, attendance_count: 0 } };
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
    follow_up_requested: entry.status === "absent" && entry.followUp,
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

  try {
    const admin = createAdminClient();
    await admin.from("activity_log").insert({
      church_id: churchId,
      automation_type: "Track Weekly Attendance",
      category: "Admin",
      task_name: "Weekly attendance recorded",
      time_saved_minutes: 5,
      trigger_source: "attendance_module",
    });
  } catch (activityError) {
    console.error("activity_log insert failed:", activityError);
  }

  const followUpMemberIds = entries
    .filter((e) => e.status === "absent" && e.followUp)
    .map((e) => e.memberId);

  type FollowUpMemberPayload = {
    entryId: string;
    id: string;
    firstName: string;
    lastName: string;
    phone: string | null;
  };

  let followUpMembers: FollowUpMemberPayload[] = [];

  if (followUpMemberIds.length > 0) {
    const admin = createAdminClient();
    const { data: followUpEntries } = await admin
      .from("attendance_entries")
      .select("id, member_id")
      .eq("record_id", record.id)
      .eq("follow_up_requested", true);

    const entryByMember = new Map(
      (followUpEntries ?? []).map((row) => [row.member_id, row.id]),
    );

    const { data: memberRows } = await admin
      .from("members")
      .select("id, first_name, last_name, phone")
      .in("id", followUpMemberIds);

    followUpMembers = (memberRows ?? []).map((member) => ({
      entryId: entryByMember.get(member.id) ?? "",
      id: member.id,
      firstName: member.first_name,
      lastName: member.last_name,
      phone: member.phone,
    }));
  }

  const webhookPayload = {
    churchId,
    serviceDate,
    recordId: record.id,
    totalPresent,
    totalAbsent,
    followUpMemberIds,
    followUpMembers,
    notes: notes?.trim() || null,
    statusCallbackUrl: `${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"}/api/webhooks/attendance-follow-up-status`,
  };

  try {
    const headersList = headers();
    const origin =
      headersList.get("origin") ??
      process.env.NEXT_PUBLIC_SITE_URL ??
      "http://localhost:3000";

    await fetch(`${origin}/api/webhooks/attendance-submitted`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-faithform-secret": process.env.N8N_WEBHOOK_SECRET ?? "",
      },
      body: JSON.stringify(webhookPayload),
    });
  } catch (webhookError) {
    console.error("attendance webhook failed:", webhookError);
  }

  revalidatePath("/dashboard/attendance");
  revalidatePath(`/dashboard/attendance/${serviceDate}`);

  return { ok: true };
}
