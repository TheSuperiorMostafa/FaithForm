"use server";

import { revalidatePath } from "next/cache";

import { getChurchAuth, type ChurchAuth } from "@/lib/auth/church";
import { toUserError } from "@/lib/errors/user-error";
import { featureActionError } from "@/lib/features/guard";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Renaming and deleting a family.
 *
 * Guarded exactly like the household actions in `checkin/actions.ts`: signed
 * in, the Check-In feature on, a church admin, and every row matched on the
 * caller's own church as well as its id. Ids arrive from a browser, so a
 * guessed id from another church matches nothing.
 */

export type HouseholdActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { data?: never } : { data: T }))
  | { ok: false; error: string };

type Context = { auth: ChurchAuth; admin: ReturnType<typeof createAdminClient> };

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

async function requireHouseholdAdmin(): Promise<Context | { ok: false; error: string }> {
  const auth = await getChurchAuth();
  if (!auth) return fail("You must be signed in.");

  const featureError = await featureActionError("checkin");
  if (featureError) return fail(featureError);

  if (!auth.isAdmin) return fail("Only church admins can change this.");

  return { auth, admin: createAdminClient() };
}

function isContext(value: Context | { ok: false }): value is Context {
  return !("ok" in value);
}

function revalidateFamilies(householdId?: string) {
  revalidatePath("/dashboard/people");
  revalidatePath("/dashboard/people/households");
  revalidatePath("/dashboard/checkin");
  if (householdId) revalidatePath(`/dashboard/people/households/${householdId}`);
}

export async function renameHousehold(input: {
  householdId: string;
  name: string;
}): Promise<HouseholdActionResult> {
  const context = await requireHouseholdAdmin();
  if (!isContext(context)) return context;

  const householdId = input.householdId?.trim() ?? "";
  const name = input.name?.trim() ?? "";
  if (!householdId) return fail("We couldn't find that family. Refresh the page and try again.");
  if (!name) return fail("Give the family a name.");
  if (name.length > 120) return fail("That name is too long. Use 120 characters or fewer.");

  // Only the name changes. The notes, codes and people stay as they are.
  const { data, error } = await context.admin
    .from("households")
    .update({ name, updated_at: new Date().toISOString() })
    .eq("id", householdId)
    .eq("church_id", context.auth.churchId)
    .select("id")
    .maybeSingle();

  if (error) return fail(toUserError(error, "We couldn't rename this family."));
  if (!data) return fail("We couldn't find that family. Refresh the page and try again.");

  revalidateFamilies(householdId);
  return { ok: true };
}

export type HouseholdDeletionCheck = {
  canDelete: boolean;
  /** Children checked in under this family, at any time. */
  checkinCount: number;
};

async function countCheckins(context: Context, householdId: string) {
  return context.admin
    .from("checkin_sessions")
    .select("id", { count: "exact", head: true })
    .eq("household_id", householdId)
    .eq("church_id", context.auth.churchId);
}

/**
 * Whether a family can be deleted. A family with check-in history is kept:
 * each Sunday's record says which family a child was released to, and that
 * record must still make sense after the fact.
 */
export async function checkHouseholdDeletion(
  householdId: string,
): Promise<HouseholdActionResult<HouseholdDeletionCheck>> {
  const context = await requireHouseholdAdmin();
  if (!isContext(context)) return context;

  const { data: household, error: householdError } = await context.admin
    .from("households")
    .select("id")
    .eq("id", householdId)
    .eq("church_id", context.auth.churchId)
    .maybeSingle();

  if (householdError) return fail(toUserError(householdError, "We couldn't check this family."));
  if (!household) return fail("We couldn't find that family. Refresh the page and try again.");

  const { count, error } = await countCheckins(context, householdId);
  if (error) return fail(toUserError(error, "We couldn't check this family's history."));

  const checkinCount = count ?? 0;
  return { ok: true, data: { canDelete: checkinCount === 0, checkinCount } };
}

/**
 * Deletes a family with no check-in history. The people in it stay in People;
 * only the family, its pickup permissions and its codes go.
 */
export async function deleteHousehold(input: {
  householdId: string;
}): Promise<HouseholdActionResult> {
  const context = await requireHouseholdAdmin();
  if (!isContext(context)) return context;

  const householdId = input.householdId?.trim() ?? "";
  if (!householdId) return fail("We couldn't find that family. Refresh the page and try again.");

  const { data: household, error: householdError } = await context.admin
    .from("households")
    .select("id")
    .eq("id", householdId)
    .eq("church_id", context.auth.churchId)
    .maybeSingle();

  if (householdError) return fail(toUserError(householdError, "We couldn't delete this family."));
  if (!household) return fail("We couldn't find that family. Refresh the page and try again.");

  // Checked again here, not trusted from the earlier check: a child could have
  // been checked in between the page loading and the button being pressed.
  const { count, error: countError } = await countCheckins(context, householdId);
  if (countError) return fail(toUserError(countError, "We couldn't delete this family."));
  if ((count ?? 0) > 0) {
    return fail(
      "This family can't be deleted because children have been checked in with it. Their check-in history needs it. You can rename it or remove people from it instead.",
    );
  }

  const { error } = await context.admin
    .from("households")
    .delete()
    .eq("id", householdId)
    .eq("church_id", context.auth.churchId);

  if (error) return fail(toUserError(error, "We couldn't delete this family."));

  revalidateFamilies();
  return { ok: true };
}
