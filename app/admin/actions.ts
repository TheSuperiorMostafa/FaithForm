"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSuperAdmin } from "@/lib/auth/superadmin";
import { sendInviteEmail } from "@/lib/email/invite";
import type {
  AdminRole,
  SupportTicketPriority,
  SupportTicketStatus,
} from "@/lib/queries/admin";
import { createAdminClient } from "@/lib/supabase/admin";

function readString(formData: FormData, key: string): string {
  return formData.get(key)?.toString().trim() ?? "";
}

function isRole(value: string): value is AdminRole {
  return value === "admin" || value === "viewer";
}

function isPriority(value: string): value is SupportTicketPriority {
  return value === "low" || value === "normal" || value === "high" || value === "urgent";
}

function isStatus(value: string): value is SupportTicketStatus {
  return value === "open" || value === "in_progress" || value === "resolved";
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function generateSlug(name: string): string {
  const tempId = crypto.randomUUID();
  const baseSlug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${baseSlug || "church"}-${tempId.replace(/-/g, "").slice(0, 8)}`;
}

export type CreateChurchResult =
  | { ok: true; churchId: string; email: string | null }
  | { ok: false; error: string };

/**
 * Stands a church up, with or without its first admin.
 *
 * A church usually arrives before its admin does: we agree to onboard them on
 * a call, build out the profile, features and website ourselves, and only find
 * out weeks later which address the pastor actually reads. Requiring an email
 * up front meant inventing one, which then owned the workspace. Leave it out
 * and the church exists for us to work in; `inviteChurchAdmin` hands it over
 * whenever the real address turns up.
 */
export async function createChurch(
  formData: FormData,
): Promise<CreateChurchResult> {
  await requireSuperAdmin();

  const name = readString(formData, "name");
  const timezone = readString(formData, "timezone") || "America/New_York";
  const adminFirstName = readString(formData, "adminFirstName");
  const adminLastName = readString(formData, "adminLastName");
  const adminEmail = readString(formData, "adminEmail").toLowerCase();

  if (!name) {
    return { ok: false, error: "Church name is required." };
  }

  // Everything about the admin is optional together: either we know who they
  // are and invite them now, or we set the church up and invite later.
  const invitingAdmin = Boolean(adminEmail || adminFirstName || adminLastName);
  if (invitingAdmin) {
    if (!adminFirstName) {
      return { ok: false, error: "Admin first name is required." };
    }
    if (!adminLastName) {
      return { ok: false, error: "Admin last name is required." };
    }
    if (!isValidEmail(adminEmail)) {
      return { ok: false, error: "A valid admin email is required." };
    }
  }

  const admin = createAdminClient();
  const slug = generateSlug(name);

  const { data: church, error: churchError } = await admin
    .from("churches")
    .insert({ name, timezone, slug })
    .select("id, name")
    .single();

  if (churchError || !church) {
    return { ok: false, error: churchError?.message ?? "Could not create church." };
  }

  if (!invitingAdmin) {
    revalidatePath("/admin");
    revalidatePath("/admin/churches");
    return { ok: true, churchId: church.id, email: null };
  }

  const { data: invite, error: inviteError } = await admin
    .from("church_invites")
    .insert({
      church_id: church.id,
      email: adminEmail,
      admin_first_name: adminFirstName,
      admin_last_name: adminLastName,
    })
    .select("token")
    .single();

  if (inviteError || !invite) {
    await admin.from("churches").delete().eq("id", church.id);
    return {
      ok: false,
      error: inviteError?.message ?? "Could not create invite.",
    };
  }

  try {
    await sendInviteEmail({
      email: adminEmail,
      churchName: church.name,
      token: invite.token,
      adminFirstName,
    });
  } catch (err) {
    await admin.from("church_invites").delete().eq("church_id", church.id);
    await admin.from("churches").delete().eq("id", church.id);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to send invite email.",
    };
  }

  revalidatePath("/admin");
  revalidatePath("/admin/churches");
  return { ok: true, churchId: church.id, email: adminEmail };
}

export type InviteChurchAdminResult =
  | { ok: true; email: string }
  | { ok: false; error: string };

/**
 * Sends the first admin their invite, for a church that has been waiting
 * without one.
 *
 * Any invite still outstanding for this church is replaced rather than left
 * beside the new one: a corrected address should not leave the typo's link
 * live.
 */
export async function inviteChurchAdmin(
  formData: FormData,
): Promise<InviteChurchAdminResult> {
  await requireSuperAdmin();

  const churchId = readString(formData, "churchId");
  const adminFirstName = readString(formData, "adminFirstName");
  const adminLastName = readString(formData, "adminLastName");
  const adminEmail = readString(formData, "adminEmail").toLowerCase();

  if (!churchId) {
    return { ok: false, error: "Church is required." };
  }
  if (!adminFirstName) {
    return { ok: false, error: "Admin first name is required." };
  }
  if (!adminLastName) {
    return { ok: false, error: "Admin last name is required." };
  }
  if (!isValidEmail(adminEmail)) {
    return { ok: false, error: "A valid admin email is required." };
  }

  const admin = createAdminClient();
  const { data: church } = await admin
    .from("churches")
    .select("id, name, onboarding_completed_at")
    .eq("id", churchId)
    .maybeSingle();

  if (!church) {
    return { ok: false, error: "Church not found." };
  }
  if (church.onboarding_completed_at) {
    return {
      ok: false,
      error:
        "This church has already been set up. Add more people from its own Settings › Team.",
    };
  }

  await admin
    .from("church_invites")
    .delete()
    .eq("church_id", churchId)
    .is("accepted_at", null);

  const { data: invite, error: inviteError } = await admin
    .from("church_invites")
    .insert({
      church_id: churchId,
      email: adminEmail,
      admin_first_name: adminFirstName,
      admin_last_name: adminLastName,
    })
    .select("token")
    .single();

  if (inviteError || !invite) {
    return {
      ok: false,
      error: inviteError?.message ?? "Could not create invite.",
    };
  }

  try {
    await sendInviteEmail({
      email: adminEmail,
      churchName: church.name as string,
      token: invite.token,
      adminFirstName,
    });
  } catch (err) {
    await admin.from("church_invites").delete().eq("church_id", churchId);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to send invite email.",
    };
  }

  revalidatePath("/admin");
  revalidatePath("/admin/churches");
  revalidatePath(`/admin/churches/${churchId}`);
  return { ok: true, email: adminEmail };
}

export async function updateChurchUserRole(formData: FormData) {
  await requireSuperAdmin();

  const churchUserId = readString(formData, "churchUserId");
  const churchId = readString(formData, "churchId");
  const role = readString(formData, "role");

  if (!churchUserId || !churchId || !isRole(role)) {
    throw new Error("Invalid role update.");
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("church_users")
    .update({ role })
    .eq("id", churchUserId)
    .eq("church_id", churchId);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/admin/churches/${churchId}`);
  revalidatePath("/admin/users");
}

export async function createSupportTicket(formData: FormData) {
  const user = await requireSuperAdmin();

  const churchId = readString(formData, "churchId") || null;
  const subject = readString(formData, "subject");
  const body = readString(formData, "body") || null;
  const priority = readString(formData, "priority") || "normal";

  if (!subject || !isPriority(priority)) {
    throw new Error("Subject and priority are required.");
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("support_tickets")
    .insert({
      church_id: churchId,
      submitted_by: user.id,
      subject,
      body,
      priority,
      status: "open",
    })
    .select("id, church_id")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/admin");
  revalidatePath("/admin/support");
  if (data.church_id) {
    revalidatePath(`/admin/churches/${data.church_id}`);
  }

  redirect(`/admin/support/${data.id}`);
}

export async function updateSupportTicket(formData: FormData) {
  await requireSuperAdmin();

  const ticketId = readString(formData, "ticketId");
  const status = readString(formData, "status");
  const adminNotes = readString(formData, "adminNotes") || null;

  if (!ticketId || !isStatus(status)) {
    throw new Error("Invalid support ticket update.");
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("support_tickets")
    .update({
      status,
      admin_notes: adminNotes,
      updated_at: new Date().toISOString(),
    })
    .eq("id", ticketId)
    .select("church_id")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/admin");
  revalidatePath("/admin/support");
  revalidatePath(`/admin/support/${ticketId}`);
  if (data?.church_id) {
    revalidatePath(`/admin/churches/${data.church_id}`);
  }
}
