import { redirect } from "next/navigation";

import { RosterBoard } from "@/components/checkin/roster-board";
import { getChurchAuth } from "@/lib/auth/church";
import { localDateInTimeZone } from "@/lib/checkin/service-week";
import { getRoster, listLocations } from "@/lib/queries/checkin";
import { getMembersForChurch } from "@/lib/queries/members";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function CheckinTodayPage() {
  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  const supabase = createClient();
  const today = localDateInTimeZone(auth.churchTimezone);

  const [locations, sessions, members, { data: defaults }] = await Promise.all([
    listLocations(auth.churchId, {}, supabase),
    getRoster(auth.churchId, today, {}, supabase),
    getMembersForChurch(supabase, auth.churchId),
    supabase
      .from("members")
      .select("id, default_location_id")
      .eq("church_id", auth.churchId)
      .not("default_location_id", "is", null),
  ]);

  const defaultLocationByMember = Object.fromEntries(
    (defaults ?? []).map((row) => [
      row.id as string,
      row.default_location_id as string,
    ]),
  );

  return (
    <RosterBoard
      sessions={sessions}
      locations={locations}
      members={members}
      defaultLocationByMember={defaultLocationByMember}
      serviceDate={today}
    />
  );
}
