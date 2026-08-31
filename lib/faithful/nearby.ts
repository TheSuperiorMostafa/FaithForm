import { z } from "zod";

import { filterChurchSlugsWithFeature } from "@/lib/features/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { VisitorError } from "@/lib/faithful/errors";

/**
 * Nearby church discovery.
 *
 * The coordinates a device sends are used for exactly one query and then
 * discarded. Nothing here writes a location, and nothing logs one — a
 * congregation's whereabouts is not ours to keep, and a coordinate in a log
 * line is a location history whether or not it was meant as one.
 *
 * The query itself is a bounded index scan plus haversine over the survivors
 * (`discover_churches_nearby`). No campus set is ever loaded into memory.
 */

export const nearbySearchSchema = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  radiusKm: z.coerce.number().min(1).max(200).default(40),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type NearbyChurch = {
  slug: string;
  name: string;
  logoUrl: string | null;
  publicSummary: string | null;
  denomination: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  joinPolicy: "open" | "approval_required" | "invite_only";
  publicProfileVersion: number;
  campusName: string | null;
  /** Rounded to 100 m: precise enough to sort, too coarse to re-identify. */
  distanceKm: number;
};

export async function findNearbyChurches(input: unknown): Promise<NearbyChurch[]> {
  const parsed = nearbySearchSchema.safeParse(input);
  if (!parsed.success) {
    throw new VisitorError("invalid_input", "Check your location and radius.");
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("discover_churches_nearby", {
    p_latitude: parsed.data.latitude,
    p_longitude: parsed.data.longitude,
    p_radius_km: parsed.data.radiusKm,
    p_limit: parsed.data.limit,
  });

  if (error) {
    // Deliberately does not echo the error: it would contain the coordinates.
    throw new VisitorError("unavailable", "Nearby search is unavailable.");
  }

  const seen = new Set<string>();
  const results: NearbyChurch[] = [];

  for (const raw of (data ?? []) as Record<string, unknown>[]) {
    const slug = raw.slug as string;
    // A church with several campuses matches more than once; the nearest wins,
    // and the query already ordered by distance.
    if (seen.has(slug)) continue;
    seen.add(slug);

    results.push({
      slug,
      name: raw.name as string,
      logoUrl: (raw.logo_url as string | null) ?? null,
      publicSummary: (raw.public_summary as string | null) ?? null,
      denomination: (raw.denomination as string | null) ?? null,
      city: (raw.city as string | null) ?? null,
      state: (raw.state as string | null) ?? null,
      postalCode: (raw.postal_code as string | null) ?? null,
      joinPolicy: (raw.join_policy as NearbyChurch["joinPolicy"]) ?? "approval_required",
      publicProfileVersion: (raw.public_profile_version as number | null) ?? 1,
      campusName: (raw.campus_name as string | null) ?? null,
      distanceKm: Math.round(Number(raw.distance_km) * 10) / 10,
    });
  }

  // Same rule as search: a church whose Member App feature is off is not in
  // the app, so it is not on the map either.
  const enabled = await filterChurchSlugsWithFeature(
    results.map((church) => church.slug),
    "member_app",
  );

  return results.filter((church) => enabled.has(church.slug));
}
