"use server";

import { revalidatePath } from "next/cache";

import { getChurchAuth } from "@/lib/auth/church";
import type { FeatureKey } from "@/lib/features/catalog";
import { featureActionError } from "@/lib/features/guard";
import type { ChurchMember } from "@/lib/queries/members";
import { validateMemberInput } from "@/lib/people/validate-member";
import { createClient } from "@/lib/supabase/server";

export type MemberActionResult =
  | { ok: true; member: ChurchMember }
  | { ok: false; error: string };

function revalidatePeoplePaths() {
  revalidatePath("/dashboard/people");
  revalidatePath("/dashboard/attendance");
}

function mapMemberRow(row: {
  id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  email: string | null;
  photo_url: string | null;
  is_active: boolean;
}): ChurchMember {
  return {
    ...row,
    attendance_count: 0,
  };
}

type MemberContext =
  | { ok: false; error: string }
  | { ok: true; churchId: string; supabase: ReturnType<typeof createClient> };

/**
 * The feature key is a parameter because two different features legitimately
 * create members: the People directory, and the attendance sheet's "someone
 * new came today". It is never taken from the caller — each exported action
 * hard-codes its own, so a client cannot name a feature it happens to hold.
 */
async function requireAdminMemberAction(
  feature: FeatureKey,
): Promise<MemberContext> {
  const auth = await getChurchAuth();
  if (!auth) {
    return { ok: false, error: "You must be signed in." };
  }

  // Before the role check, not after: a church whose People feature is off has
  // no admins for it either, and the honest message is "not enabled" rather
  // than "not an admin".
  const featureError = await featureActionError(feature);
  if (featureError) {
    return { ok: false, error: featureError };
  }

  if (!auth.isAdmin) {
    return { ok: false, error: "Only church admins can edit people." };
  }

  const supabase = createClient();
  return { ok: true, churchId: auth.churchId, supabase };
}

/** Shared body. Callers do their own gating before reaching this. */
async function insertMember(
  context: Extract<MemberContext, { ok: true }>,
  input: { firstName: string; lastName: string; phone?: string; email?: string },
): Promise<MemberActionResult> {
  const validated = validateMemberInput(input);
  if (!validated.ok) {
    return { ok: false, error: validated.error };
  }

  const { firstName, lastName, phone, email } = validated.data;

  const { data, error } = await context.supabase
    .from("members")
    .insert({
      church_id: context.churchId,
      first_name: firstName,
      last_name: lastName,
      phone,
      email,
      is_active: true,
    })
    .select("id, first_name, last_name, phone, email, photo_url, is_active")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Could not add person." };
  }

  revalidatePeoplePaths();
  return { ok: true, member: mapMemberRow(data) };
}

export async function createMember(input: {
  firstName: string;
  lastName: string;
  phone?: string;
  email?: string;
}): Promise<MemberActionResult> {
  const context = await requireAdminMemberAction("people");
  if (!context.ok) {
    return context;
  }

  return insertMember(context, input);
}

/**
 * Adding someone from the attendance sheet.
 *
 * Gated on Attendance rather than People: a church can run attendance without
 * the directory turned on, and refusing to record a visitor because a feature
 * they never asked for is off would be the wrong answer.
 */
export async function createMemberDuringAttendance(input: {
  firstName: string;
  lastName: string;
  phone?: string;
  email?: string;
}): Promise<MemberActionResult> {
  const context = await requireAdminMemberAction("attendance");
  if (!context.ok) {
    return context;
  }

  return insertMember(context, input);
}

export async function updateMember(input: {
  memberId: string;
  firstName: string;
  lastName: string;
  phone?: string;
  email?: string;
}): Promise<MemberActionResult> {
  const context = await requireAdminMemberAction("people");
  if (!context.ok) {
    return context;
  }

  const validated = validateMemberInput(input);
  if (!validated.ok) {
    return { ok: false, error: validated.error };
  }

  const { firstName, lastName, phone, email } = validated.data;

  const { data, error } = await context.supabase
    .from("members")
    .update({
      first_name: firstName,
      last_name: lastName,
      phone,
      email,
    })
    .eq("id", input.memberId)
    .eq("church_id", context.churchId)
    .select("id, first_name, last_name, phone, email, photo_url, is_active")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Could not update person." };
  }

  revalidatePeoplePaths();
  return { ok: true, member: mapMemberRow(data) };
}

export async function deactivateMember(memberId: string): Promise<MemberActionResult> {
  const context = await requireAdminMemberAction("people");
  if (!context.ok) {
    return context;
  }

  const { data, error } = await context.supabase
    .from("members")
    .update({ is_active: false })
    .eq("id", memberId)
    .eq("church_id", context.churchId)
    .select("id, first_name, last_name, phone, email, photo_url, is_active")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Could not deactivate person." };
  }

  revalidatePeoplePaths();
  return { ok: true, member: mapMemberRow(data) };
}

export async function reactivateMember(memberId: string): Promise<MemberActionResult> {
  const context = await requireAdminMemberAction("people");
  if (!context.ok) {
    return context;
  }

  const { data, error } = await context.supabase
    .from("members")
    .update({ is_active: true })
    .eq("id", memberId)
    .eq("church_id", context.churchId)
    .select("id, first_name, last_name, phone, email, photo_url, is_active")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Could not reactivate person." };
  }

  revalidatePeoplePaths();
  return { ok: true, member: mapMemberRow(data) };
}
