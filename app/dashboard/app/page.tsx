import { redirect } from "next/navigation";

import {
  getCampusesForSettings,
  getInvitationsForSettings,
} from "@/app/dashboard/settings/faithform-actions";
import { getPendingJoinRequests } from "@/app/dashboard/people/claim-actions";
import { AutomaticCheckinSummaryCard } from "@/components/attendance/automatic-checkin-summary-card";
import { JoinRequestsPanel } from "@/components/people/join-requests-panel";
import { FaithFormVisibilityCard } from "@/components/settings/faithform-visibility-card";
import { VisitorInvitationsCard } from "@/components/settings/visitor-invitations-card";
import { readChurchAutomaticReadiness } from "@/lib/attendance/v2/geofence-config";
import { getChurchAuth } from "@/lib/auth/church";
import { getFeatureAccess } from "@/lib/features/access";
import { getChurchDiscoverySettings } from "@/lib/queries/faithform-settings";

export const dynamic = "force-dynamic";

/**
 * Everything about your church in the member app, in one sidebar-visible
 * place: how people find you, who is waiting on a yes, and the invitation
 * links that admit someone directly. This used to live behind Settings, where
 * nobody thought to look for it.
 */
export default async function MemberAppPage() {
  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  if (!auth.churchId) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col items-center justify-center gap-3 py-16 text-center">
        <h2 className="text-xl font-semibold text-foreground">
          No church linked yet
        </h2>
        <p className="max-w-md text-base text-muted-foreground">
          Link your account to a church to manage how it appears in the app.
        </p>
      </div>
    );
  }

  const [discovery, campuses, invitationPage, relationships, readiness, access] =
    await Promise.all([
      getChurchDiscoverySettings(auth.churchId),
      getCampusesForSettings(),
      getInvitationsForSettings(),
      getPendingJoinRequests(),
      // The same readiness the phones get; a failure only hides the card.
      readChurchAutomaticReadiness(auth.churchId).catch(() => null),
      getFeatureAccess(),
    ]);

  const joinRequests = relationships.items.filter(
    (relationship) => relationship.state === "pending",
  );

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <div>
        <h1 className="border-l-4 border-accent pl-3 font-heading text-[26px] font-bold">
          Member App
        </h1>
        <p className="text-sm text-muted-foreground">
          Your people&apos;s app for this church — invitation links first,
          optional search listing, join requests, and what you publish.
        </p>
      </div>

      <JoinRequestsPanel requests={joinRequests} />
      {readiness ? (
        <AutomaticCheckinSummaryCard
          problem={readiness.problem}
          watching={readiness.regions.map((region) => ({
            campusName: region.campusName,
            radiusMeters: region.radiusMeters,
          }))}
          nextWindow={readiness.windows[0] ?? null}
          canOpenSetup={access?.allowed.includes("attendance") ?? false}
        />
      ) : null}
      <FaithFormVisibilityCard
        isAdmin={auth.isAdmin}
        isDiscoverable={discovery.isDiscoverable}
        publicSummary={discovery.publicSummary}
        joinPolicy={discovery.joinPolicy}
        slug={discovery.slug}
        campuses={campuses}
      />
      <VisitorInvitationsCard
        isAdmin={auth.isAdmin}
        invitations={invitationPage.items}
      />
    </div>
  );
}
