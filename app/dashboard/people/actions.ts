"use server";

import { revalidatePath } from "next/cache";

import { getChurchAuth } from "@/lib/auth/church";
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

async function requireAdminMemberAction(): Promise<
  | { ok: false; error: string }
  | { ok: true; churchId: string; supabase: ReturnType<typeof createClient> }
> {
  const auth = await getChurchAuth();
  if (!auth) {
    return { ok: false, error: "You must be signed in." };
  }
  if (!auth.isAdmin) {
    return { ok: false, error: "Only church admins can edit people." };
  }

  const supabase = createClient();
  return { ok: true, churchId: auth.churchId, supabase };
}

export async function createMember(input: {
  firstName: string;
  lastName: string;
  phone?: string;
  email?: string;
}): Promise<MemberActionResult> {
  const context = await requireAdminMemberAction();
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

export async function updateMember(input: {
  memberId: string;
  firstName: string;
  lastName: string;
  phone?: string;
  email?: string;
}): Promise<MemberActionResult> {
  const context = await requireAdminMemberAction();
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
  const context = await requireAdminMemberAction();
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
  const context = await requireAdminMemberAction();
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
