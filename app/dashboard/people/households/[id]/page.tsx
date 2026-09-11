import { notFound, redirect } from "next/navigation";

import { HouseholdDetail } from "@/components/checkin/household-detail";
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
  const [household, members] = await Promise.all([
    getHousehold(auth.churchId, id, supabase),
    getMembersForChurch(supabase, auth.churchId),
  ]);

  if (!household) notFound();

  return (
    <HouseholdDetail
      household={household}
      members={members}
      isAdmin={auth.isAdmin}
    />
  );
}
