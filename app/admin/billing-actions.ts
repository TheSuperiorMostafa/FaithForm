"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireSuperAdmin } from "@/lib/auth/superadmin";
import {
  MAX_LINE_ITEMS,
  MAX_QTY,
  MAX_UNIT_CENTS,
  canChangeInvoiceStatus,
  computeInvoiceTotals,
  formatPeriodLabel,
  normalizePeriodStart,
  toStoredBilledTo,
  toStoredLineItems,
  type InvoiceStatus,
} from "@/lib/billing/invoice";
import { toUserError } from "@/lib/errors/user-error";
import { createAdminClient } from "@/lib/supabase/admin";

/*
 * Platform-admin billing actions. Each one checks the caller is a FaithForm
 * platform admin, then writes with the service role, always scoped by the
 * church id. Nothing here charges a card or moves money: invoices are records.
 */

export type BillingActionResult = { ok: true; message: string } | { ok: false; error: string };

const churchIdSchema = z.string().uuid();

function revalidateBilling(churchId: string) {
  revalidatePath(`/admin/churches/${churchId}`);
  revalidatePath("/dashboard/settings");
}

const profileSchema = z.object({
  churchId: churchIdSchema,
  /**
   * A rate to confirm for this church. Omitted or null leaves the rate as it
   * is. A rate is only ever saved as confirmed: each church has its own
   * agreed amount, and nothing shows it until then.
   */
  monthlyRateCents: z.number().int().min(0).max(MAX_UNIT_CENTS).nullable().optional(),
  /** The admin ticked that this rate is the one agreed with the church. */
  confirmRate: z.boolean().optional(),
  contactName: z.string().trim().max(160),
  contactEmail: z.union([z.literal(""), z.string().trim().email().max(254)]),
  contactPhone: z.string().trim().max(40),
});

export type SaveBillingProfileInput = z.input<typeof profileSchema>;

export async function saveChurchBillingProfile(input: SaveBillingProfileInput): Promise<BillingActionResult> {
  const user = await requireSuperAdmin();
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Check the monthly rate and the billing email, then save again." };
  }
  const value = parsed.data;
  const settingRate = value.monthlyRateCents !== null && value.monthlyRateCents !== undefined;
  if (settingRate && value.confirmRate !== true) {
    return {
      ok: false,
      error: "Confirm this is the rate agreed with the church before saving it. The church sees it once it's saved.",
    };
  }
  const now = new Date().toISOString();

  const { error } = await createAdminClient()
    .from("church_billing_profiles")
    .upsert(
      {
        church_id: value.churchId,
        ...(settingRate
          ? {
              monthly_rate_cents: value.monthlyRateCents,
              monthly_rate_confirmed_at: now,
              monthly_rate_confirmed_by: user.id,
            }
          : {}),
        contact_name: value.contactName || null,
        contact_email: value.contactEmail || null,
        contact_phone: value.contactPhone || null,
        updated_at: now,
        updated_by: user.id,
      },
      { onConflict: "church_id" },
    );
  if (error) return { ok: false, error: toUserError(error, "We couldn't save the billing details.") };
  if (settingRate) {
    // The confirmed rate replaces any unconfirmed one entered earlier.
    await createAdminClient().from("church_billing_rate_drafts").delete().eq("church_id", value.churchId);
  }

  revalidateBilling(value.churchId);
  return {
    ok: true,
    message: settingRate
      ? "Rate confirmed. The church now sees it, and new invoices use it."
      : "Billing contact saved.",
  };
}

const lineSchema = z.object({
  description: z.string().trim().min(1).max(200),
  detail: z.string().trim().max(400),
  qty: z.number().int().min(1).max(MAX_QTY),
  unitCents: z.number().int().min(0).max(MAX_UNIT_CENTS).nullable(),
});

const issueSchema = z.object({
  churchId: churchIdSchema,
  period: z.string(),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  billedTo: z.object({
    organization: z.string().trim().min(1).max(200),
    contactName: z.string().trim().max(160),
    email: z.string().trim().max(254),
    phone: z.string().trim().max(40),
  }),
  lineItems: z.array(lineSchema).min(1).max(MAX_LINE_ITEMS),
  notes: z.string().trim().max(2000),
});

export type IssueInvoiceInput = z.input<typeof issueSchema>;

export async function issueChurchInvoice(input: IssueInvoiceInput): Promise<BillingActionResult> {
  const user = await requireSuperAdmin();
  const parsed = issueSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Each line needs a service name, a quantity and a price (or Included), and the invoice needs a church name.",
    };
  }
  const value = parsed.data;
  const periodStart = normalizePeriodStart(value.period);
  if (!periodStart) return { ok: false, error: "Choose the month this invoice is for." };

  const totals = computeInvoiceTotals(value.lineItems);
  const admin = createAdminClient();

  // No invoice before the church's own rate is confirmed: a prefilled default
  // must never be billed by accident.
  const { data: profile, error: profileError } = await admin
    .from("church_billing_profiles")
    .select("monthly_rate_confirmed_at")
    .eq("church_id", value.churchId)
    .maybeSingle();
  if (profileError) return { ok: false, error: toUserError(profileError, "We couldn't issue this invoice.") };
  if (!profile?.monthly_rate_confirmed_at) {
    return { ok: false, error: "Confirm this church's monthly rate first, then issue the invoice." };
  }

  // A voided month can be reissued; a live one cannot be issued twice.
  const { data: existing, error: existingError } = await admin
    .from("church_invoices")
    .select("invoice_number")
    .eq("church_id", value.churchId)
    .eq("period_start", periodStart)
    .neq("status", "void")
    .maybeSingle();
  if (existingError) return { ok: false, error: toUserError(existingError, "We couldn't issue this invoice.") };
  const duplicateMessage = (number?: string) =>
    `${formatPeriodLabel(periodStart)} already has invoice${number ? ` ${number}` : ""}. Void it first to issue a new one.`;
  if (existing) return { ok: false, error: duplicateMessage(existing.invoice_number as string) };

  const { data, error } = await admin
    .from("church_invoices")
    .insert({
      church_id: value.churchId,
      invoice_date: value.invoiceDate,
      period_start: periodStart,
      status: "due",
      line_items: toStoredLineItems(value.lineItems),
      subtotal_cents: totals.subtotalCents,
      total_cents: totals.totalCents,
      billed_to: toStoredBilledTo(value.billedTo),
      notes: value.notes || null,
      created_by: user.id,
    })
    .select("invoice_number")
    .single();
  if (error) {
    // Two admins issuing the same month at once: the partial unique index wins.
    if ((error as { code?: string }).code === "23505") return { ok: false, error: duplicateMessage() };
    return { ok: false, error: toUserError(error, "We couldn't issue this invoice.") };
  }

  revalidateBilling(value.churchId);
  return {
    ok: true,
    message: `Invoice ${data.invoice_number as string} for ${formatPeriodLabel(periodStart)} issued. The church sees it in Settings › Billing.`,
  };
}

const statusSchema = z.object({
  churchId: churchIdSchema,
  invoiceId: z.string().uuid(),
  status: z.enum(["due", "paid", "void"]),
});

export type SetInvoiceStatusInput = z.input<typeof statusSchema>;

export async function setChurchInvoiceStatus(input: SetInvoiceStatusInput): Promise<BillingActionResult> {
  await requireSuperAdmin();
  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "We couldn't find that invoice." };
  const { churchId, invoiceId, status: next } = parsed.data;

  const admin = createAdminClient();
  const { data: current, error: readError } = await admin
    .from("church_invoices")
    .select("status, invoice_number")
    .eq("id", invoiceId)
    .eq("church_id", churchId)
    .maybeSingle();
  if (readError) return { ok: false, error: toUserError(readError, "We couldn't update this invoice.") };
  if (!current) return { ok: false, error: "We couldn't find that invoice." };

  const from = current.status as InvoiceStatus;
  if (!canChangeInvoiceStatus(from, next)) {
    return {
      ok: false,
      error: from === "void" ? "A voided invoice can't be changed. Issue a new one instead." : "Nothing to change.",
    };
  }

  const now = new Date().toISOString();
  const patch =
    next === "paid"
      ? { status: next, paid_at: now, voided_at: null }
      : next === "void"
        ? { status: next, paid_at: null, voided_at: now }
        : { status: next, paid_at: null, voided_at: null };

  // Only change it if nobody else did in the meantime.
  const { data: updated, error } = await admin
    .from("church_invoices")
    .update(patch)
    .eq("id", invoiceId)
    .eq("church_id", churchId)
    .eq("status", from)
    .select("id");
  if (error) return { ok: false, error: toUserError(error, "We couldn't update this invoice.") };
  if (!updated || updated.length === 0) {
    return { ok: false, error: "This invoice was just changed by someone else. Refresh to see it." };
  }

  revalidateBilling(churchId);
  const number = current.invoice_number as string;
  const message =
    next === "paid"
      ? `Invoice ${number} marked paid.`
      : next === "void"
        ? `Invoice ${number} voided. You can issue a new one for that month.`
        : `Invoice ${number} marked as due again.`;
  return { ok: true, message };
}
