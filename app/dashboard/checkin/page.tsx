import { redirect } from "next/navigation";

import { RosterBoard } from "@/components/checkin/roster-board";
import { getChurchAuth } from "@/lib/auth/church";
import { localDateInTimeZone } from "@/lib/checkin/service-week";
import {
  getRoster,
  listCheckinChildren,
  listLocations,
} from "@/lib/queries/checkin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function CheckinTodayPage() {
  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  const supabase = createClient();
  const today = localDateInTimeZone(auth.churchTimezone);

  const [locations, sessions, children] = await Promise.all([
      listLocations(auth.churchId, {}, supabase),
      getRoster(auth.churchId, today, {}, supabase),
      listCheckinChildren(auth.churchId, supabase),
    ]);

  const defaultLocationByMember = Object.fromEntries(
    children
      .filter((child) => child.defaultLocationId)
      .map((child) => [child.id, child.defaultLocationId as string]),
  );

  return (
    <RosterBoard
      sessions={sessions}
      locations={locations}
      members={children}
      defaultLocationByMember={defaultLocationByMember}
      serviceDate={today}
    />
  );
}
