import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  SOCIAL_COLUMNS,
  appDetailsFrom,
  type ChurchAppDetails,
} from "@/lib/faithform/church-links";
import type { PublicChurchProfile } from "@/lib/faithform/discovery";
import { VisitorError } from "@/lib/faithform/errors";
import { churchSlugSchema } from "@/lib/faithform/schemas";

/**
 * A church's page for the people who already have it as their church.
 *
 * Deliberately not in `discovery.ts`, which only ever reads through the
 * public projections: most churches are joined through an invitation link and
 * never list themselves, and their people still need the church's page —
 * service times, where to go, how to reach them.
 *
 * **Callers must have checked the relationship.** Nothing here does; it reads
 * the church directly. The column lists are explicit for the same reason the
 * projections enumerate theirs: a private column added to `churches` later
 * cannot leak through here.
 */

export async function getChurchProfileForMember(
  slug: string,
): Promise<PublicChurchProfile | null> {
  const parsedSlug = churchSlugSchema.safeParse(slug);
  if (!parsedSlug.success) return null;

  const admin = createAdminClient();
  const { data: row, error } = await admin
    .from("churches")
    .select(
      "id, slug, name, logo_url, cover_image_url, public_summary, tagline, denomination, address, city, state, zip, website, phone, email, join_policy, timezone, public_profile_version",
    )
    .eq("slug", parsedSlug.data)
    .maybeSingle();
  if (error) throw new VisitorError("unavailable", "Church is unavailable.");
  if (!row) return null;

  const { data: campusRows } = await admin
    .from("church_campuses")
    .select(
      "id, slug, name, address_line1, city, state, postal_code, latitude, longitude, timezone, is_primary",
    )
    .eq("church_id", row.id as string)
    .eq("is_active", true)
    .eq("is_public", true)
    .order("is_primary", { ascending: false })
    .order("sort_key", { ascending: true })
    .order("id", { ascending: true });

  const campuses = (campusRows ?? []) as Record<string, unknown>[];
  const campusIds = campuses.map((campus) => campus.id as string);
  const { data: serviceRows } = campusIds.length
    ? await admin
        .from("church_service_times")
        .select("campus_id, label, day_of_week, start_time, kind")
        .in("campus_id", campusIds)
        .order("sort_order", { ascending: true })
    : { data: [] };
  const services = (serviceRows ?? []) as Record<string, unknown>[];

  return {
    slug: row.slug as string,
    name: row.name as string,
    logoUrl: (row.logo_url as string | null) ?? null,
    coverImageUrl: (row.cover_image_url as string | null) ?? null,
    publicSummary: (row.public_summary as string | null) ?? null,
    tagline: (row.tagline as string | null) ?? null,
    denomination: (row.denomination as string | null) ?? null,
    address: (row.address as string | null) ?? null,
    city: (row.city as string | null) ?? null,
    state: (row.state as string | null) ?? null,
    postalCode: (row.zip as string | null) ?? null,
    website: (row.website as string | null) ?? null,
    phone: (row.phone as string | null) ?? null,
    email: (row.email as string | null) ?? null,
    joinPolicy:
      (row.join_policy as PublicChurchProfile["joinPolicy"] | null) ?? "approval_required",
    timezone: (row.timezone as string | null) ?? "America/New_York",
    publicProfileVersion: (row.public_profile_version as number | null) ?? 1,
    campuses: campuses.map((campus) => ({
      slug: campus.slug as string,
      name: campus.name as string,
      addressLine1: (campus.address_line1 as string | null) ?? null,
      city: (campus.city as string | null) ?? null,
      state: (campus.state as string | null) ?? null,
      postalCode: (campus.postal_code as string | null) ?? null,
      latitude: campus.latitude === null ? null : Number(campus.latitude),
      longitude: campus.longitude === null ? null : Number(campus.longitude),
      timezone: campus.timezone as string,
      isPrimary: Boolean(campus.is_primary),
      services: services
        .filter((service) => service.campus_id === campus.id)
        .map((service) => ({
          label: service.label as string,
          dayOfWeek: Number(service.day_of_week),
          startTime: String(service.start_time),
          kind: service.kind as string,
        })),
    })),
  };
}

const APP_DETAIL_COLUMNS = ["id", "description", "google_maps_url", ...SOCIAL_COLUMNS];

/** Postgres "undefined column": migration 0090 has not been applied here yet. */
function isMissingColumn(error: { code?: string } | null): boolean {
  return error?.code === "42703";
}

async function loadAppDetailRow(
  admin: SupabaseClient,
  slug: string,
): Promise<Record<string, unknown> | null> {
  const withLinks = await admin
    .from("churches")
    .select([...APP_DETAIL_COLUMNS, "app_links"].join(", "))
    .eq("slug", slug)
    .maybeSingle();
  if (!withLinks.error) return (withLinks.data as Record<string, unknown> | null) ?? null;

  // A church page without its quick links beats no church page at all.
  if (isMissingColumn(withLinks.error)) {
    const withoutLinks = await admin
      .from("churches")
      .select(APP_DETAIL_COLUMNS.join(", "))
      .eq("slug", slug)
      .maybeSingle();
    if (!withoutLinks.error) {
      return (withoutLinks.data as Record<string, unknown> | null) ?? null;
    }
  }
  throw new VisitorError("unavailable", "Church is unavailable.");
}

export async function getMemberChurchAppDetails(
  slug: string,
): Promise<ChurchAppDetails | null> {
  const parsedSlug = churchSlugSchema.safeParse(slug);
  if (!parsedSlug.success) return null;

  const admin = createAdminClient();
  const row = await loadAppDetailRow(admin, parsedSlug.data);
  if (!row) return null;

  const { data: serviceRows } = await admin
    .from("church_service_times")
    .select("label, day_of_week, start_time, kind")
    .eq("church_id", row.id as string)
    .is("campus_id", null)
    .order("sort_order", { ascending: true });

  return appDetailsFrom(row, (serviceRows ?? []) as Record<string, unknown>[]);
}
