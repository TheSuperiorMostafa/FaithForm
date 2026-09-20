import { requireActiveAccount } from "@/lib/faithform/account";
import { createAdminClient } from "@/lib/supabase/admin";
import { MobileError } from "@/lib/mobile/v1/errors";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { readPhotoBody } from "@/lib/faithform/profile-photo";
import { brandingPhotoRequestSchema, decodeBrandingPhoto } from "./images";

export async function readBrandingPhoto(request: Request, userId: string) {
  const budget = await checkRateLimit(`branding-photo:${userId}`, { limit: 20, windowMs: 3_600_000 });
  if (!budget.ok) throw new MobileError(budget.reason === "limited" ? "rate_limited" : "unavailable", "Please try again later.", { retryAfterSeconds: budget.retryAfterSeconds });
  const parsed = brandingPhotoRequestSchema.safeParse(await readPhotoBody(request));
  if (!parsed.success) throw new MobileError("invalid_request", "Choose a valid photo.");
  return decodeBrandingPhoto(parsed.data.imageBase64);
}

export async function churchBrandingContext(userId: string, slug: string) {
  await requireActiveAccount(userId);
  const admin = createAdminClient();
  const { data: church, error } = await admin.from("churches").select("id, logo_url, cover_image_url").eq("slug", slug).maybeSingle();
  if (error) throw new MobileError("unavailable", "Please try again.");
  if (!church) throw new MobileError("not_found", "Church not found.");
  const { data: staff, error: staffError } = await admin.from("church_users").select("role").eq("church_id", church.id).eq("user_id", userId).maybeSingle();
  if (staffError) throw new MobileError("unavailable", "Please try again.");
  return { admin, church, canEdit: staff?.role === "admin" };
}
