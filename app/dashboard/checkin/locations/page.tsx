import { redirect } from "next/navigation";

import { LocationsManager } from "@/components/checkin/locations-manager";
import { getChurchAuth } from "@/lib/auth/church";
import { listLocations } from "@/lib/queries/checkin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function CheckinLocationsPage() {
  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  const locations = await listLocations(
    auth.churchId,
    { includeInactive: true },
    createClient(),
  );

  return <LocationsManager locations={locations} isAdmin={auth.isAdmin} />;
}
