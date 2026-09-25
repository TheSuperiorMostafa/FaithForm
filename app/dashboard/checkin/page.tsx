import { redirect } from "next/navigation";

import { CheckinDesk } from "@/components/checkin/checkin-desk";
import { getChurchAuth } from "@/lib/auth/church";
import { localDateInTimeZone } from "@/lib/checkin/service-week";
import {
  getRoster,
  listCheckinChildren,
  listLocations,
} from "@/lib/queries/checkin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Check in: the desk. Reads are strict, so a failed load reaches the
 * section's error screen instead of looking like "No rooms yet" or an empty
 * room while families are waiting.
 */
export default async function CheckinTodayPage() {
  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  const supabase = createClient();
  const today = localDateInTimeZone(auth.churchTimezone);

  const [locations, sessions, children] = await Promise.all([
    listLocations(auth.churchId, { strict: true }, supabase),
    getRoster(auth.churchId, today, { strict: true }, supabase),
    listCheckinChildren(auth.churchId, supabase, { strict: true }),
  ]);

  return (
    <CheckinDesk
      sessions={sessions}
      locations={locations}
      members={children}
      serviceDate={today}
      canAddFamily={auth.isAdmin}
      currentUserId={auth.userId}
    />
  );
}
