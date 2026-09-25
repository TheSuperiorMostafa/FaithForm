import { notFound, redirect } from "next/navigation";
import { HandCoins } from "lucide-react";

import { DonorStatementDownload } from "@/components/giving/donor-statement-download";
import { GiftRow } from "@/components/giving/giving-overview";
import { GivingNotReady, GivingSubpageHeader, plural } from "@/components/giving/giving-page-parts";
import { RecurringRow } from "@/components/giving/recurring-row";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { List } from "@/components/ui/list-row";
import { SectionHeader } from "@/components/ui/page-header";
import { getChurchAuth } from "@/lib/auth/church";
import { donorDisplayName } from "@/lib/giving/labels";
import { startOfYear } from "@/lib/giving/periods";
import { defaultStatementYear, statementYearOptions } from "@/lib/giving/statement-year";
import {
  getChurchGivingProfile,
  getDonorById,
  getDonorGifts,
  getDonorSubscriptions,
} from "@/lib/queries/giving";
import { formatCents } from "@/lib/utils/currency";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BACK = { href: "/dashboard/giving/donors", label: "Donors" };

export default async function DonorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await getChurchAuth();
  if (!auth) redirect("/login");
  if (!UUID_RE.test(id)) notFound();

  const profile = await getChurchGivingProfile(auth.churchId);
  if (!profile?.stripeChargesEnabled) {
    return (
      <div className="flex w-full flex-col gap-8">
        <GivingSubpageHeader page="donor" back={BACK} />
        <GivingNotReady isAdmin={auth.isAdmin} />
      </div>
    );
  }

  let data;
  try {
    // Every read is scoped to the caller's church: another church's donor
    // id finds nothing and becomes a 404.
    const donor = await getDonorById(auth.churchId, id);
    if (!donor) notFound();
    const [gifts, subscriptions] = await Promise.all([
      getDonorGifts(auth.churchId, id),
      getDonorSubscriptions(auth.churchId, id),
    ]);
    data = { donor, gifts, subscriptions };
  } catch (error) {
    // notFound() throws a control-flow error that must keep propagating.
    if (error && typeof error === "object" && "digest" in error) throw error;
    console.error("[giving] donor failed to load", error);
    return (
      <div className="flex w-full flex-col gap-8">
        <GivingSubpageHeader page="donor" back={BACK} />
        <ErrorState
          title="This donor didn't load"
          description="Nothing was lost. Refresh the page to try again, and if it keeps happening, contact FaithForm support."
        />
      </div>
    );
  }

  const { donor, gifts, subscriptions } = data;
  const name = donorDisplayName(donor);
  const received = gifts.filter((g) => g.status === "succeeded");
  const yearStart = startOfYear().toISOString();
  const thisYearCents = received
    .filter((g) => g.createdAt >= yearStart)
    .reduce((sum, g) => sum + g.amountCents, 0);
  const allTimeCents = received.reduce((sum, g) => sum + g.amountCents, 0);

  return (
    <div className="flex w-full flex-col gap-8">
      <GivingSubpageHeader
        page="donor"
        back={BACK}
        title={name}
        description={donor.name ? donor.email : GIVING_DONOR_NO_NAME}
        action={
          <DonorStatementDownload
            donorId={donor.id}
            years={statementYearOptions()}
            defaultYear={defaultStatementYear()}
          />
        }
      />

      <section aria-label={`${name}'s giving`} className="grid gap-4 sm:grid-cols-3">
        <Stat label="This year" value={formatCents(thisYearCents)} />
        <Stat label="All time" value={formatCents(allTimeCents)} />
        <Stat label="Gifts received" value={received.length.toLocaleString("en-US")} />
      </section>

      {subscriptions.length > 0 && (
        <section aria-labelledby="donor-recurring" className="flex flex-col gap-4">
          <SectionHeader
            id="donor-recurring"
            title="Recurring gifts"
            description={plural(subscriptions.length, "recurring gift")}
          />
          <List label={`${name}'s recurring gifts`}>
            {subscriptions.map((s) => (
              <RecurringRow
                key={s.id}
                subscription={s}
                showDonor={false}
                canManage={auth.isAdmin}
              />
            ))}
          </List>
        </section>
      )}

      <section aria-labelledby="donor-gifts" className="flex flex-col gap-4">
        <SectionHeader id="donor-gifts" title="Gifts" description={plural(gifts.length, "gift")} />
        {gifts.length === 0 ? (
          <EmptyState
            compact
            icon={HandCoins}
            title="No gifts yet"
            description="Their gifts will show up here."
          />
        ) : (
          <List label={`${name}'s gifts`}>
            {gifts.map((gift) => (
              <GiftRow key={gift.id} gift={gift} linkDonor={false} />
            ))}
          </List>
        )}
      </section>
    </div>
  );
}

const GIVING_DONOR_NO_NAME = "No name given";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="flex flex-col gap-2 p-6">
      <h2 className="text-[15px] font-semibold text-muted-foreground">{label}</h2>
      <p className="font-heading text-3xl font-bold leading-none tracking-tight text-foreground">
        {value}
      </p>
    </Card>
  );
}
