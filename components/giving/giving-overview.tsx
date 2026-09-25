import Link from "next/link";
import {
  AlertTriangle,
  FileText,
  HandCoins,
  Landmark,
  Receipt,
  Repeat,
  Settings,
  Users,
} from "lucide-react";

import { GivingLinkCard } from "@/components/giving/giving-link-card";
import { formatGiftDate, plural } from "@/components/giving/giving-page-parts";
import { ActionCard, ActionGrid } from "@/components/ui/action-card";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { InitialsAvatar, List, ListRow } from "@/components/ui/list-row";
import { SectionHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { donorDisplayName, giftStatus, giftTypeLabel } from "@/lib/giving/labels";
import { defaultStatementYear } from "@/lib/giving/statement-year";
import { getGivingByFundPeriods, getGivingSummary } from "@/lib/queries/giving";
import { formatCents } from "@/lib/utils/currency";
import { cn } from "@/lib/utils";
import type { FundGivingBreakdown, GivingDonationRow } from "@/types/giving";

/**
 * The Giving overview for a church that can take gifts. Leads with what came
 * in ("This week: $4,210 from 38 gifts"), then the latest gifts, then big
 * tiles to everything else.
 */
export async function GivingOverview({
  churchId,
  isAdmin,
  givePageUrl,
}: {
  churchId: string;
  isAdmin: boolean;
  givePageUrl: string;
}) {
  let data;
  try {
    const [summary, funds] = await Promise.all([
      getGivingSummary(churchId),
      getGivingByFundPeriods(churchId),
    ]);
    data = { summary, funds };
  } catch (error) {
    console.error("[giving] overview failed to load", error);
    return (
      <ErrorState
        title="Your giving totals didn't load"
        description="No gifts were lost. Refresh the page to try again, and if it keeps happening, contact FaithForm support."
      />
    );
  }
  const { summary, funds } = data;
  const now = new Date();
  const statementYear = defaultStatementYear(now);
  const statementSeason = statementYear < now.getFullYear();

  return (
    <>
      {summary.failedSubscriptionCount > 0 && (
        <div
          role="status"
          className="flex flex-col gap-4 rounded-2xl border border-orange-200 bg-orange-50 p-5 text-orange-950 sm:flex-row sm:items-center sm:justify-between dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-100"
        >
          <p className="flex items-start gap-3 text-base">
            <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
            <span>
              <strong>{plural(summary.failedSubscriptionCount, "recurring gift")}</strong>{" "}
              didn&apos;t go through. The donor may need to update their card.
            </span>
          </p>
          <Link
            href="/dashboard/giving/recurring"
            className={buttonVariants({ variant: "outline" })}
          >
            See recurring gifts
          </Link>
        </div>
      )}

      {statementSeason && (
        <div className="flex flex-col gap-4 rounded-2xl border border-accent/40 bg-accent/10 p-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-3 text-base text-foreground">
            <FileText className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
            <span>
              <strong>{statementYear} giving statements are ready to send.</strong> Donors need
              them for their tax records.
            </span>
          </p>
          <Link
            href={`/dashboard/giving/statements?year=${statementYear}`}
            className={buttonVariants()}
          >
            Send {statementYear} statements
          </Link>
        </div>
      )}

      <section aria-label="Giving totals" className="grid gap-4 sm:grid-cols-3">
        <TotalCard
          highlight
          label="This week"
          cents={summary.weekCents}
          gifts={summary.weekGifts}
        />
        <TotalCard label="This month" cents={summary.monthCents} gifts={summary.monthGifts} />
        <TotalCard label="This year" cents={summary.yearCents} gifts={summary.yearGifts} />
      </section>

      <section aria-labelledby="recent-gifts" className="flex flex-col gap-4">
        <SectionHeader
          id="recent-gifts"
          title="Recent gifts"
          action={
            <Link
              href="/dashboard/giving/gifts"
              className={buttonVariants({ variant: "ghost" })}
            >
              See all gifts
            </Link>
          }
        />
        <RecentGifts gifts={summary.recentDonations} />
      </section>

      <section aria-label="More in Giving">
        <ActionGrid>
          <ActionCard
            href="/dashboard/giving/gifts"
            icon={Receipt}
            title="All gifts"
            description="Search every gift and download a spreadsheet."
          />
          <ActionCard
            href="/dashboard/giving/donors"
            icon={Users}
            title="Donors"
            description="Who gave, and what they gave this year."
          />
          <ActionCard
            href="/dashboard/giving/recurring"
            icon={Repeat}
            title="Recurring gifts"
            description="Gifts that repeat on their own."
            badge={
              summary.failedSubscriptionCount > 0 ? (
                <StatusBadge tone="attention">
                  {summary.failedSubscriptionCount} failed
                </StatusBadge>
              ) : undefined
            }
          />
          <ActionCard
            href="/dashboard/giving/payouts"
            icon={Landmark}
            title="Deposits"
            description="Money on its way to your church's bank."
          />
          <ActionCard
            href="/dashboard/giving/statements"
            icon={FileText}
            title="Year-end statements"
            description="Email or print each donor's yearly record."
          />
          {isAdmin && (
            <ActionCard
              href="/dashboard/giving/settings"
              icon={Settings}
              title="Giving settings"
              description="Funds, statement details, giving page and the app."
            />
          )}
        </ActionGrid>
      </section>

      <GivingLinkCard givePageUrl={givePageUrl} />

      <FundTotals month={funds.month} year={funds.ytd} />
    </>
  );
}

function TotalCard({
  label,
  cents,
  gifts,
  highlight = false,
}: {
  label: string;
  cents: number;
  gifts: number;
  highlight?: boolean;
}) {
  return (
    <Card
      className={cn(
        "flex flex-col gap-2 p-6",
        highlight &&
          "border-transparent bg-primary text-primary-foreground dark:border-accent/40 dark:bg-accent/15 dark:text-foreground",
      )}
    >
      <h2
        className={cn(
          "text-[15px] font-semibold",
          highlight ? "text-primary-foreground/85 dark:text-muted-foreground" : "text-muted-foreground",
        )}
      >
        {label}
      </h2>
      <p className="font-heading text-4xl font-bold leading-none tracking-tight">
        {formatCents(cents)}
      </p>
      <p
        className={cn(
          "text-[15px]",
          highlight ? "text-primary-foreground/85 dark:text-muted-foreground" : "text-muted-foreground",
        )}
      >
        from {plural(gifts, "gift")}
      </p>
    </Card>
  );
}

export function GiftRow({
  gift,
  linkDonor = true,
}: {
  gift: GivingDonationRow;
  /** False on a donor's own page, where the row leads with the amount. */
  linkDonor?: boolean;
}) {
  const name = donorDisplayName(gift);
  const status = giftStatus(gift.status);
  const fund = gift.fundName ?? gift.fundDesignation ?? "General";
  const amount = formatCents(gift.amountCents, gift.currency);
  const badge =
    gift.status === "succeeded" ? undefined : (
      <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
    );

  if (!linkDonor) {
    return (
      <ListRow
        leading={
          <span
            aria-hidden
            className="flex size-12 items-center justify-center rounded-full bg-primary/[0.08] text-primary dark:bg-accent/15 dark:text-accent"
          >
            <HandCoins className="size-6" strokeWidth={1.75} />
          </span>
        }
        title={amount}
        subtitle={`${fund} · ${formatGiftDate(gift.createdAt)} · ${giftTypeLabel(gift.giftType)}`}
        trailing={badge}
      />
    );
  }

  return (
    <ListRow
      href={gift.donorId ? `/dashboard/giving/donors/${gift.donorId}` : undefined}
      leading={<InitialsAvatar name={name} />}
      title={name}
      subtitle={`${fund} · ${formatGiftDate(gift.createdAt)} · ${giftTypeLabel(gift.giftType)}`}
      trailing={
        <span className="flex flex-col items-end gap-1 text-right">
          <span className="font-heading text-lg font-bold text-foreground">{amount}</span>
          {badge}
        </span>
      }
    />
  );
}

function RecentGifts({ gifts }: { gifts: GivingDonationRow[] }) {
  if (gifts.length === 0) {
    return (
      <EmptyState
        compact
        icon={HandCoins}
        title="No gifts yet"
        description="When someone gives on your giving page or in the app, it shows up here."
      />
    );
  }
  return (
    <List label="Recent gifts">
      {gifts.map((gift) => (
        <GiftRow key={gift.id} gift={gift} />
      ))}
    </List>
  );
}

function FundTotals({
  month,
  year,
}: {
  month: FundGivingBreakdown[];
  year: FundGivingBreakdown[];
}) {
  if (year.length === 0) return null;
  const monthById = new Map(month.map((f) => [f.fundId, f]));
  return (
    <section aria-labelledby="by-fund" className="flex flex-col gap-4">
      <SectionHeader id="by-fund" title="By fund" description="Received gifts, sorted by this year's total." />
      <Card className="overflow-hidden p-0">
        <table className="w-full text-[15px]">
          <thead className="border-b border-border text-left text-muted-foreground">
            <tr>
              <th scope="col" className="px-6 py-4 font-semibold">Fund</th>
              <th scope="col" className="px-6 py-4 text-right font-semibold">This month</th>
              <th scope="col" className="px-6 py-4 text-right font-semibold">This year</th>
            </tr>
          </thead>
          <tbody>
            {year.map((fund) => (
              <tr key={fund.fundId} className="border-b border-border/60 last:border-0">
                <th scope="row" className="px-6 py-4 text-left font-semibold text-foreground">
                  {fund.fundName}
                </th>
                <td className="px-6 py-4 text-right text-muted-foreground">
                  {formatCents(monthById.get(fund.fundId)?.totalCents ?? 0)}
                </td>
                <td className="px-6 py-4 text-right font-semibold text-foreground">
                  {formatCents(fund.totalCents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </section>
  );
}
