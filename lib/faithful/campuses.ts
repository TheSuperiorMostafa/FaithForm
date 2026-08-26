import { createAdminClient } from "@/lib/supabase/admin";
import { VisitorError } from "@/lib/faithful/errors";
import { campusSchema } from "@/lib/faithful/schemas";
import { bumpPublicProfileVersion } from "@/lib/faithful/discovery";

/**
 * Campuses.
 *
 * A church that has always had one address keeps working untouched: no
 * existing `churches.address` is rewritten and no existing service time is
 * reassigned. A campus is additive, and `church_service_times.campus_id` stays
 * null until someone deliberately attaches a schedule to a place.
 *
 * Coordinates and a radius are stored here for Prompt 6. Nothing in Prompt 3
 * reads a device location or evaluates a geofence.
 */

export type Campus = {
  id: string;
  churchId: string;
  name: string;
  slug: string;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  latitude: number | null;
  longitude: number | null;
  timezone: string;
  geofenceRadiusM: number;
  isActive: boolean;
  isPublic: boolean;
  isPrimary: boolean;
  sortKey: number;
};

const CAMPUS_COLUMNS =
  "id, church_id, name, slug, address_line1, city, state, postal_code, latitude, longitude, timezone, geofence_radius_m, is_active, is_public, is_primary, sort_key";

function mapCampus(row: Record<string, unknown>): Campus {
  return {
    id: row.id as string,
    churchId: row.church_id as string,
    name: row.name as string,
    slug: row.slug as string,
    addressLine1: (row.address_line1 as string | null) ?? null,
    city: (row.city as string | null) ?? null,
    state: (row.state as string | null) ?? null,
    postalCode: (row.postal_code as string | null) ?? null,
    latitude: row.latitude === null ? null : Number(row.latitude),
    longitude: row.longitude === null ? null : Number(row.longitude),
    timezone: row.timezone as string,
    geofenceRadiusM: Number(row.geofence_radius_m),
    isActive: Boolean(row.is_active),
    isPublic: Boolean(row.is_public),
    isPrimary: Boolean(row.is_primary),
    sortKey: Number(row.sort_key ?? 0),
  };
}

export async function listCampuses(churchId: string): Promise<Campus[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("church_campuses")
    .select(CAMPUS_COLUMNS)
    .eq("church_id", churchId)
    .order("is_primary", { ascending: false })
    .order("sort_key", { ascending: true })
    .order("id", { ascending: true });

  if (error) throw new VisitorError("unavailable", "Could not load campuses.");
  return (data ?? []).map(mapCampus);
}

/**
 * Demoting the previous primary before promoting the new one keeps the partial
 * unique index satisfied. Two campuses briefly claiming primary is exactly
 * what that index exists to prevent.
 */
async function clearPrimary(churchId: string, exceptId?: string): Promise<void> {
  const admin = createAdminClient();
  let query = admin
    .from("church_campuses")
    .update({ is_primary: false, updated_at: new Date().toISOString() })
    .eq("church_id", churchId)
    .eq("is_primary", true);

  if (exceptId) query = query.neq("id", exceptId);
  await query;
}

export async function createCampus(
  churchId: string,
  input: unknown,
): Promise<Campus> {
  const parsed = campusSchema.safeParse(input);
  if (!parsed.success) {
    throw new VisitorError(
      "invalid_input",
      parsed.error.issues[0]?.message ?? "Check the values you entered.",
    );
  }

  const admin = createAdminClient();

  // The first campus a church creates is its primary one unless it says
  // otherwise — otherwise a church ends up with campuses and no main location.
  const existing = await listCampuses(churchId);
  const shouldBePrimary = parsed.data.isPrimary || existing.length === 0;

  if (shouldBePrimary) await clearPrimary(churchId);

  const { data, error } = await admin
    .from("church_campuses")
    .insert({
      church_id: churchId,
      name: parsed.data.name,
      slug: parsed.data.slug,
      address_line1: parsed.data.addressLine1 ?? null,
      address_line2: parsed.data.addressLine2 ?? null,
      city: parsed.data.city ?? null,
      state: parsed.data.state ?? null,
      postal_code: parsed.data.postalCode ?? null,
      country: parsed.data.country,
      latitude: parsed.data.latitude ?? null,
      longitude: parsed.data.longitude ?? null,
      timezone: parsed.data.timezone,
      geofence_radius_m: parsed.data.geofenceRadiusM,
      is_active: parsed.data.isActive,
      is_public: parsed.data.isPublic,
      is_primary: shouldBePrimary,
      sort_key: parsed.data.sortKey,
    })
    .select(CAMPUS_COLUMNS)
    .maybeSingle();

  if (error || !data) {
    // The (church_id, slug) unique constraint is the usual cause.
    throw new VisitorError(
      "conflict",
      "A campus with that web address already exists.",
    );
  }

  await bumpPublicProfileVersion(churchId);
  return mapCampus(data);
}

export async function updateCampus(
  churchId: string,
  campusId: string,
  input: unknown,
): Promise<Campus> {
  const parsed = campusSchema.safeParse(input);
  if (!parsed.success) {
    throw new VisitorError(
      "invalid_input",
      parsed.error.issues[0]?.message ?? "Check the values you entered.",
    );
  }

  const admin = createAdminClient();

  if (parsed.data.isPrimary) await clearPrimary(churchId, campusId);

  const { data, error } = await admin
    .from("church_campuses")
    .update({
      name: parsed.data.name,
      slug: parsed.data.slug,
      address_line1: parsed.data.addressLine1 ?? null,
      address_line2: parsed.data.addressLine2 ?? null,
      city: parsed.data.city ?? null,
      state: parsed.data.state ?? null,
      postal_code: parsed.data.postalCode ?? null,
      country: parsed.data.country,
      latitude: parsed.data.latitude ?? null,
      longitude: parsed.data.longitude ?? null,
      timezone: parsed.data.timezone,
      geofence_radius_m: parsed.data.geofenceRadiusM,
      is_active: parsed.data.isActive,
      is_public: parsed.data.isPublic,
      is_primary: parsed.data.isPrimary,
      sort_key: parsed.data.sortKey,
      updated_at: new Date().toISOString(),
    })
    .eq("id", campusId)
    // Exact tenant predicate at the write: a campus id from another church
    // matches no row rather than being updated.
    .eq("church_id", churchId)
    .select(CAMPUS_COLUMNS)
    .maybeSingle();

  if (error || !data) {
    throw new VisitorError("conflict", "Could not save that campus.");
  }

  await bumpPublicProfileVersion(churchId);
  return mapCampus(data);
}

/**
 * Deactivating rather than deleting. Prompt 6 will attach attendance to a
 * campus, and a deleted row would orphan that history — so a campus that is no
 * longer used stops being offered without disappearing.
 */
export async function deactivateCampus(
  churchId: string,
  campusId: string,
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("church_campuses")
    .update({
      is_active: false,
      is_primary: false,
      updated_at: new Date().toISOString(),
    })
    .eq("id", campusId)
    .eq("church_id", churchId);

  if (error) throw new VisitorError("unavailable", "Could not update that campus.");
  await bumpPublicProfileVersion(churchId);
}

/**
 * Attaches an existing service time to a campus, or detaches it with null.
 * Existing church-level schedules keep working either way.
 */
export async function assignServiceTimeToCampus(
  churchId: string,
  serviceTimeId: string,
  campusId: string | null,
): Promise<void> {
  const admin = createAdminClient();

  if (campusId) {
    const { data: campus } = await admin
      .from("church_campuses")
      .select("id")
      .eq("id", campusId)
      .eq("church_id", churchId)
      .maybeSingle();
    if (!campus) {
      throw new VisitorError("invalid_input", "That campus is not in this church.");
    }
  }

  const { error } = await admin
    .from("church_service_times")
    .update({ campus_id: campusId, updated_at: new Date().toISOString() })
    .eq("id", serviceTimeId)
    .eq("church_id", churchId);

  if (error) throw new VisitorError("unavailable", "Could not update that service.");
  await bumpPublicProfileVersion(churchId);
}
