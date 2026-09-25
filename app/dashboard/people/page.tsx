import { redirect } from "next/navigation";

import { Users } from "lucide-react";

import { NeedsAttentionCard } from "@/components/people/needs-attention-card";
import { PeopleManager } from "@/components/people/people-manager";
import { PEOPLE_DESCRIPTION } from "@/components/people/people-tabs";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import {
  getAppMembersNotInPeople,
  getPendingClaims,
  getPendingJoinRequests,
} from "@/app/dashboard/people/claim-actions";
import { getChurchAuth } from "@/lib/auth/church";
import { listAppConnections, listAppPhotos } from "@/lib/faithform/app-people";
import { getFeatureAccess } from "@/lib/features/access";
import { getMembersForChurch } from "@/lib/queries/members";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function PeoplePage() {
  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  if (!auth.churchId) {
    return (
      <div className="flex w-full flex-col gap-8">
        <PageHeader title="People" description={PEOPLE_DESCRIPTION} />
        <EmptyState
          icon={Users}
          title="Your account isn't connected to a church yet"
          description="Set up your church, or ask your church admin to invite you. Then you can add and find people here."
        />
      </div>
    );
  }

  const supabase = createClient();
  const access = await getFeatureAccess();
  // Who is on the app is only worth showing where the church offers the app.
  const showAppStatus = access?.flags.member_app ?? false;

  const [members, pendingClaims, relationships, notInPeople, connections, photos] =
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
      // Someone's own photo is theirs whether or not this church shows who is
      // on the app, so it is never behind that flag.
      listAppPhotos(createAdminClient(), auth.churchId),
    ]);

  // Filtered in the database already; kept so a stray state can never render
  // as a request.
  const joinRequests = relationships.items.filter(
    (relationship) => relationship.state === "pending",
  );

  return (
    <PeopleManager
      initialMembers={members}
      isAdmin={auth.isAdmin}
      showAppStatus={showAppStatus}
      appConnections={Object.fromEntries(connections)}
      appPhotos={Object.fromEntries(photos)}
      attention={
        // Join requests, identity questions and app members not yet in People,
        // folded into one card so the list stays above the fold.
        <NeedsAttentionCard
          joinRequests={joinRequests}
          claims={pendingClaims}
          notInPeople={notInPeople}
        />
      }
    />
  );
}
