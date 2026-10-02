import { redirect } from "next/navigation";

import { ActivityFeed } from "@/components/checkin/activity-feed";
import {
  ACTIVE_NOW_DESCRIPTION,
  ACTIVE_NOW_TITLE,
  ROOMS_DESCRIPTION,
  ROOMS_TITLE,
} from "@/components/checkin/copy";
import { LocationsManager } from "@/components/checkin/locations-manager";
import { RoomAlerts } from "@/components/checkin/room-alerts";
import { RosterBoard } from "@/components/checkin/roster-board";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/ui/page-header";
import { getChurchAuth } from "@/lib/auth/church";
import {
  buildActivityFeed,
  buildRoomAlerts,
  openRosterSessions,
} from "@/lib/checkin/rooms-activity";
import { localDateInTimeZone } from "@/lib/checkin/service-week";
import { getRoster, listLocations } from "@/lib/queries/checkin";
import { createClient } from "@/lib/supabase/server";
import { pageFeatureBlocked } from "@/lib/features/page-gate";

export const dynamic = "force-dynamic";

/**
 * Rooms: the interactive roster volunteers work from, today's activity, and
 * capacity alerts — with room settings tucked under More options so a normal
 * Sunday does not require a manual.
 */
export default async function CheckinLocationsPage() {
  if (await pageFeatureBlocked("checkin")) return null;

  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  const supabase = createClient();
  const today = localDateInTimeZone(auth.churchTimezone);

  // One roster read with closed sessions included: open rows power the board,
  // checked-out rows power today's activity feed. No extra tables.
  const [locations, daySessions] = await Promise.all([
    listLocations(auth.churchId, { includeInactive: true, strict: true }, supabase),
    getRoster(auth.churchId, today, { includeClosed: true, strict: true }, supabase),
  ]);

  const activeLocations = locations.filter((location) => location.isActive);
  const openSessions = openRosterSessions(daySessions);
  const activity = buildActivityFeed(daySessions);
  const alerts = buildRoomAlerts(openSessions, activeLocations, activity);

  return (
    <div className="flex w-full flex-col gap-8">
      <SectionHeader title={ROOMS_TITLE} description={ROOMS_DESCRIPTION} />

      <RoomAlerts alerts={alerts} />

      <section aria-labelledby="rooms-active-now" className="flex flex-col gap-5">
        <SectionHeader
          id="rooms-active-now"
          title={ACTIVE_NOW_TITLE}
          description={ACTIVE_NOW_DESCRIPTION}
        />
        {activeLocations.length === 0 ? (
          <EmptyState
            title="No open rooms"
            description={
              auth.isAdmin
                ? "Open Room settings below to add a room or reopen one."
                : "A church admin needs to open a room before children can be checked in."
            }
          />
        ) : (
          <RosterBoard
            sessions={openSessions}
            locations={activeLocations}
            currentUserId={auth.userId}
          />
        )}
      </section>

      <ActivityFeed events={activity} timeZone={auth.churchTimezone} />

      <LocationsManager locations={locations} isAdmin={auth.isAdmin} />
    </div>
  );
}
