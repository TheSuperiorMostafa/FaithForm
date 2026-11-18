"use server";

import { revalidatePath } from "next/cache";

import { getChurchAuth } from "@/lib/auth/church";
import type { FeatureKey } from "@/lib/features/catalog";
import { featureActionError } from "@/lib/features/guard";
import type { ChurchMember } from "@/lib/queries/members";
import { validateMemberInput } from "@/lib/people/validate-member";
import { toUserError } from "@/lib/errors/user-error";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  isMemberGender,
  isMembershipStatus,
  type MemberGender,
  type MembershipStatus,
} from "@/lib/people/membership-status";

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
  membership_status?: MembershipStatus;
  address?: string | null;
  gender?: string | null;
}): ChurchMember {
  return {
    ...row,
    address: row.address ?? null,
    gender: isMemberGender(row.gender) ? row.gender : null,
    attendance_count: 0,
  };
}

const MEMBER_RETURN_COLUMNS =
  "id, first_name, last_name, phone, email, photo_url, is_active, membership_status";
const MEMBER_RETURN_COLUMNS_WITH_PROFILE = `${MEMBER_RETURN_COLUMNS}, address, gender`;

/** Address and gender arrived with migration 0168; an older database still saves the rest. */
function isMissingProfileColumn(error: { message?: string } | null): boolean {
  return Boolean(error?.message && /\b(address|gender)\b/.test(error.message));
}

type ProfileInput = { address?: string | null; gender?: MemberGender | "" | null };

function profileFields(input: ProfileInput): Record<string, string | null> {
  const fields: Record<string, string | null> = {};
  if (input.address !== undefined) {
    const address = (input.address ?? "").trim().replace(/\s+/g, " ").slice(0, 300);
    fields.address = address || null;
  }
  if (input.gender !== undefined) {
    fields.gender = input.gender ? input.gender : null;
  }
  return fields;
}

function invalidProfile(input: ProfileInput): string | null {
  if (input.gender && !isMemberGender(input.gender)) return "Choose Male or Female.";
  return null;
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
async function requireMemberAction(
  feature: FeatureKey,
  adminOnly = true,
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

  if (adminOnly && !auth.isAdmin) {
    return { ok: false, error: "Only church admins can edit people." };
  }

  // Basic People edits are permitted by the feature grant. Direct table
  // writes remain admin-only in RLS, so use the server client after this guard
  // and constrain every mutation below to the authenticated church and fields.
  const supabase = adminOnly ? createClient() : createAdminClient();
  return { ok: true, churchId: auth.churchId, supabase };
}

/** Shared body. Callers do their own gating before reaching this. */
async function insertMember(
  context: Extract<MemberContext, { ok: true }>,
  input: { firstName: string; lastName: string; phone?: string; email?: string; membershipStatus?: MembershipStatus } & ProfileInput,
): Promise<MemberActionResult> {
  if (input.membershipStatus !== undefined && !isMembershipStatus(input.membershipStatus)) {
    return { ok: false, error: "Choose a valid church status." };
  }
  const profileError = invalidProfile(input);
  if (profileError) return { ok: false, error: profileError };
  const validated = validateMemberInput(input);
  if (!validated.ok) {
    return { ok: false, error: validated.error };
  }

  const { firstName, lastName, phone, email } = validated.data;

  const base = {
    church_id: context.churchId,
    first_name: firstName,
    last_name: lastName,
    phone,
    email,
    ...(input.membershipStatus ? { membership_status: input.membershipStatus } : {}),
    is_active: true,
  };
  const profile = profileFields(input);
  let { data, error } = await context.supabase
    .from("members")
    .insert({ ...base, ...profile })
    .select(MEMBER_RETURN_COLUMNS_WITH_PROFILE)
    .single();
  if (isMissingProfileColumn(error)) {
    ({ data, error } = await context.supabase
      .from("members")
      .insert(base)
      .select(MEMBER_RETURN_COLUMNS)
      .single());
  }

  if (error || !data) {
    return { ok: false, error: toUserError(error, "We couldn't add this person.") };
  }

  revalidatePeoplePaths();
  return { ok: true, member: mapMemberRow(data as unknown as Parameters<typeof mapMemberRow>[0]) };
}

export async function createMember(input: {
  firstName: string;
  lastName: string;
  phone?: string;
  email?: string;
  membershipStatus?: MembershipStatus;
} & ProfileInput): Promise<MemberActionResult> {
  const context = await requireMemberAction("people", false);
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
  membershipStatus?: MembershipStatus;
}): Promise<MemberActionResult> {
  const context = await requireMemberAction("attendance");
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
  membershipStatus?: MembershipStatus;
} & ProfileInput): Promise<MemberActionResult> {
  const context = await requireMemberAction("people", false);
  if (!context.ok) {
    return context;
  }

  if (input.membershipStatus !== undefined && !isMembershipStatus(input.membershipStatus)) {
    return { ok: false, error: "Choose a valid church status." };
  }
  const profileError = invalidProfile(input);
  if (profileError) return { ok: false, error: profileError };
  const validated = validateMemberInput(input);
  if (!validated.ok) {
    return { ok: false, error: validated.error };
  }

  const { firstName, lastName, phone, email } = validated.data;

  const base = {
    first_name: firstName,
    last_name: lastName,
    phone,
    email,
    ...(input.membershipStatus ? { membership_status: input.membershipStatus } : {}),
  };
  const update = (fields: Record<string, unknown>, columns: string) =>
    context.supabase
      .from("members")
      .update(fields)
      .eq("id", input.memberId)
      .eq("church_id", context.churchId)
      .select(columns)
      .single();
  let { data, error } = await update({ ...base, ...profileFields(input) }, MEMBER_RETURN_COLUMNS_WITH_PROFILE);
  if (isMissingProfileColumn(error)) {
    ({ data, error } = await update(base, MEMBER_RETURN_COLUMNS));
  }

  if (error || !data) {
    return { ok: false, error: toUserError(error, "We couldn't save this person's details.") };
  }

  revalidatePeoplePaths();
  return { ok: true, member: mapMemberRow(data as unknown as Parameters<typeof mapMemberRow>[0]) };
}

export async function deactivateMember(memberId: string): Promise<MemberActionResult> {
  const context = await requireMemberAction("people");
  if (!context.ok) {
    return context;
  }

  const { data, error } = await context.supabase
    .from("members")
    .update({ is_active: false })
    .eq("id", memberId)
    .eq("church_id", context.churchId)
    .select("id, first_name, last_name, phone, email, photo_url, is_active, membership_status")
    .single();

  if (error || !data) {
    return { ok: false, error: toUserError(error, "We couldn't deactivate this person.") };
  }

  revalidatePeoplePaths();
  return { ok: true, member: mapMemberRow(data as unknown as Parameters<typeof mapMemberRow>[0]) };
}

export async function reactivateMember(memberId: string): Promise<MemberActionResult> {
  const context = await requireMemberAction("people");
  if (!context.ok) {
    return context;
  }

  const { data, error } = await context.supabase
    .from("members")
    .update({ is_active: true })
    .eq("id", memberId)
    .eq("church_id", context.churchId)
    .select("id, first_name, last_name, phone, email, photo_url, is_active, membership_status")
    .single();

  if (error || !data) {
    return { ok: false, error: toUserError(error, "We couldn't reactivate this person.") };
  }

  revalidatePeoplePaths();
  return { ok: true, member: mapMemberRow(data as unknown as Parameters<typeof mapMemberRow>[0]) };
}

export type BulkMemberUpdateResult =
  | { ok: true; updated: number; profileFieldsUnavailable?: boolean }
  | { ok: false; error: string };

/**
 * People list multiselect: one status and/or gender for everyone chosen.
 * Constrained to this church, like every other People write.
 */
export async function bulkUpdateMembers(input: {
  memberIds: string[];
  membershipStatus?: MembershipStatus;
  gender?: MemberGender | "";
}): Promise<BulkMemberUpdateResult> {
  const context = await requireMemberAction("people", false);
  if (!context.ok) {
    return context;
  }

  const memberIds = [...new Set(input.memberIds.filter((id) => typeof id === "string" && id))].slice(0, 1000);
  if (memberIds.length === 0) return { ok: false, error: "Choose at least one person." };
  if (input.membershipStatus !== undefined && !isMembershipStatus(input.membershipStatus)) {
    return { ok: false, error: "Choose a valid church status." };
  }
  const profileError = invalidProfile(input);
  if (profileError) return { ok: false, error: profileError };

  const fields: Record<string, string | null> = {
    ...(input.membershipStatus ? { membership_status: input.membershipStatus } : {}),
    ...profileFields({ gender: input.gender }),
  };
  if (Object.keys(fields).length === 0) return { ok: false, error: "Choose what to change." };

  const { data, error } = await context.supabase
    .from("members")
    .update(fields)
    .in("id", memberIds)
    .eq("church_id", context.churchId)
    .select("id");

  if (error) {
    if (isMissingProfileColumn(error)) {
      return { ok: false, error: "Gender isn't available yet. Try again after the next update." };
    }
    return { ok: false, error: toUserError(error, "We couldn't update these people.") };
  }

  revalidatePeoplePaths();
  return { ok: true, updated: (data ?? []).length };
}
