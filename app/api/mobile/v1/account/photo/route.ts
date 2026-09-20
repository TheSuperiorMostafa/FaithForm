import { updateProfilePhotoRequestSchema } from "@/lib/mobile/v1/contract";
import { randomUUID } from "node:crypto";
import { authenticatedRoute } from "@/lib/mobile/v1/handler";
import { MobileError } from "@/lib/mobile/v1/errors";
import { ensureVisitorAccount } from "@/lib/faithform/account";
import { prepareProfilePhoto, readPhotoBody } from "@/lib/faithform/profile-photo";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const BUCKET = "profile-photos";

export const PUT = authenticatedRoute({ cache: "private-no-store" }, async ({ userId, request }) => {
  const account = await ensureVisitorAccount(userId);
  if (account.status !== "active") throw new MobileError("forbidden", "This account is not active.");
  const budget = await checkRateLimit(`profile-photo:${userId}`, { limit: 15, windowMs: 60 * 60 * 1000 });
  if (!budget.ok) throw new MobileError(budget.reason === "limited" ? "rate_limited" : "unavailable", "Please try again later.", { retryAfterSeconds: budget.retryAfterSeconds });
  const parsed = updateProfilePhotoRequestSchema.safeParse(await readPhotoBody(request));
  if (!parsed.success) {
    throw new MobileError("invalid_request", "Choose a photo.");
  }
  const body = parsed.data;
  const admin = createAdminClient();
  const storage = admin.storage.from(BUCKET);
  let path: string | null = null;
  let avatarUrl: string | null = null;
  if (body.jpegBase64 !== null) {
    const jpeg = await prepareProfilePhoto(body.jpegBase64);
    path = `${userId}/${randomUUID()}.jpg`;
    const { error } = await storage.upload(path, jpeg, { contentType: "image/jpeg", cacheControl: "31536000", upsert: false });
    if (error) throw new MobileError("unavailable", "Your photo could not be saved. Try again.");
    avatarUrl = storage.getPublicUrl(path).data.publicUrl;
  }
  try {
    // Recheck lifecycle at the write, in case deletion began during the upload.
    const { data, error } = await admin.from("visitor_accounts")
      .update({ avatar_url: avatarUrl, updated_at: new Date().toISOString() })
      .eq("id", account.id).eq("user_id", userId).eq("status", "active")
      .select("id").maybeSingle();
    if (error || !data) throw new MobileError("unavailable", "Your photo could not be saved. Try again.");
  } catch (error) {
    // A lost database response can follow a committed write. Never delete an
    // image that might already be referenced; an orphan is safer than data loss.
    if (path) {
      const current = await admin.from("visitor_accounts").select("avatar_url")
        .eq("id", account.id).maybeSingle().then(result => result, () => null);
      if (current && !current.error && current.data?.avatar_url !== avatarUrl) {
        await storage.remove([path]).catch(() => null);
      }
    }
    throw error;
  }
  // Only remove our own objects, never a provider image or another user's file.
  const prefix = storage.getPublicUrl(`${userId}/`).data.publicUrl;
  if (account.avatarUrl?.startsWith(prefix)) {
    const oldName = account.avatarUrl.slice(prefix.length);
    if (/^[a-f0-9-]+\.jpg$/.test(oldName)) await storage.remove([`${userId}/${oldName}`]).catch(() => null);
  }
  return { data: { avatarUrl } };
});
