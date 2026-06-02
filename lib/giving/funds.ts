import { createAdminClient } from "@/lib/supabase/admin";
import type { GivingFundRow } from "@/types/giving";

const DEFAULT_FUNDS = [
  { name: "General", slug: "general", sort_order: 0, is_default: true },
  { name: "Missions", slug: "missions", sort_order: 1, is_default: false },
  { name: "Building", slug: "building", sort_order: 2, is_default: false },
] as const;

function mapFund(row: Record<string, unknown>): GivingFundRow {
  return {
    id: row.id as string,
    churchId: row.church_id as string,
    name: row.name as string,
    slug: row.slug as string,
    sortOrder: row.sort_order as number,
    isDefault: row.is_default as boolean,
    isActive: row.is_active as boolean,
  };
}

export async function ensureDefaultFunds(churchId: string): Promise<void> {
  const admin = createAdminClient();
  const { count } = await admin
    .from("giving_funds")
    .select("id", { count: "exact", head: true })
    .eq("church_id", churchId);

  if ((count ?? 0) > 0) return;

  await admin.from("giving_funds").insert(
    DEFAULT_FUNDS.map((f) => ({
      church_id: churchId,
      name: f.name,
      slug: f.slug,
      sort_order: f.sort_order,
      is_default: f.is_default,
      is_active: true,
    })),
  );
}

export async function getActiveFundsForChurch(
  churchId: string,
): Promise<GivingFundRow[]> {
  await ensureDefaultFunds(churchId);
  const admin = createAdminClient();
  const { data } = await admin
    .from("giving_funds")
    .select("*")
    .eq("church_id", churchId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  return (data ?? []).map((r) => mapFund(r as Record<string, unknown>));
}

export async function getFundById(
  fundId: string,
  churchId: string,
): Promise<GivingFundRow | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("giving_funds")
    .select("*")
    .eq("id", fundId)
    .eq("church_id", churchId)
    .maybeSingle();

  return data ? mapFund(data as Record<string, unknown>) : null;
}

export async function getDefaultFund(
  churchId: string,
): Promise<GivingFundRow | null> {
  const funds = await getActiveFundsForChurch(churchId);
  return funds.find((f) => f.isDefault) ?? funds[0] ?? null;
}
