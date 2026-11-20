import { notFound, redirect } from "next/navigation";
import { PlanEditor } from "@/components/service-plans/editor/plan-editor";
import { RememberLastType } from "@/components/service-plans/remember-last-type";
import { getChurchAuth } from "@/lib/auth/church";
import { pageFeatureBlocked } from "@/lib/features/page-gate";
import { getPlan, listPeopleOptions, listTeams } from "@/lib/service-plans/queries";
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

  const [people, teams] = await Promise.all([
    listPeopleOptions(client, auth.churchId),
    listTeams(client, auth.churchId, plan.serviceTypeId),
  ]);

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
