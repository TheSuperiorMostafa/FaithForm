import { redirect } from "next/navigation";

import { ScheduleCard } from "@/components/live-streaming/schedule-card";
import { ServicePresentationLinker } from "@/components/live-streaming/service-presentation-linker";
import { AdvancedSection } from "@/components/ui/advanced-section";
import { getChurchAuth } from "@/lib/auth/church";
import { canAccessFeature, getFeatureAccess } from "@/lib/features/access";
import { listStreamEvents } from "@/lib/stream/events";
import { getLiveBroadcastStatus } from "@/lib/stream/go-live";
import { createClient } from "@/lib/supabase/server";
import { pageFeatureBlocked } from "@/lib/features/page-gate";

export const dynamic = "force-dynamic";

/**
 * Upcoming services, off the Go live card: the schedule, and (secondary) the
 * sermon slides linked to each service.
 */
export default async function UpcomingServicesPage() {
  if (await pageFeatureBlocked("live_stream")) return null;

  const supabase = createClient();
  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  const [events, status, access] = await Promise.all([
    listStreamEvents(auth.churchId, { limit: 20, supabase }),
    getLiveBroadcastStatus(auth.churchId, supabase),
    getFeatureAccess(),
  ]);
  // Linked slides are the ones shared in the app, so linking needs Sermons and
  // the app switched on (the link route refuses otherwise).
  const canLinkSlides =
    auth.isAdmin && canAccessFeature(access, "sermon_builder") && canAccessFeature(access, "member_app");

  return (
    <div className="flex w-full flex-col gap-8">
      <ScheduleCard
        isAdmin={auth.isAdmin}
        events={events}
        youtubeConnected={status.platforms.youtube.connected}
        facebookConnected={status.platforms.facebook.connected}
        timeZone={auth.churchTimezone ?? "America/New_York"}
      />

      {canLinkSlides ? (
        <AdvancedSection
          title="Show sermon slides during a service"
          description="Link a sermon's slides so people can open them while they watch."
        >
          <ServicePresentationLinker bare />
        </AdvancedSection>
      ) : null}
    </div>
  );
}
