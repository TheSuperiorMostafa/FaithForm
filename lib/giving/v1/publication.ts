import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import { isChurchFeatureEnabled } from "@/lib/features/access";

/**
 * Publishing a fund to Faithful, from the dashboard.
 *
 * The dashboard is where publication decisions are made, and this is the only
 * module that makes them. Faithful reads a projection; it never writes one.
 *
 * ## What is deliberately not here
 *
 * Money. Payouts, refunds, reconciliation, statements, fee reporting and donor
 * management all stay in the existing dashboard systems, untouched. This module
 * writes six columns on `giving_funds` and nothing else — no donation row, no
 * Stripe call, no total, and no goal.
 */

export const MOBILE_VISIBILITIES = ["none", "public", "followers", "members"] as const;
export type MobileVisibility = (typeof MOBILE_VISIBILITIES)[number];

/** The platform's own bounds. A church may narrow these; it may not widen them. */
export const PLATFORM_MIN_CENTS = 100;
export const PLATFORM_MAX_CENTS = 2_000_000;
export const MAX_SUGGESTED_AMOUNTS = 6;

/**
 * Whether a church can accept money at all.
 *
 * Four separate facts, reported separately so the dashboard can say which one is
 * missing — a church that has not finished onboarding needs a different sentence
 * from a church that switched giving off.
 */
export type StripeReadiness = {
  connected: boolean;
  chargesEnabled: boolean;
  detailsSubmitted: boolean;
  givingFeatureEnabled: boolean;
  /** The single answer publication is gated on. */
  canAcceptPayments: boolean;
};

export async function readStripeReadiness(
  churchId: string,
  supabase?: SupabaseClient,
): Promise<StripeReadiness> {
  const db = supabase ?? createAdminClient();

  const { data } = await db
    .from("churches")
    .select("stripe_account_id, stripe_charges_enabled, stripe_details_submitted")
    .eq("id", churchId)
    .maybeSingle();

  const connected = Boolean(data?.stripe_account_id);
  const chargesEnabled = data?.stripe_charges_enabled === true;
  const detailsSubmitted = data?.stripe_details_submitted === true;
  const givingFeatureEnabled = await isChurchFeatureEnabled(churchId, "giving");

  return {
    connected,
    chargesEnabled,
    detailsSubmitted,
    givingFeatureEnabled,
    canAcceptPayments: connected && chargesEnabled && givingFeatureEnabled,
  };
}

export type PublishableFund = {
  fundId: string;
  name: string;
  isActive: boolean;
  isDefault: boolean;
  visibility: MobileVisibility;
  title: string | null;
  description: string | null;
  suggestedAmounts: number[];
  minAmountCents: number;
  maxAmountCents: number;
  publishedAt: string | null;
  publicationVersion: number;
  /** What the visitor-facing card will actually say. */
  previewTitle: string;
  /** Whether a human is allowed to publish this one right now. */
  canPublish: boolean;
};

export async function listPublishableFunds(
  churchId: string,
  supabase?: SupabaseClient,
): Promise<{ readiness: StripeReadiness; funds: PublishableFund[] }> {
  const db = supabase ?? createAdminClient();
  const readiness = await readStripeReadiness(churchId, db);

  const { data } = await db
    .from("giving_funds")
    // One string, not a concatenation: the Supabase client parses this literal
    // to type the result, and a `+` defeats it into `GenericStringError`.
    .select("id, name, is_active, is_default, mobile_visibility, mobile_title, mobile_description, mobile_suggested_amounts, mobile_min_amount_cents, mobile_max_amount_cents, mobile_published_at, mobile_publication_version, sort_order")
    .eq("church_id", churchId)
    .order("sort_order", { ascending: true });

  const funds = ((data ?? []) as Record<string, unknown>[]).map((row) => {
    const title = (row.mobile_title as string | null) ?? null;
    return {
      fundId: row.id as string,
      name: row.name as string,
      isActive: row.is_active === true,
      isDefault: row.is_default === true,
      visibility: ((row.mobile_visibility as MobileVisibility) ?? "none"),
      title,
      description: (row.mobile_description as string | null) ?? null,
      suggestedAmounts: (row.mobile_suggested_amounts as number[] | null) ?? [],
      minAmountCents: Number(row.mobile_min_amount_cents ?? PLATFORM_MIN_CENTS),
      maxAmountCents: Number(row.mobile_max_amount_cents ?? PLATFORM_MAX_CENTS),
      publishedAt: (row.mobile_published_at as string | null) ?? null,
      publicationVersion: Number(row.mobile_publication_version ?? 1),
      previewTitle: title?.trim() ? title.trim() : (row.name as string),
      // **A church that cannot charge cannot publish.** Publishing would put a
      // Give button in front of a congregation that fails at the payment sheet,
      // which reads to a person as the church losing their money.
      canPublish: readiness.canAcceptPayments && row.is_active === true,
    };
  });

  return { readiness, funds };
}

export type FundPublicationInput = {
  visibility: MobileVisibility;
  title: string | null;
  description: string | null;
  suggestedAmounts: number[];
  minAmountCents: number;
  maxAmountCents: number;
};

export type PublicationResult =
  | { ok: true; visibility: MobileVisibility }
  | {
      ok: false;
      reason:
        | "not_found"
        | "not_accepting_payments"
        | "fund_inactive"
        | "invalid_amounts"
        | "unavailable";
    };

/**
 * Normalises the amount fields a church typed.
 *
 * Every bound is clamped to the platform's own, ascending order is enforced, and
 * suggestions outside the fund's own range are dropped rather than saved — a
 * suggested amount a visitor cannot actually give is a broken button.
 */
export function normaliseAmounts(input: {
  suggestedAmounts: number[];
  minAmountCents: number;
  maxAmountCents: number;
}): { ok: true; value: Pick<FundPublicationInput, "suggestedAmounts" | "minAmountCents" | "maxAmountCents"> } | { ok: false } {
  const min = Math.trunc(input.minAmountCents);
  const max = Math.trunc(input.maxAmountCents);

  if (!Number.isFinite(min) || !Number.isFinite(max)) return { ok: false };
  if (min < PLATFORM_MIN_CENTS || max > PLATFORM_MAX_CENTS) return { ok: false };
  if (max < min) return { ok: false };

  const suggested = Array.from(
    new Set(
      input.suggestedAmounts
        .map((amount) => Math.trunc(amount))
        .filter((amount) => Number.isInteger(amount) && amount >= min && amount <= max),
    ),
  )
    .sort((a, b) => a - b)
    .slice(0, MAX_SUGGESTED_AMOUNTS);

  return { ok: true, value: { suggestedAmounts: suggested, minAmountCents: min, maxAmountCents: max } };
}

/**
 * Publishes a fund to Faithful, or changes how it is published.
 *
 * The readiness check is re-read here rather than taken from the page that
 * rendered the button: a Stripe capability can be withdrawn between a page load
 * and a click, and the click is the moment that matters.
 */
export async function publishFundToFaithful(
  input: { churchId: string; fundId: string } & FundPublicationInput,
  supabase?: SupabaseClient,
): Promise<PublicationResult> {
  const db = supabase ?? createAdminClient();

  const { data: fund } = await db
    .from("giving_funds")
    .select("id, is_active, mobile_visibility")
    .eq("id", input.fundId)
    // Tenant predicate on the read, not applied afterwards.
    .eq("church_id", input.churchId)
    .maybeSingle();

  if (!fund) return { ok: false, reason: "not_found" };

  if (input.visibility !== "none") {
    const readiness = await readStripeReadiness(input.churchId, db);
    if (!readiness.canAcceptPayments) {
      return { ok: false, reason: "not_accepting_payments" };
    }
    if (fund.is_active !== true) return { ok: false, reason: "fund_inactive" };
  }

  const amounts = normaliseAmounts(input);
  if (!amounts.ok) return { ok: false, reason: "invalid_amounts" };

  const now = new Date().toISOString();
  const { error } = await db
    .from("giving_funds")
    .update({
      mobile_visibility: input.visibility,
      mobile_title: input.title?.trim() ? input.title.trim().slice(0, 120) : null,
      mobile_description: input.description?.trim()
        ? input.description.trim().slice(0, 600)
        : null,
      mobile_suggested_amounts: amounts.value.suggestedAmounts,
      mobile_min_amount_cents: amounts.value.minAmountCents,
      mobile_max_amount_cents: amounts.value.maxAmountCents,
      mobile_published_at: input.visibility === "none" ? null : now,
      mobile_unpublished_at: input.visibility === "none" ? now : null,
    })
    .eq("id", input.fundId)
    .eq("church_id", input.churchId);

  if (error) return { ok: false, reason: "unavailable" };
  return { ok: true, visibility: input.visibility };
}
