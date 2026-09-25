import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { startOfWeek } from "@/lib/giving/periods";
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

/**
 * Supabase caps a single read (usually at 1,000 rows), so totals read every
 * page instead of silently summing the first thousand gifts.
 */
const PAGE_ROWS = 1000;
const MAX_PAGES = 200;

async function readAllRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let i = 0; i < MAX_PAGES; i += 1) {
    const from = i * PAGE_ROWS;
    const { data, error } = await page(from, from + PAGE_ROWS - 1);
    if (error) throw new Error(`giving read failed: ${error.message}`);
    const chunk = data ?? [];
    rows.push(...chunk);
    if (chunk.length < PAGE_ROWS) break;
  }
  return rows;
}

function startOfWeekIso(d: Date): string {
  return startOfWeek(d).toISOString();
}

export type GivingPeriodTotals = {
  weekCents: number;
  weekGifts: number;
  weekGivers: number;
  monthGifts: number;
  yearGifts: number;
};

export async function getGivingKpis(
  churchId: string,
): Promise<GivingKpis & GivingPeriodTotals> {
  const supabase = createClient();
  const now = new Date();
  const todayStart = startOfDayIso(now);
  const weekStart = startOfWeekIso(now);
  const monthStart = startOfMonthIso(now);
  const yearStart = startOfYearIso(now);
  // In the first days of January the week can start last year.
  const since = weekStart < yearStart ? weekStart : yearStart;

  const rows = await readAllRows<{
    amount_cents: number;
    donor_id: string | null;
    donor_email: string | null;
    created_at: string;
  }>((from, to) =>
    supabase
      .from("giving_donations")
      .select("amount_cents, donor_id, donor_email, created_at")
      .eq("church_id", churchId)
      .eq("status", "succeeded")
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .range(from, to),
  );

  const inRange = (iso: string) => rows.filter((r) => r.created_at >= iso);
  const sum = (list: typeof rows) => list.reduce((acc, r) => acc + (r.amount_cents ?? 0), 0);

  return {
    todayCents: sum(inRange(todayStart)),
    monthCents: sum(inRange(monthStart)),
    yearCents: sum(inRange(yearStart)),
    todayGivers: countUniqueGivers(rows, todayStart),
    monthGivers: countUniqueGivers(rows, monthStart),
    yearGivers: countUniqueGivers(rows, yearStart),
    weekCents: sum(inRange(weekStart)),
    weekGifts: inRange(weekStart).length,
    weekGivers: countUniqueGivers(rows, weekStart),
    monthGifts: inRange(monthStart).length,
    yearGifts: inRange(yearStart).length,
  };
}

export async function getGivingSummary(
  churchId: string,
): Promise<GivingSummary & GivingPeriodTotals> {
  const supabase = createClient();
  const [kpis, recentResult, failedResult] = await Promise.all([
    getGivingKpis(churchId),
    supabase
      .from("giving_donations")
      .select(DONATION_SELECT)
      .eq("church_id", churchId)
      .order("created_at", { ascending: false })
      .limit(6),
    supabase
      .from("giving_subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("church_id", churchId)
      .in("status", ["past_due", "unpaid"]),
  ]);

  if (recentResult.error) {
    throw new Error(`recent gifts failed: ${recentResult.error.message}`);
  }

  return {
    ...kpis,
    recentDonations: (recentResult.data ?? []).map((r) =>
      mapDonation(r as Record<string, unknown>),
    ),
    failedSubscriptionCount: failedResult.count ?? 0,
  };
}

function aggregateGivingByFund(
  rows: Record<string, unknown>[],
  since: string,
): FundGivingBreakdown[] {
  const map = new Map<string, FundGivingBreakdown>();

  for (const row of rows) {
    if ((row.created_at as string) < since) continue;
    const fundRaw = row.giving_funds as
      | { id: string; name: string }
      | { id: string; name: string }[]
      | null;
    const fund = Array.isArray(fundRaw) ? fundRaw[0] : fundRaw;
    const fundId = (row.fund_id as string) ?? fund?.id ?? "unknown";
    const existing = map.get(fundId) ?? {
      fundId,
      fundName: fund?.name ?? "Unassigned",
      totalCents: 0,
      giftCount: 0,
    };
    existing.totalCents += row.amount_cents as number;
    existing.giftCount += 1;
    map.set(fundId, existing);
  }

  return Array.from(map.values()).sort((a, b) => b.totalCents - a.totalCents);
}

/** Month and YTD share the same bounded donation set, so read it once. */
export async function getGivingByFundPeriods(churchId: string): Promise<{
  month: FundGivingBreakdown[];
  ytd: FundGivingBreakdown[];
}> {
  const supabase = createClient();
  const now = new Date();
  const monthStart = startOfMonthIso(now);
  const yearStart = startOfYearIso(now);
  const rows = await readAllRows<Record<string, unknown>>((from, to) =>
    supabase
      .from("giving_donations")
      .select("amount_cents, fund_id, created_at, giving_funds ( id, name )")
      .eq("church_id", churchId)
      .eq("status", "succeeded")
      .gte("created_at", yearStart)
      .order("created_at", { ascending: true })
      .range(from, to),
  );
  return {
    month: aggregateGivingByFund(rows, monthStart),
    ytd: aggregateGivingByFund(rows, yearStart),
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

  const [donors, donations] = await Promise.all([
    readAllRows<{ id: string; name: string | null; email: string }>((from, to) =>
      supabase
        .from("giving_donors")
        .select("id, name, email")
        .eq("church_id", churchId)
        .order("name", { ascending: true })
        .range(from, to),
    ),
    readAllRows<{ donor_id: string | null; amount_cents: number; created_at: string }>(
      (from, to) =>
        supabase
          .from("giving_donations")
          .select("donor_id, amount_cents, created_at")
          .eq("church_id", churchId)
          .eq("status", "succeeded")
          .order("created_at", { ascending: true })
          .range(from, to),
    ),
  ]);

  const stats = new Map<
    string,
    { ytdCents: number; giftCount: number; lastGiftAt: string | null }
  >();

  for (const d of donations) {
    const donorId = d.donor_id;
    if (!donorId) continue;
    const cur = stats.get(donorId) ?? {
      ytdCents: 0,
      giftCount: 0,
      lastGiftAt: null,
    };
    cur.giftCount += 1;
    const createdAt = d.created_at;
    if (createdAt >= yearStart) {
      cur.ytdCents += d.amount_cents;
    }
    if (!cur.lastGiftAt || createdAt > cur.lastGiftAt) {
      cur.lastGiftAt = createdAt;
    }
    stats.set(donorId, cur);
  }

  return donors.map((d) => {
    const s = stats.get(d.id);
    return {
      id: d.id,
      name: d.name ?? null,
      email: d.email,
      ytdCents: s?.ytdCents ?? 0,
      giftCount: s?.giftCount ?? 0,
      lastGiftAt: s?.lastGiftAt ?? null,
    };
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyGiftFilters<Q extends { eq: any; gte: any; lte: any; or: any }>(
  query: Q,
  filters: GiftsSearchFilters,
): Q {
  let q = query;
  if (filters.fundId) q = q.eq("fund_id", filters.fundId);
  if (filters.giftType) q = q.eq("gift_type", filters.giftType);
  if (filters.status) q = q.eq("status", filters.status);
  if (filters.dateFrom) q = q.gte("created_at", filters.dateFrom);
  if (filters.dateTo) q = q.lte("created_at", filters.dateTo);
  const term = searchTerm(filters.search);
  if (term) {
    q = q.or(`donor_name.ilike.${term},donor_email.ilike.${term}`);
  }
  return q;
}

/**
 * A search box value made safe for a PostgREST `or=(…)` filter: commas,
 * parentheses and wildcards would otherwise change the filter itself.
 */
function searchTerm(search: string | undefined): string | null {
  const cleaned = (search ?? "").trim().replace(/[,()%*\\]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned ? `%${cleaned}%` : null;
}

/**
 * The money behind a gifts search: what was received (succeeded gifts) and
 * the total of every matching gift, across all pages, not just the one shown.
 */
export async function sumGifts(
  churchId: string,
  filters: GiftsSearchFilters,
): Promise<{ receivedCents: number; totalCents: number }> {
  const supabase = createClient();
  const rows = await readAllRows<{ amount_cents: number; status: string }>((from, to) =>
    applyGiftFilters(
      supabase
        .from("giving_donations")
        .select("amount_cents, status")
        .eq("church_id", churchId),
      filters,
    )
      .order("created_at", { ascending: false })
      .range(from, to),
  );
  let receivedCents = 0;
  let totalCents = 0;
  for (const r of rows) {
    totalCents += r.amount_cents ?? 0;
    if (r.status === "succeeded") receivedCents += r.amount_cents ?? 0;
  }
  return { receivedCents, totalCents };
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

  const query = applyGiftFilters(
    supabase
      .from("giving_donations")
      .select(DONATION_SELECT, { count: "exact" })
      .eq("church_id", churchId),
    filters,
  ).order("created_at", { ascending: false });

  const { data, count, error } = await query.range(from, to);

  if (error) {
    console.error("searchGifts:", error.message);
    throw new Error("gifts search failed");
  }

  return {
    donations: (data ?? []).map((r) => mapDonation(r as Record<string, unknown>)),
    total: count ?? 0,
    page,
    pageSize,
  };
}

/** Every gift matching the filters, for the spreadsheet download. */
export async function searchAllGifts(
  churchId: string,
  filters: GiftsSearchFilters,
): Promise<GivingDonationRow[]> {
  const supabase = createClient();
  const rows = await readAllRows<Record<string, unknown>>((from, to) =>
    applyGiftFilters(
      supabase.from("giving_donations").select(DONATION_SELECT).eq("church_id", churchId),
      filters,
    )
      .order("created_at", { ascending: false })
      .range(from, to),
  );
  return rows.map((r) => mapDonation(r));
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
  const { data, error } = await supabase
    .from("giving_subscriptions")
    .select(
      `id, stripe_subscription_id, stripe_customer_id, amount_cents, currency, interval, status,
       donor_name, donor_email, donor_id, fund_id, fund_designation, paused_at, created_at,
       giving_funds ( name )`,
    )
    .eq("church_id", churchId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`recurring gifts read failed: ${error.message}`);
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
  const data = await readAllRows<{ amount_cents: number; created_at: string }>((from, to) =>
    supabase
      .from("giving_donations")
      .select("amount_cents, created_at")
      .eq("church_id", churchId)
      .eq("status", "succeeded")
      .order("created_at", { ascending: true })
      .range(from, to),
  );

  const monthlyMap = new Map<string, { total: number; count: number; year: number; month: number }>();
  const annualMap = new Map<string, { total: number; count: number; year: number }>();

  for (const row of data) {
    const d = new Date(row.created_at);
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

// ---------------------------------------------------------------------------
// One donor
// ---------------------------------------------------------------------------

export type GivingDonorDetail = {
  id: string;
  name: string | null;
  email: string;
  createdAt: string | null;
};

/** A donor of this church, or null. Scoped by church on the read itself. */
export async function getDonorById(
  churchId: string,
  donorId: string,
): Promise<GivingDonorDetail | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("giving_donors")
    .select("id, name, email, created_at")
    .eq("church_id", churchId)
    .eq("id", donorId)
    .maybeSingle();
  if (error) throw new Error(`donor read failed: ${error.message}`);
  if (!data) return null;
  return {
    id: data.id as string,
    name: (data.name as string | null) ?? null,
    email: data.email as string,
    createdAt: (data.created_at as string | null) ?? null,
  };
}

/** Every gift from one donor, newest first, in any state. */
export async function getDonorGifts(
  churchId: string,
  donorId: string,
): Promise<GivingDonationRow[]> {
  const supabase = createClient();
  const rows = await readAllRows<Record<string, unknown>>((from, to) =>
    supabase
      .from("giving_donations")
      .select(DONATION_SELECT)
      .eq("church_id", churchId)
      .eq("donor_id", donorId)
      .order("created_at", { ascending: false })
      .range(from, to),
  );
  return rows.map((r) => mapDonation(r));
}

export async function getDonorSubscriptions(
  churchId: string,
  donorId: string,
): Promise<GivingSubscriptionRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("giving_subscriptions")
    .select(
      `id, stripe_subscription_id, stripe_customer_id, amount_cents, currency, interval, status,
       donor_name, donor_email, donor_id, fund_id, fund_designation, paused_at, created_at,
       giving_funds ( name )`,
    )
    .eq("church_id", churchId)
    .eq("donor_id", donorId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`donor recurring read failed: ${error.message}`);
  return (data ?? []).map((r) => mapSubscription(r as Record<string, unknown>));
}

// ---------------------------------------------------------------------------
// Year-end statements
// ---------------------------------------------------------------------------

export type StatementDonor = {
  id: string;
  name: string | null;
  email: string;
  totalCents: number;
  giftCount: number;
};

export type GiftWithoutStatement = {
  id: string;
  donorName: string | null;
  donorEmail: string | null;
  amountCents: number;
  currency: string;
  createdAt: string;
};

export type StatementPreview = {
  year: number;
  donors: StatementDonor[];
  totalCents: number;
  giftCount: number;
  /** Received gifts that can't go on anyone's statement: no donor email on file. */
  giftsWithoutDonor: GiftWithoutStatement[];
};

/**
 * Who gets a statement for `year`: every donor with at least one received
 * gift in that year. Uses the same year window as the statement PDF
 * (`getDonorGiftsForYear`) so the count matches what is sent.
 */
export async function getStatementPreview(
  churchId: string,
  year: number,
): Promise<StatementPreview> {
  const supabase = createClient();
  const yearStart = new Date(year, 0, 1).toISOString();
  const yearEnd = new Date(year + 1, 0, 1).toISOString();

  const [gifts, donors] = await Promise.all([
    readAllRows<{
      id: string;
      donor_id: string | null;
      donor_name: string | null;
      donor_email: string | null;
      amount_cents: number;
      currency: string;
      created_at: string;
    }>((from, to) =>
      supabase
        .from("giving_donations")
        .select("id, donor_id, donor_name, donor_email, amount_cents, currency, created_at")
        .eq("church_id", churchId)
        .eq("status", "succeeded")
        .gte("created_at", yearStart)
        .lt("created_at", yearEnd)
        .order("created_at", { ascending: true })
        .range(from, to),
    ),
    readAllRows<{ id: string; name: string | null; email: string }>((from, to) =>
      supabase
        .from("giving_donors")
        .select("id, name, email")
        .eq("church_id", churchId)
        .order("name", { ascending: true })
        .range(from, to),
    ),
  ]);

  const byDonor = new Map<string, { totalCents: number; giftCount: number }>();
  const giftsWithoutDonor: GiftWithoutStatement[] = [];
  let totalCents = 0;
  for (const g of gifts) {
    totalCents += g.amount_cents ?? 0;
    if (!g.donor_id) {
      giftsWithoutDonor.push({
        id: g.id,
        donorName: g.donor_name ?? null,
        donorEmail: g.donor_email ?? null,
        amountCents: g.amount_cents,
        currency: g.currency ?? "usd",
        createdAt: g.created_at,
      });
      continue;
    }
    const cur = byDonor.get(g.donor_id) ?? { totalCents: 0, giftCount: 0 };
    cur.totalCents += g.amount_cents ?? 0;
    cur.giftCount += 1;
    byDonor.set(g.donor_id, cur);
  }

  const statementDonors: StatementDonor[] = [];
  for (const d of donors) {
    const stats = byDonor.get(d.id);
    if (!stats) continue;
    statementDonors.push({
      id: d.id,
      name: d.name ?? null,
      email: d.email,
      totalCents: stats.totalCents,
      giftCount: stats.giftCount,
    });
  }

  return {
    year,
    donors: statementDonors,
    totalCents,
    giftCount: gifts.length,
    giftsWithoutDonor,
  };
}

/**
 * The church's own address from Church info, written as one line, to
 * pre-fill the statement address when none has been saved yet.
 */
export async function getChurchAddressLine(churchId: string): Promise<string> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("churches")
    .select("address, city, state, zip")
    .eq("id", churchId)
    .maybeSingle();
  if (error || !data) return "";
  return formatAddressLine({
    address: data.address as string | null,
    city: data.city as string | null,
    state: data.state as string | null,
    zip: data.zip as string | null,
  });
}

export function formatAddressLine(parts: {
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}): string {
  const street = parts.address?.trim() ?? "";
  const city = parts.city?.trim() ?? "";
  const stateZip = [parts.state?.trim(), parts.zip?.trim()].filter(Boolean).join(" ");
  return [street, city, stateZip].filter(Boolean).join(", ");
}
