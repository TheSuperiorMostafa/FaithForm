import { notFound, redirect } from "next/navigation";
import { PlanEditor } from "@/components/service-plans/editor/plan-editor";
import { RememberLastType } from "@/components/service-plans/remember-last-type";
import { getChurchAuth } from "@/lib/auth/church";
import { pageFeatureBlocked } from "@/lib/features/page-gate";
import { getPlan, listPeopleOptions, listTeams } from "@/lib/service-plans/queries";
import { readAvailabilityForPeople } from "@/lib/groups/availability";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ serviceTypeId: string; planId: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PlanPage({ params }: PageProps) {
  if (await pageFeatureBlocked("service_plans")) return null;
  const [{ serviceTypeId, planId }, auth] = await Promise.all([params, getChurchAuth()]);
  if (!auth) redirect("/login");
  if (!UUID.test(planId) || !UUID.test(serviceTypeId)) notFound();

  const client = createClient();
  const plan = await getPlan(client, auth.churchId, planId);
  if (!plan) notFound();
  if (plan.serviceTypeId !== serviceTypeId) redirect(`/dashboard/plans/${plan.serviceTypeId}/${plan.id}`);

  const [peopleList, teams] = await Promise.all([
    listPeopleOptions(client, auth.churchId),
    listTeams(client, auth.churchId, plan.serviceTypeId),
  ]);

  // What each person told their groups about when they can serve, shown while
  // scheduling. Scoped to the signed-in staff member's church. Optional: if it
  // can't be read, the plan still opens without it.
  const availability = await readAvailabilityForPeople(
    createAdminClient(),
    auth.churchId,
    peopleList.map((p) => p.id),
  ).catch((error) => {
    console.error("[plans] availability failed to load", error);
    return new Map<string, { groupName: string; availability: string }[]>();
  });
  const people = peopleList.map((p) => {
    const entries = availability.get(p.id);
    if (!entries?.length) return p;
    const text = entries.length === 1
      ? entries[0].availability
      : entries.map((e) => `${e.groupName}: ${e.availability}`).join(" · ");
    return { ...p, availability: text };
  });

  return (
    <>
      <RememberLastType serviceTypeId={plan.serviceTypeId} />
      <PlanEditor
        initialPlan={plan}
        people={people}
        teams={teams}
        timeZone={auth.churchTimezone}
        userId={auth.userId}
      />
    </>
  );
}
