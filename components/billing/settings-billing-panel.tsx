import { Download, ExternalLink, Receipt } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { List, ListRow } from "@/components/ui/list-row";
import { SectionHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  CHURCH_STATUS_LABEL,
  FAITHFORM_BILLING,
  INVOICE_STATUS_TONE,
  PLAN_NAME,
  formatCents,
  formatInvoiceDate,
  formatPeriodLabel,
  type ChurchBillingProfile,
  type ChurchInvoice,
} from "@/lib/billing/invoice";

/*
 * Static copy shared with the loading skeleton, so both read the same.
 */
export const BILLING_PLAN_TITLE = "Your plan";
export const BILLING_PLAN_DESCRIPTION =
  "FaithForm sends one invoice at the start of each month. Payment is due when you receive it.";
export const BILLING_INVOICES_TITLE = "Invoices";
export const BILLING_INVOICES_DESCRIPTION = "Open any invoice, or download the PDF for your records.";

/** The quiet cancellation line at the bottom of Billing. */
export function CancelPlanNote() {
  return (
    <p className="text-sm text-muted-foreground">
      To cancel your plan, email{" "}
      <a
        href={`mailto:${FAITHFORM_BILLING.email}?subject=${encodeURIComponent("Cancel my FaithForm plan")}`}
        className="font-medium text-foreground/80 underline underline-offset-4 hover:text-primary dark:hover:text-accent"
      >
        {FAITHFORM_BILLING.email}
      </a>
      .
    </p>
  );
}

export function SettingsBillingPanel({
  profile,
  invoices,
}: {
  profile: ChurchBillingProfile;
  invoices: ChurchInvoice[];
}) {
  return (
    <div className="flex flex-col gap-8">
      <Card>
        <CardHeader>
          <CardTitle>{BILLING_PLAN_TITLE}</CardTitle>
          <CardDescription className="text-[15px]">{BILLING_PLAN_DESCRIPTION}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4 rounded-2xl bg-muted/50 px-5 py-4">
            <span
              aria-hidden
              className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary/[0.07] text-primary dark:bg-accent/15 dark:text-accent"
            >
              <Receipt className="size-6" strokeWidth={1.75} />
            </span>
            <div className="min-w-0">
              <p className="text-base font-semibold">{PLAN_NAME}</p>
              <p className="text-[15px] text-muted-foreground">
                {formatCents(profile.monthlyRateCents)} a month · every FaithForm system and your
                dashboard
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <section className="flex flex-col gap-4" aria-labelledby="billing-invoices">
        <SectionHeader
          id="billing-invoices"
          title={BILLING_INVOICES_TITLE}
          description={BILLING_INVOICES_DESCRIPTION}
        />
        {invoices.length === 0 ? (
          <EmptyState
            compact
            icon={Receipt}
            title="No invoices yet"
            description="Your monthly invoices will appear here as soon as FaithForm sends the first one."
          />
        ) : (
          <List label="Invoices">
            {invoices.map((invoice) => (
              <InvoiceRow key={invoice.id} invoice={invoice} />
            ))}
          </List>
        )}
      </section>

      <CancelPlanNote />
    </div>
  );
}

function InvoiceRow({ invoice }: { invoice: ChurchInvoice }) {
  const href = `/api/billing/invoices/${invoice.id}`;
  const period = formatPeriodLabel(invoice.periodStart);

  return (
    <ListRow
      className="flex-col items-stretch sm:flex-row sm:items-center"
      title={period}
      subtitle={`${invoice.invoiceNumber} · ${formatInvoiceDate(invoice.invoiceDate)} · ${formatCents(invoice.totalCents)}`}
      status={
        <StatusBadge tone={INVOICE_STATUS_TONE[invoice.status]}>
          {CHURCH_STATUS_LABEL[invoice.status]}
        </StatusBadge>
      }
      trailing={
        <div className="flex flex-wrap gap-2 pb-2 pl-3 sm:pb-0 sm:pl-0">
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <ExternalLink className="size-4" aria-hidden />
            View<span className="sr-only"> invoice {invoice.invoiceNumber} for {period}</span>
          </a>
          <a
            href={`${href}?download=1`}
            download
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <Download className="size-4" aria-hidden />
            Download PDF<span className="sr-only"> of invoice {invoice.invoiceNumber}</span>
          </a>
        </div>
      }
    />
  );
}
