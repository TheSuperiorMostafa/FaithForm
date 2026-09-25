import { notFound, redirect } from "next/navigation";

import { HouseholdDetail } from "@/components/people/household-detail";
import { getChurchAuth } from "@/lib/auth/church";
import { getHousehold } from "@/lib/queries/checkin";
import { getMembersForChurch } from "@/lib/queries/members";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function HouseholdDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  const supabase = createClient();
  const [household, members, { data: memberships }] = await Promise.all([
    getHousehold(auth.churchId, id, supabase),
    getMembersForChurch(supabase, auth.churchId),
    // Who is already in another family, so the picker can say so up front
    // instead of failing after the person is chosen.
    supabase
      .from("household_members")
      .select("member_id, household_id, households(name)")
      .eq("church_id", auth.churchId),
  ]);

  if (!household) notFound();

  const memberFamilies: Record<string, string> = {};
  for (const row of memberships ?? []) {
    if (row.household_id === id) continue;
    const family = Array.isArray(row.households) ? row.households[0] : row.households;
    if (family?.name) memberFamilies[row.member_id as string] = family.name as string;
  }

  return (
    <HouseholdDetail
      household={household}
      members={members}
      memberFamilies={memberFamilies}
      isAdmin={auth.isAdmin}
    />
  );
}
