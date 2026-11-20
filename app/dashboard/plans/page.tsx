import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { CalendarDays, ListOrdered, Music } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { NewServiceTypeCard, StarterServiceTypeButton } from "@/components/service-plans/service-type-create";
import { getChurchAuth } from "@/lib/auth/church";
import { localDateInTimeZone } from "@/lib/checkin/service-week";
import { pageFeatureBlocked } from "@/lib/features/page-gate";
import { LAST_TYPE_COOKIE } from "@/lib/service-plans/remember";
import { PLANS_DESCRIPTION, PLANS_TITLE } from "@/lib/service-plans/page-copy";
import { listServiceTypes } from "@/lib/service-plans/queries";
import { formatClockTime, formatPlanDate } from "@/lib/service-plans/timing";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<{ home?: string }> };

export default async function ServicePlansPage({ searchParams }: PageProps) {
  if (await pageFeatureBlocked("service_plans")) return null;
  const [query, auth] = await Promise.all([searchParams, getChurchAuth()]);
  if (!auth) redirect("/login");

  const today = localDateInTimeZone(auth.churchTimezone);
  const types = await listServiceTypes(createClient(), auth.churchId, today);

  // The menu lands on next Sunday's plan for the type used last, when there is
  // one. `?home=1` (the breadcrumb) always shows this page.
  if (!query.home) {
    const last = (await cookies()).get(LAST_TYPE_COOKIE)?.value;
    const type = types.find((t) => t.id === last);
    if (type?.nextPlan) redirect(`/dashboard/plans/${type.id}/${type.nextPlan.id}`);
  }

  return (
    <div className="flex w-full flex-col gap-8">
      <PageHeader
        title={PLANS_TITLE}
        description={PLANS_DESCRIPTION}
        icon={ListOrdered}
        secondary={
          <Button variant="outline" size="lg" nativeButton={false} render={<Link href="/dashboard/plans/songs" />}>
            <Music aria-hidden className="size-5" />
            Song library
          </Button>
        }
      />

      {types.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title="Create your first service type"
          description="A service type is a kind of service you hold every week, like Sunday Morning. Start with a typical Sunday order you can change: Welcome, Announcements, Worship, Offering, Message and Closing."
          action={
            <div className="flex flex-col items-center gap-3 sm:flex-row">
              <StarterServiceTypeButton />
              <NewServiceTypeCard variant="button" />
            </div>
          }
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Service types">
          {types.map((type) => (
            <li key={type.id}>
              <Link
                href={`/dashboard/plans/${type.id}`}
                className="group flex h-full min-h-[168px] flex-col justify-between gap-4 rounded-2xl border border-border bg-card p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/60 hover:shadow-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none motion-reduce:hover:translate-y-0 sm:p-6"
              >
                <span className="font-heading text-lg font-bold leading-snug text-foreground">{type.name}</span>
                <span className="space-y-1 text-[15px] leading-snug text-muted-foreground">
                  <span className="block font-semibold text-foreground">
                    {type.nextPlan
                      ? `Next: ${formatPlanDate(type.nextPlan.date, "short")}${
                          type.nextPlan.firstTime
                            ? ` at ${formatClockTime(type.nextPlan.firstTime, auth.churchTimezone)}`
                            : ""
                        }`
                      : "No upcoming plan"}
                  </span>
                  <span className="block">
                    {type.upcomingCount === 1 ? "1 upcoming plan" : `${type.upcomingCount} upcoming plans`}
                  </span>
                  <span className="block">
                    {type.defaultTemplateName ? `Template: ${type.defaultTemplateName}` : "No default template"}
                  </span>
                </span>
              </Link>
            </li>
          ))}
          <li>
            <NewServiceTypeCard variant="card" />
          </li>
        </ul>
      )}
    </div>
  );
}
