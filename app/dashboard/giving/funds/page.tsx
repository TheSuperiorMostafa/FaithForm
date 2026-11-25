import { redirect } from "next/navigation";
import { Lock } from "lucide-react";

import { GivingNotReady, GivingSubpageHeader } from "@/components/giving/giving-page-parts";
import { AddFundButton, FundsBanksView, type StripeReturnParams } from "@/components/giving/funds-banks-view";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { getChurchAuth } from "@/lib/auth/church";
import { pageFeatureBlocked } from "@/lib/features/page-gate";
import { getFundsAndBanks, type FundsAndBanks } from "@/lib/queries/fund-accounts";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function single(value: string | string[] | undefined): string | null {
  return typeof value === "string" ? value : null;
}

/** Funds & banks: which bank each fund's gifts go to. Admins only. */
export default async function FundsAndBanksPage({ searchParams }: PageProps) {
  if (await pageFeatureBlocked("giving")) return null;

  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  if (!auth.isAdmin) {
    return (
      <div className="flex w-full flex-col gap-8">
        <GivingSubpageHeader page="funds" />
        <EmptyState
          icon={Lock}
          title="Only church admins can see funds and banks"
          description="If a fund's gifts need to go to a different bank, ask an admin on your team."
        />
      </div>
    );
  }

  // getFundsAndBanks reads with the service role; the admin check above is what scopes it.
  let data: FundsAndBanks | null = null;
  try {
    data = await getFundsAndBanks(auth.churchId);
  } catch (error) {
    console.error("[giving] funds and banks failed to load", error);
  }

  if (!data) {
    return (
      <div className="flex w-full flex-col gap-8">
        <GivingSubpageHeader page="funds" />
        <ErrorState
          title="Funds and banks didn't load"
          description="Nothing was changed and your gifts are safe. Refresh the page to try again."
          refreshOnRetry
        />
      </div>
    );
  }

  if (!data.mainConnected) {
    return (
      <div className="flex w-full flex-col gap-8">
        <GivingSubpageHeader page="funds" />
        <GivingNotReady isAdmin />
      </div>
    );
  }

  if (!data.schemaReady) {
    return (
      <div className="flex w-full flex-col gap-8">
        <GivingSubpageHeader page="funds" />
        <ErrorState
          title="Funds and banks needs a database update"
          description="Every fund still sends its gifts to your main bank account. Ask FaithForm support to finish the update, then this page will let you choose a bank for each fund."
        />
      </div>
    );
  }

  const query = await searchParams;
  const accountParam = single(query.account);
  const stripeReturn: StripeReturnParams =
    accountParam && single(query.stripe_return) === "1"
      ? { accountRowId: accountParam, mode: "return" }
      : accountParam && single(query.stripe_refresh) === "1"
        ? { accountRowId: accountParam, mode: "refresh" }
        : null;

  return (
    <div className="flex w-full flex-col gap-8">
      <GivingSubpageHeader page="funds" action={<AddFundButton accounts={data.accounts} />} />
      <FundsBanksView accounts={data.accounts} funds={data.funds} stripeReturn={stripeReturn} />
    </div>
  );
}
