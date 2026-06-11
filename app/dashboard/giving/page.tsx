import Link from "next/link";
import { redirect } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { DonationsTable } from "@/components/giving/donations-table";
import { FundBreakdown } from "@/components/giving/fund-breakdown";
import { GivingSetupCta } from "@/components/giving/giving-setup-cta";
import { QrCodeCard } from "@/components/giving/qr-code-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getChurchAuth } from "@/lib/auth/church";
import {
  getChurchGivingProfile,
  getGivingByFund,
  getGivingSummary,
} from "@/lib/queries/giving";
import { formatCents } from "@/lib/utils/currency";

export const dynamic = "force-dynamic";

export default async function GivingPage() {
  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  const profile = await getChurchGivingProfile(auth.churchId);
  if (!profile) {
    return (
      <div className="mx-auto max-w-md py-16 text-center text-sm text-muted-foreground">
        <p>Unable to load your church giving profile.</p>
        <p className="mt-2">
          If this continues, contact support or check that your account is linked to a
          church in Settings.
        </p>
      </div>
    );
  }

  if (!profile.stripeChargesEnabled) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <GivingPageHeader showSettingsLink={auth.isAdmin} />
        <GivingSetupCta />
      </div>
    );
  }

  const summary = await getGivingSummary(auth.churchId);
  const fundMonth = await getGivingByFund(auth.churchId, "month");
  const fundYtd = await getGivingByFund(auth.churchId, "ytd");

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <GivingPageHeader showSettingsLink={auth.isAdmin} />

      {summary.failedSubscriptionCount > 0 && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm">
          <strong>{summary.failedSubscriptionCount}</strong> recurring{" "}
          {summary.failedSubscriptionCount === 1 ? "donor needs" : "donors need"}{" "}
          attention —{" "}
          <Link
            href="/dashboard/giving/recurring"
            className="font-medium text-accent underline"
          >
            View failed payments
          </Link>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Today"
          value={summary.todayCents}
          givers={summary.todayGivers}
        />
        <StatCard
          label="This month"
          value={summary.monthCents}
          givers={summary.monthGivers}
        />
        <StatCard
          label="Year to date"
          value={summary.yearCents}
          givers={summary.yearGivers}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">By fund — this month</CardTitle>
          </CardHeader>
          <CardContent>
            <FundBreakdown title="" funds={fundMonth} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">By fund — YTD</CardTitle>
          </CardHeader>
          <CardContent>
            <FundBreakdown title="" funds={fundYtd} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">Your giving page</p>
            <p className="text-sm text-muted-foreground break-all">{profile.givePageUrl}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              href={profile.givePageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-8 items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 text-sm font-medium hover:bg-muted"
            >
              <ExternalLink className="h-4 w-4" />
              Open page
            </a>
          </div>
        </CardContent>
      </Card>

      <QrCodeCard givePageUrl={profile.givePageUrl} />

      <div className="flex flex-wrap gap-2 text-sm">
        <Link
          href="/dashboard/giving/gifts"
          className="rounded-lg border border-border px-3 py-2 font-medium hover:border-accent"
        >
          All gifts
        </Link>
        <Link
          href="/dashboard/giving/donors"
          className="rounded-lg border border-border px-3 py-2 font-medium hover:border-accent"
        >
          Donors
        </Link>
        <Link
          href="/dashboard/giving/recurring"
          className="rounded-lg border border-border px-3 py-2 font-medium hover:border-accent"
        >
          Recurring gifts
        </Link>
        <Link
          href="/dashboard/giving/payouts"
          className="rounded-lg border border-border px-3 py-2 font-medium hover:border-accent"
        >
          Payouts
        </Link>
        <Link
          href="/dashboard/giving/statements"
          className="rounded-lg border border-border px-3 py-2 font-medium hover:border-accent"
        >
          Statements
        </Link>
      </div>

      <Card className="overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Recent gifts</CardTitle>
          <Link
            href="/dashboard/giving/gifts"
            className="text-sm text-accent hover:underline"
          >
            View all
          </Link>
        </CardHeader>
        <CardContent className="p-0">
          <DonationsTable donations={summary.recentDonations} showFund />
        </CardContent>
      </Card>
    </div>
  );
}

function GivingPageHeader({ showSettingsLink = false }: { showSettingsLink?: boolean }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 className="border-l-4 border-accent pl-3 font-heading text-[26px] font-bold">
          Giving
        </h1>
        <p className="text-sm text-muted-foreground">
          Track gifts, donors, recurring donations, and payouts to your church account.
        </p>
      </div>
      {showSettingsLink && (
        <Link
          href="/dashboard/settings?tab=giving"
          className="shrink-0 text-sm font-medium text-accent hover:underline"
        >
          Giving settings
        </Link>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  givers,
}: {
  label: string;
  value: number;
  givers: number;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="mt-1 font-heading text-2xl font-bold">{formatCents(value)}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {givers} {givers === 1 ? "giver" : "givers"}
        </p>
      </CardContent>
    </Card>
  );
}
