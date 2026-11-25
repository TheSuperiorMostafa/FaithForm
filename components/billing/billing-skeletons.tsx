import { FilePlus2, Receipt } from "lucide-react";

import {
  BILLING_INVOICES_DESCRIPTION,
  BILLING_INVOICES_TITLE,
  BILLING_PLAN_DESCRIPTION,
  BILLING_PLAN_TITLE,
  CancelPlanNote,
} from "@/components/billing/settings-billing-panel";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/page-header";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";
import { PLAN_NAME } from "@/lib/billing/invoice";

export const ADMIN_PLAN_DESCRIPTION = `${PLAN_NAME}, billed monthly. The rate and contact fill in each new invoice; past invoices keep what they were issued with. Leave the contact blank to use the church's own details.`;
export const ADMIN_INVOICES_DESCRIPTION =
  "Issue one invoice a month. The church sees each one in Settings › Billing and can download the PDF. Nothing is charged automatically.";

/** One invoice row: the same padding and controls as the loaded ListRow. */
function InvoiceRowSkeleton({ actions }: { actions: string[] }) {
  return (
    <li className="flex flex-col items-stretch gap-2 rounded-2xl sm:flex-row sm:items-center">
      <div className="flex min-h-[72px] min-w-0 flex-1 items-center gap-3 rounded-2xl px-3 py-3 sm:gap-4 sm:px-4">
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-5 w-36 max-w-full" />
          <Skeleton className="h-4 w-64 max-w-full" />
        </div>
        <Skeleton className="h-7 w-16 shrink-0 rounded-full" />
      </div>
      <div className="flex flex-wrap gap-2 pb-2 pl-3 pr-3 sm:pb-0 sm:pl-0">
        {actions.map((width, index) => (
          <Skeleton key={index} className={`h-11 ${width} rounded-[10px]`} />
        ))}
      </div>
    </li>
  );
}

/** Settings › Billing while it loads. Titles and the cancel line are real text. */
export function SettingsBillingSkeleton() {
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
            <div className="min-w-0 flex-1">
              <p className="text-base font-semibold">{PLAN_NAME}</p>
              <Skeleton className="mt-1 h-5 w-80 max-w-full" />
            </div>
          </div>
        </CardContent>
      </Card>

      <section className="flex flex-col gap-4">
        <SectionHeader title={BILLING_INVOICES_TITLE} description={BILLING_INVOICES_DESCRIPTION} />
        <ul className="divide-y divide-border rounded-3xl border border-border bg-card p-2 shadow-sm">
          {Array.from({ length: 3 }).map((_, index) => (
            <InvoiceRowSkeleton key={index} actions={["w-24", "w-40"]} />
          ))}
        </ul>
      </section>

      <CancelPlanNote />
    </div>
  );
}

/** The admin church page's Billing tab while it loads. */
export function ChurchBillingSkeleton() {
  return (
    <SkeletonContainer label="billing" className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Plan and billing contact</CardTitle>
          <CardDescription>{ADMIN_PLAN_DESCRIPTION}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {["Monthly rate (USD)", "Billing contact name", "Billing email", "Billing phone"].map((label) => (
            <div key={label} className="space-y-2">
              <p className="text-sm font-semibold leading-none">{label}</p>
              <Skeleton className="h-11 w-full rounded-[10px]" />
            </div>
          ))}
          <span className="inline-flex min-h-11 items-center self-start rounded-[10px] border border-primary/45 px-6 text-[15px] font-semibold text-primary dark:border-accent/60 dark:text-accent sm:col-span-2 sm:justify-self-start">
            Save billing details
          </span>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle>Invoices</CardTitle>
            <CardDescription>{ADMIN_INVOICES_DESCRIPTION}</CardDescription>
          </div>
          <span className="inline-flex min-h-11 items-center gap-2 rounded-[10px] bg-accent px-6 text-[15px] font-semibold text-accent-foreground">
            <FilePlus2 className="size-4" aria-hidden />
            Issue invoice
          </span>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-border rounded-3xl border border-border bg-card p-1 shadow-sm">
            {Array.from({ length: 2 }).map((_, index) => (
              <InvoiceRowSkeleton key={index} actions={["w-32", "w-28", "w-24"]} />
            ))}
          </ul>
        </CardContent>
      </Card>
    </SkeletonContainer>
  );
}
