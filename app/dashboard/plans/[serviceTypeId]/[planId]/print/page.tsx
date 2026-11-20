import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Printer } from "lucide-react";

import { PrintPreview, type PrintPerson } from "@/components/service-plans/print-preview";
import { PageHeader } from "@/components/ui/page-header";
import { getChurchAuth } from "@/lib/auth/church";
import { pageFeatureBlocked } from "@/lib/features/page-gate";
import { getPlan, listTeams } from "@/lib/service-plans/queries";
import { formatClockTime } from "@/lib/service-plans/timing";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Same words in `loading.tsx` (a page may not export them).
const PRINT_TITLE = "Print this plan";
const PRINT_DESCRIPTION = "Choose who it's for and what to show, check the preview, then download the PDF.";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type PageProps = { params: Promise<{ serviceTypeId: string; planId: string }> };

export default async function PrintPlanPage({ params }: PageProps) {
  if (await pageFeatureBlocked("service_plans")) return null;
  const [{ serviceTypeId, planId }, auth] = await Promise.all([params, getChurchAuth()]);
  if (!auth) redirect("/login");
  if (!UUID.test(serviceTypeId) || !UUID.test(planId)) notFound();

  const client = createClient();
  const plan = await getPlan(client, auth.churchId, planId);
  if (!plan || plan.serviceTypeId !== serviceTypeId) notFound();
  const teams = await listTeams(client, auth.churchId, plan.serviceTypeId);

  // Anyone who leads an item by name or serves on this plan's team.
  const people = new Map<string, PrintPerson>();
  for (const item of plan.items) {
    for (const leader of item.leaders) {
      if (leader.personId) people.set(leader.personId, { id: leader.personId, name: leader.name });
    }
  }
  for (const member of plan.team) {
    if (member.status !== "declined") people.set(member.personId, { id: member.personId, name: member.personName });
  }

  const times = plan.times.map((t) => ({
    id: t.id,
    label: `${t.label} · ${formatClockTime(t.startsAt, auth.churchTimezone)}`,
  }));
  const defaultTimeId = (plan.times.find((t) => t.kind === "service") ?? plan.times[0])?.id ?? null;
  const planHref = `/dashboard/plans/${serviceTypeId}/${planId}`;

  return (
    <div className="flex w-full flex-col gap-8">
      <Link
        href={planHref}
        className="inline-flex min-h-11 w-fit items-center gap-2 text-[15px] font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-5" />
        Back to plan
      </Link>
      <PageHeader title={PRINT_TITLE} description={PRINT_DESCRIPTION} icon={Printer} />
      <PrintPreview
        planId={plan.id}
        teams={teams.map((t) => ({ id: t.id, name: t.name, noteCategories: t.noteCategories }))}
        people={[...people.values()].sort((a, b) => a.name.localeCompare(b.name))}
        times={times}
        defaultTimeId={defaultTimeId}
      />
    </div>
  );
}
