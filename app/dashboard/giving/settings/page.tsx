import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Lock, Palette } from "lucide-react";

import { getGivingFundsForSettings } from "@/app/dashboard/settings/giving-actions";
import { BankConnection } from "@/components/giving/bank-connection";
import { FaithFormGivingPanel } from "@/components/giving/faithform-giving-panel";
import { FundsSettings } from "@/components/giving/funds-settings";
import { GivingSubpageHeader } from "@/components/giving/giving-page-parts";
import { StatementSettings } from "@/components/giving/statement-settings";
import { WebAddressSettings } from "@/components/giving/web-address-settings";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { getChurchAuth } from "@/lib/auth/church";
import { feeExplanation } from "@/lib/giving/fee-copy";
import { getChurchAddressLine, getChurchGivingProfile } from "@/lib/queries/giving";
import { applicationFeeAmount } from "@/lib/stripe/config";

export const dynamic = "force-dynamic";

/**
 * Everything a church sets once for giving, in one place on the Giving page
 * (it used to live in Settings): bank connection, funds, the app, statement
 * details, the giving page address, and where its look comes from.
 */
export default async function GivingSettingsPage() {
  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  if (!auth.isAdmin) {
    return (
      <div className="flex w-full flex-col gap-8">
        <GivingSubpageHeader page="settings" />
        <EmptyState
          icon={Lock}
          title="Only church admins can change giving settings"
          description="If a fund or statement detail needs changing, ask an admin on your team."
        />
      </div>
    );
  }

  let data;
  try {
    const [profile, funds, suggestedAddress] = await Promise.all([
      getChurchGivingProfile(auth.churchId),
      getGivingFundsForSettings(auth.churchId),
      getChurchAddressLine(auth.churchId),
    ]);
    data = profile ? { profile, funds, suggestedAddress } : null;
  } catch (error) {
    console.error("[giving] settings failed to load", error);
    data = null;
  }

  if (!data) {
    return (
      <div className="flex w-full flex-col gap-8">
        <GivingSubpageHeader page="settings" />
        <ErrorState
          title="Giving settings didn't load"
          description="Nothing was changed. Refresh the page to try again, and if it keeps happening, contact FaithForm support."
        />
      </div>
    );
  }

  const { profile, funds, suggestedAddress } = data;
  const fees = feeExplanation(applicationFeeAmount());

  return (
    <div className="flex w-full flex-col gap-8">
      <GivingSubpageHeader page="settings" />

      <Card className="flex flex-col gap-6 p-6">
        <BankConnection
          returnTo="settings"
          state={{
            hasAccount: Boolean(profile.stripeAccountId),
            status: profile.stripeOnboardingStatus,
            chargesEnabled: profile.stripeChargesEnabled,
            payoutsEnabled: profile.stripePayoutsEnabled,
            requirementsDue: profile.stripeRequirementsDue,
          }}
        />
        <div className="space-y-2 border-t border-border pt-5">
          <h3 className="text-base font-semibold text-foreground">Fees</h3>
          <p className="text-[15px] leading-relaxed text-muted-foreground">{fees.summary}</p>
          <ul className="list-disc space-y-1 pl-5 text-[15px] leading-relaxed text-muted-foreground">
            {fees.details.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      </Card>

      <FundsSettings funds={funds} />

      <FaithFormGivingPanel isAdmin={auth.isAdmin} />

      <StatementSettings
        ein={profile.ein ?? null}
        statementAddress={profile.statementAddress ?? null}
        suggestedAddress={suggestedAddress}
      />

      <WebAddressSettings slug={profile.slug} givePageUrl={profile.givePageUrl} />

      <Card className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-4">
          <span
            aria-hidden
            className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary/[0.07] text-primary dark:bg-accent/15 dark:text-accent"
          >
            <Palette className="size-6" strokeWidth={1.75} />
          </span>
          <div className="space-y-1.5">
            <h2 className="font-heading text-xl font-bold text-foreground">Logo and colors</h2>
            <p className="text-[15px] leading-relaxed text-muted-foreground">
              Your giving page and receipts use your church&apos;s logo and colors, the same ones
              as the app.
            </p>
          </div>
        </div>
        <Link href="/dashboard/settings?tab=church" className={buttonVariants({ variant: "outline" })}>
          Change logo and colors
          <ArrowRight aria-hidden />
        </Link>
      </Card>
    </div>
  );
}
