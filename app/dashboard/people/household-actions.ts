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

/** Every family in the church, for the People multiselect's "Add to the same family". */
export async function listFamiliesForPicker(): Promise<
  HouseholdActionResult<{ id: string; name: string }[]>
> {
  const context = await requireHouseholdAdmin();
  if (!isContext(context)) return context;

  const { data, error } = await context.admin
    .from("households")
    .select("id, name")
    .eq("church_id", context.auth.churchId)
    .order("name", { ascending: true })
    .limit(2000);

  if (error) return fail(toUserError(error, "We couldn't load your families."));
  return { ok: true, data: (data ?? []) as { id: string; name: string }[] };
}

const BULK_RELATIONSHIPS = ["guardian", "dependent", "other"] as const;
type BulkRelationship = (typeof BULK_RELATIONSHIPS)[number];

/**
 * People list multiselect: put everyone chosen into one family — an existing
 * one, or a new one made here. Someone already in another family is skipped
 * and reported, since a person belongs to one family at a time.
 */
export async function addPeopleToFamily(input: {
  memberIds: string[];
  householdId?: string;
  newFamilyName?: string;
  relationship: BulkRelationship;
}): Promise<
  HouseholdActionResult<{ householdId: string; added: number; alreadyInFamily: number }>
> {
  const context = await requireHouseholdAdmin();
  if (!isContext(context)) return context;

  const memberIds = [...new Set((input.memberIds ?? []).filter((id) => typeof id === "string" && id))].slice(0, 500);
  if (memberIds.length === 0) return fail("Choose at least one person.");
  if (!BULK_RELATIONSHIPS.includes(input.relationship)) {
    return fail("Pick how these people belong to the family.");
  }

  const churchId = context.auth.churchId;
  const { data: members, error: membersError } = await context.admin
    .from("members")
    .select("id")
    .eq("church_id", churchId)
    .in("id", memberIds);
  if (membersError) return fail(toUserError(membersError, "We couldn't find those people."));
  const validIds = (members ?? []).map((row) => row.id as string);
  if (validIds.length === 0) return fail("We couldn't find those people. Refresh the page and try again.");

  let householdId = input.householdId?.trim() ?? "";
  if (householdId) {
    const { data: household } = await context.admin
      .from("households")
      .select("id")
      .eq("id", householdId)
      .eq("church_id", churchId)
      .maybeSingle();
    if (!household) return fail("We couldn't find that family. Refresh the page and try again.");
  } else {
    const name = input.newFamilyName?.trim() ?? "";
    if (!name) return fail("Give the new family a name.");
    if (name.length > 120) return fail("That name is too long. Use 120 characters or fewer.");
    const { data: created, error: createError } = await context.admin
      .from("households")
      .insert({ church_id: churchId, name, created_by: context.auth.userId })
      .select("id")
      .single();
    if (createError || !created) return fail(toUserError(createError, "We couldn't create that family."));
    householdId = created.id as string;
  }

  const { data: existing } = await context.admin
    .from("household_members")
    .select("member_id, household_id")
    .eq("church_id", churchId)
    .in("member_id", validIds);
  const alreadyIn = new Set((existing ?? []).map((row) => row.member_id as string));
  const toAdd = validIds.filter((id) => !alreadyIn.has(id));
  const alreadyInFamily = (existing ?? []).filter((row) => row.household_id !== householdId).length;

  if (toAdd.length > 0) {
    const { error } = await context.admin.from("household_members").insert(
      toAdd.map((memberId) => ({
        church_id: churchId,
        household_id: householdId,
        member_id: memberId,
        relationship: input.relationship,
        created_by: context.auth.userId,
      })),
    );
    if (error) {
      return fail(
        error.code === "23505"
          ? "Someone you chose already belongs to a family. Remove them from it first."
          : toUserError(error, "We couldn't add these people to the family."),
      );
    }
  }

  revalidateFamilies(householdId);
  return { ok: true, data: { householdId, added: toAdd.length, alreadyInFamily } };
}
