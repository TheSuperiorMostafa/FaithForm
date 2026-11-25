"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Ban, CheckCircle2, ExternalLink, FilePlus2, Plus, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  issueChurchInvoice,
  saveChurchBillingProfile,
  setChurchInvoiceStatus,
} from "@/app/admin/billing-actions";
import { ADMIN_INVOICES_DESCRIPTION, ADMIN_PLAN_DESCRIPTION } from "@/components/billing/billing-skeletons";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { confirmAction } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { List, ListRow } from "@/components/ui/list-row";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import {
  MAX_LINE_ITEMS,
  computeInvoiceTotals,
  defaultLineItems,
  formatCents,
  formatInvoiceDate,
  formatPeriodLabel,
  parseDollarsToCents,
  INVOICE_STATUS_TONE,
  type BilledTo,
  type ChurchBillingProfile,
  type ChurchInvoice,
  type InvoiceLineItem,
  type InvoiceStatus,
} from "@/lib/billing/invoice";

const ADMIN_STATUS_LABEL: Record<InvoiceStatus, string> = { due: "Due", paid: "Paid", void: "Void" };

function centsToInput(cents: number | null): string {
  return cents === null ? "" : (cents / 100).toFixed(2);
}

type AdminBillingProfile = ChurchBillingProfile & {
  rateConfirmedAt: string | null;
  proposedMonthlyRateCents: number | null;
};

export function ChurchBillingPanel({
  churchId,
  profile,
  defaultBilledTo,
  invoices,
  defaultPeriod,
  defaultInvoiceDate,
}: {
  churchId: string;
  profile: AdminBillingProfile;
  defaultBilledTo: BilledTo;
  invoices: ChurchInvoice[];
  /** YYYY-MM, the church's current month. */
  defaultPeriod: string;
  /** YYYY-MM-DD, today in the church's time zone. */
  defaultInvoiceDate: string;
}) {
  const [issueOpen, setIssueOpen] = useState(false);
  const confirmedRate = profile.monthlyRateCents;

  return (
    <div className="space-y-4">
      <BillingProfileCard churchId={churchId} profile={profile} />

      <Card>
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle>Invoices</CardTitle>
            <CardDescription>{ADMIN_INVOICES_DESCRIPTION}</CardDescription>
            {confirmedRate === null && (
              <p className="text-sm font-medium text-foreground">
                Confirm this church&apos;s monthly rate above before issuing an invoice.
              </p>
            )}
          </div>
          <Button type="button" onClick={() => setIssueOpen(true)} disabled={confirmedRate === null}>
            <FilePlus2 className="size-4" aria-hidden />
            Issue invoice
          </Button>
        </CardHeader>
        <CardContent>
          {invoices.length === 0 ? (
            <EmptyState
              compact
              title="No invoices yet"
              description="Issue the first monthly invoice and it appears here and in the church's Settings."
            />
          ) : (
            <List label="Invoices" className="p-1">
              {invoices.map((invoice) => (
                <AdminInvoiceRow key={invoice.id} churchId={churchId} invoice={invoice} />
              ))}
            </List>
          )}
        </CardContent>
      </Card>

      {issueOpen && confirmedRate !== null && (
        <IssueInvoiceDialog
          churchId={churchId}
          open={issueOpen}
          onOpenChange={setIssueOpen}
          rateCents={confirmedRate}
          billedTo={defaultBilledTo}
          defaultPeriod={defaultPeriod}
          defaultInvoiceDate={defaultInvoiceDate}
          takenPeriods={invoices.filter((i) => i.status !== "void").map((i) => i.periodStart.slice(0, 7))}
        />
      )}
    </div>
  );
}

function BillingProfileCard({ churchId, profile }: { churchId: string; profile: AdminBillingProfile }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Never prefilled with a guess: empty until this church's rate is confirmed.
  const [rate, setRate] = useState(centsToInput(profile.monthlyRateCents));
  const [confirmed, setConfirmed] = useState(false);
  const [contactName, setContactName] = useState(profile.contactName);
  const [contactEmail, setContactEmail] = useState(profile.contactEmail);
  const [contactPhone, setContactPhone] = useState(profile.contactPhone);

  function save(event: React.FormEvent) {
    event.preventDefault();
    const typed = rate.trim();
    const monthlyRateCents = typed ? parseDollarsToCents(typed) : null;
    if (typed && monthlyRateCents === null) {
      toast.error("Enter the monthly rate as an amount, like 250.00.");
      return;
    }
    const rateChanged = monthlyRateCents !== null && monthlyRateCents !== profile.monthlyRateCents;
    if (rateChanged && !confirmed) {
      toast.error("Tick the box to confirm this is the rate agreed with the church.");
      return;
    }
    startTransition(async () => {
      const result = await saveChurchBillingProfile({
        churchId,
        monthlyRateCents: rateChanged ? monthlyRateCents : null,
        confirmRate: rateChanged ? confirmed : undefined,
        contactName,
        contactEmail,
        contactPhone,
      });
      if (result.ok) {
        toast.success(result.message);
        setConfirmed(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  const typedCents = rate.trim() ? parseDollarsToCents(rate.trim()) : null;
  const needsConfirm = typedCents !== null && typedCents !== profile.monthlyRateCents;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Plan and billing contact</CardTitle>
        <CardDescription>{ADMIN_PLAN_DESCRIPTION}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label htmlFor="billing-rate">Monthly rate (USD)</Label>
              <StatusBadge tone={profile.monthlyRateCents === null ? "attention" : "done"}>
                {profile.monthlyRateCents === null ? "Not confirmed" : "Confirmed"}
              </StatusBadge>
            </div>
            <Input
              id="billing-rate"
              inputMode="decimal"
              placeholder="Enter the agreed amount"
              value={rate}
              onChange={(event) => {
                setRate(event.target.value);
                setConfirmed(false);
              }}
              aria-describedby="billing-rate-note"
            />
            <p id="billing-rate-note" className="text-sm text-muted-foreground">
              {profile.monthlyRateCents !== null
                ? `Confirmed${profile.rateConfirmedAt ? ` ${formatInvoiceDate(profile.rateConfirmedAt.slice(0, 10))}` : ""}. The church sees this amount.`
                : profile.proposedMonthlyRateCents !== null
                  ? `Entered earlier but never confirmed: ${formatCents(profile.proposedMonthlyRateCents)}. The church sees no amount until you confirm one.`
                  : "The church sees no amount until you confirm one."}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="billing-contact-name">Billing contact name</Label>
            <Input
              id="billing-contact-name"
              value={contactName}
              maxLength={160}
              onChange={(event) => setContactName(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="billing-contact-email">Billing email</Label>
            <Input
              id="billing-contact-email"
              type="email"
              value={contactEmail}
              maxLength={254}
              onChange={(event) => setContactEmail(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="billing-contact-phone">Billing phone</Label>
            <Input
              id="billing-contact-phone"
              type="tel"
              value={contactPhone}
              maxLength={40}
              onChange={(event) => setContactPhone(event.target.value)}
            />
          </div>
          {needsConfirm && (
            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[15px] sm:col-span-2">
              <input
                type="checkbox"
                className="size-5 accent-primary"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              {typedCents !== null ? formatCents(typedCents) : "This"} a month is the rate agreed with this church
            </label>
          )}
          <div className="sm:col-span-2">
            <Button type="submit" variant="outline" disabled={pending || (needsConfirm && !confirmed)}>
              {pending ? "Saving…" : needsConfirm ? "Confirm rate and save" : "Save billing details"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function AdminInvoiceRow({ churchId, invoice }: { churchId: string; invoice: ChurchInvoice }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const period = formatPeriodLabel(invoice.periodStart);

  function change(status: InvoiceStatus) {
    startTransition(async () => {
      const result = await setChurchInvoiceStatus({ churchId, invoiceId: invoice.id, status });
      if (result.ok) {
        toast.success(result.message);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  async function voidInvoice() {
    const ok = await confirmAction({
      title: `Void invoice ${invoice.invoiceNumber}?`,
      description: `The church will see ${period} as cancelled. A voided invoice can't be reopened; you can issue a new one for ${period} afterwards.`,
      confirmLabel: "Void invoice",
      destructive: true,
    });
    if (ok) change("void");
  }

  const subtitle = [
    `Issued ${formatInvoiceDate(invoice.invoiceDate)}`,
    formatCents(invoice.totalCents),
    invoice.status === "paid" && invoice.paidAt ? `Paid ${formatInvoiceDate(invoice.paidAt.slice(0, 10))}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <ListRow
      className="flex-col items-stretch sm:flex-row sm:items-center"
      title={`${invoice.invoiceNumber} · ${period}`}
      subtitle={subtitle}
      status={<StatusBadge tone={INVOICE_STATUS_TONE[invoice.status]}>{ADMIN_STATUS_LABEL[invoice.status]}</StatusBadge>}
      trailing={
        <div className="flex flex-wrap gap-2 pl-3 sm:pl-0">
          <a
            href={`/api/billing/invoices/${invoice.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <ExternalLink className="size-4" aria-hidden />
            View PDF<span className="sr-only"> for {invoice.invoiceNumber}</span>
          </a>
          {invoice.status === "due" && (
            <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => change("paid")}>
              <CheckCircle2 className="size-4" aria-hidden />
              Mark paid
            </Button>
          )}
          {invoice.status === "paid" && (
            <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => change("due")}>
              <RotateCcw className="size-4" aria-hidden />
              Mark unpaid
            </Button>
          )}
          {invoice.status !== "void" && (
            <Button type="button" size="sm" variant="destructive" disabled={pending} onClick={voidInvoice}>
              <Ban className="size-4" aria-hidden />
              Void
            </Button>
          )}
        </div>
      }
    />
  );
}

type DraftLine = {
  key: number;
  description: string;
  detail: string;
  qty: string;
  price: string;
  included: boolean;
};

function toDraft(line: InvoiceLineItem, key: number): DraftLine {
  return {
    key,
    description: line.description,
    detail: line.detail,
    qty: String(line.qty),
    price: line.unitCents === null ? "" : centsToInput(line.unitCents),
    included: line.unitCents === null,
  };
}

/** Converts the editable lines, or explains the first one that is not valid. */
function readLines(drafts: DraftLine[]): { lines: InvoiceLineItem[] } | { error: string } {
  const lines: InvoiceLineItem[] = [];
  for (const [index, draft] of drafts.entries()) {
    const n = index + 1;
    if (!draft.description.trim()) return { error: `Line ${n} needs a service name.` };
    const qty = Number(draft.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 999) return { error: `Line ${n} needs a quantity from 1 to 999.` };
    const unitCents = draft.included ? null : parseDollarsToCents(draft.price);
    if (!draft.included && unitCents === null) return { error: `Line ${n} needs a price, like 250.00, or tick Included.` };
    lines.push({ description: draft.description.trim(), detail: draft.detail.trim(), qty, unitCents });
  }
  if (lines.length === 0) return { error: "Add at least one line." };
  return { lines };
}

/** The last 12 months, this month and the next one, newest first. */
function periodOptions(current: string): string[] {
  const [year, month] = current.split("-").map(Number);
  const options: string[] = [];
  for (let offset = 1; offset >= -12; offset -= 1) {
    const date = new Date(Date.UTC(year, month - 1 + offset, 1));
    options.push(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return options;
}

function IssueInvoiceDialog({
  churchId,
  open,
  onOpenChange,
  rateCents,
  billedTo: initialBilledTo,
  defaultPeriod,
  defaultInvoiceDate,
  takenPeriods,
}: {
  churchId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rateCents: number;
  billedTo: BilledTo;
  defaultPeriod: string;
  defaultInvoiceDate: string;
  takenPeriods: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const options = useMemo(() => periodOptions(defaultPeriod), [defaultPeriod]);
  const firstOpen = options.find((option) => option <= defaultPeriod && !takenPeriods.includes(option));
  const [period, setPeriod] = useState(firstOpen ?? defaultPeriod);
  const [invoiceDate, setInvoiceDate] = useState(defaultInvoiceDate);
  const [billedTo, setBilledTo] = useState<BilledTo>(initialBilledTo);
  const [drafts, setDrafts] = useState<DraftLine[]>(() => defaultLineItems(rateCents).map(toDraft));
  const [nextKey, setNextKey] = useState(2);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const parsed = readLines(drafts);
  const total = "lines" in parsed ? computeInvoiceTotals(parsed.lines).totalCents : null;

  function updateDraft(key: number, patch: Partial<DraftLine>) {
    setDrafts((current) => current.map((draft) => (draft.key === key ? { ...draft, ...patch } : draft)));
  }

  function addLine() {
    setDrafts((current) => [...current, { key: nextKey, description: "", detail: "", qty: "1", price: "", included: false }]);
    setNextKey((key) => key + 1);
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const result = readLines(drafts);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    if (!billedTo.organization.trim()) {
      setError("Enter the church name the invoice is billed to.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const response = await issueChurchInvoice({
        churchId,
        period,
        invoiceDate,
        billedTo,
        lineItems: result.lines,
        notes,
      });
      if (response.ok) {
        toast.success(response.message);
        onOpenChange(false);
        router.refresh();
      } else {
        setError(response.error);
      }
    });
  }

  const billedField = (key: keyof BilledTo, label: string, type = "text", max = 200) => (
    <div className="space-y-2">
      <Label htmlFor={`issue-${key}`}>{label}</Label>
      <Input
        id={`issue-${key}`}
        type={type}
        value={billedTo[key]}
        maxLength={max}
        required={key === "organization"}
        onChange={(event) => setBilledTo((current) => ({ ...current, [key]: event.target.value }))}
      />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Issue invoice</DialogTitle>
          <DialogDescription>
            Filled in from the plan and billing contact. Change anything for this invoice only.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="flex min-h-0 flex-auto flex-col">
          <div className="min-h-0 flex-auto space-y-6 overflow-y-auto px-6 py-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="issue-period">Month</Label>
                <Select id="issue-period" value={period} onChange={(event) => setPeriod(event.target.value)}>
                  {options.map((option) => (
                    <option key={option} value={option}>
                      {formatPeriodLabel(`${option}-01`)}
                      {takenPeriods.includes(option) ? " (already invoiced)" : ""}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="issue-date">Invoice date</Label>
                <Input
                  id="issue-date"
                  type="date"
                  value={invoiceDate}
                  required
                  onChange={(event) => setInvoiceDate(event.target.value)}
                />
              </div>
            </div>

            <fieldset className="space-y-3">
              <legend className="text-[15px] font-semibold">Billed to</legend>
              <div className="grid gap-4 sm:grid-cols-2">
                {billedField("organization", "Church name")}
                {billedField("contactName", "Contact name", "text", 160)}
                {billedField("email", "Email", "email", 254)}
                {billedField("phone", "Phone", "tel", 40)}
              </div>
            </fieldset>

            <fieldset className="space-y-3">
              <legend className="text-[15px] font-semibold">Lines</legend>
              {drafts.map((draft, index) => (
                <div key={draft.key} className="space-y-3 rounded-2xl border border-border p-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor={`line-${draft.key}-description`}>Service</Label>
                      <Input
                        id={`line-${draft.key}-description`}
                        value={draft.description}
                        maxLength={200}
                        onChange={(event) => updateDraft(draft.key, { description: event.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`line-${draft.key}-detail`}>Detail</Label>
                      <Input
                        id={`line-${draft.key}-detail`}
                        value={draft.detail}
                        maxLength={400}
                        onChange={(event) => updateDraft(draft.key, { detail: event.target.value })}
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="w-24 space-y-2">
                      <Label htmlFor={`line-${draft.key}-qty`}>Qty</Label>
                      <Input
                        id={`line-${draft.key}-qty`}
                        inputMode="numeric"
                        value={draft.qty}
                        onChange={(event) => updateDraft(draft.key, { qty: event.target.value })}
                      />
                    </div>
                    <div className="w-36 space-y-2">
                      <Label htmlFor={`line-${draft.key}-price`}>Unit price (USD)</Label>
                      <Input
                        id={`line-${draft.key}-price`}
                        inputMode="decimal"
                        value={draft.included ? "" : draft.price}
                        placeholder={draft.included ? "Included" : "0.00"}
                        disabled={draft.included}
                        onChange={(event) => updateDraft(draft.key, { price: event.target.value })}
                      />
                    </div>
                    <label className="flex min-h-11 items-center gap-2 text-[15px]">
                      <input
                        type="checkbox"
                        className="size-5 accent-primary"
                        checked={draft.included}
                        onChange={(event) => updateDraft(draft.key, { included: event.target.checked })}
                      />
                      Included (no charge)
                    </label>
                    {drafts.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="ml-auto"
                        onClick={() => setDrafts((current) => current.filter((item) => item.key !== draft.key))}
                      >
                        <Trash2 className="size-4" aria-hidden />
                        Remove line<span className="sr-only"> {index + 1}</span>
                      </Button>
                    )}
                  </div>
                </div>
              ))}
              {drafts.length < MAX_LINE_ITEMS && (
                <Button type="button" variant="outline" size="sm" onClick={addLine}>
                  <Plus className="size-4" aria-hidden />
                  Add a line
                </Button>
              )}
            </fieldset>

            <div className="space-y-2">
              <Label htmlFor="issue-notes">Notes on the invoice (optional)</Label>
              <Textarea
                id="issue-notes"
                value={notes}
                maxLength={2000}
                onChange={(event) => setNotes(event.target.value)}
              />
            </div>

            <div className="flex items-center justify-between rounded-2xl bg-muted/50 px-5 py-4">
              <span className="text-[15px] font-semibold">Total due (tax exempt)</span>
              <span className="font-heading text-xl font-bold">{total === null ? "—" : formatCents(total)}</span>
            </div>

            {error && (
              <p role="alert" className="text-[15px] font-medium text-destructive">
                {error}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Issuing…" : `Issue invoice for ${formatPeriodLabel(`${period}-01`)}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
