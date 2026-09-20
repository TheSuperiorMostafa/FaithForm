import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeSiteImage, type CropRect } from "@/lib/security/validate-image";
import { MobileError } from "@/lib/mobile/v1/errors";

export const imageCropSchema = z.object({ x: z.number().finite().min(0), y: z.number().finite().min(0), width: z.number().finite().positive(), height: z.number().finite().positive() }).strict();
export function parseImageCrop(value: FormDataEntryValue | null): CropRect | null {
  if (value === null) return null;
  try { return imageCropSchema.parse(JSON.parse(String(value))); }
  catch { throw new MobileError("invalid_request", "Choose a valid image crop."); }
}
export { brandingPhotoRequestSchema } from "@/lib/mobile/v1/contract";
export function decodeBrandingPhoto(value: string | null): Buffer | null {
  if (value === null) return null;
  if (!value || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new MobileError("invalid_request", "Choose a valid photo.");
  return Buffer.from(value, "base64");
}
const BUCKET = "branding-images";
export type BrandingTarget = { actorUserId: string; churchId: string; groupId?: string; kind: "logo" | "cover"; previousUrl: string | null };

/** Call only after deriving the tenant and edit capability from the authenticated user. */
export async function saveBrandingImage(admin: SupabaseClient, target: BrandingTarget, bytes: Buffer | null, crop: CropRect | null = null): Promise<{ url: string | null }> {
  const prefix = target.groupId ? `${target.churchId}/groups/${target.groupId}/` : `${target.churchId}/church/`;
  const storage = admin.storage.from(BUCKET);
  let path: string | null = null;
  let url: string | null = null;
  if (bytes) {
    if (!bytes.length || bytes.length > 12 * 1024 * 1024) throw new MobileError("payload_too_large", "Choose an image under 12 MB.");
    // A group's photo is its logo, not a banner: the apps show it square in
    // lists, headers and the conversation title, so it is stored square. Only
    // the church cover is genuinely wide.
    const output = target.kind === "logo" || target.groupId ? { width: 1024, height: 1024 } : { width: 1600, height: 900 };
    const normalized = await normalizeSiteImage(bytes, { crop, output });
    if (!normalized) throw new MobileError("invalid_request", "Choose a readable JPG, PNG or WebP image.");
    path = `${prefix}${target.kind}-${randomUUID()}.${normalized.ext}`;
    const result = await storage.upload(path, normalized.buffer, { contentType: normalized.contentType, cacheControl: "31536000", upsert: false });
    if (result.error) throw new MobileError("unavailable", "Your image could not be uploaded. Try again.");
    url = storage.getPublicUrl(path).data.publicUrl;
  }
  const column = target.kind === "logo" ? "logo_url" : "cover_image_url";
  let update = admin.from(target.groupId ? "groups" : "churches")
    .update({ [column]: url, ...(target.groupId ? { cover_image_path: path, updated_by: target.actorUserId } : {}) })
    .eq("id", target.groupId ?? target.churchId);
  if (target.groupId) update = update.eq("church_id", target.churchId).neq("status", "deleted");
  // Compare-and-swap prevents concurrent uploads from deleting the winning image.
  update = target.previousUrl === null ? update.is(column, null) : update.eq(column, target.previousUrl);
  const result = await update.select("id").maybeSingle();
  if (result.error || !result.data) {
    // A transport error can be ambiguous: only clean up after a confirmed loser.
    if (!result.error && path) await storage.remove([path]);
    throw new MobileError("unavailable", "The image could not be saved. Refresh and try again.");
  }
  const publicPrefix = storage.getPublicUrl(prefix).data.publicUrl;
  if (target.previousUrl?.startsWith(publicPrefix)) {
    const name = target.previousUrl.slice(publicPrefix.length);
    if (/^(logo|cover)-[a-f0-9-]+\.(jpg|png)$/.test(name)) await storage.remove([`${prefix}${name}`]).catch(() => undefined);
  }
  return { url };
}
