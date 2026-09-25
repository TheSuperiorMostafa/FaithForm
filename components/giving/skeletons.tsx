import { ChevronDown, Download, FileText, Landmark, Mail, Palette, Plus, Receipt, Repeat, Search, Users } from "lucide-react";

import { GIVING_COPY, GivingSubpageHeader } from "@/components/giving/giving-page-parts";
import { SetupSteps } from "@/components/giving/giving-setup";
import { StatementYearPicker } from "@/components/giving/statement-year-picker";
import { ActionCard, ActionGrid } from "@/components/ui/action-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { List } from "@/components/ui/list-row";
import { PageHeader, SectionHeader } from "@/components/ui/page-header";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";
import { RANGE_PRESETS } from "@/lib/giving/periods";
import type { SetupStep } from "@/lib/giving/setup";
import { defaultStatementYear } from "@/lib/giving/statement-year";
import { cn } from "@/lib/utils";

/**
 * Loading states for every Giving page. Each mirrors its page: the same root,
 * header, grid and card padding. Words that never change are real text; only
 * amounts, names and dates shimmer.
 */

const NAME_WIDTHS = ["w-44", "w-36", "w-52", "w-40", "w-48", "w-32"];

/**
 * A shimmer that can sit inside a heading or paragraph (the shared
 * `Skeleton` is a <div>, which isn't allowed inside <p>).
 */
function InlineSkeleton({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-block overflow-hidden rounded-md bg-muted align-middle before:absolute before:inset-0 before:-translate-x-full before:animate-[shimmer_1.6s_infinite] before:bg-gradient-to-r before:from-transparent before:via-white/45 before:to-transparent motion-reduce:before:animate-none dark:before:via-white/10",
        className,
      )}
    />
  );
}

/** Mirrors `ListRow`: 72px, avatar, two lines, trailing value. */
function RowSkeleton({ i, trailing = "amount" }: { i: number; trailing?: "amount" | "badge" | "actions" | "none" }) {
  return (
    <li className="flex items-center gap-2 rounded-2xl">
      <div className="flex min-h-[72px] min-w-0 flex-1 items-center gap-4 px-4 py-3">
        <Skeleton className="size-12 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className={cn("h-5", NAME_WIDTHS[i % NAME_WIDTHS.length])} />
          <Skeleton className="h-4 w-56 max-w-full" />
        </div>
        {trailing === "amount" && <Skeleton className="h-6 w-20 shrink-0" />}
        {trailing === "badge" && <Skeleton className="h-8 w-24 shrink-0 rounded-full" />}
        {trailing === "actions" && (
          <div className="hidden shrink-0 gap-2 sm:flex">
            <Skeleton className="h-11 w-24 rounded-[10px]" />
            <Skeleton className="h-11 w-24 rounded-[10px]" />
          </div>
        )}
      </div>
    </li>
  );
}

function RowsSkeleton({
  count,
  trailing,
  label,
}: {
  count: number;
  trailing?: "amount" | "badge" | "actions" | "none";
  label?: string;
}) {
  return (
    <List label={label}>
      {Array.from({ length: count }).map((_, i) => (
        <RowSkeleton key={i} i={i} trailing={trailing} />
      ))}
    </List>
  );
}

/** Mirrors `SearchBox` on the donors and gifts pages. */
function SearchBoxSkeleton({ placeholder }: { placeholder: string }) {
  return (
    <div className="relative">
      <Search
        className="pointer-events-none absolute left-5 top-1/2 size-6 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <div className="flex min-h-14 w-full items-center rounded-2xl border-[1.5px] border-border bg-background pl-14 pr-5 text-lg text-muted-foreground shadow-sm">
        {placeholder}
      </div>
    </div>
  );
}

function StaticAdvanced({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card/50">
      <div className="flex min-h-12 w-full items-center justify-between gap-3 px-5 py-3">
        <span className="space-y-0.5">
          <span className="block text-[15px] font-semibold text-foreground">{title}</span>
          <span className="block text-sm text-muted-foreground">{description}</span>
        </span>
        <ChevronDown aria-hidden className="size-5 shrink-0 text-muted-foreground" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export function GivingOverviewSkeleton({ headerless = false }: { headerless?: boolean }) {
  const now = new Date();
  const statementYear = defaultStatementYear(now);
  const statementSeason = statementYear < now.getFullYear();

  return (
    <SkeletonContainer className="flex w-full flex-col gap-8" label="giving">
      {!headerless && (
        <PageHeader title={GIVING_COPY.overview.title} description={GIVING_COPY.overview.description} />
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
          <Button disabled>Send {statementYear} statements</Button>
        </div>
      )}

      <section aria-label="Giving totals" className="grid gap-4 sm:grid-cols-3">
        {["This week", "This month", "This year"].map((label, i) => (
          <Card
            key={label}
            className={cn(
              "flex flex-col gap-2 p-6",
              i === 0 &&
                "border-transparent bg-primary text-primary-foreground dark:border-accent/40 dark:bg-accent/15 dark:text-foreground",
            )}
          >
            <h2
              className={cn(
                "text-[15px] font-semibold",
                i === 0 ? "text-primary-foreground/85 dark:text-muted-foreground" : "text-muted-foreground",
              )}
            >
              {label}
            </h2>
            <Skeleton className={cn("h-9 w-36", i === 0 && "bg-white/15")} />
            <Skeleton className={cn("h-5 w-28", i === 0 && "bg-white/15")} />
          </Card>
        ))}
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeader
          title="Recent gifts"
          action={
            <Button variant="ghost" disabled>
              See all gifts
            </Button>
          }
        />
        <RowsSkeleton count={6} />
      </section>

      <section aria-label="More in Giving">
        <ActionGrid>
          <ActionCard href="/dashboard/giving/gifts" icon={Receipt} title="All gifts" description="Search every gift and download a spreadsheet." />
          <ActionCard href="/dashboard/giving/donors" icon={Users} title="Donors" description="Who gave, and what they gave this year." />
          <ActionCard href="/dashboard/giving/recurring" icon={Repeat} title="Recurring gifts" description="Gifts that repeat on their own." />
          <ActionCard href="/dashboard/giving/payouts" icon={Landmark} title="Deposits" description="Money on its way to your church's bank." />
          <ActionCard href="/dashboard/giving/statements" icon={FileText} title="Year-end statements" description="Email or print each donor's yearly record." />
          <Skeleton className="min-h-[152px] rounded-2xl" />
        </ActionGrid>
      </section>

      <GivingLinkCardSkeleton />
    </SkeletonContainer>
  );
}

function GivingLinkCardSkeleton({ title = "Your giving link" }: { title?: string }) {
  return (
    <Card className="flex flex-col gap-6 p-6 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="space-y-1.5">
          <h2 className="font-heading text-xl font-bold text-foreground">{title}</h2>
          <p className="text-[15px] leading-relaxed text-muted-foreground">
            Share it in emails, on your website and in the bulletin. The QR code opens the same page.
          </p>
        </div>
        <div className="rounded-xl border border-border bg-muted/40 px-4 py-3">
          <Skeleton className="h-6 w-72 max-w-full" />
        </div>
        <div className="flex flex-wrap gap-3">
          <Button disabled>Copy link</Button>
          <Button variant="outline" disabled>
            Open giving page
          </Button>
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-center gap-3">
        <div className="rounded-2xl border border-border bg-white p-2">
          <Skeleton className="size-40 rounded-lg" />
        </div>
        <Button variant="ghost" disabled>
          <Download aria-hidden />
          Download QR code
        </Button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const STEP_COPY: Record<SetupStep, { title: string; description: string }> = {
  details: {
    title: "Start accepting gifts",
    description:
      "First, the details that go on your donors' year-end statements. You can change them later.",
  },
  connect: {
    title: "Connect your bank",
    description:
      "Gifts go straight to your church's bank account. Our secure payment partner, Stripe, handles cards and bank details, so FaithForm never sees them. You'll leave this page for a few minutes, then come right back here.",
  },
  funds: {
    title: "Choose where people can give",
    description:
      "All your funds are on your giving page. Tick the ones to show in the FaithForm app too. They'll be open to everyone, with $25, $50 and $100 buttons you can change later.",
  },
  ready: { title: "You're ready to receive gifts", description: "" },
};

/** The setup step, shown under the page's own header while it loads. */
export function GivingSetupSkeleton({ step }: { step: SetupStep }) {
  const copy = STEP_COPY[step];
  return (
    <SkeletonContainer className="flex flex-col gap-6" label="giving setup">
      <SetupSteps current={step} />
      {step === "ready" ? (
        <>
          <Skeleton className="h-72 rounded-3xl" />
          <GivingLinkCardSkeleton title="Share your giving link" />
        </>
      ) : (
        <Card className="flex flex-col gap-6 p-6 sm:p-8">
          <div className="space-y-2">
            <h2 className="font-heading text-2xl font-bold text-foreground">{copy.title}</h2>
            <p className="max-w-2xl text-base leading-relaxed text-muted-foreground">{copy.description}</p>
          </div>
          <div className="flex max-w-xl flex-col gap-5">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className={step === "details" ? "h-[72px] rounded-xl" : "h-14 rounded-2xl"} />
            ))}
          </div>
          <div className="flex flex-wrap gap-3">
            <Skeleton className="h-12 w-56 rounded-[10px]" />
          </div>
        </Card>
      )}
    </SkeletonContainer>
  );
}

// ---------------------------------------------------------------------------
// Gifts
// ---------------------------------------------------------------------------

export function GiftsSkeleton() {
  return (
    <SkeletonContainer className="flex w-full flex-col gap-8" label="gifts">
      <GivingSubpageHeader
        page="gifts"
        secondary={
          <Button variant="outline" disabled>
            <Download aria-hidden />
            Download spreadsheet (CSV)
          </Button>
        }
      />

      <section className="flex flex-col gap-4">
        <SearchBoxSkeleton placeholder="Search by donor name or email" />
        <div className="flex flex-wrap items-center gap-2">
          {[...RANGE_PRESETS.map((p) => p.label), "Custom dates"].map((label) => (
            <span
              key={label}
              className="inline-flex min-h-11 items-center rounded-full border border-border bg-card px-5 text-[15px] font-semibold text-foreground"
            >
              {label}
            </span>
          ))}
        </div>
        <StaticAdvanced title="More filters" description="Fund, one-time or recurring, and status" />
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex h-8 items-center gap-3">
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-7 w-40" />
        </div>
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-[15px]">
              <thead className="border-b border-border text-left text-muted-foreground">
                <tr>
                  <th className="px-5 py-4 font-semibold">Date</th>
                  <th className="px-5 py-4 font-semibold">Donor</th>
                  <th className="px-5 py-4 text-right font-semibold">Amount</th>
                  <th className="px-5 py-4 text-right font-semibold">After fees</th>
                  <th className="px-5 py-4 font-semibold">Fund</th>
                  <th className="px-5 py-4 font-semibold">Type</th>
                  <th className="px-5 py-4 font-semibold">Status</th>
                  <th className="px-5 py-4" />
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 10 }).map((_, i) => (
                  <tr key={i} className="border-b border-border/60 last:border-0">
                    <td className="px-5 py-4"><Skeleton className="h-5 w-24" /></td>
                    <td className="px-5 py-4"><Skeleton className={cn("h-5", NAME_WIDTHS[i % NAME_WIDTHS.length])} /></td>
                    <td className="px-5 py-4"><Skeleton className="ml-auto h-5 w-16" /></td>
                    <td className="px-5 py-4"><Skeleton className="ml-auto h-5 w-16" /></td>
                    <td className="px-5 py-4"><Skeleton className="h-5 w-20" /></td>
                    <td className="px-5 py-4"><Skeleton className="h-5 w-20" /></td>
                    <td className="px-5 py-4"><Skeleton className="h-8 w-24 rounded-full" /></td>
                    <td className="px-5 py-4"><Skeleton className="ml-auto h-11 w-24 rounded-[10px]" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <p className="text-sm text-muted-foreground">
          &ldquo;After fees&rdquo; is what reaches your bank once the card processing fee is taken out.
        </p>
      </section>
    </SkeletonContainer>
  );
}

// ---------------------------------------------------------------------------
// Donors and one donor
// ---------------------------------------------------------------------------

export function DonorsSkeleton() {
  return (
    <SkeletonContainer className="flex w-full flex-col gap-8" label="donors">
      <GivingSubpageHeader page="donors" />
      <div className="flex flex-col gap-5">
        <SearchBoxSkeleton placeholder="Search by name or email" />
        <Skeleton className="h-5 w-24" />
        <RowsSkeleton count={8} />
      </div>
    </SkeletonContainer>
  );
}

export function DonorDetailSkeleton() {
  return (
    <SkeletonContainer className="flex w-full flex-col gap-8" label="donor">
      <GivingSubpageHeader
        page="donor"
        back={{ href: "/dashboard/giving/donors", label: "Donors" }}
        title={<InlineSkeleton className="h-10 w-64 max-w-full" />}
        description={<InlineSkeleton className="h-5 w-52" />}
        action={
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <span className="block text-sm font-semibold text-foreground">Statement year</span>
              <Skeleton className="h-11 w-32 rounded-[10px]" />
            </div>
            <Skeleton className="h-12 w-56 rounded-[10px]" />
          </div>
        }
      />
      <section className="grid gap-4 sm:grid-cols-3">
        {["This year", "All time", "Gifts received"].map((label) => (
          <Card key={label} className="flex flex-col gap-2 p-6">
            <h2 className="text-[15px] font-semibold text-muted-foreground">{label}</h2>
            <Skeleton className="h-[30px] w-32" />
          </Card>
        ))}
      </section>
      <section className="flex flex-col gap-4">
        <SectionHeader title="Gifts" description={<InlineSkeleton className="h-5 w-16" />} />
        <RowsSkeleton count={6} trailing="none" />
      </section>
    </SkeletonContainer>
  );
}

// ---------------------------------------------------------------------------
// Recurring and deposits
// ---------------------------------------------------------------------------

export function RecurringSkeleton() {
  return (
    <SkeletonContainer className="flex w-full flex-col gap-8" label="recurring gifts">
      <GivingSubpageHeader page="recurring" />
      <section className="flex flex-col gap-4">
        <SectionHeader title="Active and paused" description={<InlineSkeleton className="h-5 w-32" />} />
        <List>
          {Array.from({ length: 6 }).map((_, i) => (
            <li key={i} className="flex flex-col gap-3 rounded-2xl px-4 py-4 sm:flex-row sm:items-center sm:gap-4">
              <div className="flex min-w-0 flex-1 items-center gap-4">
                <Skeleton className="size-12 shrink-0 rounded-full" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className={cn("h-5", NAME_WIDTHS[i % NAME_WIDTHS.length])} />
                  <Skeleton className="h-4 w-64 max-w-full" />
                </div>
                <Skeleton className="h-8 w-20 shrink-0 rounded-full" />
              </div>
              <div className="flex gap-2 sm:shrink-0">
                <Skeleton className="h-11 w-24 rounded-[10px]" />
                <Skeleton className="h-11 w-24 rounded-[10px]" />
              </div>
            </li>
          ))}
        </List>
      </section>
    </SkeletonContainer>
  );
}

export function DepositsSkeleton() {
  return (
    <SkeletonContainer className="flex w-full flex-col gap-8" label="deposits">
      <GivingSubpageHeader page="deposits" />
      <RowsSkeleton count={8} trailing="badge" />
    </SkeletonContainer>
  );
}

// ---------------------------------------------------------------------------
// Statements
// ---------------------------------------------------------------------------

export function StatementsSkeleton() {
  return (
    <SkeletonContainer className="flex w-full flex-col gap-8" label="statements">
      <GivingSubpageHeader page="statements" />
      <StatementYearPicker year={defaultStatementYear()} />
      <Card className="flex flex-col gap-6 p-6 sm:p-8">
        <div className="space-y-2">
          <Skeleton className="h-8 w-72 max-w-full" />
          <Skeleton className="h-5 w-full max-w-2xl" />
          <Skeleton className="h-5 w-2/3 max-w-xl" />
        </div>
        <div>
          <Button size="lg" disabled>
            <Mail aria-hidden />
            Email donors
          </Button>
        </div>
        <div className="flex flex-col gap-2 border-t border-border pt-5">
          <p className="text-[15px] text-muted-foreground">
            Prefer paper? Download every statement as PDFs in one file.
          </p>
          <div>
            <Skeleton className="h-11 w-72 rounded-[10px]" />
          </div>
        </div>
      </Card>
      <section className="flex flex-col gap-4">
        <SectionHeader
          title={<InlineSkeleton className="h-7 w-64" />}
          description="Download one to check it, or to print it for someone."
        />
        <RowsSkeleton count={6} trailing="none" />
      </section>
    </SkeletonContainer>
  );
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function SettingsCardSkeleton({
  title,
  description,
  rows,
}: {
  title: string;
  description: string;
  rows: number;
}) {
  return (
    <Card className="flex flex-col gap-6 p-6">
      <div className="space-y-1.5">
        <h2 className="font-heading text-xl font-bold text-foreground">{title}</h2>
        <p className="text-[15px] leading-relaxed text-muted-foreground">{description}</p>
      </div>
      <div className="flex max-w-xl flex-col gap-4">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-[76px] rounded-xl" />
        ))}
      </div>
    </Card>
  );
}

export function GivingSettingsSkeleton() {
  return (
    <SkeletonContainer className="flex w-full flex-col gap-8" label="giving settings">
      <GivingSubpageHeader page="settings" />
      <Card className="flex flex-col gap-6 p-6">
        <div className="flex flex-wrap items-center gap-3">
          <Landmark className="size-6 text-primary dark:text-accent" aria-hidden />
          <span className="text-base font-semibold text-foreground">Bank connection</span>
          <Skeleton className="h-8 w-32 rounded-full" />
        </div>
        <Skeleton className="h-5 w-full max-w-lg" />
        <Skeleton className="h-11 w-36 rounded-[10px]" />
        <div className="space-y-2 border-t border-border pt-5">
          <h3 className="text-base font-semibold text-foreground">Fees</h3>
          <Skeleton className="h-5 w-full max-w-2xl" />
          <Skeleton className="h-5 w-4/5 max-w-2xl" />
        </div>
      </Card>
      <Card className="flex flex-col gap-6 p-6">
        <div className="space-y-1.5">
          <h2 className="font-heading text-xl font-bold text-foreground">Funds</h2>
          <p className="text-[15px] leading-relaxed text-muted-foreground">
            Donors choose a fund on your giving page. Your main fund is chosen for them unless they
            pick another.
          </p>
        </div>
        <ul className="flex flex-col divide-y divide-border rounded-2xl border border-border">
          {Array.from({ length: 3 }).map((_, i) => (
            <li key={i} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center">
              <Skeleton className={cn("h-5", NAME_WIDTHS[i])} />
              <div className="flex gap-2 sm:ml-auto">
                <Skeleton className="h-11 w-28 rounded-[10px]" />
                <Skeleton className="h-11 w-36 rounded-[10px]" />
              </div>
            </li>
          ))}
        </ul>
        <div className="flex max-w-xl flex-col gap-2">
          <span className="text-sm font-semibold text-foreground">Add a fund</span>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Skeleton className="h-11 flex-1 rounded-[10px]" />
            <Button disabled>
              <Plus aria-hidden />
              Add fund
            </Button>
          </div>
        </div>
      </Card>
      <SettingsCardSkeleton
        title="Giving in the FaithForm app"
        description="Choose which funds people can give to in the FaithForm app, and who sees them."
        rows={2}
      />
      <SettingsCardSkeleton
        title="Statement details"
        description="Printed on each donor's year-end statement, with a note that nothing was given in exchange for their gifts."
        rows={2}
      />
      <SettingsCardSkeleton
        title="Giving page address"
        description="The web address people visit to give. Use your church's name, with dashes instead of spaces."
        rows={1}
      />
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
        <Button variant="outline" disabled>
          Change logo and colors
        </Button>
      </Card>
    </SkeletonContainer>
  );
}
