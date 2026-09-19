import type { SupabaseClient } from "@supabase/supabase-js";

import { getChurchAuth, type ChurchAuth } from "@/lib/auth/church";
import { VisitorError } from "@/lib/faithform/errors";
import { featureActionError } from "@/lib/features/guard";
import { isUuid } from "@/lib/groups/context";
import { GROUP_COLUMNS, type GroupRow } from "@/lib/groups/read-models";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Who is working in the dashboard, and in which church — re-derived for every
 * page and action from the signed-in session, never from anything a form
 * posts. Church staff who hold the Groups feature manage every group of their
 * own church; nothing here reaches another church, because every group is
 * loaded with the session's `church_id` as a predicate.
 *
 * Writes go through the service role after this check, because the tables
 * have no browser write path at all (0091 RLS). Church-wide messaging policy
 * is for church admins only.
 */

export type StaffContext = {
  auth: ChurchAuth;
  userId: string;
  churchId: string;
  church: { id: string; slug: string | null; name: string; timezone: string };
  isAdmin: boolean;
  admin: SupabaseClient;
};

export async function requireGroupsStaff(options: { adminOnly?: boolean } = {}): Promise<StaffContext> {
  const auth = await getChurchAuth();
  if (!auth?.churchId) throw new VisitorError("unauthenticated", "You must be signed in.");

  const featureError = await featureActionError("groups");
  if (featureError) throw new VisitorError("forbidden", featureError);
  if (options.adminOnly && !auth.isAdmin) {
    throw new VisitorError("forbidden", "Only church admins can change this.");
  }

  const admin = createAdminClient();
  const { data: church } = await admin
    .from("churches")
    .select("id, slug, name, timezone")
    .eq("id", auth.churchId)
    .maybeSingle();
  if (!church) throw new VisitorError("church_not_found", "Church not found.");

  return {
    auth,
    userId: auth.userId,
    churchId: auth.churchId,
    church: {
      id: church.id as string,
      slug: (church.slug as string | null) ?? null,
      name: (church.name as string | null) ?? "Your church",
      timezone: (church.timezone as string | null) ?? auth.churchTimezone ?? "America/New_York",
    },
    isAdmin: auth.isAdmin,
    admin,
  };
}

/** A group of the staff member's own church, or `group_not_found`. */
export async function loadStaffGroup(
  ctx: StaffContext,
  groupId: string,
  options: { includeDeleted?: boolean } = {},
): Promise<GroupRow> {
  if (!isUuid(groupId)) throw new VisitorError("group_not_found", "Group not found.");
  let query = ctx.admin.from("groups").select(GROUP_COLUMNS).eq("id", groupId).eq("church_id", ctx.churchId);
  if (!options.includeDeleted) query = query.neq("status", "deleted");
  const { data } = await query.maybeSingle();
  if (!data) throw new VisitorError("group_not_found", "Group not found.");
  return data as unknown as GroupRow;
}

export function staffActor(ctx: StaffContext) {
  return { type: "staff" as const, userId: ctx.userId };
}

export type StaffActionResult<T> = { ok: true; data: T } | { ok: false; error: string; field?: string };

/**
 * Runs a dashboard action and turns a domain refusal into the message the
 * form shows. Anything unexpected is logged by kind only and answered with a
 * generic retry message — never the database's own words.
 */
export async function runStaffAction<T>(
  label: string,
  operation: () => Promise<T>,
): Promise<{ ok: true; data: T } | { ok: false; error: string; field?: string }> {
  try {
    return { ok: true, data: await operation() };
  } catch (error) {
    if (error instanceof VisitorError) return { ok: false, error: error.message };
    if (error instanceof StaffFieldError) return { ok: false, error: error.message, field: error.field };
    console.error(`[groups] ${label} failed:`, error instanceof Error ? error.name : "unknown");
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

/** A validation problem tied to one form field. */
export class StaffFieldError extends Error {
  readonly field: string | undefined;
  constructor(message: string, field?: string) {
    super(message);
    this.name = "StaffFieldError";
    this.field = field;
  }
}
