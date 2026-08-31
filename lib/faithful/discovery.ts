import { filterChurchIdsWithFeature } from "@/lib/features/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { VisitorError } from "@/lib/faithful/errors";
import {
  discoverySearchSchema,
  discoverySettingsSchema,
  churchSlugSchema,
} from "@/lib/faithful/schemas";

/**
 * Public church discovery.
 *
 * Every read here goes through a SECURITY DEFINER projection function that
 * enumerates its own columns. Selecting from `churches` directly is what this
 * module exists to avoid: a private column added to that table later cannot
 * leak through a projection that never mentions it.
 */

export type DiscoveredChurch = {
  slug: string;
  name: string;
  logoUrl: string | null;
  publicSummary: string | null;
  denomination: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  website: string | null;
  joinPolicy: "open" | "approval_required" | "invite_only";
  publicProfileVersion: number;
};

export type DiscoveryPage = {
  churches: DiscoveredChurch[];
  nextCursor: { name: string; id: string } | null;
};

function mapDiscovered(row: Record<string, unknown>): DiscoveredChurch {
  return {
    slug: row.slug as string,
    name: row.name as string,
    logoUrl: (row.logo_url as string | null) ?? null,
    publicSummary: (row.public_summary as string | null) ?? null,
    denomination: (row.denomination as string | null) ?? null,
    city: (row.city as string | null) ?? null,
    state: (row.state as string | null) ?? null,
    postalCode: (row.postal_code as string | null) ?? null,
    website: (row.website as string | null) ?? null,
    joinPolicy: row.join_policy as DiscoveredChurch["joinPolicy"],
    publicProfileVersion: (row.public_profile_version as number | null) ?? 1,
  };
}

/**
 * Keyset pagination. One extra row is requested to decide whether a next page
 * exists without a second count query, then dropped before returning.
 */
export async function discoverChurches(input: unknown): Promise<DiscoveryPage> {
  const parsed = discoverySearchSchema.safeParse(input ?? {});
  if (!parsed.success) {
    throw new VisitorError("invalid_input", "Check your search.");
  }
  const { limit, cursorName, cursorId, query, state, postalCode } = parsed.data;

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("discover_churches", {
    p_query: query ?? null,
    p_state: state ?? null,
    p_postal_code: postalCode ?? null,
    p_cursor_name: cursorName ?? null,
    p_cursor_id: cursorId ?? null,
    p_limit: limit + 1,
  });

  if (error) throw new VisitorError("unavailable", "Search is unavailable.");

  const rows = (data ?? []) as Record<string, unknown>[];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];

  // A church whose Member App feature is switched off is not in the app, and
  // that has to be true of search as well as of joining. Filtered after the
  // keyset page rather than inside the projection so the cursor still describes
  // the same underlying sequence — dropping rows here can shorten a page, never
  // skip past one.
  const enabled = await filterChurchIdsWithFeature(
    page.map((row) => row.cursor_id as string),
    "member_app",
  );

  return {
    churches: page
      .filter((row) => enabled.has(row.cursor_id as string))
      .map(mapDiscovered),
    nextCursor:
      hasMore && last
        ? { name: last.cursor_name as string, id: last.cursor_id as string }
        : null,
  };
}

export type PublicChurchProfile = {
  slug: string;
  name: string;
  logoUrl: string | null;
  coverImageUrl: string | null;
  publicSummary: string | null;
  tagline: string | null;
  denomination: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  joinPolicy: "open" | "approval_required" | "invite_only";
  timezone: string;
  publicProfileVersion: number;
  campuses: PublicCampus[];
};

export type PublicCampus = {
  slug: string;
  name: string;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  latitude: number | null;
  longitude: number | null;
  timezone: string;
  isPrimary: boolean;
  services: { label: string; dayOfWeek: number; startTime: string; kind: string }[];
};

/**
 * A hidden church and a nonexistent slug return the same `null`. Anything else
 * turns the profile endpoint into an oracle for whether a private church
 * exists under a guessed name.
 */
export async function getPublicChurchProfile(
  slug: string,
): Promise<PublicChurchProfile | null> {
  const parsedSlug = churchSlugSchema.safeParse(slug);
  if (!parsedSlug.success) return null;

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("public_church_profile", {
    p_slug: parsedSlug.data,
  });
  if (error) throw new VisitorError("unavailable", "Church is unavailable.");

  const row = ((data ?? []) as Record<string, unknown>[])[0];
  if (!row) return null;

  const { data: campusRows } = await admin.rpc("public_church_campuses", {
    p_slug: parsedSlug.data,
  });

  const byCampus = new Map<string, PublicCampus>();
  for (const raw of (campusRows ?? []) as Record<string, unknown>[]) {
    const campusSlug = raw.campus_slug as string;
    if (!byCampus.has(campusSlug)) {
      byCampus.set(campusSlug, {
        slug: campusSlug,
        name: raw.name as string,
        addressLine1: (raw.address_line1 as string | null) ?? null,
        city: (raw.city as string | null) ?? null,
        state: (raw.state as string | null) ?? null,
        postalCode: (raw.postal_code as string | null) ?? null,
        latitude: raw.latitude === null ? null : Number(raw.latitude),
        longitude: raw.longitude === null ? null : Number(raw.longitude),
        timezone: raw.timezone as string,
        isPrimary: Boolean(raw.is_primary),
        services: [],
      });
    }
    if (raw.service_label) {
      byCampus.get(campusSlug)!.services.push({
        label: raw.service_label as string,
        dayOfWeek: Number(raw.service_day_of_week),
        startTime: raw.service_start_time as string,
        kind: raw.service_kind as string,
      });
    }
  }

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
    postalCode: (row.postal_code as string | null) ?? null,
    website: (row.website as string | null) ?? null,
    phone: (row.phone as string | null) ?? null,
    email: (row.email as string | null) ?? null,
    joinPolicy: row.join_policy as PublicChurchProfile["joinPolicy"],
    timezone: row.timezone as string,
    publicProfileVersion: (row.public_profile_version as number | null) ?? 1,
    campuses: Array.from(byCampus.values()),
  };
}

/**
 * Staff-side control. The caller must already have proven admin rights for
 * exactly this church; `churchId` never comes from a client payload.
 */
export async function updateDiscoverySettings(
  churchId: string,
  input: unknown,
): Promise<void> {
  const parsed = discoverySettingsSchema.safeParse(input);
  if (!parsed.success) {
    throw new VisitorError("invalid_input", "Check the values you entered.");
  }

  const admin = createAdminClient();

  // Publishing needs a public handle. Rather than inventing one silently,
  // refuse and let the church choose its own.
  if (parsed.data.isDiscoverable) {
    const { data: church } = await admin
      .from("churches")
      .select("slug")
      .eq("id", churchId)
      .maybeSingle();
    if (!church?.slug) {
      throw new VisitorError(
        "invalid_input",
        "Set a public web address for this church before listing it.",
      );
    }
  }

  const { error } = await admin
    .from("churches")
    .update({
      is_discoverable: parsed.data.isDiscoverable,
      public_summary: parsed.data.publicSummary ?? null,
      join_policy: parsed.data.joinPolicy,
      discovery_updated_at: new Date().toISOString(),
    })
    .eq("id", churchId);

  if (error) throw new VisitorError("unavailable", "Could not save.");

  // Cached public profiles must not keep serving the previous visibility.
  await bumpPublicProfileVersion(churchId);
}

async function bumpPublicProfileVersion(churchId: string): Promise<void> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("churches")
    .select("public_profile_version")
    .eq("id", churchId)
    .maybeSingle();
  const next = ((data?.public_profile_version as number | null) ?? 1) + 1;
  await admin
    .from("churches")
    .update({ public_profile_version: next })
    .eq("id", churchId);
}

export { bumpPublicProfileVersion };
