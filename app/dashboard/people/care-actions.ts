"use server";

import { getChurchAuth } from "@/lib/auth/church";
import { featureActionError } from "@/lib/features/guard";
import { listLocations, listMemberFiles } from "@/lib/queries/checkin";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { ChurchLocation, MemberFile } from "@/types/checkin";

export type MemberCareDetails = {
  medicalNotes: string | null;
  defaultLocationId: string | null;
  locations: ChurchLocation[];
  files: MemberFile[];
  /** False on a database that has not had migration 0071 applied. */
  available: boolean;
};

export type CareResult<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Everything the People panel shows below the name and phone number.
 *
 * Fetched on demand rather than with the directory. A church with two thousand
 * members would otherwise pay for two thousand medical notes and file lists to
 * render a list that shows neither, and one of those columns is the most
 * sensitive thing in the table.
 */
export async function getMemberCareDetails(
  memberId: string,
): Promise<CareResult<MemberCareDetails>> {
  const auth = await getChurchAuth();
  if (!auth) return { ok: false, error: "You must be signed in." };

  const featureError = await featureActionError("people");
  if (featureError) return { ok: false, error: featureError };

  const supabase = createClient();

  const { data: member, error } = await supabase
    .from("members")
    .select("id, medical_notes, default_location_id")
    .eq("id", memberId)
    .eq("church_id", auth.churchId)
    .maybeSingle();

  // Before 0071 these columns do not exist. The panel then renders as "not set
  // up yet" instead of showing an error on a page that otherwise works.
  if (error && /medical_notes|default_location_id/i.test(error.message)) {
    return {
      ok: true,
      data: {
        medicalNotes: null,
        defaultLocationId: null,
        locations: [],
        files: [],
        available: false,
      },
    };
  }

  if (!member) return { ok: false, error: "That person could not be found." };

  const [locations, files] = await Promise.all([
    listLocations(auth.churchId, {}, supabase),
    // Read through the user's own client so the admin-only visibility policy on
    // `member_files` decides what comes back, rather than this function.
    listMemberFiles(memberId, supabase),
  ]);

  return {
    ok: true,
    data: {
      medicalNotes: (member.medical_notes as string | null) ?? null,
      defaultLocationId: (member.default_location_id as string | null) ?? null,
      locations,
      files,
      available: true,
    },
  };
}

export async function saveMemberCareDetails(input: {
  memberId: string;
  medicalNotes: string;
  defaultLocationId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await getChurchAuth();
  if (!auth) return { ok: false, error: "You must be signed in." };

  const featureError = await featureActionError("people");
  if (featureError) return { ok: false, error: featureError };

  if (!auth.isAdmin) {
    return { ok: false, error: "Only church admins can edit people." };
  }

  const { error } = await createAdminClient()
    .from("members")
    .update({
      medical_notes: input.medicalNotes.trim() || null,
      default_location_id: input.defaultLocationId || null,
    })
    .eq("id", input.memberId)
    .eq("church_id", auth.churchId);

  if (error) {
    return {
      ok: false,
      error: /medical_notes|default_location_id/i.test(error.message)
        ? "Check-In has not been set up on this database yet."
        : "Could not save those details.",
    };
  }

  return { ok: true };
}
