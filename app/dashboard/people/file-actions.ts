"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";

import { getChurchAuth } from "@/lib/auth/church";
import {
  isAllowedMemberFileType,
  MAX_FILES_PER_MEMBER,
  MAX_MEMBER_FILE_BYTES,
  MEMBER_FILES_BUCKET,
  memberFileExtension,
  sanitizeMemberFileName,
  ALLOWED_MEMBER_FILE_EXTENSIONS,
} from "@/lib/checkin/member-files";
import { featureActionError } from "@/lib/features/guard";
import { createAdminClient } from "@/lib/supabase/admin";

export type MemberFileResult = { ok: true } | { ok: false; error: string };

/**
 * Uploading and deleting a person's documents is a church-admin action.
 *
 * Not because a volunteer could not be trusted with a waiver, but because the
 * same control carries background checks, and the default has to be set by the
 * most sensitive thing that passes through it. A church that wants a particular
 * file seen more widely marks that file staff-visible; the reverse — tightening
 * a default after somebody has already uploaded under it — never happens.
 */
async function requireFileAdmin() {
  const auth = await getChurchAuth();
  if (!auth) return { ok: false as const, error: "You must be signed in." };

  const featureError = await featureActionError("people");
  if (featureError) return { ok: false as const, error: featureError };

  if (!auth.isAdmin) {
    return {
      ok: false as const,
      error: "Only church admins can manage a person's documents.",
    };
  }

  return { ok: true as const, auth, admin: createAdminClient() };
}

export async function uploadMemberFile(
  formData: FormData,
): Promise<MemberFileResult> {
  const guard = await requireFileAdmin();
  if (!guard.ok) return guard;

  const memberId = formData.get("memberId")?.toString().trim() ?? "";
  const label = formData.get("label")?.toString().trim() ?? "";
  const visibility =
    formData.get("visibility")?.toString() === "staff" ? "staff" : "church_admin";
  const expiresOn = formData.get("expiresOn")?.toString().trim() || null;

  if (!memberId) return { ok: false, error: "Pick a person." };
  if (!label) return { ok: false, error: "Give the document a label." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose a file to upload." };
  }

  if (file.size > MAX_MEMBER_FILE_BYTES) {
    return {
      ok: false,
      error: `${file.name} is over ${Math.round(MAX_MEMBER_FILE_BYTES / (1024 * 1024))}MB. Upload a smaller file.`,
    };
  }

  const mimeType = (file.type || "").toLowerCase();
  if (!isAllowedMemberFileType(mimeType)) {
    return {
      ok: false,
      error: `That file type cannot be stored. Allowed: ${ALLOWED_MEMBER_FILE_EXTENSIONS.join(", ")}.`,
    };
  }

  // The member id arrives from a browser. Without this, a guessed id would
  // attach a document to somebody in another church.
  const { data: member } = await guard.admin
    .from("members")
    .select("id")
    .eq("id", memberId)
    .eq("church_id", guard.auth.churchId)
    .maybeSingle();

  if (!member) return { ok: false, error: "That person could not be found." };

  const { count } = await guard.admin
    .from("member_files")
    .select("id", { count: "exact", head: true })
    .eq("member_id", memberId);

  if ((count ?? 0) >= MAX_FILES_PER_MEMBER) {
    return {
      ok: false,
      error: `A person can hold ${MAX_FILES_PER_MEMBER} documents. Remove one first.`,
    };
  }

  const extension = memberFileExtension(mimeType);
  const fileName = sanitizeMemberFileName(file.name, extension);
  const storagePath = `${guard.auth.churchId}/${memberId}/${randomUUID()}.${extension}`;

  const { error: uploadError } = await guard.admin.storage
    .from(MEMBER_FILES_BUCKET)
    .upload(storagePath, Buffer.from(await file.arrayBuffer()), {
      contentType: mimeType,
      upsert: false,
    });

  if (uploadError) {
    console.error("[member-files] upload failed:", uploadError.message);
    return { ok: false, error: "That file could not be uploaded. Try again." };
  }

  const { error: insertError } = await guard.admin.from("member_files").insert({
    church_id: guard.auth.churchId,
    member_id: memberId,
    storage_path: storagePath,
    label,
    file_name: fileName,
    mime_type: mimeType,
    size_bytes: file.size,
    visibility,
    expires_on: expiresOn,
    uploaded_by: guard.auth.userId,
    uploaded_by_name: guard.auth.userEmail || null,
  });

  if (insertError) {
    // The object is removed rather than left behind: a stored file with no row
    // is invisible to every screen and to every deletion path.
    await guard.admin.storage.from(MEMBER_FILES_BUCKET).remove([storagePath]);
    console.error("[member-files] insert failed:", insertError.message);
    return { ok: false, error: "That file could not be saved." };
  }

  revalidatePath("/dashboard/people");
  return { ok: true };
}

export async function deleteMemberFile(
  fileId: string,
): Promise<MemberFileResult> {
  const guard = await requireFileAdmin();
  if (!guard.ok) return guard;

  const { data: file } = await guard.admin
    .from("member_files")
    .select("id, storage_path")
    .eq("id", fileId)
    .eq("church_id", guard.auth.churchId)
    .maybeSingle();

  if (!file) return { ok: false, error: "That document could not be found." };

  const { error } = await guard.admin
    .from("member_files")
    .delete()
    .eq("id", fileId);

  if (error) return { ok: false, error: "That document could not be removed." };

  await guard.admin.storage
    .from(MEMBER_FILES_BUCKET)
    .remove([file.storage_path as string]);

  revalidatePath("/dashboard/people");
  return { ok: true };
}
