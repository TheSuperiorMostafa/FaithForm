import "server-only";

import sharp from "sharp";

import { isOwnStorageImage } from "@/components/church-app/app-flyer-content";
import { getChurchDiscoverySettings } from "@/lib/queries/faithform-settings";
import { createAdminClient } from "@/lib/supabase/admin";

export type ChurchFlyerData = {
  churchName: string;
  primaryColor: string | null;
  accentColor: string | null;
  logoUrl: string | null;
  findableInSearch: boolean;
};

/**
 * What the flyer and QR code need about one church: its public name, logo and
 * app colors, and whether app search can find it.
 *
 * `churchId` must come from the caller's own staff session; the admin client
 * bypasses row security, so this is the church boundary. Only fields the app
 * already shows the public are read.
 */
export async function loadChurchFlyerData(churchId: string): Promise<ChurchFlyerData | null> {
  const admin = createAdminClient();
  const [{ data, error }, discovery] = await Promise.all([
    admin
      .from("churches")
      .select("name, logo_url, giving_primary_color, giving_accent_color")
      .eq("id", churchId)
      .maybeSingle(),
    getChurchDiscoverySettings(churchId),
  ]);
  if (error || !data) return null;
  return {
    churchName: (data.name as string | null) ?? "",
    primaryColor: (data.giving_primary_color as string | null) ?? null,
    accentColor: (data.giving_accent_color as string | null) ?? null,
    logoUrl: (data.logo_url as string | null) ?? null,
    findableInSearch: discovery.isDiscoverable && discovery.joinPolicy !== "invite_only",
  };
}

const MAX_LOGO_BYTES = 8 * 1024 * 1024;

/** The church logo as a small PNG for the PDF, or null; a missing logo never blocks the flyer. */
export async function fetchLogoPng(url: string | null): Promise<Buffer | null> {
  if (!url || !isOwnStorageImage(url)) return null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5_000), redirect: "error" });
    if (!response.ok) return null;
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > MAX_LOGO_BYTES) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_LOGO_BYTES) return null;
    return await sharp(bytes, { failOn: "error" })
      .rotate()
      .resize(400, 400, { fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();
  } catch {
    return null;
  }
}
