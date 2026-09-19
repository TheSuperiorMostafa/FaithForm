"use server";

import { revalidatePath } from "next/cache";

import { getChurchAuth } from "@/lib/auth/church";
import { featureActionError } from "@/lib/features/guard";
import {
  VisitorError,
  fail,
  toVisitorResult,
  type VisitorResult,
} from "@/lib/faithform/errors";
import { createCampus, listCampuses } from "@/lib/faithform/campuses";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getAttendanceSetupState,
  saveCampusCheckinLocation,
  saveChurchAttendancePolicy,
  saveServiceSchedule,
  type AttendanceSetupPolicy,
  type AttendanceSetupState,
  type SetupServiceTime,
} from "@/lib/attendance/v2/setup";
import { geocodeAddress, type GeocodeMatch } from "@/lib/attendance/v2/geocode";
import {
  readChurchAutomaticReadiness,
  type ChurchAutomaticReadiness,
  type GeofenceWindow,
} from "@/lib/attendance/v2/geofence-config";
import { checkMyPhone, type PhoneCheck } from "@/lib/attendance/v2/phone-check";

/**
 * Check-in setup: automatic check-in, the check-in window, arrival rules,
 * campus locations and weekly service times.
 *
 * Reading is for anyone with Attendance; changing anything is for church
 * admins, the same bar as a correction or a kiosk. Every action resolves the
 * church from the caller's own session and none takes a church id, so a forged
 * payload cannot reach another church's setup.
 */

type SetupContext = { churchId: string; userId: string; isAdmin: boolean };

async function requireSetupViewer(): Promise<SetupContext> {
  const auth = await getChurchAuth();
  if (!auth) throw new VisitorError("unauthenticated", "Sign in to continue.");

  const featureError = await featureActionError("attendance");
  if (featureError) throw new VisitorError("forbidden", featureError);

  return { churchId: auth.churchId, userId: auth.userId, isAdmin: auth.isAdmin };
}

async function requireSetupAdmin(): Promise<SetupContext> {
  const context = await requireSetupViewer();
  if (!context.isAdmin) {
    throw new VisitorError("forbidden", "Only a church admin can change Automatic Attendance.");
  }
  return context;
}

function revalidateSetup() {
  revalidatePath("/dashboard/attendance/setup");
  revalidatePath("/dashboard/attendance/services");
  // Campus cards and service times also render on these.
  revalidatePath("/dashboard/app");
  revalidatePath("/dashboard/website/details");
}

/** Everything the setup screen shows, read in one pass. */
export type CheckinSetupView = {
  state: AttendanceSetupState;
  /**
   * What a phone is told about this church right now, from the same function
   * the phones' own requests use — so the page cannot say "ready" while the
   * phones are refused.
   */
  readiness: {
    problem: ChurchAutomaticReadiness["problem"];
    switchedOn: boolean;
    featureEnabled: boolean;
    watching: { campusName: string; radiusMeters: number }[];
    windows: GeofenceWindow[];
  };
  /** The signed-in person's own phone, checked the way the app checks it. */
  phone: PhoneCheck | null;
  /** The church's address from its profile, to look the building up in one tap. */
  churchAddress: string | null;
  churchName: string;
};

export async function getCheckinSetup(): Promise<VisitorResult<CheckinSetupView>> {
  try {
    const { churchId, userId } = await requireSetupViewer();
    const admin = createAdminClient();

    const [state, readiness, phone, { data: church }] = await Promise.all([
      getAttendanceSetupState(churchId, { client: admin }),
      readChurchAutomaticReadiness(churchId, { client: admin }),
      // A failure here must not take the whole setup page with it.
      checkMyPhone({ userId, churchId, client: admin }).catch(() => null),
      admin
        .from("churches")
        .select("name, address, city, state, zip")
        .eq("id", churchId)
        .maybeSingle(),
    ]);

    const churchAddress =
      [church?.address, church?.city, church?.state, church?.zip]
        .filter((part): part is string => typeof part === "string" && part.trim() !== "")
        .map((part) => part.trim())
        .join(", ") || null;

    return {
      ok: true,
      data: {
        state,
        readiness: {
          problem: readiness.problem,
          switchedOn: readiness.switchedOn,
          featureEnabled: readiness.featureEnabled,
          watching: readiness.regions.map((region) => ({
            campusName: region.campusName,
            radiusMeters: region.radiusMeters,
          })),
          windows: readiness.windows.slice(0, 6),
        },
        phone,
        churchAddress,
        churchName: (church?.name as string | undefined)?.trim() || "your church",
      },
    };
  } catch (error) {
    return toVisitorResult(error);
  }
}

export async function saveCheckinPolicy(
  values: unknown,
): Promise<VisitorResult<{ policy: AttendanceSetupPolicy; servicesUpdated: number }>> {
  try {
    const { churchId, userId } = await requireSetupAdmin();
    const saved = await saveChurchAttendancePolicy({
      churchId,
      actorUserId: userId,
      values,
    });
    revalidateSetup();
    return { ok: true, data: saved };
  } catch (error) {
    return toVisitorResult(error);
  }
}

export async function saveCampusLocation(input: {
  campusId: string;
  values: unknown;
}): Promise<VisitorResult<{ servicesUpdated: number }>> {
  try {
    const { churchId, userId } = await requireSetupAdmin();
    const saved = await saveCampusCheckinLocation({
      churchId,
      campusId: String(input.campusId ?? ""),
      actorUserId: userId,
      values: input.values,
    });
    revalidateSetup();
    return { ok: true, data: saved };
  } catch (error) {
    return toVisitorResult(error);
  }
}

/**
 * Creates the church's first campus from its own profile, so a one-building
 * church never has to learn the word "campus" to set a location.
 */
export async function addMainCampus(): Promise<VisitorResult<{ campusId: string }>> {
  try {
    const { churchId } = await requireSetupAdmin();

    const existing = await listCampuses(churchId);
    const active = existing.find((campus) => campus.isActive);
    if (active) return { ok: true, data: { campusId: active.id } };

    const { data: church } = await createAdminClient()
      .from("churches")
      .select("name, address, city, state, zip, timezone")
      .eq("id", churchId)
      .maybeSingle();

    const campus = await createCampus(churchId, {
      name: "Main campus",
      slug: existing.some((row) => row.slug === "main") ? `main-${Date.now()}` : "main",
      addressLine1: (church?.address as string | null) ?? null,
      city: (church?.city as string | null) ?? null,
      state: ((church?.state as string | null) ?? "").slice(0, 60) || null,
      postalCode: ((church?.zip as string | null) ?? "").slice(0, 12) || null,
      country: "US",
      latitude: null,
      longitude: null,
      timezone: (church?.timezone as string | null) || "America/New_York",
      geofenceRadiusM: 150,
      isActive: true,
      isPublic: true,
      isPrimary: true,
    });

    revalidateSetup();
    return { ok: true, data: { campusId: campus.id } };
  } catch (error) {
    return toVisitorResult(error);
  }
}

/**
 * Looks an address up. Limited per church: the geocoder is a free public
 * service with a one-request-a-second policy, and a church looks its address up
 * a handful of times, not dozens a minute.
 */
export async function findAddress(query: string): Promise<VisitorResult<GeocodeMatch[]>> {
  try {
    const { churchId } = await requireSetupAdmin();

    const limited = await checkRateLimit(`attendance:geocode:${churchId}`, {
      limit: 10,
      windowMs: 60 * 1000,
    });
    if (!limited.ok) {
      return fail("rate_limited", "Too many searches. Wait a minute and try again.");
    }

    const matches = await geocodeAddress(String(query ?? ""));
    if (matches === null) {
      return fail(
        "unavailable",
        "Address search isn't available right now. Drop a pin on the map or enter coordinates instead.",
      );
    }
    return { ok: true, data: matches };
  } catch (error) {
    return toVisitorResult(error);
  }
}

export async function saveServiceTimes(
  rows: unknown,
): Promise<VisitorResult<{ serviceTimes: SetupServiceTime[]; servicesUpdated: number }>> {
  try {
    const { churchId, userId } = await requireSetupAdmin();
    const saved = await saveServiceSchedule({ churchId, actorUserId: userId, rows });
    revalidateSetup();
    return { ok: true, data: saved };
  } catch (error) {
    return toVisitorResult(error);
  }
}
