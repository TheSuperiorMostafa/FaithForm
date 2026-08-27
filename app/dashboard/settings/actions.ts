"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import {
  ALLOWED_ATTACHMENT_EXTENSIONS,
  COMMUNICATION_ATTACHMENTS_BUCKET,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_CHURCH,
  extensionForMimeType,
  isAllowedAttachmentType,
  listCommunicationAttachments,
  sanitizeAttachmentName,
} from "@/lib/announcements/attachments";
import { getChurchAuth } from "@/lib/auth/church";
import { featureActionError } from "@/lib/features/guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { upsertFollowUpMessageTemplates } from "@/lib/queries/follow-up-settings";
import { upsertAnnouncementEmailSettings } from "@/lib/queries/announcement-email-settings";
import {
  DEFAULT_ANNOUNCEMENT_EMAIL_BODY,
  DEFAULT_ANNOUNCEMENT_EMAIL_SUBJECT,
  validateAnnouncementEmailTemplate,
} from "@/lib/email/announcement-template";
import {
  DEFAULT_FOLLOW_UP_TEMPLATES,
  FOLLOW_UP_TEMPLATE_COUNT,
  validateFollowUpTemplates,
} from "@/lib/sms/follow-up-messages";

export type SettingsFormState = {
  ok: boolean;
  error?: string;
};

export async function updateFollowUpMessages(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const auth = await getChurchAuth();
  if (!auth) {
    return { ok: false, error: "Not signed in." };
  }
  if (!auth.isAdmin) {
    return {
      ok: false,
      error: "Only church admins can change follow-up messages.",
    };
  }

  const featureError = await featureActionError("attendance");
  if (featureError) return { ok: false, error: featureError };

  const reset = formData.get("reset")?.toString() === "1";
  const templates = reset
    ? [...DEFAULT_FOLLOW_UP_TEMPLATES]
    : Array.from({ length: FOLLOW_UP_TEMPLATE_COUNT }, (_, index) =>
        formData.get(`message_${index}`)?.toString() ?? "",
      );

  const validated = validateFollowUpTemplates(templates);
  if (!validated.ok) {
    return { ok: false, error: validated.error };
  }

  try {
    await upsertFollowUpMessageTemplates(
      auth.churchId,
      validated.templates,
    );
    revalidatePath("/dashboard/settings");
    revalidatePath("/dashboard/attendance");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not save messages.",
    };
  }
}

export async function updateAnnouncementEmailSettings(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const auth = await getChurchAuth();
  if (!auth) {
    return { ok: false, error: "Not signed in." };
  }
  if (!auth.isAdmin) {
    return {
      ok: false,
      error: "Only church admins can change announcement email settings.",
    };
  }

  const featureError = await featureActionError("announcements");
  if (featureError) return { ok: false, error: featureError };

  const reset = formData.get("reset")?.toString() === "1";
  const subject = reset
    ? DEFAULT_ANNOUNCEMENT_EMAIL_SUBJECT
    : (formData.get("announcement_email_subject")?.toString() ?? "");
  const body = reset
    ? DEFAULT_ANNOUNCEMENT_EMAIL_BODY
    : (formData.get("announcement_email_body")?.toString() ?? "");
  const toRaw = reset
    ? ""
    : (formData.get("announcement_email_to")?.toString() ?? "");
  const to = toRaw.trim() || null;
  const weeklyEmailEnabled = reset
    ? true
    : formData.get("weekly_email_enabled")?.toString() === "true";

  const validated = validateAnnouncementEmailTemplate(subject, body, to);
  if (!validated.ok) {
    return { ok: false, error: validated.error };
  }

  try {
    await upsertAnnouncementEmailSettings(auth.churchId, {
      subject,
      body,
      to,
      weeklyEmailEnabled,
    });
    revalidatePath("/dashboard/settings");
    revalidatePath("/dashboard/announcements");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not save email template.",
    };
  }
}

export type AttachmentActionResult = { ok: boolean; error?: string };

async function guardCommunicationsAdmin(): Promise<
  { ok: true; churchId: string; userId: string } | { ok: false; error: string }
> {
  const auth = await getChurchAuth();
  if (!auth) return { ok: false, error: "Not signed in." };
  if (!auth.isAdmin) {
    return {
      ok: false,
      error: "Only church admins can change email attachments.",
    };
  }

  const featureError = await featureActionError("announcements");
  if (featureError) return { ok: false, error: featureError };

  return { ok: true, churchId: auth.churchId, userId: auth.userId };
}

/**
 * Adds a file to the weekly email's standing attachment list.
 *
 * The path is prefixed with the church id so one church can never reach
 * another's file, and the stored name is a fresh uuid — the name a person chose
 * is kept in the row and used only as the filename in the sent message, never
 * as a path.
 */
export async function uploadCommunicationAttachment(
  formData: FormData,
): Promise<AttachmentActionResult> {
  const guard = await guardCommunicationsAdmin();
  if (!guard.ok) return { ok: false, error: guard.error };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose a file to attach." };
  }

  if (file.size > MAX_ATTACHMENT_BYTES) {
    return {
      ok: false,
      error: `${file.name} is over ${Math.round(MAX_ATTACHMENT_BYTES / (1024 * 1024))}MB. Attach a smaller file.`,
    };
  }

  const mimeType = (file.type || "").toLowerCase();
  if (!isAllowedAttachmentType(mimeType)) {
    return {
      ok: false,
      error: `That file type can't be attached. Allowed: ${ALLOWED_ATTACHMENT_EXTENSIONS.join(", ")}.`,
    };
  }

  const admin = createAdminClient();

  const existing = await listCommunicationAttachments(guard.churchId, admin);
  if (existing.length >= MAX_ATTACHMENTS_PER_CHURCH) {
    return {
      ok: false,
      error: `The weekly email can carry ${MAX_ATTACHMENTS_PER_CHURCH} files. Remove one first.`,
    };
  }

  const extension = extensionForMimeType(mimeType);
  const fileName = sanitizeAttachmentName(file.name, extension);
  const storagePath = `${guard.churchId}/${randomUUID()}.${extension}`;

  const { error: uploadError } = await admin.storage
    .from(COMMUNICATION_ATTACHMENTS_BUCKET)
    .upload(storagePath, Buffer.from(await file.arrayBuffer()), {
      contentType: mimeType,
      upsert: false,
    });

  if (uploadError) {
    console.error("[communications] attachment upload failed:", uploadError.message);
    return { ok: false, error: "That file could not be uploaded. Please try again." };
  }

  const { error: insertError } = await admin
    .from("communication_attachments")
    .insert({
      church_id: guard.churchId,
      storage_path: storagePath,
      file_name: fileName,
      mime_type: mimeType,
      size_bytes: file.size,
      uploaded_by: guard.userId,
    });

  if (insertError) {
    // The row is what makes the object findable, so an orphan is swept up here
    // rather than left paid for and unreachable.
    await admin.storage
      .from(COMMUNICATION_ATTACHMENTS_BUCKET)
      .remove([storagePath]);

    const missingTable = /communication_attachments/i.test(insertError.message);
    console.error("[communications] attachment record failed:", insertError.message);
    return {
      ok: false,
      error: missingTable
        ? "Attachments aren't set up on this database yet — run `pnpm db:communications`."
        : "That file could not be attached. Please try again.",
    };
  }

  revalidatePath("/dashboard/settings");
  return { ok: true };
}

export async function removeCommunicationAttachment(
  attachmentId: string,
): Promise<AttachmentActionResult> {
  const guard = await guardCommunicationsAdmin();
  if (!guard.ok) return { ok: false, error: guard.error };

  const admin = createAdminClient();

  // Scoped to the church on the way in: an id alone must not be enough to
  // delete another church's file.
  const { data: row, error: loadError } = await admin
    .from("communication_attachments")
    .select("id, storage_path")
    .eq("id", attachmentId)
    .eq("church_id", guard.churchId)
    .maybeSingle();

  if (loadError) {
    return { ok: false, error: "That attachment could not be removed." };
  }
  if (!row) {
    return { ok: false, error: "That attachment is no longer there." };
  }

  const { error: deleteError } = await admin
    .from("communication_attachments")
    .delete()
    .eq("id", attachmentId)
    .eq("church_id", guard.churchId);

  if (deleteError) {
    return { ok: false, error: "That attachment could not be removed." };
  }

  // The row is gone either way; a failed object delete leaves bytes behind but
  // nothing that reaches an email.
  await admin.storage
    .from(COMMUNICATION_ATTACHMENTS_BUCKET)
    .remove([row.storage_path as string]);

  revalidatePath("/dashboard/settings");
  return { ok: true };
}
