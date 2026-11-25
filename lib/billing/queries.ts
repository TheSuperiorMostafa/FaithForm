import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  CHURCH_INVOICE_COLUMNS,
  DEFAULT_MONTHLY_RATE_CENTS,
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

export async function getChurchBillingProfile(
  client: SupabaseClient,
  churchId: string,
): Promise<ChurchBillingProfile & { saved: boolean }> {
  const { data, error } = await client
    .from("church_billing_profiles")
    .select("monthly_rate_cents, contact_name, contact_email, contact_phone")
    .eq("church_id", churchId)
    .maybeSingle();
  if (error) throw new Error(`billing profile: ${error.message}`);
  return {
    saved: Boolean(data),
    monthlyRateCents: (data?.monthly_rate_cents as number | undefined) ?? DEFAULT_MONTHLY_RATE_CENTS,
    contactName: (data?.contact_name as string | null) ?? "",
    contactEmail: (data?.contact_email as string | null) ?? "",
    contactPhone: (data?.contact_phone as string | null) ?? "",
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
