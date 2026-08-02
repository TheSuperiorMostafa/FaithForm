import { createAdminClient } from "@/lib/supabase/admin";
import type {
  SiteOverrideRow,
  SitePageRow,
  SiteProfile,
  SiteSectionRow,
  SiteSettingsRow,
  SiteThemeRow,
} from "@/types/site";

/**
 * Public site reads.
 *
 * These run through the service-role client with explicit column allowlists,
 * the same shape as `getChurchBySlug` in lib/queries/giving.ts. That is a
 * deliberate alternative to granting `anon` RLS: the churches row carries
 * stripe state and ai_knowledge, and the safest way to keep those off a public
 * page is for the browser to have no read path to the table at all.
 *
 * Every select below is an allowlist. Do not switch one to `*`.
 */

const CHURCH_SELECT = `
  id,
  slug,
  name,
  tagline,
  description,
  mission_statement,
  vision_statement,
  denomination,
  logo_url,
  cover_image_url,
  address,
  city,
  state,
  zip,
  phone,
  email,
  google_maps_url,
  facebook_url,
  instagram_url,
  youtube_url,
  livestream_url,
  stripe_charges_enabled
`;

type ChurchRow = Record<string, unknown>;

function text(row: ChurchRow, key: string): string | null {
  const value = row[key];
  return typeof value === "string" && value.trim() ? value : null;
}

export type SiteBundle = {
  churchId: string;
  profile: SiteProfile;
  settings: SiteSettingsRow | null;
  theme: SiteThemeRow;
  page: SitePageRow;
  sections: SiteSectionRow[];
  overrides: SiteOverrideRow[];
  /** Where the Visit form is delivered. Never sent to the browser. */
  contactEmail: string | null;
};

/** Used when a church has no site_settings row yet, so a fresh site still renders. */
const FALLBACK_THEME_KEY = "grace";

export async function resolveChurchIdByHostname(
  hostname: string,
): Promise<{ churchId: string; slug: string } | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("site_domains")
    .select("church_id, churches!inner(slug)")
    .eq("hostname", hostname.toLowerCase())
    .maybeSingle();

  if (error || !data) return null;

  const church = data.churches as unknown as { slug: string } | null;
  if (!church?.slug) return null;

  return { churchId: data.church_id as string, slug: church.slug };
}

/**
 * Everything one page render needs, in a single pass.
 *
 * The queries after the church lookup are independent, so they run together --
 * a church site is the slowest-loading thing in the product and each extra
 * serial round trip is felt directly.
 */
export async function getSiteBundle(
  slug: string,
  path = "/",
): Promise<SiteBundle | null> {
  const supabase = createAdminClient();

  const { data: churchRow, error: churchError } = await supabase
    .from("churches")
    .select(CHURCH_SELECT)
    .eq("slug", slug)
    .maybeSingle();

  if (churchError || !churchRow) return null;

  const church = churchRow as ChurchRow;
  const churchId = church.id as string;

  const [
    settingsResult,
    pageResult,
    serviceTimesResult,
    staffResult,
    eventsResult,
    mediaResult,
  ] = await Promise.all([
    supabase
      .from("site_settings")
      .select("theme_key, brand_tokens, custom_css, contact_email, is_published")
      .eq("church_id", churchId)
      .maybeSingle(),
    supabase
      .from("site_pages")
      .select("id, path, title, meta_description, status")
      .eq("church_id", churchId)
      .eq("path", path)
      .maybeSingle(),
    supabase
      .from("church_service_times")
      .select("label, day_of_week, start_time, end_time, kind, notes")
      .eq("church_id", churchId)
      .order("sort_order", { ascending: true }),
    // is_public is the church's own switch for who appears on the web. It is
    // filtered here rather than in the component so no override can undo it.
    supabase
      .from("church_staff")
      .select("full_name, title, bio, photo_url")
      .eq("church_id", churchId)
      .eq("is_public", true)
      .order("sort_order", { ascending: true }),
    supabase
      .from("announcements")
      .select("event_title, event_date, event_location, notes")
      .eq("church_id", churchId)
      .in("status", ["approved", "published"])
      .gte("event_date", new Date().toISOString())
      .order("event_date", { ascending: true })
      .limit(6),
    supabase
      .from("site_media")
      .select(
        "id, title, series, speaker, published_at, video_url, thumbnail_url",
      )
      .eq("church_id", churchId)
      .eq("is_published", true)
      .order("published_at", { ascending: false, nullsFirst: false })
      .order("sort_order", { ascending: true })
      .limit(12),
  ]);

  const page = pageResult.data;
  if (!page) return null;

  const settingsRow = settingsResult.data;
  const settings: SiteSettingsRow | null = settingsRow
    ? {
        themeKey: (settingsRow.theme_key as string) ?? FALLBACK_THEME_KEY,
        brandTokens:
          (settingsRow.brand_tokens as Record<string, string> | null) ?? {},
        customCss: (settingsRow.custom_css as string | null) ?? null,
        contactEmail: (settingsRow.contact_email as string | null) ?? null,
        isPublished: Boolean(settingsRow.is_published),
      }
    : null;

  const theme = await getTheme(settings?.themeKey ?? FALLBACK_THEME_KEY);
  if (!theme) return null;

  const [sectionsResult, overridesResult] = await Promise.all([
    supabase
      .from("site_sections")
      .select("id, type, sort_order, is_visible, props")
      .eq("page_id", page.id)
      .order("sort_order", { ascending: true }),
    supabase
      .from("site_overrides")
      .select("scope, page_id, section_id, patch")
      .eq("church_id", churchId),
  ]);

  const profile: SiteProfile = {
    slug: (church.slug as string) ?? slug,
    name: (church.name as string) ?? "",
    tagline: text(church, "tagline"),
    description: text(church, "description"),
    missionStatement: text(church, "mission_statement"),
    visionStatement: text(church, "vision_statement"),
    denomination: text(church, "denomination"),
    logoUrl: text(church, "logo_url"),
    coverImageUrl: text(church, "cover_image_url"),
    address: text(church, "address"),
    city: text(church, "city"),
    state: text(church, "state"),
    zip: text(church, "zip"),
    phone: text(church, "phone"),
    email: text(church, "email"),
    googleMapsUrl: text(church, "google_maps_url"),
    facebookUrl: text(church, "facebook_url"),
    instagramUrl: text(church, "instagram_url"),
    youtubeUrl: text(church, "youtube_url"),
    livestreamUrl: text(church, "livestream_url"),
    serviceTimes: (serviceTimesResult.data ?? []).map((row) => ({
      label: row.label as string,
      dayOfWeek: row.day_of_week as number,
      startTime: row.start_time as string,
      endTime: (row.end_time as string | null) ?? null,
      kind: (row.kind as string) ?? "regular",
      notes: (row.notes as string | null) ?? null,
    })),
    staff: (staffResult.data ?? []).map((row) => ({
      name: row.full_name as string,
      title: (row.title as string | null) ?? null,
      bio: (row.bio as string | null) ?? null,
      photoUrl: (row.photo_url as string | null) ?? null,
    })),
    events: (eventsResult.data ?? []).map((row) => ({
      title: row.event_title as string,
      date: (row.event_date as string | null) ?? null,
      location: (row.event_location as string | null) ?? null,
      note: (row.notes as string | null) ?? null,
    })),
    media: (mediaResult.data ?? []).map((row) => ({
      id: row.id as string,
      title: row.title as string,
      series: (row.series as string | null) ?? null,
      speaker: (row.speaker as string | null) ?? null,
      date: (row.published_at as string | null) ?? null,
      videoUrl: (row.video_url as string | null) ?? null,
      thumbnail: row.thumbnail_url
        ? { src: row.thumbnail_url as string, alt: row.title as string }
        : null,
    })),
    givingEnabled: Boolean(church.stripe_charges_enabled),
  };

  return {
    churchId,
    profile,
    settings,
    theme,
    page: {
      id: page.id as string,
      path: page.path as string,
      title: (page.title as string | null) ?? null,
      metaDescription: (page.meta_description as string | null) ?? null,
      status: (page.status as "draft" | "published") ?? "draft",
    },
    sections: (sectionsResult.data ?? []).map((row) => ({
      id: row.id as string,
      type: row.type as string,
      sortOrder: (row.sort_order as number) ?? 0,
      isVisible: row.is_visible !== false,
      props: (row.props as Record<string, unknown> | null) ?? {},
    })),
    overrides: (overridesResult.data ?? []).map((row) => ({
      scope: row.scope as SiteOverrideRow["scope"],
      pageId: (row.page_id as string | null) ?? null,
      sectionId: (row.section_id as string | null) ?? null,
      patch: (row.patch as Record<string, unknown> | null) ?? {},
    })),
    contactEmail: settings?.contactEmail ?? profile.email,
  };
}

async function getTheme(key: string): Promise<SiteThemeRow | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("site_themes")
    .select("key, name, tokens, section_defaults")
    .eq("key", key)
    .maybeSingle();

  if (error || !data) return null;

  return {
    key: data.key as string,
    name: data.name as string,
    tokens: (data.tokens as Record<string, string> | null) ?? {},
    sectionDefaults:
      (data.section_defaults as Record<string, Record<string, unknown>> | null) ??
      {},
  };
}

/** Minimal lookup for the contact route: recipient plus display name. */
export async function getContactTargetBySlug(slug: string): Promise<{
  churchId: string;
  churchName: string;
  recipient: string | null;
} | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("churches")
    .select("id, name, email")
    .eq("slug", slug)
    .maybeSingle();

  if (error || !data) return null;

  const { data: settings } = await supabase
    .from("site_settings")
    .select("contact_email")
    .eq("church_id", data.id as string)
    .maybeSingle();

  const configured = (settings?.contact_email as string | null) ?? null;

  return {
    churchId: data.id as string,
    churchName: (data.name as string) ?? "",
    recipient: configured?.trim() || (data.email as string | null) || null,
  };
}
