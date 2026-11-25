import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  CHURCH_INVOICE_COLUMNS,
  mapInvoiceRow,
  type BilledTo,
  type ChurchBillingProfile,
  type ChurchInvoice,
  type ChurchInvoiceRow,
} from "@/lib/billing/invoice";

/*
 * Billing reads. Callers authorise first (church admin of this church, or a
 * platform admin) and pass a client; these always filter by church id so a
 * service-role client can never return another church's rows.
 */

/**
 * A church's billing profile. `monthlyRateCents` is the confirmed rate only:
 * null until a platform admin confirms it, and never a default. Safe for the
 * church's own (RLS) client, which cannot read the unconfirmed rate.
 */
export async function getChurchBillingProfile(
  client: SupabaseClient,
  churchId: string,
): Promise<ChurchBillingProfile & { saved: boolean }> {
  const { data, error } = await client
    .from("church_billing_profiles")
    .select("monthly_rate_cents, monthly_rate_confirmed_at, contact_name, contact_email, contact_phone")
    .eq("church_id", churchId)
    .maybeSingle();
  if (error) throw new Error(`billing profile: ${error.message}`);
  const confirmed = Boolean(data?.monthly_rate_confirmed_at);
  return {
    saved: Boolean(data),
    monthlyRateCents: confirmed ? ((data?.monthly_rate_cents as number | null) ?? null) : null,
    contactName: (data?.contact_name as string | null) ?? "",
    contactEmail: (data?.contact_email as string | null) ?? "",
    contactPhone: (data?.contact_phone as string | null) ?? "",
  };
}

/**
 * The platform admin's view of the profile: also when the rate was confirmed
 * and any rate entered earlier that still needs confirming. Service role only.
 */
export async function getAdminBillingProfile(
  client: SupabaseClient,
  churchId: string,
): Promise<ChurchBillingProfile & { rateConfirmedAt: string | null; proposedMonthlyRateCents: number | null }> {
  const profile = await getChurchBillingProfile(client, churchId);
  const [confirmedRead, draftRead] = await Promise.all([
    client
      .from("church_billing_profiles")
      .select("monthly_rate_confirmed_at")
      .eq("church_id", churchId)
      .maybeSingle(),
    client
      .from("church_billing_rate_drafts")
      .select("proposed_monthly_rate_cents")
      .eq("church_id", churchId)
      .maybeSingle(),
  ]);
  if (confirmedRead.error) throw new Error(`billing profile: ${confirmedRead.error.message}`);
  if (draftRead.error) throw new Error(`billing rate draft: ${draftRead.error.message}`);
  const rateConfirmedAt = (confirmedRead.data?.monthly_rate_confirmed_at as string | null) ?? null;
  return {
    ...profile,
    rateConfirmedAt,
    // A draft only matters while nothing is confirmed.
    proposedMonthlyRateCents: rateConfirmedAt
      ? null
      : ((draftRead.data?.proposed_monthly_rate_cents as number | null) ?? null),
  };
}

export async function listChurchInvoices(
  client: SupabaseClient,
  churchId: string,
): Promise<ChurchInvoice[]> {
  const { data, error } = await client
    .from("church_invoices")
    .select(CHURCH_INVOICE_COLUMNS)
    .eq("church_id", churchId)
    .order("period_start", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(240);
  if (error) throw new Error(`church invoices: ${error.message}`);
  return ((data ?? []) as ChurchInvoiceRow[]).map(mapInvoiceRow);
}

/** One invoice by id, whatever church it belongs to. The caller authorises against `churchId`. */
export async function getChurchInvoiceById(
  client: SupabaseClient,
  invoiceId: string,
): Promise<ChurchInvoice | null> {
  const { data, error } = await client
    .from("church_invoices")
    .select(CHURCH_INVOICE_COLUMNS)
    .eq("id", invoiceId)
    .maybeSingle();
  if (error) throw new Error(`church invoice: ${error.message}`);
  return data ? mapInvoiceRow(data as ChurchInvoiceRow) : null;
}

/**
 * Who the next invoice is addressed to: the saved billing contact, falling
 * back to the church's own details and its senior pastor.
 */
export async function getDefaultBilledTo(
  client: SupabaseClient,
  churchId: string,
  profile: ChurchBillingProfile,
): Promise<BilledTo> {
  const [churchResult, pastorResult] = await Promise.all([
    client.from("churches").select("name, phone, email").eq("id", churchId).maybeSingle(),
    client
      .from("church_staff")
      .select("full_name, email, phone")
      .eq("church_id", churchId)
      .eq("is_senior_pastor", true)
      .order("sort_order", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);
  if (churchResult.error) throw new Error(`billing church: ${churchResult.error.message}`);
  // The pastor is only a fallback for the contact name; a failed read is not fatal.
  const pastor = pastorResult.error ? null : pastorResult.data;
  const church = churchResult.data;

  return {
    organization: (church?.name as string | null) ?? "",
    contactName: profile.contactName || ((pastor?.full_name as string | null) ?? ""),
    email: profile.contactEmail || ((church?.email as string | null) ?? "") || ((pastor?.email as string | null) ?? ""),
    phone: profile.contactPhone || ((church?.phone as string | null) ?? "") || ((pastor?.phone as string | null) ?? ""),
  };
}
