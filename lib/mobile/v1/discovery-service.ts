import { createAdminClient } from "@/lib/supabase/admin";
import { VisitorError } from "@/lib/faithful/errors";
import { getVisitorAccount, ensureVisitorAccount } from "@/lib/faithful/account";
import { discoverChurches, getPublicChurchProfile } from "@/lib/faithful/discovery";
import { findNearbyChurches } from "@/lib/faithful/nearby";
import type { RelationshipState } from "@/lib/faithful/relationship-state";
import type {
  ChurchProfileDto,
  DiscoveredChurchDto,
  OnboardingStateDto,
} from "@/lib/mobile/v1/contract";

/**
 * Projects Prompt 3's discovery services into mobile DTOs, and answers the one
 * question the app asks first: is this person onboarded yet?
 */

/**
 * Onboarding is decided here rather than by the client inferring it from an
 * empty list, so the rule has one home and both platforms agree.
 *
 * `left` and `blocked` do not count as active: someone who left every church
 * is onboarding again, which is the honest reading.
 */
export async function getOnboardingState(userId: string): Promise<OnboardingStateDto> {
  const account = await ensureVisitorAccount(userId);
  const admin = createAdminClient();

  const { data: rows } = await admin
    .from("visitor_church_relationships")
    .select("state, churches!inner(slug)")
    .eq("account_id", account.id)
    .in("state", ["following", "pending", "joined"])
    .limit(50);

  const active = (rows ?? []) as Record<string, unknown>[];
  const slugs = active.map((row) => {
    const church = row.churches as { slug: string } | { slug: string }[];
    return (Array.isArray(church) ? church[0] : church).slug;
  });

  let selectedChurchSlug: string | null = null;
  if (account.selectedChurchId) {
    const { data: church } = await admin
      .from("churches")
      .select("slug")
      .eq("id", account.selectedChurchId)
      .maybeSingle();
    const slug = (church?.slug as string | null) ?? null;
    // A selection that no longer names an active relationship is dropped
    // rather than restored — leaving or being blocked must not survive as a
    // usable preference.
    selectedChurchSlug = slug && slugs.includes(slug) ? slug : null;
  }

  return {
    needsOnboarding: slugs.length === 0,
    hasAnyRelationship: slugs.length > 0,
    selectedChurchSlug,
    activeChurchCount: slugs.length,
    // More than one church and nothing valid selected: the person chooses.
    requiresChurchChooser: slugs.length > 1 && selectedChurchSlug === null,
  };
}

function toDiscovered(
  church: Awaited<ReturnType<typeof discoverChurches>>["churches"][number],
): DiscoveredChurchDto {
  return {
    slug: church.slug,
    name: church.name,
    logoUrl: church.logoUrl,
    publicSummary: church.publicSummary,
    denomination: church.denomination,
    city: church.city,
    state: church.state,
    postalCode: church.postalCode,
    joinPolicy: church.joinPolicy,
    publicProfileVersion: church.publicProfileVersion,
    distanceKm: null,
    campusName: null,
  };
}

export async function searchChurches(input: {
  query?: string;
  state?: string;
  postalCode?: string;
  limit: number;
  cursorName: string | null;
  cursorId: string | null;
}): Promise<{ items: DiscoveredChurchDto[]; nextCursor: { name: string; id: string } | null }> {
  const page = await discoverChurches({
    query: input.query,
    state: input.state,
    postalCode: input.postalCode,
    limit: input.limit,
    cursorName: input.cursorName ?? undefined,
    cursorId: input.cursorId ?? undefined,
  });

  return { items: page.churches.map(toDiscovered), nextCursor: page.nextCursor };
}

/**
 * Nearby search. The coordinates are used for this query and discarded — no
 * location is stored, and none is logged.
 */
export async function searchNearby(input: unknown): Promise<DiscoveredChurchDto[]> {
  const results = await findNearbyChurches(input);
  return results.map((church) => ({
    slug: church.slug,
    name: church.name,
    logoUrl: church.logoUrl,
    publicSummary: church.publicSummary,
    denomination: church.denomination,
    city: church.city,
    state: church.state,
    postalCode: church.postalCode,
    joinPolicy: church.joinPolicy,
    publicProfileVersion: church.publicProfileVersion,
    distanceKm: church.distanceKm,
    campusName: church.campusName,
  }));
}

/**
 * Resolves the caller's own relationship with a church.
 *
 * Returns null for a signed-out caller or a church they have never engaged
 * with. Never throws for "no relationship" — that is a normal state on a
 * profile someone is deciding about.
 */
export async function resolveRelationshipState(
  userId: string | null,
  churchSlug: string,
): Promise<RelationshipState | null> {
  if (!userId) return null;

  const account = await getVisitorAccount(userId);
  if (!account) return null;

  const admin = createAdminClient();
  const { data: church } = await admin
    .from("churches")
    .select("id")
    .eq("slug", churchSlug)
    .maybeSingle();

  if (!church) return null;

  const { data } = await admin
    .from("visitor_church_relationships")
    .select("state")
    .eq("account_id", account.id)
    .eq("church_id", church.id as string)
    .maybeSingle();

  return (data?.state as RelationshipState | null) ?? null;
}

export async function getChurchProfile(
  userId: string | null,
  slug: string,
): Promise<ChurchProfileDto | null> {
  const profile = await getPublicChurchProfile(slug);
  if (!profile) return null;

  const relationshipState = await resolveRelationshipState(userId, slug);

  return {
    slug: profile.slug,
    name: profile.name,
    logoUrl: profile.logoUrl,
    coverImageUrl: profile.coverImageUrl,
    publicSummary: profile.publicSummary,
    tagline: profile.tagline,
    denomination: profile.denomination,
    address: profile.address,
    city: profile.city,
    state: profile.state,
    postalCode: profile.postalCode,
    website: profile.website,
    phone: profile.phone,
    email: profile.email,
    joinPolicy: profile.joinPolicy,
    timezone: profile.timezone,
    publicProfileVersion: profile.publicProfileVersion,
    campuses: profile.campuses.map((campus) => ({
      slug: campus.slug,
      name: campus.name,
      addressLine1: campus.addressLine1,
      city: campus.city,
      state: campus.state,
      postalCode: campus.postalCode,
      latitude: campus.latitude,
      longitude: campus.longitude,
      timezone: campus.timezone,
      isPrimary: campus.isPrimary,
    })),
    serviceTimes: profile.campuses.flatMap((campus) =>
      campus.services.map((service) => ({
        campusSlug: campus.slug,
        label: service.label,
        dayOfWeek: service.dayOfWeek,
        startTime: service.startTime,
        kind: service.kind,
      })),
    ),
    relationshipState,
  };
}

/** The churches the account may switch between. Excludes left and blocked. */
export async function getChurchChooser(userId: string): Promise<
  { slug: string; name: string; logoUrl: string | null; state: RelationshipState }[]
> {
  const account = await getVisitorAccount(userId);
  if (!account) throw new VisitorError("account_missing", "No visitor account.");

  const admin = createAdminClient();
  const { data } = await admin
    .from("visitor_church_relationships")
    .select("state, churches!inner(slug, name, logo_url)")
    .eq("account_id", account.id)
    .in("state", ["following", "pending", "joined"])
    .order("updated_at", { ascending: false })
    .limit(50);

  return ((data ?? []) as Record<string, unknown>[]).map((row) => {
    const church = row.churches as
      | { slug: string; name: string; logo_url: string | null }
      | { slug: string; name: string; logo_url: string | null }[];
    const resolved = Array.isArray(church) ? church[0] : church;
    return {
      slug: resolved.slug,
      name: resolved.name,
      logoUrl: resolved.logo_url ?? null,
      state: row.state as RelationshipState,
    };
  });
}
