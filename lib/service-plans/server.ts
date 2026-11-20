import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { UserFacingError } from "@/lib/errors/user-error";
import { keyBetween, keysBetween, REBALANCE_KEY_LENGTH } from "@/lib/service-plans/fractional-index";
import type { ServiceTypeTime } from "@/lib/service-plans/types";
import { shiftYmd, zonedDateTimeToUtcMs } from "@/lib/utils/dates";

/**
 * Write-side helpers for the Service Plans actions. Every function takes the
 * service-role client and the caller's church, and filters by that church on
 * every statement: the action has already checked who is asking, and these
 * make sure the write can only land in their church.
 */

export const NOT_FOUND = "We couldn't find that. It may have been deleted by someone else.";

export async function assertPlan(
  admin: SupabaseClient,
  churchId: string,
  planId: string,
): Promise<{ id: string; serviceTypeId: string; date: string | null; isTemplate: boolean }> {
  const { data, error } = await admin
    .from("plans")
    .select("id, service_type_id, plan_date, is_template")
    .eq("church_id", churchId)
    .eq("id", planId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new UserFacingError(NOT_FOUND);
  return {
    id: data.id as string,
    serviceTypeId: data.service_type_id as string,
    date: (data.plan_date as string | null) ?? null,
    isTemplate: data.is_template as boolean,
  };
}

export async function assertServiceType(
  admin: SupabaseClient,
  churchId: string,
  serviceTypeId: string,
): Promise<{ id: string; name: string }> {
  const { data, error } = await admin
    .from("service_types")
    .select("id, name")
    .eq("church_id", churchId)
    .eq("id", serviceTypeId)
    .is("archived_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new UserFacingError(NOT_FOUND);
  return { id: data.id as string, name: data.name as string };
}

export async function assertItem(
  admin: SupabaseClient,
  churchId: string,
  itemId: string,
  options: { includeDeleted?: boolean } = {},
): Promise<{ id: string; planId: string; position: string; itemType: string; deletedAt: string | null }> {
  const { data, error } = await admin
    .from("plan_items")
    .select("id, plan_id, position, item_type, deleted_at")
    .eq("church_id", churchId)
    .eq("id", itemId)
    .maybeSingle();
  if (error) throw error;
  if (!data || (!options.includeDeleted && data.deleted_at)) throw new UserFacingError(NOT_FOUND);
  return {
    id: data.id as string,
    planId: data.plan_id as string,
    position: data.position as string,
    itemType: data.item_type as string,
    deletedAt: (data.deleted_at as string | null) ?? null,
  };
}

/** Live positions of a plan, in order. */
export async function planPositions(
  admin: SupabaseClient,
  churchId: string,
  planId: string,
): Promise<{ id: string; position: string }[]> {
  const { data, error } = await admin
    .from("plan_items")
    .select("id, position")
    .eq("church_id", churchId)
    .eq("plan_id", planId)
    .is("deleted_at", null);
  if (error) throw error;
  return (data ?? [])
    .map((r) => ({ id: r.id as string, position: r.position as string }))
    .sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0));
}

/**
 * The key for an item placed after `afterId` (null = first). Computed from the
 * database's current order, not the browser's, so two planners never fight
 * over a stale list.
 */
export function keyAfter(
  positions: { id: string; position: string }[],
  afterId: string | null | undefined,
  excludeId?: string,
): string {
  const list = excludeId ? positions.filter((p) => p.id !== excludeId) : positions;
  if (afterId === undefined) {
    return keyBetween(list.at(-1)?.position ?? null, null);
  }
  if (afterId === null) return keyBetween(null, list[0]?.position ?? null);
  const index = list.findIndex((p) => p.id === afterId);
  if (index === -1) return keyBetween(list.at(-1)?.position ?? null, null);
  return keyBetween(list[index].position, list[index + 1]?.position ?? null);
}

/**
 * Spreads keys evenly again once one grows long. Rare: it takes dozens of
 * moves into the same gap. Writes every row, which is fine at plan sizes.
 */
export async function rebalanceIfNeeded(
  admin: SupabaseClient,
  churchId: string,
  planId: string,
  latestKey: string,
): Promise<void> {
  if (latestKey.length <= REBALANCE_KEY_LENGTH) return;
  const positions = await planPositions(admin, churchId, planId);
  const keys = keysBetween(null, null, positions.length);
  // Two passes through temporary keys so the unique (plan, position) index
  // never sees a collision mid-way.
  for (const [i, row] of positions.entries()) {
    const { error } = await admin
      .from("plan_items")
      .update({ position: `z${"z".repeat(10)}${keys[i]}` })
      .eq("church_id", churchId)
      .eq("id", row.id);
    if (error) throw error;
  }
  for (const [i, row] of positions.entries()) {
    const { error } = await admin
      .from("plan_items")
      .update({ position: keys[i] })
      .eq("church_id", churchId)
      .eq("id", row.id);
    if (error) throw error;
  }
}

export function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === "23505");
}

/**
 * A default time's date for a plan on `planDate`. Times on another weekday
 * land on the nearest such day around the service: a Saturday rehearsal for a
 * Sunday plan is the day before, a Wednesday time on a Wednesday plan is the
 * same day.
 */
export function dateForWeekday(planDate: string, planWeekday: number, weekday: number): string {
  let delta = (weekday - planWeekday + 7) % 7;
  if (delta > 3) delta -= 7;
  return shiftYmd(planDate, delta);
}

export function timesForPlan(
  planDate: string,
  planWeekday: number,
  defaults: ServiceTypeTime[],
  timeZone: string,
): { kind: string; label: string; starts_at: string }[] {
  return defaults.map((t) => ({
    kind: t.kind,
    label: t.label,
    starts_at: new Date(
      zonedDateTimeToUtcMs(dateForWeekday(planDate, planWeekday, t.weekday), t.localTime, timeZone),
    ).toISOString(),
  }));
}

export function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

export function requireText(value: unknown, max: number, what: string): string {
  const text = cleanText(value, max);
  if (!text) throw new UserFacingError(`Give the ${what} a name.`);
  return text;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assertId(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new UserFacingError(NOT_FOUND);
  return value;
}

export function optionalId(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  return assertId(value);
}
