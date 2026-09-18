import { redirect } from "next/navigation";

import { AppMembersNotInPeoplePanel } from "@/components/people/app-members-not-in-people-panel";
import { JoinRequestsPanel } from "@/components/people/join-requests-panel";
import { PeopleClaimsPanel } from "@/components/people/people-claims-panel";
import { PeopleManager } from "@/components/people/people-manager";
import {
  getAppMembersNotInPeople,
  getPendingClaims,
  getPendingJoinRequests,
} from "@/app/dashboard/people/claim-actions";
import { getChurchAuth } from "@/lib/auth/church";
import { listAppConnections } from "@/lib/faithform/app-people";
import { getFeatureAccess } from "@/lib/features/access";
import { getMembersForChurch } from "@/lib/queries/members";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function PeoplePage() {
  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  if (!auth.churchId) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col items-center justify-center gap-3 py-16 text-center">
        <h2 className="text-xl font-semibold text-foreground">
          No church linked yet
        </h2>
        <p className="max-w-md text-base text-muted-foreground">
          Your account is not linked to a church yet. Contact support to connect
          your church before managing people.
        </p>
      </div>
    );
  }

  const supabase = createClient();
  const access = await getFeatureAccess();
  // Who is on the app is only worth showing where the church offers the app.
  const showAppStatus = access?.flags.member_app ?? false;

  const [members, pendingClaims, relationships, notInPeople, connections] =
    await Promise.all([
      getMembersForChurch(supabase, auth.churchId, {
        includeInactive: true,
        includeAttendanceTotals: true,
      }),
      getPendingClaims(),
      getPendingJoinRequests(),
      getAppMembersNotInPeople(),
      showAppStatus
        ? listAppConnections(supabase, auth.churchId)
        : Promise.resolve(new Map<string, { linkedAt: string }>()),
    ]);

  // Filtered in the database already; kept so a stray state can never render
  // as a request.
  const joinRequests = relationships.items.filter(
    (relationship) => relationship.state === "pending",
  );

  return (
    <div className="flex w-full flex-col gap-5">
      <JoinRequestsPanel requests={joinRequests} />
      <PeopleClaimsPanel claims={pendingClaims} />
      <AppMembersNotInPeoplePanel people={notInPeople} />
      <PeopleManager
        initialMembers={members}
        isAdmin={auth.isAdmin}
        showAppStatus={showAppStatus}
        appConnections={Object.fromEntries(connections)}
      />
    </div>
  );
}
