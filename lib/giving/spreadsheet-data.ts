import { createClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe/client";
import type { DepositSheetRow, DonorSheetRow, RecurringSheetRow } from "@/lib/giving/spreadsheet";
import { churchYear, sheetDate } from "@/lib/giving/spreadsheet";

/**
 * Reads the full lists behind the Giving spreadsheets. Every read is scoped
 * to the church and goes through the signed-in member's client, so row-level
 * security still applies. Lists are read page by page, never capped at the
 * database's default 1,000 rows.
 */

const PAGE_ROWS = 1000;
const MAX_PAGES = 200;
const MAX_DEPOSITS = 5000;

async function readAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let i = 0; i < MAX_PAGES; i += 1) {
    const from = i * PAGE_ROWS;
    const { data, error } = await page(from, from + PAGE_ROWS - 1);
    if (error) throw new Error(`giving spreadsheet read failed: ${error.message}`);
    const chunk = data ?? [];
    rows.push(...chunk);
    if (chunk.length < PAGE_ROWS) break;
  }
  return rows;
}

const LIVE_RECURRING = new Set(["active", "trialing", "past_due", "unpaid"]);

export async function loadDonorSheetRows(
  churchId: string,
  timeZone: string,
  now = new Date(),
): Promise<DonorSheetRow[]> {
  const supabase = createClient();
  const year = String(churchYear(now, timeZone));

  const [donors, donations, subscriptions] = await Promise.all([
    readAll<{ id: string; name: string | null; email: string | null }>((from, to) =>
      supabase
        .from("giving_donors")
        .select("id, name, email")
        .eq("church_id", churchId)
        .order("name", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    ),
    readAll<{ donor_id: string | null; amount_cents: number; created_at: string }>((from, to) =>
      supabase
        .from("giving_donations")
        .select("donor_id, amount_cents, created_at")
        .eq("church_id", churchId)
        .eq("status", "succeeded")
        .not("donor_id", "is", null)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    ),
    readAll<{ donor_id: string | null; amount_cents: number; interval: string | null; status: string | null; paused_at: string | null }>(
      (from, to) =>
        supabase
          .from("giving_subscriptions")
          .select("donor_id, amount_cents, interval, status, paused_at")
          .eq("church_id", churchId)
          .not("donor_id", "is", null)
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to),
    ),
  ]);

  const stats = new Map<
    string,
    { totalCents: number; yearCents: number; giftCount: number; firstGiftAt: string | null; lastGiftAt: string | null }
  >();
  for (const d of donations) {
    if (!d.donor_id) continue;
    const cur = stats.get(d.donor_id) ?? {
      totalCents: 0,
      yearCents: 0,
      giftCount: 0,
      firstGiftAt: null,
      lastGiftAt: null,
    };
    cur.totalCents += d.amount_cents;
    cur.giftCount += 1;
    if (sheetDate(d.created_at, timeZone).startsWith(year)) cur.yearCents += d.amount_cents;
    if (!cur.firstGiftAt || d.created_at < cur.firstGiftAt) cur.firstGiftAt = d.created_at;
    if (!cur.lastGiftAt || d.created_at > cur.lastGiftAt) cur.lastGiftAt = d.created_at;
    stats.set(d.donor_id, cur);
  }

  // What each donor gives on repeat right now (running gifts only, not paused
  // or cancelled). Several recurring gifts at the same frequency add up.
  const recurring = new Map<string, number>();
  for (const s of subscriptions) {
    if (!s.donor_id || s.paused_at || !LIVE_RECURRING.has(s.status ?? "")) continue;
    recurring.set(s.donor_id, (recurring.get(s.donor_id) ?? 0) + s.amount_cents);
  }

  return donors.map((d) => {
    const s = stats.get(d.id);
    return {
      name: d.name,
      email: d.email,
      totalCents: s?.totalCents ?? 0,
      yearCents: s?.yearCents ?? 0,
      giftCount: s?.giftCount ?? 0,
      firstGiftAt: s?.firstGiftAt ?? null,
      lastGiftAt: s?.lastGiftAt ?? null,
      recurringCents: recurring.get(d.id) ?? 0,
    };
  });
}

export async function loadRecurringSheetRows(churchId: string): Promise<RecurringSheetRow[]> {
  const supabase = createClient();
  const rows = await readAll<Record<string, unknown>>((from, to) =>
    supabase
      .from("giving_subscriptions")
      .select(
        "amount_cents, interval, status, donor_name, donor_email, fund_designation, paused_at, created_at, giving_funds ( name )",
      )
      .eq("church_id", churchId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to),
  );
  return rows.map((r) => {
    const fund = r.giving_funds as { name: string } | { name: string }[] | null;
    const fundName = Array.isArray(fund) ? (fund[0]?.name ?? null) : (fund?.name ?? null);
    return {
      donorName: (r.donor_name as string | null) ?? null,
      donorEmail: (r.donor_email as string | null) ?? null,
      amountCents: (r.amount_cents as number) ?? 0,
      interval: (r.interval as string | null) ?? null,
      status: (r.status as string | null) ?? null,
      pausedAt: (r.paused_at as string | null) ?? null,
      fundName,
      fundDesignation: (r.fund_designation as string | null) ?? null,
      createdAt: (r.created_at as string | null) ?? null,
    };
  });
}

/** Every deposit the payment partner has made to the church's bank, newest first. */
export async function loadDepositSheetRows(stripeAccountId: string): Promise<DepositSheetRow[]> {
  const stripe = getStripe();
  const payouts = await stripe.payouts
    .list({ limit: 100 }, { stripeAccount: stripeAccountId })
    .autoPagingToArray({ limit: MAX_DEPOSITS });
  return payouts.map((p) => ({
    amount: p.amount,
    currency: p.currency,
    status: p.status,
    arrival_date: p.arrival_date ?? null,
    created: p.created ?? null,
  }));
}
