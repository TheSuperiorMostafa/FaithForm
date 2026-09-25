"use server";

import { revalidatePath } from "next/cache";

import { getChurchAuth, type ChurchAuth } from "@/lib/auth/church";
import {
  issueWeeklyCode,
  lookupWeeklyCode,
  mintPickupQr,
  rotateHouseholdCredentials,
  verifyPickupQr,
  weekExpiry,
} from "@/lib/checkin/household-credentials";
import {
  localDateInTimeZone,
  serviceWeekStart,
} from "@/lib/checkin/service-week";
import {
  parseNewFamily,
  undoCheckinCutoff,
  undoCheckinRefusal,
  UNDO_CHECKIN_MESSAGES,
  type NewFamilyInput,
} from "@/lib/checkin/desk";
import { toUserError } from "@/lib/errors/user-error";
import { featureActionError } from "@/lib/features/guard";
import { validateMemberInput } from "@/lib/people/validate-member";
import {
  findHouseholdsByPersonName,
  getHousehold,
  getHouseholdOpenSessions,
  locationUsage,
} from "@/lib/queries/checkin";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type {
  CheckinSessionRow,
  CheckoutMethod,
  HouseholdRelationship,
} from "@/types/checkin";

export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { data?: never } : { data: T }))
  | { ok: false; error: string };

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

type Context = { auth: ChurchAuth; admin: ReturnType<typeof createAdminClient> };

/**
 * Anyone the church has given Check-In to may work a station.
 *
 * Deliberately not admin-only. The people who run children's check-in on a
 * Sunday are volunteers, and a system that only a pastor can operate is one
 * that gets worked around with a paper list by 9:15.
 */
async function requireStation(): Promise<Context | { ok: false; error: string }> {
  const auth = await getChurchAuth();
  if (!auth) return fail("You must be signed in.");

  const featureError = await featureActionError("checkin");
  if (featureError) return fail(featureError);

  return { auth, admin: createAdminClient() };
}

/** Configuration, rooms, households, authorizations, is the admin's. */
async function requireAdmin(): Promise<Context | { ok: false; error: string }> {
  const context = await requireStation();
  if ("ok" in context) return context;
  if (!context.auth.isAdmin) {
    return fail("Only church admins can change this.");
  }
  return context;
}

function isContext(value: Context | { ok: false }): value is Context {
  return !("ok" in value);
}

function revalidateCheckin(householdId?: string) {
  revalidatePath("/dashboard/checkin");
  revalidatePath("/dashboard/checkin/locations");
  revalidatePath("/dashboard/checkin/stats");
  revalidatePath("/dashboard/people");
  revalidatePath("/dashboard/people/households");
  if (householdId) {
    revalidatePath(`/dashboard/people/households/${householdId}`);
  }
}

function text(formData: FormData, key: string): string {
  return formData.get(key)?.toString().trim() ?? "";
}

// ---------------------------------------------------------------------------
// LOCATIONS
// ---------------------------------------------------------------------------

export async function createLocation(formData: FormData): Promise<ActionResult> {
  const context = await requireAdmin();
  if (!isContext(context)) return context;

  const name = text(formData, "name");
  if (!name) return fail("Give the room a name.");

  const capacityRaw = text(formData, "capacity");
  const capacity = capacityRaw ? Number(capacityRaw) : null;
  if (capacity !== null && (!Number.isInteger(capacity) || capacity <= 0)) {
    return fail("\"Room for\" must be a whole number above zero, or left empty.");
  }

  const { error } = await context.admin.from("church_locations").insert({
    church_id: context.auth.churchId,
    name,
    description: text(formData, "description") || null,
    capacity,
    sort_order: Number(text(formData, "sortOrder") || "0") || 0,
    created_by: context.auth.userId,
  });

  if (error) {
    return fail(
      error.code === "23505"
        ? `There is already a room called “${name}”.`
        : toUserError(error, "We couldn't add that room."),
    );
  }

  revalidateCheckin();
  return { ok: true };
}

export async function updateLocation(formData: FormData): Promise<ActionResult> {
  const context = await requireAdmin();
  if (!isContext(context)) return context;

  const id = text(formData, "locationId");
  const name = text(formData, "name");
  if (!id || !name) return fail("Give the room a name.");

  const capacityRaw = text(formData, "capacity");
  const capacity = capacityRaw ? Number(capacityRaw) : null;
  if (capacity !== null && (!Number.isInteger(capacity) || capacity <= 0)) {
    return fail("\"Room for\" must be a whole number above zero, or left empty.");
  }

  const { error } = await context.admin
    .from("church_locations")
    .update({
      name,
      description: text(formData, "description") || null,
      capacity,
      sort_order: Number(text(formData, "sortOrder") || "0") || 0,
      is_active: formData.get("isActive") !== "false",
    })
    .eq("id", id)
    .eq("church_id", context.auth.churchId);

  if (error) {
    return fail(
      error.code === "23505"
        ? `There is already a room called “${name}”.`
        : toUserError(error, "We couldn't save that room."),
    );
  }

  revalidateCheckin();
  return { ok: true };
}

/**
 * "Sanctuary" is where an adult goes unless told otherwise. One per church,
 * enforced by a partial unique index, so the old default has to be cleared
 * before the new one is set, rather than both being true for an instant.
 */
export async function setDefaultAdultLocation(
  formData: FormData,
): Promise<ActionResult> {
  const context = await requireAdmin();
  if (!isContext(context)) return context;

  const id = text(formData, "locationId");
  if (!id) return fail("Pick a room.");

  await context.admin
    .from("church_locations")
    .update({ is_default_adult_location: false })
    .eq("church_id", context.auth.churchId)
    .eq("is_default_adult_location", true);

  const { error } = await context.admin
    .from("church_locations")
    .update({ is_default_adult_location: true })
    .eq("id", id)
    .eq("church_id", context.auth.churchId);

  if (error) return fail(toUserError(error, "We couldn't set that room for adults."));

  revalidateCheckin();
  return { ok: true };
}

/**
 * Put the rooms in the order the church walks them. Takes the full list of
 * room ids in their new order; every id is matched on this church as well, so
 * an id from elsewhere changes nothing.
 */
export async function reorderLocations(
  locationIds: string[],
): Promise<ActionResult> {
  const context = await requireAdmin();
  if (!isContext(context)) return context;

  const ids = Array.from(
    new Set((locationIds ?? []).filter((id) => typeof id === "string" && id)),
  );
  if (ids.length === 0 || ids.length > 200) return fail("Pick the rooms to move.");

  for (const [index, id] of ids.entries()) {
    const { error } = await context.admin
      .from("church_locations")
      .update({ sort_order: (index + 1) * 10 })
      .eq("id", id)
      .eq("church_id", context.auth.churchId);
    if (error) return fail(toUserError(error, "We couldn't change the order of your rooms."));
  }

  revalidateCheckin();
  return { ok: true };
}

export type LocationDeletionCheck = {
  canDelete: boolean;
  sessions: number;
  defaultFor: number;
  openNow: number;
};

/**
 * What deleting this room would take with it.
 *
 * Asked before the button is pressed, not after: the database refuses to
 * delete a room with history (`on delete restrict`), and a refusal a person
 * cannot act on is worse than a warning that offers them the thing they
 * actually wanted, which is to stop using the room without erasing last year.
 */
export async function checkLocationDeletion(
  locationId: string,
): Promise<ActionResult<LocationDeletionCheck>> {
  const context = await requireAdmin();
  if (!isContext(context)) return context;

  const usage = await locationUsage(
    context.auth.churchId,
    locationId,
    createClient(),
  );

  return {
    ok: true,
    data: { ...usage, canDelete: usage.sessions === 0 && usage.defaultFor === 0 },
  };
}

export async function deleteLocation(formData: FormData): Promise<ActionResult> {
  const context = await requireAdmin();
  if (!isContext(context)) return context;

  const id = text(formData, "locationId");
  if (!id) return fail("Pick a room.");

  const usage = await locationUsage(context.auth.churchId, id, createClient());

  if (usage.sessions > 0 || usage.defaultFor > 0) {
    return fail(
      `That room has ${usage.sessions} check-in${usage.sessions === 1 ? "" : "s"} on record and is the usual room for ${usage.defaultFor} ${usage.defaultFor === 1 ? "person" : "people"}. Close it instead: that keeps its history and stops new check-ins.`,
    );
  }

  const { error } = await context.admin
    .from("church_locations")
    .delete()
    .eq("id", id)
    .eq("church_id", context.auth.churchId);

  if (error) return fail(toUserError(error, "We couldn't delete that room."));

  revalidateCheckin();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// HOUSEHOLDS
// ---------------------------------------------------------------------------

export async function createHousehold(
  formData: FormData,
): Promise<ActionResult<{ householdId: string }>> {
  const context = await requireAdmin();
  if (!isContext(context)) return context;

  const name = text(formData, "name");
  if (!name) return fail("Give the family a name.");

  const { data, error } = await context.admin
    .from("households")
    .insert({
      church_id: context.auth.churchId,
      name,
      notes: text(formData, "notes") || null,
      created_by: context.auth.userId,
    })
    .select("id")
    .single();

  if (error || !data) return fail(toUserError(error, "We couldn't create that family."));

  revalidateCheckin();
  return { ok: true, data: { householdId: data.id as string } };
}

export async function updateHousehold(formData: FormData): Promise<ActionResult> {
  const context = await requireAdmin();
  if (!isContext(context)) return context;

  const id = text(formData, "householdId");
  const name = text(formData, "name");
  if (!id || !name) return fail("Give the family a name.");

  const { error } = await context.admin
    .from("households")
    .update({ name, notes: text(formData, "notes") || null })
    .eq("id", id)
    .eq("church_id", context.auth.churchId);

  if (error) return fail(toUserError(error, "We couldn't save that family."));

  revalidateCheckin(id);
  return { ok: true };
}

const RELATIONSHIPS: HouseholdRelationship[] = ["guardian", "dependent", "other"];

export async function addHouseholdMember(
  formData: FormData,
): Promise<ActionResult> {
  const context = await requireAdmin();
  if (!isContext(context)) return context;

  const householdId = text(formData, "householdId");
  const memberId = text(formData, "memberId");
  const relationship = text(formData, "relationship") as HouseholdRelationship;

  if (!householdId || !memberId) return fail("Pick a person to add.");
  if (!RELATIONSHIPS.includes(relationship)) {
    return fail("Pick how this person belongs to the family.");
  }

  // Both sides are re-checked against this church rather than trusted from the
  // form: the ids arrive from a browser, and a household in another church
  // would otherwise be writable by anyone who guessed its id.
  const [{ data: household }, { data: member }] = await Promise.all([
    context.admin
      .from("households")
      .select("id")
      .eq("id", householdId)
      .eq("church_id", context.auth.churchId)
      .maybeSingle(),
    context.admin
      .from("members")
      .select("id")
      .eq("id", memberId)
      .eq("church_id", context.auth.churchId)
      .maybeSingle(),
  ]);

  if (!household || !member) return fail("That person could not be found.");

  const { error } = await context.admin.from("household_members").insert({
    church_id: context.auth.churchId,
    household_id: householdId,
    member_id: memberId,
    relationship,
    relationship_label: text(formData, "relationshipLabel") || null,
    created_by: context.auth.userId,
  });

  if (error) {
    return fail(
      error.code === "23505"
        ? "That person already belongs to a family. Remove them from it first."
        : toUserError(error, "We couldn't add that person."),
    );
  }

  revalidateCheckin(householdId);
  return { ok: true };
}

export async function updateHouseholdMember(
  formData: FormData,
): Promise<ActionResult> {
  const context = await requireAdmin();
  if (!isContext(context)) return context;

  const id = text(formData, "membershipId");
  const householdId = text(formData, "householdId");
  const relationship = text(formData, "relationship") as HouseholdRelationship;

  if (!id || !RELATIONSHIPS.includes(relationship)) {
    return fail("Pick how this person belongs to the family.");
  }

  const makePrimary = formData.get("isPrimaryContact") === "true";

  if (makePrimary) {
    await context.admin
      .from("household_members")
      .update({ is_primary_contact: false })
      .eq("household_id", householdId)
      .eq("is_primary_contact", true);
  }

  const { error } = await context.admin
    .from("household_members")
    .update({
      relationship,
      relationship_label: text(formData, "relationshipLabel") || null,
      is_primary_contact: makePrimary,
    })
    .eq("id", id)
    .eq("church_id", context.auth.churchId);

  if (error) return fail(toUserError(error, "We couldn't save that change."));

  revalidateCheckin(householdId);
  return { ok: true };
}

export async function removeHouseholdMember(
  formData: FormData,
): Promise<ActionResult> {
  const context = await requireAdmin();
  if (!isContext(context)) return context;

  const id = text(formData, "membershipId");
  const householdId = text(formData, "householdId");
  if (!id) return fail("Pick someone to remove.");

  const { error } = await context.admin
    .from("household_members")
    .delete()
    .eq("id", id)
    .eq("church_id", context.auth.churchId);

  if (error) return fail(toUserError(error, "We couldn't remove that person."));

  revalidateCheckin(householdId);
  return { ok: true };
}

export async function addPickupAuthorization(
  formData: FormData,
): Promise<ActionResult> {
  const context = await requireAdmin();
  if (!isContext(context)) return context;

  const householdId = text(formData, "householdId");
  const memberId = text(formData, "memberId");
  if (!householdId || !memberId) return fail("Pick a person who may pick up.");

  const { data: member } = await context.admin
    .from("members")
    .select("id")
    .eq("id", memberId)
    .eq("church_id", context.auth.churchId)
    .maybeSingle();

  if (!member) return fail("That person could not be found.");

  const { error } = await context.admin
    .from("household_pickup_authorizations")
    .insert({
      church_id: context.auth.churchId,
      household_id: householdId,
      member_id: memberId,
      relationship_label: text(formData, "relationshipLabel") || null,
      authorized_by: context.auth.userId,
    });

  if (error) {
    return fail(
      error.code === "23505"
        ? "That person can already pick up this family's children."
        : toUserError(error, "We couldn't add that person to the pickup list."),
    );
  }

  revalidateCheckin(householdId);
  return { ok: true };
}

export async function revokePickupAuthorization(
  formData: FormData,
): Promise<ActionResult> {
  const context = await requireAdmin();
  if (!isContext(context)) return context;

  const id = text(formData, "authorizationId");
  const householdId = text(formData, "householdId");
  if (!id) return fail("Pick who to take off the pickup list.");

  const { error } = await context.admin
    .from("household_pickup_authorizations")
    .update({
      is_active: false,
      revoked_at: new Date().toISOString(),
      revoked_by: context.auth.userId,
      revoke_reason: text(formData, "reason") || null,
    })
    .eq("id", id)
    .eq("church_id", context.auth.churchId);

  if (error) return fail(toUserError(error, "We couldn't take that person off the pickup list."));

  revalidateCheckin(householdId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// PERSON DETAILS
// ---------------------------------------------------------------------------

export async function updateMemberCareDetails(
  formData: FormData,
): Promise<ActionResult> {
  const context = await requireAdmin();
  if (!isContext(context)) return context;

  const memberId = text(formData, "memberId");
  if (!memberId) return fail("Pick a person.");

  const defaultLocationId = text(formData, "defaultLocationId");

  const { error } = await context.admin
    .from("members")
    .update({
      medical_notes: text(formData, "medicalNotes") || null,
      default_location_id: defaultLocationId || null,
    })
    .eq("id", memberId)
    .eq("church_id", context.auth.churchId);

  if (error) return fail(toUserError(error, "We couldn't save those details."));

  revalidateCheckin();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// CHECK-IN
// ---------------------------------------------------------------------------

type CheckInOneResult =
  | { ok: true; sessionId: string; householdId: string | null }
  | { ok: false; error: string };

/**
 * Receive one child into a room. The single rule every check-in path goes
 * through: the desk's one-child form, the family card, "Mark arrived" and the
 * new-family form all land here.
 *
 * Re-checks the person and the room against this church, then lets the partial
 * unique index settle the race: two volunteers checking the same child in from
 * two iPads produce one row, and the second gets told so rather than silently
 * creating a duplicate the roster would then show twice.
 */
async function checkInOne(
  context: Context,
  input: { memberId: string; locationId: string; method?: string },
): Promise<CheckInOneResult> {
  const { memberId, locationId } = input;
  if (!memberId || !locationId) return fail("Pick a child and a room.");

  const [{ data: member }, { data: location }] = await Promise.all([
    context.admin
      .from("members")
      .select("id")
      .eq("id", memberId)
      .eq("church_id", context.auth.churchId)
      .maybeSingle(),
    context.admin
      .from("church_locations")
      .select("id, is_active")
      .eq("id", locationId)
      .eq("church_id", context.auth.churchId)
      .maybeSingle(),
  ]);

  if (!member) return fail("We couldn't find that child. Refresh the page and try again.");
  if (!location) return fail("We couldn't find that room. Refresh the page and try again.");
  if (location.is_active === false) return fail("That room is closed. Choose another room.");

  const { data: membership } = await context.admin
    .from("household_members")
    .select("household_id, relationship")
    .eq("member_id", memberId)
    .eq("church_id", context.auth.churchId)
    .maybeSingle();

  if (!membership || membership.relationship !== "dependent") {
    return fail("Only children in a family can be checked in.");
  }

  const today = localDateInTimeZone(context.auth.churchTimezone);
  const now = new Date().toISOString();

  // An existing pre-check-in is completed rather than duplicated: this is the
  // moment the spec calls "physically received by a staff member", and it has
  // to move the row the parent already created, not sit beside it.
  const { data: open } = await context.admin
    .from("checkin_sessions")
    .select("id, status")
    .eq("member_id", memberId)
    .eq("local_service_date", today)
    .in("status", ["pre_checked_in", "checked_in"])
    .maybeSingle();

  if (open) {
    if (open.status === "checked_in") {
      return fail("Already checked in today.");
    }

    const { data: received, error } = await context.admin
      .from("checkin_sessions")
      .update({
        status: "checked_in",
        location_id: locationId,
        checked_in_at: now,
        checked_in_by: context.auth.userId,
        checkin_method: "staff",
      })
      .eq("id", open.id)
      .eq("status", "pre_checked_in")
      .select("id");

    if (error) {
      console.error("[checkin] completing a pre-check-in failed:", error.message);
      return fail(toUserError(error, "We couldn't complete that check-in."));
    }
    if ((received ?? []).length === 0) {
      return fail("That child was just checked in from another station.");
    }

    return {
      ok: true,
      sessionId: open.id as string,
      householdId: (membership.household_id as string | null) ?? null,
    };
  }

  const { data, error } = await context.admin
    .from("checkin_sessions")
    .insert({
      church_id: context.auth.churchId,
      member_id: memberId,
      household_id: (membership?.household_id as string | null) ?? null,
      location_id: locationId,
      local_service_date: today,
      status: "checked_in",
      checked_in_at: now,
      checked_in_by: context.auth.userId,
      checkin_method: input.method === "kiosk" ? "kiosk" : "staff",
    })
    .select("id")
    .single();

  if (error || !data) {
    if (error?.code === "23505") {
      return fail("That child was just checked in from another station.");
    }
    // Said out loud in the server log. A missing table, a schema-cache miss
    // and a constraint violation all used to collapse into one sentence that
    // told nobody which it was.
    console.error("[checkin] check-in insert failed:", error?.message ?? "no row");
    return fail(
      /relation .* does not exist|schema cache/i.test(error?.message ?? "")
        ? "Kids check-in isn't turned on for your church yet. Contact FaithForm support to turn it on."
        : toUserError(error, "We couldn't check that child in."),
    );
  }

  return {
    ok: true,
    sessionId: data.id as string,
    householdId: (membership.household_id as string | null) ?? null,
  };
}

/** Receive a person into a room. Kept for callers that check in one child. */
export async function checkInMember(
  formData: FormData,
): Promise<ActionResult<{ sessionId: string }>> {
  const context = await requireStation();
  if (!isContext(context)) return context;

  const result = await checkInOne(context, {
    memberId: text(formData, "memberId"),
    locationId: text(formData, "locationId"),
    method: text(formData, "method"),
  });
  if (!result.ok) return result;

  revalidateCheckin();
  return { ok: true, data: { sessionId: result.sessionId } };
}

export type ChildCheckinResult =
  | { memberId: string; ok: true; sessionId: string; locationId: string }
  | { memberId: string; ok: false; error: string };

export type FamilyCheckinResult = {
  results: ChildCheckinResult[];
  /**
   * This week's 6-digit pickup code for each family with a child now in a
   * room, from the same issuing path the family page uses. Missing when a code
   * could not be issued; the desk then says to ask an admin.
   */
  pickupCodes: { householdId: string; code: string }[];
};

/** A family at the desk is never more than this many children in one go. */
const MAX_CHILDREN_PER_CHECKIN = 20;

/**
 * Check several children in with one press: the family card's big button.
 *
 * Nothing new about the rules: each child goes through `checkInOne`, one after
 * another, with the same church, room, child-only and double-check-in guards.
 * Results come back per child, so "Tim is already in the Nursery" does not
 * stop Anna being checked in.
 */
export async function checkInChildren(input: {
  children: { memberId: string; locationId: string }[];
}): Promise<ActionResult<FamilyCheckinResult>> {
  const context = await requireStation();
  if (!isContext(context)) return context;

  const seen = new Set<string>();
  const children = (input?.children ?? []).filter((child) => {
    if (!child || typeof child.memberId !== "string" || !child.memberId) return false;
    if (seen.has(child.memberId)) return false;
    seen.add(child.memberId);
    return true;
  });

  if (children.length === 0) return fail("Tick at least one child to check in.");
  if (children.length > MAX_CHILDREN_PER_CHECKIN) {
    return fail("That is too many children at once. Check them in a family at a time.");
  }

  const results: ChildCheckinResult[] = [];
  const households = new Set<string>();

  for (const child of children) {
    const locationId = typeof child.locationId === "string" ? child.locationId : "";
    try {
      const result = await checkInOne(context, { memberId: child.memberId, locationId });
      if (result.ok) {
        results.push({ memberId: child.memberId, ok: true, sessionId: result.sessionId, locationId });
        if (result.householdId) households.add(result.householdId);
      } else {
        results.push({ memberId: child.memberId, ok: false, error: result.error });
      }
    } catch (error) {
      results.push({
        memberId: child.memberId,
        ok: false,
        error: toUserError(error, "We couldn't check that child in."),
      });
    }
  }

  const pickupCodes: FamilyCheckinResult["pickupCodes"] = [];
  for (const householdId of households) {
    const code = await weeklyCodeFor(context, householdId);
    if (code.ok) pickupCodes.push({ householdId, code: code.code });
  }

  if (results.some((result) => result.ok)) revalidateCheckin();
  return { ok: true, data: { results, pickupCodes } };
}

/**
 * Take back check-ins made at the desk a moment ago: the wrong child ticked,
 * the wrong family tapped.
 *
 * Same station guard as checking in. Only sessions in this church, still
 * checked in, never released, made by this same person, and under ten minutes
 * old. They are marked cancelled rather than deleted, so the row (and who made
 * it, and when) is kept; a cancelled session never counts as attendance.
 * The update repeats every condition, so a child released a second earlier
 * changes nothing.
 */
export async function undoCheckin(
  sessionIds: string[],
): Promise<ActionResult<{ undone: number }>> {
  const context = await requireStation();
  if (!isContext(context)) return context;

  const ids = Array.from(
    new Set((sessionIds ?? []).filter((id) => typeof id === "string" && id)),
  );
  if (ids.length === 0) return fail("There is nothing to undo.");
  if (ids.length > MAX_CHILDREN_PER_CHECKIN) return fail("There is too much to undo at once.");

  const { data: rows, error: readError } = await context.admin
    .from("checkin_sessions")
    .select("id, church_id, status, checked_in_at, checked_in_by, checked_out_at")
    .in("id", ids)
    .eq("church_id", context.auth.churchId);

  if (readError) return fail(toUserError(readError, "We couldn't undo that check-in."));
  if (!rows || rows.length !== ids.length) {
    return fail(UNDO_CHECKIN_MESSAGES.other_church);
  }

  const now = new Date();
  for (const row of rows) {
    const refusal = undoCheckinRefusal(
      {
        church_id: row.church_id as string,
        status: row.status as string,
        checked_in_at: (row.checked_in_at as string | null) ?? null,
        checked_in_by: (row.checked_in_by as string | null) ?? null,
        checked_out_at: (row.checked_out_at as string | null) ?? null,
      },
      { churchId: context.auth.churchId, userId: context.auth.userId, now },
    );
    if (refusal) return fail(UNDO_CHECKIN_MESSAGES[refusal]);
  }

  const { data, error } = await context.admin
    .from("checkin_sessions")
    .update({ status: "cancelled" })
    .in("id", ids)
    .eq("church_id", context.auth.churchId)
    .eq("status", "checked_in")
    .is("checked_out_at", null)
    .eq("checked_in_by", context.auth.userId)
    .gte("checked_in_at", undoCheckinCutoff(now))
    .select("id");

  if (error) return fail(toUserError(error, "We couldn't undo that check-in."));

  const undone = (data ?? []).length;
  if (undone === 0) {
    return fail("That check-in changed a moment ago, so it wasn't undone. Refresh the page.");
  }

  // No personal details in the log line: ids and counts only.
  console.info("[checkin] check-in undone", {
    churchId: context.auth.churchId,
    by: context.auth.userId,
    sessions: (data ?? []).map((row) => row.id as string),
  });

  revalidateCheckin();
  return { ok: true, data: { undone } };
}

export type NewFamilyResult = FamilyCheckinResult & {
  householdId: string;
  familyName: string;
  children: { memberId: string; firstName: string; lastName: string; locationId: string }[];
};

/**
 * A first-time family at the desk: create the parent and the children in
 * People, make them a family (parent as parent or guardian, children as
 * children), then check the children in.
 *
 * Guarded exactly like creating a family and adding people to it today:
 * signed in, Kids Check-in turned on, and a church admin. Volunteers who are
 * not admins cannot create people or families anywhere in the dashboard, and
 * this does not change that; the desk only shows the button to admins.
 *
 * If any step of creating the family fails, what was already created is
 * removed again (nothing else can refer to rows made a moment ago in this
 * same request), so a half-made family is never left behind. Once the family
 * exists, a child who can't be checked in is reported by name and the family
 * is kept, since it is complete and correct.
 */
export async function createFamilyAndCheckIn(
  input: NewFamilyInput,
): Promise<ActionResult<NewFamilyResult>> {
  const context = await requireAdmin();
  if (!isContext(context)) return context;

  const parsed = parseNewFamily(input);
  if (!parsed.ok) return fail(parsed.error);
  const family = parsed.data;

  const guardian = validateMemberInput({
    firstName: family.guardian.firstName,
    lastName: family.guardian.lastName,
    phone: family.guardian.phone,
  });
  if (!guardian.ok) return fail(guardian.error);

  const children = [];
  for (const child of family.children) {
    const checked = validateMemberInput({ firstName: child.firstName, lastName: child.lastName });
    if (!checked.ok) return fail(checked.error);
    children.push({ ...child, firstName: checked.data.firstName, lastName: checked.data.lastName });
  }

  // Every room must be this church's and open before anything is written.
  const roomIds = Array.from(new Set(children.map((child) => child.locationId)));
  const { data: rooms, error: roomError } = await context.admin
    .from("church_locations")
    .select("id, is_active")
    .eq("church_id", context.auth.churchId)
    .in("id", roomIds);
  if (roomError) return fail(toUserError(roomError, "We couldn't add this family."));
  const openRooms = new Set(
    (rooms ?? []).filter((room) => room.is_active !== false).map((room) => room.id as string),
  );
  if (roomIds.some((id) => !openRooms.has(id))) {
    return fail("One of those rooms is closed or was removed. Choose another room.");
  }

  // The same parent twice is the common slip at a busy desk: if this phone
  // number is already in People, send the volunteer to search instead.
  if (guardian.data.phone) {
    const { data: existing } = await context.admin
      .from("members")
      .select("first_name, last_name")
      .eq("church_id", context.auth.churchId)
      .eq("phone", guardian.data.phone)
      .limit(1)
      .maybeSingle();
    if (existing) {
      return fail(
        `${existing.first_name} ${existing.last_name} already has this phone number. Search for their name instead of adding a new family.`,
      );
    }
  }

  const createdMemberIds: string[] = [];
  let householdId: string | null = null;
  // Set once the family is fully made. After that nothing is ever removed:
  // a check-in may already point at these people.
  let familyComplete = false;

  const station: Context = context;
  async function cleanUp() {
    // Children and parent were created in this request and nothing else points
    // at them yet; the family's links go with the family (on delete cascade).
    if (householdId) {
      await station.admin
        .from("households")
        .delete()
        .eq("id", householdId)
        .eq("church_id", station.auth.churchId);
    }
    if (createdMemberIds.length > 0) {
      await station.admin
        .from("members")
        .delete()
        .in("id", createdMemberIds)
        .eq("church_id", station.auth.churchId);
    }
  }

  const COULD_NOT_ADD =
    "We couldn't add this family, so nothing was saved. Please try again.";

  try {
    const { data: parentRow, error: parentError } = await context.admin
      .from("members")
      .insert({
        church_id: context.auth.churchId,
        first_name: guardian.data.firstName,
        last_name: guardian.data.lastName,
        phone: guardian.data.phone,
        email: null,
        is_active: true,
      })
      .select("id")
      .single();
    if (parentError || !parentRow) {
      console.error("[checkin] new family: parent insert failed:", parentError?.message);
      await cleanUp();
      return fail(COULD_NOT_ADD);
    }
    const parentId = parentRow.id as string;
    createdMemberIds.push(parentId);

    const createdChildren: NewFamilyResult["children"] = [];
    for (const child of children) {
      const { data: childRow, error: childError } = await context.admin
        .from("members")
        .insert({
          church_id: context.auth.churchId,
          first_name: child.firstName,
          last_name: child.lastName,
          is_active: true,
          medical_notes: child.medicalNotes,
          // Next Sunday this room is already chosen on the family card.
          default_location_id: child.locationId,
        })
        .select("id")
        .single();
      if (childError || !childRow) {
        console.error("[checkin] new family: child insert failed:", childError?.message);
        await cleanUp();
        return fail(COULD_NOT_ADD);
      }
      createdMemberIds.push(childRow.id as string);
      createdChildren.push({
        memberId: childRow.id as string,
        firstName: child.firstName,
        lastName: child.lastName,
        locationId: child.locationId,
      });
    }

    const { data: householdRow, error: householdError } = await context.admin
      .from("households")
      .insert({
        church_id: context.auth.churchId,
        name: family.familyName,
        created_by: context.auth.userId,
      })
      .select("id")
      .single();
    if (householdError || !householdRow) {
      console.error("[checkin] new family: family insert failed:", householdError?.message);
      await cleanUp();
      return fail(COULD_NOT_ADD);
    }
    householdId = householdRow.id as string;

    const { error: linkError } = await context.admin.from("household_members").insert([
      {
        church_id: context.auth.churchId,
        household_id: householdId,
        member_id: parentId,
        relationship: "guardian",
        is_primary_contact: true,
        created_by: context.auth.userId,
      },
      ...createdChildren.map((child) => ({
        church_id: context.auth.churchId,
        household_id: householdId,
        member_id: child.memberId,
        relationship: "dependent",
        is_primary_contact: false,
        created_by: context.auth.userId,
      })),
    ]);
    if (linkError) {
      console.error("[checkin] new family: linking failed:", linkError.message);
      await cleanUp();
      return fail(COULD_NOT_ADD);
    }

    // The family now exists and is correct. From here a failure is about one
    // child's check-in, reported by name, and the family is kept.
    familyComplete = true;
    const results: ChildCheckinResult[] = [];
    for (const child of createdChildren) {
      try {
        const result = await checkInOne(context, {
          memberId: child.memberId,
          locationId: child.locationId,
        });
        results.push(
          result.ok
            ? { memberId: child.memberId, ok: true, sessionId: result.sessionId, locationId: child.locationId }
            : { memberId: child.memberId, ok: false, error: result.error },
        );
      } catch (error) {
        results.push({
          memberId: child.memberId,
          ok: false,
          error: toUserError(error, "We couldn't check that child in."),
        });
      }
    }

    const code = await weeklyCodeFor(context, householdId);

    revalidateCheckin(householdId);
    return {
      ok: true,
      data: {
        householdId,
        familyName: family.familyName,
        children: createdChildren,
        results,
        pickupCodes: code.ok ? [{ householdId, code: code.code }] : [],
      },
    };
  } catch (error) {
    if (familyComplete) {
      revalidateCheckin(householdId ?? undefined);
      return fail(
        toUserError(error, "The family was added, but we couldn't finish checking in. Search for them and try again."),
      );
    }
    await cleanUp().catch(() => undefined);
    return fail(toUserError(error, "We couldn't add this family, so nothing was saved."));
  }
}

/** Move someone to a different room mid-service. */
export async function moveSession(formData: FormData): Promise<ActionResult> {
  const context = await requireStation();
  if (!isContext(context)) return context;

  const sessionId = text(formData, "sessionId");
  const locationId = text(formData, "locationId");
  if (!sessionId || !locationId) return fail("Pick a room.");

  const { error } = await context.admin
    .from("checkin_sessions")
    .update({ location_id: locationId })
    .eq("id", sessionId)
    .eq("church_id", context.auth.churchId)
    .in("status", ["pre_checked_in", "checked_in"]);

  if (error) {
    console.error("[checkin] move failed:", error.message);
    return fail(toUserError(error, "We couldn't move that child."));
  }

  revalidateCheckin();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// CHECKOUT
// ---------------------------------------------------------------------------

export type PickupPerson = {
  memberId: string;
  name: string;
  /** What the family calls them: "Mother", "Grandad". Never an authorization. */
  label?: string | null;
};

export type CheckoutLookup = {
  householdId: string;
  householdName: string;
  method: CheckoutMethod;
  sessions: CheckinSessionRow[];
  guardians: PickupPerson[];
  authorizedPickups: PickupPerson[];
};

/**
 * Turn a presented code into "here are the children, and here is who may
 * take them".
 *
 * This releases nobody. It is the read a staff member does before confirming,
 * and it is a server action rather than a route so that the code table, which
 * no church session may select from: is only ever read by the service role.
 */
export async function lookupCheckoutCredential(input: {
  kind: "qr" | "code";
  value: string;
}): Promise<ActionResult<CheckoutLookup>> {
  const context = await requireStation();
  if (!isContext(context)) return context;

  const today = localDateInTimeZone(context.auth.churchTimezone);
  let householdId: string;
  let method: CheckoutMethod;

  if (input.kind === "qr") {
    const verified = verifyPickupQr(input.value);
    if (!verified.ok) {
      return fail(
        verified.reason === "expired"
          ? "That QR code has expired. Ask for this week's 6-digit code instead."
          : "That QR code didn't work. Try again, or type the 6-digit code.",
      );
    }

    if (verified.credential.churchId !== context.auth.churchId) {
      return fail("That QR code belongs to a different church.");
    }

    // The rotation counter the token was minted under has to still be the
    // household's current one, so a code bumped after a lost phone stops
    // working without anything having to reach that phone.
    const { data: household } = await context.admin
      .from("households")
      .select("code_rotation")
      .eq("id", verified.credential.householdId)
      .maybeSingle();

    if (!household) return fail("We couldn't find that family.");
    if (Number(household.code_rotation ?? 0) !== verified.codeRotation) {
      return fail("That QR code was replaced. Ask for the current one.");
    }

    if (verified.credential.weekStart !== serviceWeekStart(context.auth.churchTimezone)) {
      return fail("That QR code is from a previous week.");
    }

    householdId = verified.credential.householdId;
    method = "qr";
  } else {
    const found = await lookupWeeklyCode(
      {
        churchId: context.auth.churchId,
        timezone: context.auth.churchTimezone,
        code: input.value,
      },
      context.admin,
    );

    if (!found.ok) {
      return fail(
        found.reason === "expired"
          ? "That code is from a previous week. Ask for this week's code."
          : "No family has that code. Check the six numbers and try again.",
      );
    }

    householdId = found.householdId;
    method = "code";
  }

  const supabase = createClient();
  const [household, sessions] = await Promise.all([
    getHousehold(context.auth.churchId, householdId, supabase),
    getHouseholdOpenSessions(
      context.auth.churchId,
      householdId,
      today,
      supabase,
    ),
  ]);

  if (!household) return fail("We couldn't find that family.");

  return {
    ok: true,
    data: {
      householdId,
      householdName: household.name,
      method,
      sessions,
      guardians: household.members
        .filter((m) => m.relationship === "guardian")
        .map((m) => ({
          memberId: m.memberId,
          name: `${m.firstName} ${m.lastName}`,
          label: m.relationshipLabel,
        })),
      authorizedPickups: household.pickupAuthorizations.map((p) => ({
        memberId: p.memberId,
        name: `${p.firstName} ${p.lastName}`,
        label: p.relationshipLabel,
      })),
    },
  };
}

/**
 * The lost-phone path: find a household by name, with no code at all.
 *
 * Kept deliberately separate from `lookupCheckoutCredential` rather than folded
 * in as another `kind`. A name is not a credential, and anything reached this
 * way can only be released as an `override`, which demands a written reason
 * and is flagged for review. Collapsing the two would make the difference
 * invisible at exactly the place it matters.
 */
export async function lookupHouseholdForOverride(
  search: string,
): Promise<ActionResult<CheckoutLookup[]>> {
  const context = await requireStation();
  if (!isContext(context)) return context;

  const term = search.trim();
  if (term.length < 2) return fail("Type at least two letters of a name.");

  const supabase = createClient();
  const today = localDateInTimeZone(context.auth.churchTimezone);
  const searchResult = await findHouseholdsByPersonName(
    context.auth.churchId,
    term,
    supabase,
    { withChildrenCheckedInOn: today, limit: 8 },
  );
  if (!searchResult.ok) return fail(searchResult.error);

  const results = await Promise.all(
    searchResult.households.map(async (household) => {
      const sessions = await getHouseholdOpenSessions(
        context.auth.churchId,
        household.id,
        today,
        supabase,
      );

      return {
        householdId: household.id,
        householdName: household.name,
        method: "override" as CheckoutMethod,
        sessions,
        guardians: household.members
          .filter((m) => m.relationship === "guardian")
          .map((m) => ({
            memberId: m.memberId,
            name: `${m.firstName} ${m.lastName}`,
            label: m.relationshipLabel,
          })),
        authorizedPickups: household.pickupAuthorizations.map((p) => ({
          memberId: p.memberId,
          name: `${p.firstName} ${p.lastName}`,
          label: p.relationshipLabel,
        })),
      } satisfies CheckoutLookup;
    }),
  );

  return { ok: true, data: results.filter((row) => row.sessions.length > 0) };
}

/**
 * Release children to the adult in front of the desk.
 *
 * The update is conditional on the session still being open, so a second press
 * of the button, or a second volunteer at a second station, changes zero rows
 * rather than overwriting who released the child and when. Every release
 * records the staff member, the instant, and which code was checked.
 *
 * There is deliberately no undo. Putting a released child back would erase
 * who took them, when, and why (including the reason written for a release
 * without a code), which is the record pickup safety depends on. A child
 * released by mistake who is still here is simply checked in again, which
 * starts a new record and keeps the old one.
 */
export async function completeCheckout(input: {
  sessionIds: string[];
  method: CheckoutMethod;
  releasedToMemberId?: string;
  overrideReason?: string;
}): Promise<ActionResult<{ released: number }>> {
  const context = await requireStation();
  if (!isContext(context)) return context;

  if (input.sessionIds.length === 0) return fail("Tick who is being picked up.");

  const reason = input.overrideReason?.trim() ?? "";
  if (input.method === "override" && reason.length < 4) {
    return fail(
      "To release without a code, write down why: which ID you checked, or who confirmed it.",
    );
  }

  // Guardians and other adults are never released through kids checkout.
  const { data: openRows } = await context.admin
    .from("checkin_sessions")
    .select("id, member_id")
    .in("id", input.sessionIds)
    .eq("church_id", context.auth.churchId)
    .in("status", ["pre_checked_in", "checked_in"]);

  const memberIds = Array.from(
    new Set((openRows ?? []).map((row) => row.member_id as string)),
  );
  if (memberIds.length > 0) {
    const { data: dependents } = await context.admin
      .from("household_members")
      .select("member_id")
      .eq("church_id", context.auth.churchId)
      .eq("relationship", "dependent")
      .in("member_id", memberIds);
    const dependentIds = new Set(
      (dependents ?? []).map((row) => row.member_id as string),
    );
    if (memberIds.some((id) => !dependentIds.has(id))) {
      return fail("Only children can be checked out.");
    }
  }

  const { data, error } = await context.admin
    .from("checkin_sessions")
    .update({
      status: "checked_out",
      checked_out_at: new Date().toISOString(),
      checked_out_by: context.auth.userId,
      checkout_method: input.method,
      checkout_released_to_member_id: input.releasedToMemberId || null,
      checkout_override_reason: input.method === "override" ? reason : null,
    })
    .in("id", input.sessionIds)
    .eq("church_id", context.auth.churchId)
    .in("status", ["pre_checked_in", "checked_in"])
    .select("id");

  if (error) return fail(toUserError(error, "We couldn't release those children."));

  const released = (data ?? []).length;
  if (released === 0) {
    return fail("Those children have already been checked out.");
  }

  revalidateCheckin();
  return { ok: true, data: { released } };
}

// ---------------------------------------------------------------------------
// CREDENTIALS
// ---------------------------------------------------------------------------

export type HouseholdCredentials = {
  weekStart: string;
  code: string;
  qrToken: string | null;
};

/**
 * This family's 6-digit code for this week, issued if it has none yet. The
 * one path every screen reads a code through: the family page, and the desk's
 * success screen after a check-in.
 */
async function weeklyCodeFor(
  context: Context,
  householdId: string,
): Promise<
  | { ok: true; code: string; weekStart: string; codeRotation: number }
  | { ok: false; error: string }
> {
  const { data: household } = await context.admin
    .from("households")
    .select("id, code_rotation")
    .eq("id", householdId)
    .eq("church_id", context.auth.churchId)
    .maybeSingle();

  if (!household) return fail("We couldn't find that family.");

  const weekStart = serviceWeekStart(context.auth.churchTimezone);
  const code = await issueWeeklyCode(
    { churchId: context.auth.churchId, householdId, weekStart },
    context.admin,
  );

  if (!code) return fail("We couldn't get a pickup code for this family. Please try again.");

  return {
    ok: true,
    code,
    weekStart,
    codeRotation: Number(household.code_rotation ?? 0),
  };
}

/**
 * This household's codes for this week, issued if they do not exist.
 *
 * Staff-callable so a desk can read a code out to a parent whose phone is
 * flat. The parent app will call the same issuing path for its own household.
 */
export async function getHouseholdCredentials(
  householdId: string,
): Promise<ActionResult<HouseholdCredentials>> {
  const context = await requireStation();
  if (!isContext(context)) return context;

  const code = await weeklyCodeFor(context, householdId);
  if (!code.ok) return code;

  return {
    ok: true,
    data: {
      weekStart: code.weekStart,
      code: code.code,
      qrToken: mintPickupQr({
        householdId,
        churchId: context.auth.churchId,
        weekStart: code.weekStart,
        codeRotation: code.codeRotation,
        expiresAt: weekExpiry(code.weekStart),
      }),
    },
  };
}

/** Kill this household's current code and QR: a lost phone, a custody change. */
export async function rotateCredentials(
  formData: FormData,
): Promise<ActionResult> {
  const context = await requireAdmin();
  if (!isContext(context)) return context;

  const householdId = text(formData, "householdId");

  const { data: household } = await context.admin
    .from("households")
    .select("id")
    .eq("id", householdId)
    .eq("church_id", context.auth.churchId)
    .maybeSingle();

  if (!household) return fail("We couldn't find that family.");

  const rotated = await rotateHouseholdCredentials(householdId, context.admin);
  if (!rotated) return fail("We couldn't replace this family's pickup code. Please try again.");

  revalidateCheckin(householdId);
  return { ok: true };
}
