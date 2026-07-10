import { redirect } from "next/navigation";

import { PeopleManager } from "@/components/people/people-manager";
import { getChurchAuth } from "@/lib/auth/church";
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
  const members = await getMembersForChurch(supabase, auth.churchId, {
    includeInactive: true,
  });

  return <PeopleManager initialMembers={members} isAdmin={auth.isAdmin} />;
}
