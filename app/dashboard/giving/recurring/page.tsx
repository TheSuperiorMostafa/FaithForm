import { redirect } from "next/navigation";
import { Repeat } from "lucide-react";

import { GivingNotReady, GivingSubpageHeader, plural } from "@/components/giving/giving-page-parts";
import { RecurringRow } from "@/components/giving/recurring-row";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { List } from "@/components/ui/list-row";
import { SectionHeader } from "@/components/ui/page-header";
import { getChurchAuth } from "@/lib/auth/church";
import { recurringState } from "@/lib/giving/labels";
import { getChurchGivingProfile, getGivingSubscriptions } from "@/lib/queries/giving";

export const dynamic = "force-dynamic";

export default async function RecurringGivingPage() {
  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  const profile = await getChurchGivingProfile(auth.churchId);
  if (!profile?.stripeChargesEnabled) {
    return (
      <div className="flex w-full flex-col gap-8">
        <GivingSubpageHeader page="recurring" />
        <GivingNotReady isAdmin={auth.isAdmin} />
      </div>
    );
  }

  let subscriptions;
  try {
    subscriptions = await getGivingSubscriptions(auth.churchId);
  } catch (error) {
    console.error("[giving] recurring failed to load", error);
    subscriptions = null;
  }

  if (!subscriptions) {
    return (
      <div className="flex w-full flex-col gap-8">
        <GivingSubpageHeader page="recurring" />
        <ErrorState
          title="Recurring gifts didn't load"
          description="Nothing was changed. Refresh the page to try again, and if it keeps happening, contact FaithForm support."
        />
      </div>
    );
  }

  const failed = subscriptions.filter((s) => recurringState(s.status, s.pausedAt) === "failed");
  const others = subscriptions.filter((s) => recurringState(s.status, s.pausedAt) !== "failed");
  const active = others.filter((s) => recurringState(s.status, s.pausedAt) !== "cancelled");
  const cancelled = others.filter((s) => recurringState(s.status, s.pausedAt) === "cancelled");

  return (
    <div className="flex w-full flex-col gap-8">
      <GivingSubpageHeader page="recurring" />

      {subscriptions.length === 0 ? (
        <EmptyState
          icon={Repeat}
          title="No recurring gifts yet"
          description="When someone chooses to give every week or every month on your giving page, it shows up here."
        />
      ) : (
        <>
          {failed.length > 0 && (
            <section aria-labelledby="failed-recurring" className="flex flex-col gap-4">
              <SectionHeader
                id="failed-recurring"
                title="Payment failed"
                description={`${plural(failed.length, "gift")} didn't go through. The donor may need to update their card in their giving account.`}
              />
              <List label="Recurring gifts whose payment failed" className="border-orange-200 dark:border-orange-500/30">
                {failed.map((s) => (
                  <RecurringRow key={s.id} subscription={s} canManage={auth.isAdmin} />
                ))}
              </List>
            </section>
          )}

          <section aria-labelledby="active-recurring" className="flex flex-col gap-4">
            <SectionHeader
              id="active-recurring"
              title="Active and paused"
              description={plural(active.length, "recurring gift")}
            />
            {active.length === 0 ? (
              <EmptyState
                compact
                icon={Repeat}
                title="None right now"
                description="Recurring gifts that are running or paused show up here."
              />
            ) : (
              <List label="Active and paused recurring gifts">
                {active.map((s) => (
                  <RecurringRow key={s.id} subscription={s} canManage={auth.isAdmin} />
                ))}
              </List>
            )}
          </section>

          {cancelled.length > 0 && (
            <section aria-labelledby="cancelled-recurring" className="flex flex-col gap-4">
              <SectionHeader
                id="cancelled-recurring"
                title="Cancelled"
                description={plural(cancelled.length, "recurring gift")}
              />
              <List label="Cancelled recurring gifts">
                {cancelled.map((s) => (
                  <RecurringRow key={s.id} subscription={s} canManage={false} />
                ))}
              </List>
            </section>
          )}
        </>
      )}
    </div>
  );
}
