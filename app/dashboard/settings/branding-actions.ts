"use server";
import { revalidatePath } from "next/cache";
import { getChurchAuth } from "@/lib/auth/church";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseImageCrop, saveBrandingImage } from "@/lib/branding/images";

export async function updateChurchBranding(kind: "logo" | "cover", form: FormData) {
  const auth = await getChurchAuth();
  if (!auth?.isAdmin) return { error: "Only church admins can change church images." };
  if (kind !== "logo" && kind !== "cover") return { error: "Choose a logo or cover." };
  const admin = createAdminClient();
  const { data: church } = await admin.from("churches").select("logo_url, cover_image_url").eq("id", auth.churchId).maybeSingle();
  if (!church) return { error: "Church not found." };
  const file = form.get("photo");
  const removing = form.get("remove") === "true";
  if (!removing && (!(file instanceof File) || !file.size || file.size > 12 * 1024 * 1024)) return { error: "Choose an image under 12 MB." };
  try {
    const result = await saveBrandingImage(admin, { actorUserId: auth.userId, churchId: auth.churchId, kind, previousUrl: kind === "logo" ? church.logo_url : church.cover_image_url }, removing ? null : Buffer.from(await (file as File).arrayBuffer()), parseImageCrop(form.get("crop")));
    revalidatePath("/dashboard", "layout");
    return result;
  } catch { return { error: "The image could not be saved. Refresh and try again." }; }
}
