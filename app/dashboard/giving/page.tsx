import { redirect } from "next/navigation";
import { Suspense } from "react";
import { HandHeart } from "lucide-react";

import { loadFaithFormGiving } from "@/app/dashboard/giving/faithform-actions";
import { GIVING_COPY } from "@/components/giving/giving-page-parts";
import { GivingOverview } from "@/components/giving/giving-overview";
import { GivingSetup, type SetupFund } from "@/components/giving/giving-setup";
import { GivingOverviewSkeleton, GivingSetupSkeleton } from "@/components/giving/skeletons";
import { StripeReturn } from "@/components/giving/stripe-return";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { PageHeader } from "@/components/ui/page-header";
import { getChurchAuth } from "@/lib/auth/church";
import { feeExplanation } from "@/lib/giving/fee-copy";
import { ensureDefaultFunds } from "@/lib/giving/funds";
import { resolveSetupStep, type SetupStep } from "@/lib/giving/setup";
import { getChurchAddressLine, getChurchGivingProfile } from "@/lib/queries/giving";
import { applicationFeeAmount } from "@/lib/stripe/config";
import type { ChurchGivingProfile } from "@/types/giving";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function GivingPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  // Back from the payment partner's onboarding (lib/stripe/connect.ts).
  if (first(query.stripe_return) || first(query.stripe_refresh)) {
    return (
      <StripeReturn mode={first(query.stripe_return) ? "return" : "refresh"} isAdmin={auth.isAdmin} />
    );
  }

  const profile = await getChurchGivingProfile(auth.churchId);
  if (!profile) {
    return (
      <div className="flex w-full flex-col gap-8">
        <PageHeader title={GIVING_COPY.overview.title} description={GIVING_COPY.overview.description} />
        <ErrorState
          title="Giving didn't load"
          description="No gifts were lost. Refresh the page to try again, and if it keeps happening, contact FaithForm support."
        />
      </div>
    );
  }

  const step = resolveSetupStep({
    requested: first(query.step),
    chargesEnabled: profile.stripeChargesEnabled,
    hasEin: Boolean(profile.ein),
    hasAccount: Boolean(profile.stripeAccountId),
  });

  if (step && !(profile.stripeChargesEnabled && !auth.isAdmin)) {
    return (
      <div className="flex w-full flex-col gap-8">
        <PageHeader title={GIVING_COPY.setup.title} description={GIVING_COPY.setup.description} />
        {auth.isAdmin ? (
          <Suspense key={step} fallback={<GivingSetupSkeleton step={step} />}>
            <SetupSection churchId={auth.churchId} profile={profile} step={step} />
          </Suspense>
        ) : (
          <EmptyState
            icon={HandHeart}
            title="Giving isn't set up yet"
            description="A church admin can connect your church's bank here. Once that's done, you'll see every gift on this page."
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-8">
      <PageHeader title={GIVING_COPY.overview.title} description={GIVING_COPY.overview.description} />
      <Suspense fallback={<GivingOverviewSkeleton headerless />}>
        <GivingOverview
          churchId={auth.churchId}
          isAdmin={auth.isAdmin}
          givePageUrl={profile.givePageUrl}
        />
      </Suspense>
    </div>
  );
}

async function SetupSection({
  churchId,
  profile,
  step,
}: {
  churchId: string;
  profile: ChurchGivingProfile;
  step: SetupStep;
}) {
  let funds: SetupFund[] = [];
  let appBlockedReason: string | null = null;
  let addressLine = profile.statementAddress ?? "";

  if (step === "details" && !addressLine) {
    addressLine = await getChurchAddressLine(churchId);
  }
  if (step === "funds") {
    await ensureDefaultFunds(churchId);
    const state = await loadFaithFormGiving();
    if (!state) {
      return (
        <ErrorState
          compact
          title="Your funds didn't load"
          description="Nothing was lost. Refresh the page to try again."
        />
      );
    }
    funds = state.funds
      .filter((f) => f.isActive)
      .map((f) => ({
        fundId: f.fundId,
        name: f.name,
        isDefault: f.isDefault,
        inApp: f.visibility !== "none",
      }));
    if (!state.readiness.canAcceptPayments) {
      appBlockedReason = state.readiness.givingFeatureEnabled
        ? "Your bank connection isn't finished, so funds can't be shown in the app yet."
        : "Giving in the app is switched off for your church. Your giving page still works.";
    }
  }

  return (
    <GivingSetup
      step={step}
      churchName={profile.churchName}
      ein={profile.ein ?? null}
      statementAddress={addressLine}
      connection={{
        hasAccount: Boolean(profile.stripeAccountId),
        status: profile.stripeOnboardingStatus,
        chargesEnabled: profile.stripeChargesEnabled,
        payoutsEnabled: profile.stripePayoutsEnabled,
        requirementsDue: profile.stripeRequirementsDue,
      }}
      funds={funds}
      appBlockedReason={appBlockedReason}
      givePageUrl={profile.givePageUrl}
      feeSummary={feeExplanation(applicationFeeAmount()).summary}
    />
  );
}
