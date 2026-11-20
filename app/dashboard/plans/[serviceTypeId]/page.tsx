import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { List, ListRow } from "@/components/ui/list-row";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NewPlanButton } from "@/components/service-plans/new-plan-dialog";
import { RememberLastType } from "@/components/service-plans/remember-last-type";
import { ServiceTypeSettings } from "@/components/service-plans/service-type-settings";
import { TeamsEditor } from "@/components/service-plans/teams-editor";
import { TemplatesList } from "@/components/service-plans/templates-list";
import { getChurchAuth } from "@/lib/auth/church";
import { localDateInTimeZone } from "@/lib/checkin/service-week";
import { pageFeatureBlocked } from "@/lib/features/page-gate";
import {
  getServiceType,
  listPlans,
  listRecentPlansForCopy,
  listTeams,
  listTemplates,
} from "@/lib/service-plans/queries";
import { formatDuration, formatPlanDate, nextWeekdayOnOrAfter } from "@/lib/service-plans/timing";
import type { PlanListRow } from "@/lib/service-plans/types";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const TABS = ["plans", "templates", "teams", "settings"] as const;
type Tab = (typeof TABS)[number];

type PageProps = {
  params: Promise<{ serviceTypeId: string }>;
  searchParams: Promise<{ tab?: string }>;
};

function TeamStatusBadge({ row }: { row: PlanListRow }) {
  const { confirmed, pending, unfilled } = row.teamStatus;
  if (unfilled > 0) return <StatusBadge tone="attention">{unfilled} unfilled</StatusBadge>;
  if (pending > 0) return <StatusBadge tone="working">{pending} pending</StatusBadge>;
  if (confirmed > 0) return <StatusBadge tone="ready">Team confirmed</StatusBadge>;
  return <StatusBadge tone="neutral">No team yet</StatusBadge>;
}

function PlanRows({ rows, serviceTypeId, label }: { rows: PlanListRow[]; serviceTypeId: string; label: string }) {
  return (
    <List label={label}>
      {rows.map((row) => (
        <ListRow
          key={row.id}
          href={`/dashboard/plans/${serviceTypeId}/${row.id}`}
          leading={
            <span className="flex size-14 flex-col items-center justify-center rounded-2xl bg-primary/[0.07] text-primary dark:bg-accent/15 dark:text-accent">
              <span className="text-xs font-semibold uppercase">
                {formatPlanDate(row.date, "short").split(",")[1]?.trim().split(" ")[0]}
              </span>
              <span className="font-heading text-lg font-bold leading-none">{Number(row.date.slice(8, 10))}</span>
            </span>
          }
          title={row.title || formatPlanDate(row.date)}
          subtitle={[
            row.title ? formatPlanDate(row.date) : null,
            row.series ? `Series: ${row.series}` : null,
            `${row.itemCount} ${row.itemCount === 1 ? "item" : "items"}`,
            formatDuration(row.totalSeconds),
          ]
            .filter(Boolean)
            .join(" · ")}
          status={<TeamStatusBadge row={row} />}
        />
      ))}
    </List>
  );
}

export default async function ServiceTypePage({ params, searchParams }: PageProps) {
  if (await pageFeatureBlocked("service_plans")) return null;
  const [{ serviceTypeId }, query, auth] = await Promise.all([params, searchParams, getChurchAuth()]);
  if (!auth) redirect("/login");
  if (!/^[0-9a-f-]{36}$/i.test(serviceTypeId)) notFound();

  const client = createClient();
  const type = await getServiceType(client, auth.churchId, serviceTypeId);
  if (!type) notFound();

  const today = localDateInTimeZone(auth.churchTimezone);
  const [plans, templates, teams, recent] = await Promise.all([
    listPlans(client, auth.churchId, type.id, today),
    listTemplates(client, auth.churchId, type.id),
    listTeams(client, auth.churchId, type.id),
    listRecentPlansForCopy(client, auth.churchId, type.id),
  ]);
  const tab: Tab = (TABS as readonly string[]).includes(query.tab ?? "") ? (query.tab as Tab) : "plans";
  const defaultDate = nextWeekdayOnOrAfter(today, type.defaultWeekday ?? 0);

  const newPlan = (
    <NewPlanButton
      serviceTypeId={type.id}
      defaultDate={defaultDate}
      templates={templates.map((t) => ({ id: t.id, title: t.title }))}
      defaultTemplateId={type.defaultTemplateId}
      recentPlans={recent}
    />
  );

  return (
    <div className="flex w-full flex-col gap-8">
      <RememberLastType serviceTypeId={type.id} />
      <div className="flex flex-col gap-4">
        <Button variant="link" className="w-fit" nativeButton={false} render={<Link href="/dashboard/plans?home=1" />}>
          <ArrowLeft aria-hidden className="size-4" />
          Service Plans
        </Button>
        <PageHeader
          title={type.name}
          description="Each date's plan, the templates new plans start from, who serves, and default times."
          icon={CalendarDays}
          action={newPlan}
        />
      </div>

      <Tabs defaultValue={tab}>
        <TabsList aria-label="Service type sections" className="max-w-full overflow-x-auto">
          <TabsTrigger value="plans">Plans</TabsTrigger>
          <TabsTrigger value="templates">Templates ({templates.length})</TabsTrigger>
          <TabsTrigger value="teams">Teams and positions</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="plans" className="mt-6 flex flex-col gap-8">
          {plans.upcoming.length === 0 && plans.past.length === 0 ? (
            <EmptyState
              icon={CalendarDays}
              title="No plans yet"
              description={`Make the plan for ${formatPlanDate(defaultDate)} from a template, and every start time works itself out.`}
              action={newPlan}
            />
          ) : (
            <>
              <section className="flex flex-col gap-3" aria-labelledby="upcoming-plans">
                <h2 id="upcoming-plans" className="font-heading text-xl font-bold">
                  Upcoming
                </h2>
                {plans.upcoming.length ? (
                  <PlanRows rows={plans.upcoming} serviceTypeId={type.id} label="Upcoming plans" />
                ) : (
                  <p className="text-[15px] text-muted-foreground">Nothing planned ahead yet.</p>
                )}
              </section>
              {plans.past.length > 0 && (
                <section className="flex flex-col gap-3" aria-labelledby="past-plans">
                  <h2 id="past-plans" className="font-heading text-xl font-bold">
                    Past
                  </h2>
                  <PlanRows rows={plans.past} serviceTypeId={type.id} label="Past plans" />
                </section>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="templates" className="mt-6">
          <TemplatesList serviceTypeId={type.id} templates={templates} defaultTemplateId={type.defaultTemplateId} />
        </TabsContent>

        <TabsContent value="teams" className="mt-6">
          <TeamsEditor serviceTypeId={type.id} teams={teams} />
        </TabsContent>

        <TabsContent value="settings" className="mt-6">
          <ServiceTypeSettings type={type} templates={templates.map((t) => ({ id: t.id, title: t.title }))} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
