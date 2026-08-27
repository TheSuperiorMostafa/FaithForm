import { redirect } from "next/navigation";

import {
  getCampusesForSettings,
  getInvitationsForSettings,
} from "@/app/dashboard/settings/faithful-actions";
import { getVisitorRelationships } from "@/app/dashboard/people/claim-actions";
import { JoinRequestsPanel } from "@/components/people/join-requests-panel";
import { FaithfulVisibilityCard } from "@/components/settings/faithful-visibility-card";
import { VisitorInvitationsCard } from "@/components/settings/visitor-invitations-card";
import { getChurchAuth } from "@/lib/auth/church";
import { getChurchDiscoverySettings } from "@/lib/queries/faithful-settings";

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

  const [discovery, campuses, invitationPage, relationships] =
    await Promise.all([
      getChurchDiscoverySettings(auth.churchId),
      getCampusesForSettings(),
      getInvitationsForSettings(),
      getVisitorRelationships(),
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
          How your church shows up in the FaithForm app — who can find you, who
          can join, and the invitations that let someone in.
        </p>
      </div>

      <JoinRequestsPanel requests={joinRequests} />
      <FaithfulVisibilityCard
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
