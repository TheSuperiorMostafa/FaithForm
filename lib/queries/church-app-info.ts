import { createAdminClient } from "@/lib/supabase/admin";
import { parseQuickLinks, type SocialPlatformKey } from "@/lib/faithform/church-links";
import { getChurchProfile } from "@/lib/queries/church-profile";

/**
 * What the dashboard's Church info editor edits: everything on the church's
 * page in the member app, in one place.
 *
 * Most of it is the church profile the website and phone assistant already
 * read — name, images, address, contact, service times — so it is loaded from
 * there and saved back there, never copied. Socials and quick links are the
 * app-specific additions.
 */
export type ChurchAppServiceTime = {
  clientId: string;
  id?: string;
  label: string;
  dayOfWeek: number;
  startTime: string;
};

export type ChurchAppQuickLink = { clientId: string; label: string; url: string };

export type ChurchAppInfo = {
  name: string;
  tagline: string;
  about: string;
  logoUrl: string;
  coverImageUrl: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  email: string;
  website: string;
  mapsUrl: string;
  social: Record<SocialPlatformKey, string>;
  quickLinks: ChurchAppQuickLink[];
  serviceTimes: ChurchAppServiceTime[];
};

/** Read-only context the editor's live preview needs. */
export type ChurchAppInfoContext = {
  denomination: string | null;
  timezone: string;
  accentColor: string | null;
  primaryColor: string | null;
  /** False until migration 0090 adds `churches.app_links`. */
  quickLinksAvailable: boolean;
};

export async function getChurchAppInfo(
  churchId: string,
): Promise<{ info: ChurchAppInfo; context: ChurchAppInfoContext } | null> {
  const admin = createAdminClient();
  const profile = await getChurchProfile(churchId, admin);
  if (!profile) return null;

  const { data: linkRow, error: linkError } = await admin
    .from("churches")
    .select("app_links")
    .eq("id", churchId)
    .maybeSingle();
  const quickLinksAvailable = !linkError;

  const social: Record<SocialPlatformKey, string> = {
    instagram: profile.instagramUrl ?? "",
    facebook: profile.facebookUrl ?? "",
    youtube: profile.youtubeUrl ?? "",
    tiktok: profile.tiktokUrl ?? "",
    x: profile.xUrl ?? "",
    podcast: profile.podcastUrl ?? "",
  };

  return {
    info: {
      name: profile.name,
      tagline: profile.tagline ?? "",
      about: profile.description ?? "",
      logoUrl: profile.logoUrl ?? "",
      coverImageUrl: profile.coverImageUrl ?? "",
      address: profile.address ?? "",
      city: profile.city ?? "",
      state: profile.state ?? "",
      zip: profile.zip ?? "",
      phone: profile.phone ?? "",
      email: profile.email ?? "",
      website: profile.website ?? "",
      mapsUrl: profile.googleMapsUrl ?? "",
      social,
      quickLinks: parseQuickLinks(linkRow?.app_links).map((link, index) => ({
        clientId: `link-${index}`,
        ...link,
      })),
      serviceTimes: profile.serviceTimes.map((row) => ({
        clientId: row.id,
        id: row.id,
        label: row.label,
        dayOfWeek: row.day_of_week,
        startTime: row.start_time.slice(0, 5),
      })),
    },
    context: {
      denomination: profile.denomination,
      timezone: profile.timezone,
      accentColor: profile.accentColor,
      primaryColor: profile.primaryColor,
      quickLinksAvailable,
    },
  };
}
