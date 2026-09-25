import { redirect } from "next/navigation";
import { Landmark } from "lucide-react";

import { formatGiftDate, GivingNotReady, GivingSubpageHeader } from "@/components/giving/giving-page-parts";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { List, ListRow } from "@/components/ui/list-row";
import { StatusBadge } from "@/components/ui/status-badge";
import { getChurchAuth } from "@/lib/auth/church";
import { depositStatus } from "@/lib/giving/labels";
import { getChurchGivingProfile } from "@/lib/queries/giving";
import { isStripeConfigured } from "@/lib/stripe/client";
import { listConnectedPayouts } from "@/lib/stripe/giving";
import { formatCents } from "@/lib/utils/currency";

export const dynamic = "force-dynamic";

/** "Deposits": the payment partner's payouts to the church's bank account. */
export default async function DepositsPage() {
  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  const profile = await getChurchGivingProfile(auth.churchId);
  if (!profile?.stripeChargesEnabled || !profile.stripeAccountId) {
    return (
      <div className="flex w-full flex-col gap-8">
        <GivingSubpageHeader page="deposits" />
        <GivingNotReady isAdmin={auth.isAdmin} />
      </div>
    );
  }

  let payouts: Awaited<ReturnType<typeof listConnectedPayouts>> | null = null;
  if (isStripeConfigured()) {
    try {
      payouts = await listConnectedPayouts(profile.stripeAccountId);
    } catch (e) {
      console.error("payouts list", e);
    }
  }

  return (
    <div className="flex w-full flex-col gap-8">
      <GivingSubpageHeader page="deposits" />

      {payouts === null ? (
        // A failed load is not "no deposits yet".
        <ErrorState
          title="Deposits didn't load"
          description="Your money is safe. We couldn't reach our payment partner just now. Refresh the page in a minute to try again."
        />
      ) : payouts.length === 0 ? (
        <EmptyState
          icon={Landmark}
          title="No deposits yet"
          description="Gifts are sent to your church's bank account in regular deposits. The first one usually arrives a few days after your first gift."
        />
      ) : (
        <List label="Deposits to your bank">
          {payouts.map((p) => {
            const status = depositStatus(p.status);
            const arrival = p.arrival_date ? formatGiftDate(new Date(p.arrival_date * 1000).toISOString()) : null;
            const when =
              arrival === null
                ? "Date not set yet"
                : p.status === "paid"
                  ? `Arrived ${arrival}`
                  : p.status === "failed" || p.status === "canceled"
                    ? `Was due ${arrival}`
                    : `Expected ${arrival}`;
            return (
              <ListRow
                key={p.id}
                leading={
                  <span
                    aria-hidden
                    className="flex size-12 items-center justify-center rounded-full bg-primary/[0.08] text-primary dark:bg-accent/15 dark:text-accent"
                  >
                    <Landmark className="size-6" strokeWidth={1.75} />
                  </span>
                }
                title={formatCents(p.amount, p.currency)}
                subtitle={
                  p.status === "failed"
                    ? `${when}. Check your bank details in Giving settings.`
                    : when
                }
                trailing={<StatusBadge tone={status.tone}>{status.label}</StatusBadge>}
              />
            );
          })}
        </List>
      )}
    </div>
  );
}
