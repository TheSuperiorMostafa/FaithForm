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
import { featureActionError } from "@/lib/features/guard";
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

/** Configuration — rooms, households, authorizations — is the admin's. */
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
  revalidatePath("/dashboard/checkin/households");
  revalidatePath("/dashboard/checkin/locations");
  revalidatePath("/dashboard/checkin/stats");
  revalidatePath("/dashboard/people");
  if (householdId) {
    revalidatePath(`/dashboard/checkin/households/${householdId}`);
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
    return fail("Capacity must be a whole number above zero.");
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
        : "Could not add that room.",
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

  const { error } = await context.admin
    .from("church_locations")
    .update({
      name,
      description: text(formData, "description") || null,
      capacity: capacityRaw ? Number(capacityRaw) : null,
      sort_order: Number(text(formData, "sortOrder") || "0") || 0,
      is_active: formData.get("isActive") !== "false",
    })
    .eq("id", id)
    .eq("church_id", context.auth.churchId);

  if (error) {
    return fail(
      error.code === "23505"
        ? `There is already a room called “${name}”.`
        : "Could not save that room.",
    );
  }

  revalidateCheckin();
  return { ok: true };
}

/**
 * "Sanctuary" is where an adult goes unless told otherwise. One per church,
 * enforced by a partial unique index — so the old default has to be cleared
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

  if (error) return fail("Could not set that room as the default.");

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
      `That room has ${usage.sessions} check-in${usage.sessions === 1 ? "" : "s"} on record and is the default for ${usage.defaultFor} ${usage.defaultFor === 1 ? "person" : "people"}. Turn it off instead — it keeps the history and stops it being assignable.`,
    );
  }

  const { error } = await context.admin
    .from("church_locations")
    .delete()
    .eq("id", id)
    .eq("church_id", context.auth.churchId);

  if (error) return fail("Could not delete that room.");

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
  if (!name) return fail("Give the household a name.");

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

  if (error || !data) return fail("Could not create that household.");

  revalidateCheckin();
  return { ok: true, data: { householdId: data.id as string } };
}

export async function updateHousehold(formData: FormData): Promise<ActionResult> {
  const context = await requireAdmin();
  if (!isContext(context)) return context;

  const id = text(formData, "householdId");
  const name = text(formData, "name");
  if (!id || !name) return fail("Give the household a name.");

  const { error } = await context.admin
    .from("households")
    .update({ name, notes: text(formData, "notes") || null })
    .eq("id", id)
    .eq("church_id", context.auth.churchId);

  if (error) return fail("Could not save that household.");

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
    return fail("Pick how this person belongs to the household.");
  }

  // Both sides are re-checked against this church rather than trusted from the
  // form — the ids arrive from a browser, and a household in another church
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
        ? "That person already belongs to a household. Remove them from it first."
        : "Could not add that person.",
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
    return fail("Pick how this person belongs to the household.");
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

  if (error) return fail("Could not save that change.");

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

  if (error) return fail("Could not remove that person.");

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
  if (!householdId || !memberId) return fail("Pick a person to authorize.");

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
        ? "That person is already authorized for this household."
        : "Could not authorize that person.",
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
  if (!id) return fail("Pick an authorization to remove.");

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

  if (error) return fail("Could not remove that authorization.");

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

  if (error) return fail("Could not save those details.");

  revalidateCheckin();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// CHECK-IN
// ---------------------------------------------------------------------------

/**
 * Receive a person into a room.
 *
 * Re-checks the person and the room against this church, then lets the partial
 * unique index settle the race: two volunteers checking the same child in from
 * two iPads produce one row, and the second gets told so rather than silently
 * creating a duplicate the roster would then show twice.
 */
export async function checkInMember(
  formData: FormData,
): Promise<ActionResult<{ sessionId: string }>> {
  const context = await requireStation();
  if (!isContext(context)) return context;

  const memberId = text(formData, "memberId");
  const locationId = text(formData, "locationId");
  if (!memberId || !locationId) return fail("Pick a person and a room.");

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

  if (!member) return fail("That person could not be found.");
  if (!location) return fail("That room could not be found.");
  if (location.is_active === false) return fail("That room is switched off.");

  const { data: membership } = await context.admin
    .from("household_members")
    .select("household_id")
    .eq("member_id", memberId)
    .maybeSingle();

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
      return fail("That person is already checked in today.");
    }

    const { error } = await context.admin
      .from("checkin_sessions")
      .update({
        status: "checked_in",
        location_id: locationId,
        checked_in_at: now,
        checked_in_by: context.auth.userId,
        checkin_method: "staff",
      })
      .eq("id", open.id)
      .eq("status", "pre_checked_in");

    if (error) return fail("Could not complete that check-in.");

    revalidateCheckin();
    return { ok: true, data: { sessionId: open.id as string } };
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
      checkin_method: text(formData, "method") === "kiosk" ? "kiosk" : "staff",
    })
    .select("id")
    .single();

  if (error || !data) {
    return fail(
      error?.code === "23505"
        ? "That person was just checked in from another station."
        : "Could not check that person in.",
    );
  }

  revalidateCheckin();
  return { ok: true, data: { sessionId: data.id as string } };
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

  if (error) return fail("Could not move that person.");

  revalidateCheckin();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// CHECKOUT
// ---------------------------------------------------------------------------

export type CheckoutLookup = {
  householdId: string;
  householdName: string;
  method: CheckoutMethod;
  sessions: CheckinSessionRow[];
  guardians: { memberId: string; name: string }[];
  authorizedPickups: { memberId: string; name: string }[];
};

/**
 * Turn a presented credential into "here are the children, and here is who may
 * take them".
 *
 * This releases nobody. It is the read a staff member does before confirming,
 * and it is a server action rather than a route so that the code table — which
 * no church session may select from — is only ever read by the service role.
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
          : "That QR code is not valid.",
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

    if (!household) return fail("That household could not be found.");
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
          ? "That code is from a previous week."
          : "No household matches that code.",
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

  if (!household) return fail("That household could not be found.");

  return {
    ok: true,
    data: {
      householdId,
      householdName: household.name,
      method,
      sessions,
      guardians: household.members
        .filter((m) => m.relationship === "guardian")
        .map((m) => ({ memberId: m.memberId, name: `${m.firstName} ${m.lastName}` })),
      authorizedPickups: household.pickupAuthorizations.map((p) => ({
        memberId: p.memberId,
        name: `${p.firstName} ${p.lastName}`,
      })),
    },
  };
}

/**
 * The lost-phone path: find a household by name, with no credential at all.
 *
 * Kept deliberately separate from `lookupCheckoutCredential` rather than folded
 * in as another `kind`. A name is not a credential, and anything reached this
 * way can only be released as an `override` — which demands a written reason
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
  const households = await findHouseholdsByPersonName(
    context.auth.churchId,
    term,
    supabase,
  );

  const results = await Promise.all(
    households.slice(0, 8).map(async (household) => {
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
          })),
        authorizedPickups: household.pickupAuthorizations.map((p) => ({
          memberId: p.memberId,
          name: `${p.firstName} ${p.lastName}`,
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
 * of the button — or a second volunteer at a second station — changes zero rows
 * rather than overwriting who released the child and when. Every release
 * records the staff member, the instant, and which credential was verified.
 */
export async function completeCheckout(input: {
  sessionIds: string[];
  method: CheckoutMethod;
  releasedToMemberId?: string;
  overrideReason?: string;
}): Promise<ActionResult<{ released: number }>> {
  const context = await requireStation();
  if (!isContext(context)) return context;

  if (input.sessionIds.length === 0) return fail("Pick who is being collected.");

  const reason = input.overrideReason?.trim() ?? "";
  if (input.method === "override" && reason.length < 4) {
    return fail(
      "An override has to say why — which ID was checked, or who confirmed it.",
    );
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

  if (error) return fail("Could not complete that checkout.");

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
 * This household's credentials for this week, minted if they do not exist.
 *
 * Staff-callable so a desk can read a code out to a parent whose phone is
 * flat. The parent app will call the same issuing path for its own household.
 */
export async function getHouseholdCredentials(
  householdId: string,
): Promise<ActionResult<HouseholdCredentials>> {
  const context = await requireStation();
  if (!isContext(context)) return context;

  const { data: household } = await context.admin
    .from("households")
    .select("id, code_rotation")
    .eq("id", householdId)
    .eq("church_id", context.auth.churchId)
    .maybeSingle();

  if (!household) return fail("That household could not be found.");

  const weekStart = serviceWeekStart(context.auth.churchTimezone);
  const code = await issueWeeklyCode(
    { churchId: context.auth.churchId, householdId, weekStart },
    context.admin,
  );

  if (!code) return fail("Could not issue a code for this household.");

  return {
    ok: true,
    data: {
      weekStart,
      code,
      qrToken: mintPickupQr({
        householdId,
        churchId: context.auth.churchId,
        weekStart,
        codeRotation: Number(household.code_rotation ?? 0),
        expiresAt: weekExpiry(weekStart),
      }),
    },
  };
}

/** Kill this household's current code and QR — a lost phone, a custody change. */
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

  if (!household) return fail("That household could not be found.");

  const rotated = await rotateHouseholdCredentials(householdId, context.admin);
  if (!rotated) return fail("Could not replace those credentials.");

  revalidateCheckin(householdId);
  return { ok: true };
}
