"use server";

import { requireChurchAuth, type ChurchAuth } from "@/lib/auth/church";
import { toUserError, UserFacingError } from "@/lib/errors/user-error";
import { featureActionError } from "@/lib/features/guard";
import { assertId, assertItem, cleanText, NOT_FOUND } from "@/lib/service-plans/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Files and links on one plan item. Same shape as song files: a server-issued
 * signed upload into the private `song-files` bucket under
 * <church>/plans/<plan>/, a row once the object is really there, and
 * two-minute signed URLs to open. Each action checks the caller first.
 */

type Fail = { ok: false; error: string };
type Ok<T = object> = { ok: true } & T;
type Admin = ReturnType<typeof createAdminClient>;

const BUCKET = "song-files";
const UPLOAD_TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "text/plain", "audio/mpeg", "audio/mp4"]);

async function planner(): Promise<{ auth: ChurchAuth; admin: Admin }> {
  const auth = await requireChurchAuth();
  const denied = await featureActionError("service_plans");
  if (denied) throw new UserFacingError(denied);
  return { auth, admin: createAdminClient() };
}

function failed(error: unknown, fallback: string): Fail {
  return { ok: false, error: toUserError(error, fallback) };
}

function safeFileName(name: unknown): string {
  const base = typeof name === "string" ? (name.split(/[\\/]/).pop() ?? "") : "";
  const cleaned = base
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(-100);
  return cleaned || "file";
}

async function liveItem(admin: Admin, churchId: string, itemId: unknown) {
  const item = await assertItem(admin, churchId, assertId(itemId));
  if (item.itemType === "header") throw new UserFacingError("Section headers can't hold files. Add the file to an item.");
  return item;
}

export async function createItemFileUploadAction(
  itemId: string,
  fileName: string,
  contentType: string,
): Promise<Ok<{ path: string; token: string }> | Fail> {
  try {
    const { auth, admin } = await planner();
    if (!UPLOAD_TYPES.has(contentType)) {
      throw new UserFacingError("Upload a PDF, a picture (PNG or JPEG), a text file, or MP3 or M4A audio.");
    }
    const item = await liveItem(admin, auth.churchId, itemId);
    const path = `${auth.churchId}/plans/${item.planId}/${crypto.randomUUID()}-${safeFileName(fileName)}`;
    const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: false });
    if (error || !data) throw error ?? new Error("Upload unavailable");
    return { ok: true, path: data.path, token: data.token };
  } catch (error) {
    return failed(error, "We couldn't start that upload.");
  }
}

export async function confirmItemFileAction(input: {
  itemId: string;
  path: string;
  fileName: string;
}): Promise<Ok | Fail> {
  try {
    const { auth, admin } = await planner();
    const item = await liveItem(admin, auth.churchId, input.itemId);
    const folder = `${auth.churchId}/plans/${item.planId}`;
    const path = typeof input.path === "string" ? input.path : "";
    const name = path.slice(folder.length + 1);
    if (!path.startsWith(`${folder}/`) || !name || name.includes("/") || path.length > 500) {
      throw new UserFacingError(NOT_FOUND);
    }
    const { data: listed, error: listError } = await admin.storage.from(BUCKET).list(folder, { search: name, limit: 5 });
    if (listError) throw listError;
    if (!(listed ?? []).some((o) => o.name === name)) throw new UserFacingError("The upload didn't finish. Please try again.");
    const { error } = await admin.from("plan_item_attachments").insert({
      church_id: auth.churchId,
      plan_id: item.planId,
      plan_item_id: item.id,
      storage_path: path,
      file_name: cleanText(input.fileName, 255) ?? name,
      created_by: auth.userId,
    });
    if (error) throw error;
    return { ok: true };
  } catch (error) {
    return failed(error, "We couldn't save that file.");
  }
}

export async function addItemLinkAction(itemId: string, url: string, label?: string | null): Promise<Ok | Fail> {
  try {
    const { auth, admin } = await planner();
    const item = await liveItem(admin, auth.churchId, itemId);
    let parsed: URL;
    try {
      parsed = new URL(typeof url === "string" ? url.trim() : "");
    } catch {
      throw new UserFacingError("Paste a full link that starts with https://");
    }
    if (parsed.protocol !== "https:" || parsed.href.length > 2048) {
      throw new UserFacingError("Paste a full link that starts with https://");
    }
    const { error } = await admin.from("plan_item_attachments").insert({
      church_id: auth.churchId,
      plan_id: item.planId,
      plan_item_id: item.id,
      url: parsed.href,
      file_name: cleanText(label, 255) ?? parsed.hostname,
      created_by: auth.userId,
    });
    if (error) throw error;
    return { ok: true };
  } catch (error) {
    return failed(error, "We couldn't add that link.");
  }
}

export async function deleteItemFileAction(fileId: string): Promise<Ok | Fail> {
  try {
    const { auth, admin } = await planner();
    const { data, error } = await admin
      .from("plan_item_attachments")
      .delete()
      .eq("church_id", auth.churchId)
      .eq("id", assertId(fileId))
      .select("storage_path")
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new UserFacingError(NOT_FOUND);
    const path = (data.storage_path as string | null) ?? null;
    if (path) {
      const { error: removeError } = await admin.storage.from(BUCKET).remove([path]);
      // The row is gone already; a leftover private file is only storage.
      if (removeError) console.error("plan item file remove:", removeError.message);
    }
    return { ok: true };
  } catch (error) {
    return failed(error, "We couldn't delete that file.");
  }
}

/** A two-minute link to open a stored file shown on a plan: an item's own, or its song's. */
export async function getPlanFileUrlAction(source: "item" | "song", fileId: string): Promise<Ok<{ url: string }> | Fail> {
  try {
    const { auth, admin } = await planner();
    if (source !== "item" && source !== "song") throw new UserFacingError(NOT_FOUND);
    const { data, error } = await admin
      .from(source === "item" ? "plan_item_attachments" : "song_attachments")
      .select("storage_path, url")
      .eq("church_id", auth.churchId)
      .eq("id", assertId(fileId))
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new UserFacingError(NOT_FOUND);
    if (data.url) return { ok: true, url: data.url as string };
    const path = (data.storage_path as string | null) ?? "";
    if (!path.startsWith(`${auth.churchId}/`)) throw new UserFacingError(NOT_FOUND);
    const signed = await admin.storage.from(BUCKET).createSignedUrl(path, 120);
    if (signed.error || !signed.data) throw signed.error ?? new Error("Signed URL unavailable");
    return { ok: true, url: signed.data.signedUrl };
  } catch (error) {
    return failed(error, "We couldn't open that file.");
  }
}
