import { redirect } from "next/navigation";

import { LocationsManager } from "@/components/checkin/locations-manager";
import { getChurchAuth } from "@/lib/auth/church";
import { localDateInTimeZone } from "@/lib/checkin/service-week";
import { getRoster, listLocations } from "@/lib/queries/checkin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function CheckinLocationsPage() {
  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  const supabase = createClient();
  const today = localDateInTimeZone(auth.churchTimezone);

  const [locations, sessions] = await Promise.all([
    listLocations(auth.churchId, { includeInactive: true }, supabase),
    getRoster(auth.churchId, today, {}, supabase),
  ]);

  // Who is in each room right now, so the Rooms tab answers the question a
  // director actually walks over to ask, not only how a room is configured.
  const occupancy: Record<string, string[]> = {};
  for (const session of sessions) {
    if (session.status !== "checked_in") continue;
    (occupancy[session.locationId] ??= []).push(
      `${session.firstName} ${session.lastName}`.trim(),
    );
  }

  return (
    <LocationsManager
      locations={locations}
      occupancy={occupancy}
      isAdmin={auth.isAdmin}
    />
  );
}
