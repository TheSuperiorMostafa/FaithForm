import { redirect } from "next/navigation";
import { Smartphone } from "lucide-react";

import {
  getCampusesForSettings,
  getInvitationsForSettings,
} from "@/app/dashboard/settings/faithform-actions";
import { getPendingJoinRequests } from "@/app/dashboard/people/claim-actions";
import { AutomaticCheckinSummaryCard } from "@/components/attendance/automatic-checkin-summary-card";
import { FaithFormVisibilityCard } from "@/components/member-app/app-visibility-card";
import { ChurchInfoEditor } from "@/components/member-app/church-info-editor";
import { JoinRequestsPanel } from "@/components/people/join-requests-panel";
import { VisitorInvitationsCard } from "@/components/settings/visitor-invitations-card";
import { ErrorState } from "@/components/ui/error-state";
import { PageHeader, SectionHeader } from "@/components/ui/page-header";
import { readChurchAutomaticReadiness } from "@/lib/attendance/v2/geofence-config";
import { getChurchAuth } from "@/lib/auth/church";
import { getFeatureAccess } from "@/lib/features/access";
import { getChurchAppInfo } from "@/lib/queries/church-app-info";
import { getChurchDiscoverySettings } from "@/lib/queries/faithform-settings";

export const dynamic = "force-dynamic";

/**
 * Your church in the member app, in one place: the church page people open
 * from Home — edited beside a live phone — and then how people find and add
 * your church.
 */
export default async function MemberAppPage() {
  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  if (!auth.churchId) {
    return (
      <div className="flex w-full flex-col items-center justify-center gap-3 py-16 text-center">
        <h2 className="text-xl font-semibold text-foreground">
          Your account isn&apos;t connected to a church yet
        </h2>
        <p className="max-w-md text-base text-muted-foreground">
          Ask your church admin for an invite, then come back here to manage
          how your church appears in the app.
        </p>
      </div>
    );
  }

  const [discovery, campuses, invitationPage, relationships, readiness, access, churchInfo] =
    await Promise.all([
      getChurchDiscoverySettings(auth.churchId),
      getCampusesForSettings(),
      getInvitationsForSettings(),
      getPendingJoinRequests(),
      // The same readiness the phones get; a failure only hides the card.
      readChurchAutomaticReadiness(auth.churchId).catch(() => null),
      getFeatureAccess(),
      getChurchAppInfo(auth.churchId).catch(() => null),
    ]);

  // The app no longer asks anyone to join, so new requests stop arriving.
  // Requests made from older app builds still get an answer here.
  const joinRequests = relationships.items.filter(
    (relationship) => relationship.state === "pending",
  );

  const canUseAttendance = access?.allowed.includes("attendance") ?? false;

  return (
    <div className="flex w-full flex-col gap-8">
      <PageHeader
        title="Church App"
        icon={Smartphone}
        description="Your church's page in the FaithForm app, and how people find and add your church."
      />

      {joinRequests.length > 0 && <JoinRequestsPanel requests={joinRequests} />}

      <section className="flex flex-col gap-4" aria-labelledby="church-page-heading">
        <SectionHeader
          id="church-page-heading"
          title="Your church page"
          description="What people see when they open your church in the app. Your website and phone assistant use the same details, so a change here updates them too."
        />
        {churchInfo ? (
          <ChurchInfoEditor
            initial={churchInfo.info}
            context={churchInfo.context}
            canEdit={auth.isAdmin}
          />
        ) : (
          <ErrorState
            title="We couldn't load your church page"
            description="Nothing was changed. Refresh the page to try again."
            compact
          />
        )}
      </section>

      <section className="flex flex-col gap-4" aria-labelledby="church-access-heading">
        <SectionHeader
          id="church-access-heading"
          title="How people add your church"
          description="Each person has one church in the app. Invitation links are the easiest way in; being listed in search is optional."
        />
        <div className="grid gap-5 lg:grid-cols-2">
          <FaithFormVisibilityCard
            isAdmin={auth.isAdmin}
            isDiscoverable={discovery.isDiscoverable}
            publicSummary={discovery.publicSummary}
            joinPolicy={discovery.joinPolicy}
            slug={discovery.slug}
            campuses={campuses}
            canFindAddress={auth.isAdmin && canUseAttendance}
          />
          <VisitorInvitationsCard
            isAdmin={auth.isAdmin}
            invitations={invitationPage.items}
          />
        </div>
      </section>

      {readiness ? (
        <AutomaticCheckinSummaryCard
          problem={readiness.problem}
          watching={readiness.regions.map((region) => ({
            campusName: region.campusName,
            radiusMeters: region.radiusMeters,
          }))}
          nextWindow={readiness.windows[0] ?? null}
          canOpenSetup={canUseAttendance}
        />
      ) : null}
    </div>
  );
}
