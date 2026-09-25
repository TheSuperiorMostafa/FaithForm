import Link from "next/link";
import { redirect } from "next/navigation";
import { Download, FileText } from "lucide-react";

import { EinInlineForm } from "@/components/giving/ein-inline-form";
import { GenerateStatementsButton } from "@/components/giving/generate-statements-button";
import { formatGiftDate, GivingNotReady, GivingSubpageHeader, plural } from "@/components/giving/giving-page-parts";
import { StatementEmailer } from "@/components/giving/statement-emailer";
import { StatementYearPicker as YearPicker } from "@/components/giving/statement-year-picker";
import { AdvancedSection } from "@/components/ui/advanced-section";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { InitialsAvatar, List } from "@/components/ui/list-row";
import { SectionHeader } from "@/components/ui/page-header";
import { getChurchAuth } from "@/lib/auth/church";
import { isChurchFeatureEmailEnabled } from "@/lib/features/access";
import { donorDisplayName } from "@/lib/giving/labels";
import { isStatementEmailConfigured } from "@/lib/giving/statement-email";
import { parseStatementYear } from "@/lib/giving/statement-year";
import {
  getChurchGivingProfile,
  getGivingStatements,
  getStatementPreview,
} from "@/lib/queries/giving";
import { formatCents } from "@/lib/utils/currency";

export const dynamic = "force-dynamic";

export default async function StatementsPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const query = await searchParams;
  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  const profile = await getChurchGivingProfile(auth.churchId);
  if (!profile?.stripeChargesEnabled) {
    return (
      <div className="flex w-full flex-col gap-8">
        <GivingSubpageHeader page="statements" />
        <GivingNotReady isAdmin={auth.isAdmin} />
      </div>
    );
  }

  // Last year until April, when year-end statements are sent; any year on request.
  const year = parseStatementYear(query.year);
  const hasEin = Boolean(profile.ein);

  let data;
  try {
    const [preview, periods, emailsEnabled] = await Promise.all([
      getStatementPreview(auth.churchId, year),
      getGivingStatements(auth.churchId),
      isChurchFeatureEmailEnabled(auth.churchId, "giving"),
    ]);
    data = { preview, periods, emailsEnabled };
  } catch (error) {
    console.error("[giving] statements failed to load", error);
    return (
      <div className="flex w-full flex-col gap-8">
        <GivingSubpageHeader page="statements" />
        <YearPicker year={year} />
        <ErrorState
          title="Statements didn't load"
          description="Nothing was lost. Refresh the page to try again, and if it keeps happening, contact FaithForm support."
        />
      </div>
    );
  }
  const { preview, periods, emailsEnabled } = data;
  const donorCount = preview.donors.length;

  const emailUnavailableReason = !auth.isAdmin
    ? "Only church admins can send statements. Ask an admin on your team."
    : !hasEin
      ? "Add your tax ID above, then you can email every donor."
      : !isStatementEmailConfigured()
        ? "Email isn't available right now, so download the statements below to print or send yourself."
        : !emailsEnabled
          ? "Giving emails are switched off for your church, so download the statements below to print or send yourself."
          : null;

  return (
    <div className="flex w-full flex-col gap-8">
      <GivingSubpageHeader page="statements" />

      <YearPicker year={year} />

      {auth.isAdmin && !hasEin && <EinInlineForm />}

      <Card className="flex flex-col gap-6 p-6 sm:p-8">
        <div className="space-y-2">
          <h2 className="font-heading text-2xl font-bold text-foreground">
            {donorCount === 0
              ? `No one has given in ${year} yet`
              : `${plural(donorCount, "donor")} gave in ${year}`}
          </h2>
          {donorCount > 0 && (
            <p className="text-base text-muted-foreground">
              {formatCents(preview.totalCents)} from {plural(preview.giftCount, "gift")}. Each donor
              gets one statement listing their gifts, your church&apos;s tax ID and address, and a
              note that nothing was given in return.
            </p>
          )}
        </div>
        {donorCount > 0 && (
          <>
            <StatementEmailer
              year={year}
              donors={preview.donors.map((d) => ({ id: d.id, name: d.name, email: d.email }))}
              emailUnavailableReason={emailUnavailableReason}
            />
            {auth.isAdmin && (
              <div className="flex flex-col gap-2 border-t border-border pt-5">
                <p className="text-[15px] text-muted-foreground">
                  Prefer paper? Download every statement as PDFs in one file.
                </p>
                <div>
                  <GenerateStatementsButton year={year} hasEin={hasEin} count={donorCount} />
                </div>
              </div>
            )}
          </>
        )}
      </Card>

      {preview.giftsWithoutDonor.length > 0 && (
        <section aria-labelledby="no-email" className="flex flex-col gap-4">
          <SectionHeader
            id="no-email"
            title="Gifts not on any statement"
            description={`${plural(preview.giftsWithoutDonor.length, "gift")} in ${year} came without a donor email, so they can't go on a statement. Write to these givers yourself if you know who they are.`}
          />
          <List label="Gifts without a donor email">
            {preview.giftsWithoutDonor.map((g) => {
              const name = donorDisplayName(g);
              return (
                <li key={g.id} className="flex min-h-[72px] items-center gap-4 px-4 py-3">
                  <InitialsAvatar name={name} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base font-semibold text-foreground">{name}</span>
                    <span className="block text-[15px] text-muted-foreground">
                      {formatGiftDate(g.createdAt)}
                      {g.donorEmail ? ` · ${g.donorEmail}` : " · No email"}
                    </span>
                  </span>
                  <span className="font-heading text-lg font-bold text-foreground">
                    {formatCents(g.amountCents, g.currency)}
                  </span>
                </li>
              );
            })}
          </List>
        </section>
      )}

      {donorCount > 0 && (
        <section aria-labelledby="per-donor" className="flex flex-col gap-4">
          <SectionHeader
            id="per-donor"
            title={`Each donor's ${year} statement`}
            description="Download one to check it, or to print it for someone."
          />
          <List label={`${year} statements by donor`}>
            {preview.donors.map((d) => {
              const name = donorDisplayName(d);
              return (
                <li key={d.id} className="flex flex-col gap-2 px-4 py-3 sm:min-h-[72px] sm:flex-row sm:items-center sm:gap-4">
                  <Link
                    href={`/dashboard/giving/donors/${d.id}`}
                    className="flex min-w-0 flex-1 items-center gap-4 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <InitialsAvatar name={name} />
                    <span className="min-w-0">
                      <span className="block truncate text-base font-semibold text-foreground">{name}</span>
                      <span className="block truncate text-[15px] text-muted-foreground">
                        {formatCents(d.totalCents)} · {plural(d.giftCount, "gift")} · {d.email}
                      </span>
                    </span>
                  </Link>
                  <a
                    href={`/api/dashboard/giving/statements/${d.id}?year=${year}`}
                    className="inline-flex min-h-11 w-fit items-center gap-2 rounded-[10px] px-3 text-[15px] font-semibold text-primary hover:bg-accent/10 dark:text-accent"
                  >
                    <Download className="size-5" aria-hidden />
                    Download PDF
                  </a>
                </li>
              );
            })}
          </List>
        </section>
      )}

      {donorCount === 0 && preview.giftsWithoutDonor.length === 0 && (
        <EmptyState
          compact
          icon={FileText}
          title={`No statements for ${year}`}
          description="Pick another year above, or come back once gifts come in."
        />
      )}

      <AdvancedSection
        title="Totals by month and year"
        description="Everything received, for your own records"
      >
        <div className="grid gap-6 md:grid-cols-2">
          <PeriodList title="By month" periods={periods.monthly} />
          <PeriodList title="By year" periods={periods.annual} />
        </div>
      </AdvancedSection>
    </div>
  );
}

function PeriodList({
  title,
  periods,
}: {
  title: string;
  periods: { label: string; totalCents: number; count: number }[];
}) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      {periods.length === 0 ? (
        <p className="text-[15px] text-muted-foreground">No gifts received yet.</p>
      ) : (
        <ul className="divide-y divide-border rounded-2xl border border-border">
          {periods.map((p) => (
            <li key={p.label} className="flex items-center justify-between gap-3 px-4 py-3 text-[15px]">
              <span className="font-semibold text-foreground">{p.label}</span>
              <span className="text-muted-foreground">
                {plural(p.count, "gift")} · {formatCents(p.totalCents)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
