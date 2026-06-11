import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getGivePageUrl } from "@/lib/stripe/config";
import type {
  ChurchGivingProfile,
  FundGivingBreakdown,
  GiftsSearchFilters,
  GiftsSearchResult,
  GivingDonationRow,
  GivingDonorRow,
  GivingFundRow,
  GivingKpis,
  GivingSubscriptionRow,
  GivingSummary,
  StatementPeriod,
  StripeOnboardingStatus,
} from "@/types/giving";

type ChurchStripeRow = {
  id: string;
  name: string;
  slug: string;
  stripe_account_id: string | null;
  stripe_charges_enabled: boolean;
  stripe_payouts_enabled: boolean;
  stripe_details_submitted: boolean;
  stripe_onboarding_status: StripeOnboardingStatus;
  stripe_requirements_due: string[] | null;
  giving_enabled_at: string | null;
  logo_url?: string | null;
  giving_primary_color?: string | null;
  giving_accent_color?: string | null;
  ein?: string | null;
  statement_address?: string | null;
};

const CHURCH_GIVING_SELECT_BASE =
  "id, name, slug, stripe_account_id, stripe_charges_enabled, stripe_payouts_enabled, stripe_details_submitted, stripe_onboarding_status, stripe_requirements_due, giving_enabled_at, logo_url, ein, statement_address";

const CHURCH_GIVING_SELECT = `${CHURCH_GIVING_SELECT_BASE}, giving_primary_color, giving_accent_color`;

const DONATION_SELECT = `
  id,
  amount_cents,
  intended_amount_cents,
  currency,
  status,
  gift_type,
  donor_name,
  donor_email,
  donor_id,
  fund_id,
  fund_designation,
  fee_covered,
  stripe_fee_cents,
  net_amount_cents,
  refund_reason,
  stripe_payment_intent_id,
  created_at,
  giving_funds ( name )
`;

function mapChurchProfile(row: ChurchStripeRow): ChurchGivingProfile {
  return {
    churchId: row.id,
    churchName: row.name,
    slug: row.slug,
    stripeAccountId: row.stripe_account_id,
    stripeChargesEnabled: row.stripe_charges_enabled,
    stripePayoutsEnabled: row.stripe_payouts_enabled,
    stripeDetailsSubmitted: row.stripe_details_submitted,
    stripeOnboardingStatus: row.stripe_onboarding_status,
    stripeRequirementsDue: Array.isArray(row.stripe_requirements_due)
      ? row.stripe_requirements_due
      : [],
    givingEnabledAt: row.giving_enabled_at,
    givePageUrl: getGivePageUrl(row.slug),
    logoUrl: row.logo_url ?? null,
    givingPrimaryColor: row.giving_primary_color ?? null,
    givingAccentColor: row.giving_accent_color ?? null,
    ein: row.ein ?? null,
    statementAddress: row.statement_address ?? null,
  };
}

function mapDonation(row: Record<string, unknown>): GivingDonationRow {
  const fund = row.giving_funds as { name: string } | { name: string }[] | null;
  const fundName = Array.isArray(fund)
    ? fund[0]?.name
    : fund?.name ?? null;

  return {
    id: row.id as string,
    amountCents: row.amount_cents as number,
    intendedAmountCents: (row.intended_amount_cents as number) ?? null,
    currency: row.currency as string,
    status: row.status as GivingDonationRow["status"],
    giftType: row.gift_type as GivingDonationRow["giftType"],
    donorName: (row.donor_name as string) ?? null,
    donorEmail: (row.donor_email as string) ?? null,
    donorId: (row.donor_id as string) ?? null,
    fundId: (row.fund_id as string) ?? null,
    fundName,
    fundDesignation: (row.fund_designation as string) ?? null,
    feeCovered: Boolean(row.fee_covered),
    stripeFeeCents: (row.stripe_fee_cents as number) ?? null,
    netAmountCents: (row.net_amount_cents as number) ?? null,
    refundReason: (row.refund_reason as string) ?? null,
    stripePaymentIntentId: (row.stripe_payment_intent_id as string) ?? null,
    createdAt: row.created_at as string,
  };
}

function mapSubscription(row: Record<string, unknown>): GivingSubscriptionRow {
  const fund = row.giving_funds as { name: string } | { name: string }[] | null;
  const fundName = Array.isArray(fund)
    ? fund[0]?.name
    : fund?.name ?? null;

  return {
    id: row.id as string,
    stripeSubscriptionId: row.stripe_subscription_id as string,
    stripeCustomerId: row.stripe_customer_id as string,
    amountCents: row.amount_cents as number,
    currency: row.currency as string,
    interval: row.interval as string,
    status: row.status as GivingSubscriptionRow["status"],
    donorName: (row.donor_name as string) ?? null,
    donorEmail: (row.donor_email as string) ?? null,
    donorId: (row.donor_id as string) ?? null,
    fundId: (row.fund_id as string) ?? null,
    fundName,
    fundDesignation: (row.fund_designation as string) ?? null,
    pausedAt: (row.paused_at as string) ?? null,
    createdAt: row.created_at as string,
  };
}

function startOfDayIso(d: Date): string {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.toISOString();
}

function startOfMonthIso(d: Date): string {
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
}

function startOfYearIso(d: Date): string {
  return new Date(d.getFullYear(), 0, 1).toISOString();
}

function giverKey(row: {
  donor_id?: string | null;
  donor_email?: string | null;
}): string | null {
  if (row.donor_id) return `id:${row.donor_id}`;
  if (row.donor_email) return `email:${row.donor_email.trim().toLowerCase()}`;
  return null;
}

function countUniqueGivers(
  rows: { donor_id?: string | null; donor_email?: string | null; created_at: string }[],
  sinceIso: string,
): number {
  const keys = new Set<string>();
  for (const r of rows) {
    if (r.created_at < sinceIso) continue;
    const key = giverKey(r);
    if (key) keys.add(key);
  }
  return keys.size;
}

async function fetchChurchGivingRow(
  supabase: ReturnType<typeof createClient>,
  churchId: string,
  select: string,
) {
  return supabase.from("churches").select(select).eq("id", churchId).maybeSingle();
}

export async function getChurchGivingProfile(
  churchId: string,
): Promise<ChurchGivingProfile | null> {
  const supabase = createClient();
  const { data, error } = await fetchChurchGivingRow(
    supabase,
    churchId,
    CHURCH_GIVING_SELECT,
  );

  if (!error && data) {
    return mapChurchProfile(data as unknown as ChurchStripeRow);
  }

  if (error) {
    console.error("getChurchGivingProfile:", error.message);
  }

  const fallback = await fetchChurchGivingRow(
    supabase,
    churchId,
    CHURCH_GIVING_SELECT_BASE,
  );

  if (fallback.error) {
    console.error("getChurchGivingProfile fallback:", fallback.error.message);
    return null;
  }

  if (!fallback.data) return null;
  return mapChurchProfile(fallback.data as unknown as ChurchStripeRow);
}

export async function getChurchBySlug(slug: string): Promise<ChurchGivingProfile | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("churches")
    .select(CHURCH_GIVING_SELECT)
    .eq("slug", slug)
    .maybeSingle();

  if (!error && data) {
    return mapChurchProfile(data as unknown as ChurchStripeRow);
  }

  if (error) {
    console.error("getChurchBySlug:", error.message);
  }

  const fallback = await supabase
    .from("churches")
    .select(CHURCH_GIVING_SELECT_BASE)
    .eq("slug", slug)
    .maybeSingle();

  if (fallback.error || !fallback.data) return null;
  return mapChurchProfile(fallback.data as unknown as ChurchStripeRow);
}

export async function getGivingFunds(churchId: string): Promise<GivingFundRow[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("giving_funds")
    .select("id, church_id, name, slug, sort_order, is_default, is_active")
    .eq("church_id", churchId)
    .order("sort_order", { ascending: true });

  return (data ?? []).map((r) => ({
    id: r.id as string,
    churchId: r.church_id as string,
    name: r.name as string,
    slug: r.slug as string,
    sortOrder: r.sort_order as number,
    isDefault: r.is_default as boolean,
    isActive: r.is_active as boolean,
  }));
}

export async function getGivingKpis(churchId: string): Promise<GivingKpis> {
  const supabase = createClient();
  const now = new Date();
  const todayStart = startOfDayIso(now);
  const monthStart = startOfMonthIso(now);
  const yearStart = startOfYearIso(now);

  const { data: donations } = await supabase
    .from("giving_donations")
    .select("amount_cents, donor_id, donor_email, created_at")
    .eq("church_id", churchId)
    .eq("status", "succeeded");

  const rows = donations ?? [];
  const sumSince = (iso: string) =>
    rows
      .filter((r) => (r.created_at as string) >= iso)
      .reduce((acc, r) => acc + (r.amount_cents as number), 0);

  return {
    todayCents: sumSince(todayStart),
    monthCents: sumSince(monthStart),
    yearCents: sumSince(yearStart),
    todayGivers: countUniqueGivers(
      rows as { donor_id: string | null; donor_email: string | null; created_at: string }[],
      todayStart,
    ),
    monthGivers: countUniqueGivers(
      rows as { donor_id: string | null; donor_email: string | null; created_at: string }[],
      monthStart,
    ),
    yearGivers: countUniqueGivers(
      rows as { donor_id: string | null; donor_email: string | null; created_at: string }[],
      yearStart,
    ),
  };
}

export async function getGivingSummary(churchId: string): Promise<GivingSummary> {
  const supabase = createClient();
  const kpis = await getGivingKpis(churchId);

  const { data: recent } = await supabase
    .from("giving_donations")
    .select(DONATION_SELECT)
    .eq("church_id", churchId)
    .order("created_at", { ascending: false })
    .limit(10);

  const { count: failedCount } = await supabase
    .from("giving_subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("church_id", churchId)
    .in("status", ["past_due", "unpaid"]);

  return {
    ...kpis,
    recentDonations: (recent ?? []).map((r) =>
      mapDonation(r as Record<string, unknown>),
    ),
    failedSubscriptionCount: failedCount ?? 0,
  };
}

export async function getGivingByFund(
  churchId: string,
  period: "month" | "ytd",
): Promise<FundGivingBreakdown[]> {
  const supabase = createClient();
  const now = new Date();
  const since =
    period === "month" ? startOfMonthIso(now) : startOfYearIso(now);

  const { data } = await supabase
    .from("giving_donations")
    .select("amount_cents, fund_id, giving_funds ( id, name )")
    .eq("church_id", churchId)
    .eq("status", "succeeded")
    .gte("created_at", since);

  const map = new Map<string, FundGivingBreakdown>();

  for (const row of data ?? []) {
    const fundRaw = row.giving_funds as
      | { id: string; name: string }
      | { id: string; name: string }[]
      | null;
    const fund = Array.isArray(fundRaw) ? fundRaw[0] : fundRaw;
    const fundId = (row.fund_id as string) ?? fund?.id ?? "unknown";
    const fundName = fund?.name ?? "Unassigned";
    const existing = map.get(fundId) ?? {
      fundId,
      fundName,
      totalCents: 0,
      giftCount: 0,
    };
    existing.totalCents += row.amount_cents as number;
    existing.giftCount += 1;
    map.set(fundId, existing);
  }

  return Array.from(map.values()).sort((a, b) => b.totalCents - a.totalCents);
}

export async function getDonorsList(churchId: string): Promise<GivingDonorRow[]> {
  const supabase = createClient();
  const yearStart = startOfYearIso(new Date());

  const { data: donors } = await supabase
    .from("giving_donors")
    .select("id, name, email")
    .eq("church_id", churchId)
    .order("name", { ascending: true });

  const { data: donations } = await supabase
    .from("giving_donations")
    .select("donor_id, amount_cents, created_at, status")
    .eq("church_id", churchId)
    .eq("status", "succeeded");

  const stats = new Map<
    string,
    { ytdCents: number; giftCount: number; lastGiftAt: string | null }
  >();

  for (const d of donations ?? []) {
    const donorId = d.donor_id as string | null;
    if (!donorId) continue;
    const cur = stats.get(donorId) ?? {
      ytdCents: 0,
      giftCount: 0,
      lastGiftAt: null,
    };
    cur.giftCount += 1;
    const createdAt = d.created_at as string;
    if (createdAt >= yearStart) {
      cur.ytdCents += d.amount_cents as number;
    }
    if (!cur.lastGiftAt || createdAt > cur.lastGiftAt) {
      cur.lastGiftAt = createdAt;
    }
    stats.set(donorId, cur);
  }

  return (donors ?? []).map((d) => {
    const s = stats.get(d.id as string);
    return {
      id: d.id as string,
      name: (d.name as string) ?? null,
      email: d.email as string,
      ytdCents: s?.ytdCents ?? 0,
      giftCount: s?.giftCount ?? 0,
      lastGiftAt: s?.lastGiftAt ?? null,
    };
  });
}

export async function searchGifts(
  churchId: string,
  filters: GiftsSearchFilters,
  page = 1,
  pageSize = 25,
): Promise<GiftsSearchResult> {
  const supabase = createClient();
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from("giving_donations")
    .select(DONATION_SELECT, { count: "exact" })
    .eq("church_id", churchId)
    .order("created_at", { ascending: false });

  if (filters.fundId) query = query.eq("fund_id", filters.fundId);
  if (filters.giftType) query = query.eq("gift_type", filters.giftType);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.dateFrom) query = query.gte("created_at", filters.dateFrom);
  if (filters.dateTo) query = query.lte("created_at", filters.dateTo);

  if (filters.search?.trim()) {
    const term = `%${filters.search.trim()}%`;
    query = query.or(
      `donor_name.ilike.${term},donor_email.ilike.${term}`,
    );
  }

  const { data, count, error } = await query.range(from, to);

  if (error) {
    console.error("searchGifts:", error.message);
    return { donations: [], total: 0, page, pageSize };
  }

  return {
    donations: (data ?? []).map((r) => mapDonation(r as Record<string, unknown>)),
    total: count ?? 0,
    page,
    pageSize,
  };
}

export async function getDonationById(
  churchId: string,
  donationId: string,
): Promise<(GivingDonationRow & { stripeAccountId: string | null }) | null> {
  const admin = createAdminClient();
  const { data: church } = await admin
    .from("churches")
    .select("stripe_account_id")
    .eq("id", churchId)
    .maybeSingle();

  const { data } = await admin
    .from("giving_donations")
    .select(DONATION_SELECT)
    .eq("church_id", churchId)
    .eq("id", donationId)
    .maybeSingle();

  if (!data) return null;
  return {
    ...mapDonation(data as Record<string, unknown>),
    stripeAccountId: (church?.stripe_account_id as string) ?? null,
  };
}

export async function getGivingSubscriptions(
  churchId: string,
): Promise<GivingSubscriptionRow[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("giving_subscriptions")
    .select(
      `id, stripe_subscription_id, stripe_customer_id, amount_cents, currency, interval, status,
       donor_name, donor_email, donor_id, fund_id, fund_designation, paused_at, created_at,
       giving_funds ( name )`,
    )
    .eq("church_id", churchId)
    .order("created_at", { ascending: false });

  return (data ?? []).map((r) => mapSubscription(r as Record<string, unknown>));
}

export async function getFailedSubscriptions(
  churchId: string,
): Promise<GivingSubscriptionRow[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("giving_subscriptions")
    .select(
      `id, stripe_subscription_id, stripe_customer_id, amount_cents, currency, interval, status,
       donor_name, donor_email, donor_id, fund_id, fund_designation, paused_at, created_at,
       giving_funds ( name )`,
    )
    .eq("church_id", churchId)
    .in("status", ["past_due", "unpaid"])
    .order("updated_at", { ascending: false });

  return (data ?? []).map((r) => mapSubscription(r as Record<string, unknown>));
}

export async function getSubscriptionById(
  churchId: string,
  subscriptionId: string,
): Promise<(GivingSubscriptionRow & { stripeAccountId: string | null }) | null> {
  const admin = createAdminClient();
  const { data: church } = await admin
    .from("churches")
    .select("stripe_account_id")
    .eq("id", churchId)
    .maybeSingle();

  const { data } = await admin
    .from("giving_subscriptions")
    .select(
      `id, stripe_subscription_id, stripe_customer_id, amount_cents, currency, interval, status,
       donor_name, donor_email, donor_id, fund_id, fund_designation, paused_at, created_at,
       giving_funds ( name )`,
    )
    .eq("church_id", churchId)
    .eq("id", subscriptionId)
    .maybeSingle();

  if (!data) return null;
  return {
    ...mapSubscription(data as Record<string, unknown>),
    stripeAccountId: (church?.stripe_account_id as string) ?? null,
  };
}

export async function getDonorGiftsForYear(
  churchId: string,
  donorId: string,
  year: number,
): Promise<GivingDonationRow[]> {
  const admin = createAdminClient();
  const yearStart = new Date(year, 0, 1).toISOString();
  const yearEnd = new Date(year + 1, 0, 1).toISOString();

  const { data } = await admin
    .from("giving_donations")
    .select(DONATION_SELECT)
    .eq("church_id", churchId)
    .eq("donor_id", donorId)
    .eq("status", "succeeded")
    .gte("created_at", yearStart)
    .lt("created_at", yearEnd)
    .order("created_at", { ascending: true });

  return (data ?? []).map((r) => mapDonation(r as Record<string, unknown>));
}

export async function getGivingStatements(churchId: string): Promise<{
  monthly: StatementPeriod[];
  annual: StatementPeriod[];
}> {
  const supabase = createClient();
  const { data } = await supabase
    .from("giving_donations")
    .select("amount_cents, created_at")
    .eq("church_id", churchId)
    .eq("status", "succeeded");

  const monthlyMap = new Map<string, { total: number; count: number; year: number; month: number }>();
  const annualMap = new Map<string, { total: number; count: number; year: number }>();

  for (const row of data ?? []) {
    const d = new Date(row.created_at as string);
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    const mKey = `${year}-${month}`;
    const aKey = `${year}`;

    const m = monthlyMap.get(mKey) ?? { total: 0, count: 0, year, month };
    m.total += row.amount_cents as number;
    m.count += 1;
    monthlyMap.set(mKey, m);

    const a = annualMap.get(aKey) ?? { total: 0, count: 0, year };
    a.total += row.amount_cents as number;
    a.count += 1;
    annualMap.set(aKey, a);
  }

  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];

  const monthly = Array.from(monthlyMap.values())
    .sort((a, b) => b.year - a.year || b.month - a.month)
    .map((m) => ({
      label: `${monthNames[m.month - 1]} ${m.year}`,
      year: m.year,
      month: m.month,
      totalCents: m.total,
      count: m.count,
    }));

  const annual = Array.from(annualMap.values())
    .sort((a, b) => b.year - a.year)
    .map((a) => ({
      label: `${a.year}`,
      year: a.year,
      month: null,
      totalCents: a.total,
      count: a.count,
    }));

  return { monthly, annual };
}

/** @deprecated Use searchGifts */
export async function getGivingDonations(
  churchId: string,
  limit = 50,
): Promise<GivingDonationRow[]> {
  const result = await searchGifts(churchId, {}, 1, limit);
  return result.donations;
}
