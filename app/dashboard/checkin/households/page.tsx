import { redirect } from "next/navigation";

import { HouseholdsDirectory } from "@/components/checkin/households-directory";
import { getChurchAuth } from "@/lib/auth/church";
import { listHouseholds } from "@/lib/queries/checkin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function HouseholdsPage() {
  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  const supabase = createClient();

  const [households, { data: memberships }, { count: memberCount }] =
    await Promise.all([
      listHouseholds(auth.churchId, supabase),
      supabase
        .from("household_members")
        .select("household_id, members(first_name, last_name)")
        .eq("church_id", auth.churchId),
      supabase
        .from("members")
        .select("id", { count: "exact", head: true })
        .eq("church_id", auth.churchId)
        .eq("is_active", true),
    ]);

  // The name index is built here rather than searched per keystroke: a church
  // directory is small enough to hand over whole, and a round trip on every
  // letter is exactly what makes a front desk stop using search.
  const householdByPersonName = (memberships ?? [])
    .map((row) => {
      const member = Array.isArray(row.members) ? row.members[0] : row.members;
      if (!member) return null;
      return {
        name: `${member.first_name} ${member.last_name}`,
        householdId: row.household_id as string,
      };
    })
    .filter((row): row is { name: string; householdId: string } => row !== null);

  return (
    <HouseholdsDirectory
      households={households}
      householdByPersonName={householdByPersonName}
      isAdmin={auth.isAdmin}
      unassignedCount={Math.max(
        0,
        (memberCount ?? 0) - householdByPersonName.length,
      )}
    />
  );
}
