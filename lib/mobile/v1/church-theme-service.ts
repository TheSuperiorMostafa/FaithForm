import { createChurchAppTheme } from "@/lib/branding/church-theme";
import { normalizeHexColor } from "@/lib/giving/branding";
import { MobileError } from "@/lib/mobile/v1/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import type { z } from "zod";
import type { churchThemeSettingsSchema } from "@/lib/mobile/v1/contract";

type ChurchThemeSettings = z.infer<typeof churchThemeSettingsSchema>;

export async function updateChurchTheme(
  userId: string,
  churchSlug: string,
  input: { primaryColor: string | null; accentColor: string | null },
): Promise<ChurchThemeSettings> {
  const admin = createAdminClient();
  const { data: church } = await admin
    .from("churches")
    .select("id")
    .eq("slug", churchSlug)
    .maybeSingle();
  if (!church?.id) throw new MobileError("not_found", "Church not found.");

  const { data: membership } = await admin
    .from("church_users")
    .select("role")
    .eq("church_id", church.id)
    .eq("user_id", userId)
    .maybeSingle();
  if (membership?.role !== "admin") {
    throw new MobileError("forbidden", "Only church admins can change appearance.");
  }

  const primaryColor = normalizeHexColor(input.primaryColor);
  const accentColor = normalizeHexColor(input.accentColor);
  const { error } = await admin
    .from("churches")
    .update({
      giving_primary_color: primaryColor,
      giving_accent_color: accentColor,
    })
    .eq("id", church.id);
  if (error) throw new MobileError("unavailable", "Could not save church appearance.");

  return {
    primaryColor,
    accentColor,
    appTheme: createChurchAppTheme(primaryColor, accentColor),
  };
}
