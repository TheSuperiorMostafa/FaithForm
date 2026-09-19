import { redirect } from "next/navigation";

import {
  getCampusesForSettings,
  getInvitationsForSettings,
} from "@/app/dashboard/settings/faithform-actions";
import { getPendingJoinRequests } from "@/app/dashboard/people/claim-actions";
import { AutomaticCheckinSummaryCard } from "@/components/attendance/automatic-checkin-summary-card";
import { ChurchInfoEditor } from "@/components/member-app/church-info-editor";
import { JoinRequestsPanel } from "@/components/people/join-requests-panel";
import { FaithFormVisibilityCard } from "@/components/settings/faithform-visibility-card";
import { VisitorInvitationsCard } from "@/components/settings/visitor-invitations-card";
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

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-8">
      <div>
        <h1 className="border-l-4 border-accent pl-3 font-heading text-[26px] font-bold">
          Member App
        </h1>
        <p className="text-sm text-muted-foreground">
          Your church&apos;s page in the app — what people see when they tap
          Church info — and how people find and add your church.
        </p>
      </div>

      {joinRequests.length > 0 && <JoinRequestsPanel requests={joinRequests} />}

      <section className="flex flex-col gap-4" aria-labelledby="church-page-heading">
        <div>
          <h2 id="church-page-heading" className="font-heading text-xl font-bold">
            Church page
          </h2>
          <p className="text-sm text-muted-foreground">
            Everything here shows on your church&apos;s page in the iPhone and
            Android apps. The website and phone assistant use the same details.
          </p>
        </div>
        {churchInfo ? (
          <ChurchInfoEditor
            initial={churchInfo.info}
            context={churchInfo.context}
            canEdit={auth.isAdmin}
          />
        ) : (
          <p className="rounded-xl border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
            Your church page could not be loaded right now. Refresh to try again.
          </p>
        )}
      </section>

      <section className="flex flex-col gap-4" aria-labelledby="church-access-heading">
        <div>
          <h2 id="church-access-heading" className="font-heading text-xl font-bold">
            How people add your church
          </h2>
          <p className="text-sm text-muted-foreground">
            Each person has one church in the app. Invitation links are the
            easiest way in; listing in search is optional.
          </p>
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
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
      </section>

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
    </div>
  );
}
