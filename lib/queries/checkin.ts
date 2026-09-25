import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import {
  householdNamePattern,
  memberNameFilter,
} from "@/lib/checkin/name-filter";
import {
  childrenFromMemberships,
  type CheckinChild,
  type HouseholdMembership,
} from "@/lib/checkin/roster-search";
import { recentServiceWeeks, serviceWeekStartForDate } from "@/lib/checkin/service-week";
import type {
  CheckinSessionRow,
  CheckinStatus,
  ChurchLocation,
  HouseholdDetail,
  HouseholdMemberRow,
  HouseholdRelationship,
  HouseholdSummary,
  LocationHeadcount,
  MemberFile,
} from "@/types/checkin";

function db() {
  return createClient();
}

type MemberRow = {
  id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  email: string | null;
  medical_notes?: string | null;
  default_location_id?: string | null;
};

// ---------------------------------------------------------------------------
// LOCATIONS
// ---------------------------------------------------------------------------

function mapLocation(row: Record<string, unknown>): ChurchLocation {
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string | null) ?? null,
    sortOrder: Number(row.sort_order ?? 0),
    capacity: (row.capacity as number | null) ?? null,
    isDefaultAdultLocation: Boolean(row.is_default_adult_location),
    isActive: row.is_active !== false,
  };
}

export async function listLocations(
  churchId: string,
  options: { includeInactive?: boolean; strict?: boolean } = {},
  supabase?: SupabaseClient,
): Promise<ChurchLocation[]> {
  const client = supabase ?? db();
  let query = client
    .from("church_locations")
    .select(
      "id, name, description, sort_order, capacity, is_default_adult_location, is_active",
    )
    .eq("church_id", churchId)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (!options.includeInactive) query = query.eq("is_active", true);

  const { data, error } = await query;
  if (error) {
    console.error("[checkin] rooms read failed:", error.message);
    // A page that would otherwise say "No rooms yet" asks for the failure,
    // so its error boundary can say so instead.
    if (options.strict) throw new Error("rooms read failed");
  }
  return (data ?? []).map((row) => mapLocation(row as Record<string, unknown>));
}

/**
 * How much history a room is carrying, asked before it is deleted.
 *
 * The spec asks for a warning rather than a silent orphaning, and a warning
 * that cannot say "37 check-ins, 4 people default here" is not one anybody can
 * act on. `head: true` keeps this to a count: the rows themselves are never
 * needed.
 */
export async function locationUsage(
  churchId: string,
  locationId: string,
  supabase?: SupabaseClient,
): Promise<{ sessions: number; defaultFor: number; openNow: number }> {
  const client = supabase ?? db();

  const [sessions, defaultFor, openNow] = await Promise.all([
    client
      .from("checkin_sessions")
      .select("id", { count: "exact", head: true })
      .eq("church_id", churchId)
      .eq("location_id", locationId),
    client
      .from("members")
      .select("id", { count: "exact", head: true })
      .eq("church_id", churchId)
      .eq("default_location_id", locationId),
    client
      .from("checkin_sessions")
      .select("id", { count: "exact", head: true })
      .eq("church_id", churchId)
      .eq("location_id", locationId)
      .in("status", ["pre_checked_in", "checked_in"]),
  ]);

  return {
    sessions: sessions.count ?? 0,
    defaultFor: defaultFor.count ?? 0,
    openNow: openNow.count ?? 0,
  };
}

// ---------------------------------------------------------------------------
// HOUSEHOLDS
// ---------------------------------------------------------------------------

type HouseholdMemberJoin = {
  id: string;
  household_id: string;
  member_id: string;
  relationship: HouseholdRelationship;
  relationship_label: string | null;
  is_primary_contact: boolean;
  members: MemberRow | MemberRow[] | null;
};

function firstMember(value: MemberRow | MemberRow[] | null): MemberRow | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function mapHouseholdMember(row: HouseholdMemberJoin): HouseholdMemberRow | null {
  const member = firstMember(row.members);
  if (!member) return null;

  return {
    id: row.id,
    memberId: row.member_id,
    firstName: member.first_name,
    lastName: member.last_name,
    relationship: row.relationship,
    relationshipLabel: row.relationship_label,
    isPrimaryContact: row.is_primary_contact,
    phone: member.phone,
    email: member.email,
    medicalNotes: member.medical_notes ?? null,
    defaultLocationId: member.default_location_id ?? null,
  };
}

const HOUSEHOLD_MEMBER_SELECT =
  "id, household_id, member_id, relationship, relationship_label, is_primary_contact, members(id, first_name, last_name, phone, email, medical_notes, default_location_id)";

export async function listHouseholds(
  churchId: string,
  supabase?: SupabaseClient,
): Promise<HouseholdSummary[]> {
  const client = supabase ?? db();

  const { data: households } = await client
    .from("households")
    .select("id, name")
    .eq("church_id", churchId)
    .order("name", { ascending: true });

  if (!households?.length) return [];

  const { data: memberships } = await client
    .from("household_members")
    .select("household_id, relationship")
    .eq("church_id", churchId);

  const counts = new Map<
    string,
    { total: number; guardians: number; dependents: number }
  >();

  for (const row of memberships ?? []) {
    const key = row.household_id as string;
    const entry = counts.get(key) ?? { total: 0, guardians: 0, dependents: 0 };
    entry.total += 1;
    if (row.relationship === "guardian") entry.guardians += 1;
    if (row.relationship === "dependent") entry.dependents += 1;
    counts.set(key, entry);
  }

  return households.map((row) => {
    const entry = counts.get(row.id as string) ?? {
      total: 0,
      guardians: 0,
      dependents: 0,
    };
    return {
      id: row.id as string,
      name: row.name as string,
      memberCount: entry.total,
      guardianCount: entry.guardians,
      dependentCount: entry.dependents,
    };
  });
}

export async function getHousehold(
  churchId: string,
  householdId: string,
  supabase?: SupabaseClient,
): Promise<HouseholdDetail | null> {
  const client = supabase ?? db();

  const { data: household } = await client
    .from("households")
    .select("id, name, notes, code_rotation")
    .eq("church_id", churchId)
    .eq("id", householdId)
    .maybeSingle();

  if (!household) return null;

  const [{ data: memberRows }, { data: pickupRows }] = await Promise.all([
    client
      .from("household_members")
      .select(HOUSEHOLD_MEMBER_SELECT)
      .eq("household_id", householdId),
    client
      .from("household_pickup_authorizations")
      .select(
        "id, member_id, relationship_label, members(id, first_name, last_name)",
      )
      .eq("household_id", householdId)
      .eq("is_active", true),
  ]);

  const members = (
    (memberRows ?? []) as unknown as HouseholdMemberJoin[]
  )
    .map(mapHouseholdMember)
    .filter((row): row is HouseholdMemberRow => row !== null)
    // Guardians first, then children, then everyone else: the order a person
    // reading a household card expects.
    .sort((a, b) => {
      const rank = { guardian: 0, dependent: 1, other: 2 } as const;
      if (rank[a.relationship] !== rank[b.relationship]) {
        return rank[a.relationship] - rank[b.relationship];
      }
      return `${a.lastName}${a.firstName}`.localeCompare(
        `${b.lastName}${b.firstName}`,
      );
    });

  const pickupAuthorizations = ((pickupRows ?? []) as unknown as {
    id: string;
    member_id: string;
    relationship_label: string | null;
    members: MemberRow | MemberRow[] | null;
  }[])
    .map((row) => {
      const member = firstMember(row.members);
      if (!member) return null;
      return {
        id: row.id,
        memberId: row.member_id,
        firstName: member.first_name,
        lastName: member.last_name,
        relationshipLabel: row.relationship_label,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  return {
    id: household.id as string,
    name: household.name as string,
    notes: (household.notes as string | null) ?? null,
    codeRotation: Number(household.code_rotation ?? 0),
    memberCount: members.length,
    guardianCount: members.filter((m) => m.relationship === "guardian").length,
    dependentCount: members.filter((m) => m.relationship === "dependent").length,
    members,
    pickupAuthorizations,
  };
}

export type HouseholdNameSearch =
  | { ok: true; households: HouseholdDetail[] }
  | { ok: false; error: string };

const NAME_SEARCH_FAILED =
  "Could not search by name just now. Try again in a moment.";

/**
 * The household a person belongs to, found from any member's name or from the
 * household's own.
 *
 * This is the whole point of the directory: a volunteer types "John Doe" and
 * gets the Doe household, not John. The match is on a *member* and the result
 * is a *household*, because searching household names alone would miss a
 * child whose surname differs from the household's; household names are
 * searched as well, so "the Does" works too.
 *
 * A failed read is reported as a failure. It used to come back as an empty
 * list, which the checkout desk showed as "nobody by that name" to a family
 * standing in front of it.
 *
 * `withChildrenCheckedInOn` keeps only households with a child in a room that
 * day, and it narrows *before* `limit` cuts, so a family is never pushed off
 * the list by others who share its name but have nobody to collect.
 */
export async function findHouseholdsByPersonName(
  churchId: string,
  search: string,
  supabase?: SupabaseClient,
  options: { withChildrenCheckedInOn?: string; limit?: number } = {},
): Promise<HouseholdNameSearch> {
  const memberFilter = memberNameFilter(search);
  const householdPattern = householdNamePattern(search);
  if (!memberFilter || !householdPattern) return { ok: true, households: [] };

  const client = supabase ?? db();
  const openOn = options.withChildrenCheckedInOn;

  const [members, named, open] = await Promise.all([
    client
      .from("members")
      .select("id")
      .eq("church_id", churchId)
      .or(memberFilter)
      .order("last_name", { ascending: true })
      .order("first_name", { ascending: true })
      .limit(100),
    client
      .from("households")
      .select("id")
      .eq("church_id", churchId)
      .ilike("name", householdPattern)
      .order("name", { ascending: true })
      .limit(50),
    openOn
      ? client
          .from("checkin_sessions")
          .select("household_id")
          .eq("church_id", churchId)
          .eq("local_service_date", openOn)
          .in("status", ["pre_checked_in", "checked_in"])
      : null,
  ]);

  const readError = members.error ?? named.error ?? open?.error;
  if (readError) {
    console.error("[checkin] household name search failed:", readError.message);
    return { ok: false, error: NAME_SEARCH_FAILED };
  }

  const memberIds = (members.data ?? []).map((row) => row.id as string);
  let linkedIds: string[] = [];
  if (memberIds.length > 0) {
    const { data: links, error } = await client
      .from("household_members")
      .select("household_id")
      .eq("church_id", churchId)
      .in("member_id", memberIds);

    if (error) {
      console.error("[checkin] household name search failed:", error.message);
      return { ok: false, error: NAME_SEARCH_FAILED };
    }
    linkedIds = (links ?? []).map((row) => row.household_id as string);
  }

  const withChildrenIn = open
    ? new Set((open.data ?? []).map((row) => row.household_id as string | null))
    : null;

  // A household named for what was typed first, then households found
  // through one of their people.
  const householdIds = Array.from(
    new Set([...(named.data ?? []).map((row) => row.id as string), ...linkedIds]),
  )
    .filter((id) => !withChildrenIn || withChildrenIn.has(id))
    .slice(0, options.limit ?? 20);

  const households = await Promise.all(
    householdIds.map((id) => getHousehold(churchId, id, client)),
  );

  return {
    ok: true,
    households: households.filter((row): row is HouseholdDetail => row !== null),
  };
}

// ---------------------------------------------------------------------------
// ROSTER
// ---------------------------------------------------------------------------

// `members!member_id`, not `members(...)`: a session points at members twice,
// once for who was checked in and once for who they were released to, and an
// unhinted embed makes PostgREST refuse the whole read as ambiguous (PGRST201).
// That refusal was silently swallowed below, so every room read as empty and
// every check-in looked like it had not happened.
const SESSION_SELECT = `
  id, member_id, household_id, location_id, status, local_service_date,
  pre_checked_in_at, checked_in_at, checked_in_by, checked_out_at,
  checkin_method, checkout_method, checkout_override_reason,
  members!member_id(id, first_name, last_name, medical_notes),
  church_locations(id, name),
  households(id, name)
`;

type SessionJoin = Record<string, unknown> & {
  members: { first_name: string; last_name: string; medical_notes: string | null }
    | { first_name: string; last_name: string; medical_notes: string | null }[]
    | null;
  church_locations: { id: string; name: string } | { id: string; name: string }[] | null;
  households: { id: string; name: string } | { id: string; name: string }[] | null;
};

function unwrap<T>(value: T | T[] | null): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function mapSession(row: SessionJoin): CheckinSessionRow | null {
  const member = unwrap(row.members);
  const location = unwrap(row.church_locations);
  if (!member || !location) return null;

  const household = unwrap(row.households);

  return {
    id: row.id as string,
    memberId: row.member_id as string,
    firstName: member.first_name,
    lastName: member.last_name,
    householdId: (row.household_id as string | null) ?? null,
    householdName: household?.name ?? null,
    locationId: location.id,
    locationName: location.name,
    status: row.status as CheckinStatus,
    localServiceDate: row.local_service_date as string,
    preCheckedInAt: (row.pre_checked_in_at as string | null) ?? null,
    checkedInAt: (row.checked_in_at as string | null) ?? null,
    checkedInBy: (row.checked_in_by as string | null) ?? null,
    checkedOutAt: (row.checked_out_at as string | null) ?? null,
    checkinMethod: (row.checkin_method as CheckinSessionRow["checkinMethod"]) ?? null,
    checkoutMethod:
      (row.checkout_method as CheckinSessionRow["checkoutMethod"]) ?? null,
    checkoutOverrideReason: (row.checkout_override_reason as string | null) ?? null,
    medicalNotes: member.medical_notes ?? null,
  };
}

/** Everyone checked in on one service date, newest first within each room. */
export async function getRoster(
  churchId: string,
  localServiceDate: string,
  options: { locationId?: string; includeClosed?: boolean; strict?: boolean } = {},
  supabase?: SupabaseClient,
): Promise<CheckinSessionRow[]> {
  const client = supabase ?? db();

  let query = client
    .from("checkin_sessions")
    .select(SESSION_SELECT)
    .eq("church_id", churchId)
    .eq("local_service_date", localServiceDate);

  if (options.locationId) query = query.eq("location_id", options.locationId);
  if (!options.includeClosed) {
    query = query.in("status", ["pre_checked_in", "checked_in"]);
  }

  const { data, error } = await query.order("checked_in_at", {
    ascending: true,
  });
  if (error) {
    console.error("[checkin] roster read failed:", error.message);
    if (options.strict) throw new Error("roster read failed");
  }

  const rows = ((data ?? []) as unknown as SessionJoin[])
    .map(mapSession)
    .filter((row): row is CheckinSessionRow => row !== null);

  // Adults (guardians / other) are never part of kids check-in. If an old
  // session somehow exists for one, keep it off the board.
  const dependentIds = await listDependentMemberIds(churchId, client);
  return rows.filter((row) => dependentIds.has(row.memberId));
}

/**
 * Member ids marked as household dependents: the only people kids check-in
 * receives or releases.
 */
export async function listDependentMemberIds(
  churchId: string,
  supabase?: SupabaseClient,
): Promise<Set<string>> {
  const client = supabase ?? db();
  const { data, error } = await client
    .from("household_members")
    .select("member_id")
    .eq("church_id", churchId)
    .eq("relationship", "dependent");

  if (error) {
    console.error("[checkin] dependent members read failed:", error.message);
    return new Set();
  }

  return new Set((data ?? []).map((row) => row.member_id as string));
}

type ChildMembershipJoin = {
  member_id: string;
  household_id: string;
  relationship: HouseholdRelationship;
  households: { name: string } | { name: string }[] | null;
  members:
    | {
        first_name: string;
        last_name: string;
        is_active: boolean | null;
        default_location_id: string | null;
        medical_notes?: string | null;
      }
    | {
        first_name: string;
        last_name: string;
        is_active: boolean | null;
        default_location_id: string | null;
        medical_notes?: string | null;
      }[]
    | null;
};

/**
 * The children the Today desk may check in, each with the names a family might
 * give instead of the child's: the household's, and its guardians'.
 *
 * One read of `household_members` rather than the whole People directory. The
 * desk needs children, and adults only as words to search by, so guardians
 * come back attached to a child and never as people the desk can check in.
 * It also means no phone number or email address is sent to the browser for a
 * list that only ever shows names.
 */
export async function listCheckinChildren(
  churchId: string,
  supabase?: SupabaseClient,
  options: { strict?: boolean } = {},
): Promise<CheckinChild[]> {
  const client = supabase ?? db();
  const { data, error } = await client
    .from("household_members")
    .select(
      "member_id, household_id, relationship, households(name), members(first_name, last_name, is_active, default_location_id, medical_notes)",
    )
    .eq("church_id", churchId)
    .in("relationship", ["dependent", "guardian"]);

  if (error) {
    console.error("[checkin] children read failed:", error.message);
    if (options.strict) throw new Error("children read failed");
    return [];
  }

  const rows: HouseholdMembership[] = [];
  for (const row of (data ?? []) as unknown as ChildMembershipJoin[]) {
    const member = unwrap(row.members);
    if (!member) continue;
    rows.push({
      memberId: row.member_id,
      householdId: row.household_id,
      relationship: row.relationship,
      householdName: unwrap(row.households)?.name ?? null,
      firstName: member.first_name,
      lastName: member.last_name,
      isActive: member.is_active !== false,
      defaultLocationId: member.default_location_id ?? null,
      medicalNotes: member.medical_notes ?? null,
    });
  }

  return childrenFromMemberships(rows);
}

/** The open sessions for one household: what a checkout desk is releasing. */
export async function getHouseholdOpenSessions(
  churchId: string,
  householdId: string,
  localServiceDate: string,
  supabase?: SupabaseClient,
): Promise<CheckinSessionRow[]> {
  const client = supabase ?? db();

  const { data, error } = await client
    .from("checkin_sessions")
    .select(SESSION_SELECT)
    .eq("church_id", churchId)
    .eq("household_id", householdId)
    .eq("local_service_date", localServiceDate)
    .in("status", ["pre_checked_in", "checked_in"]);
  if (error) {
    console.error("[checkin] household sessions read failed:", error.message);
  }

  const rows = ((data ?? []) as unknown as SessionJoin[])
    .map(mapSession)
    .filter((row): row is CheckinSessionRow => row !== null);

  const { data: dependents } = await client
    .from("household_members")
    .select("member_id")
    .eq("church_id", churchId)
    .eq("household_id", householdId)
    .eq("relationship", "dependent");

  const dependentIds = new Set(
    (dependents ?? []).map((row) => row.member_id as string),
  );
  return rows.filter((row) => dependentIds.has(row.memberId));
}

// ---------------------------------------------------------------------------
// STATS
// ---------------------------------------------------------------------------

/**
 * Headcount per room per week.
 *
 * Counts sessions that reached `checked_in` or beyond. A pre-check-in that
 * nobody turned up for is not attendance, and counting it would make the
 * numbers drift upward the moment parents start using the app, which is
 * exactly when a director would be looking at them.
 *
 * Children only, by the same rule as the roster. Adults could be checked into
 * rooms before the desk was limited to children, and those old sessions would
 * otherwise go on inflating a room's numbers for weeks.
 */
export async function getLocationStats(
  churchId: string,
  options: { weeks?: number; endWeekStart: string; strict?: boolean },
  supabase?: SupabaseClient,
): Promise<{ weeks: string[]; rows: LocationHeadcount[] }> {
  const client = supabase ?? db();
  const weeks = recentServiceWeeks(options.endWeekStart, options.weeks ?? 8);
  const earliest = weeks[0];

  const [{ data, error }, dependentIds] = await Promise.all([
    client
      .from("checkin_sessions")
      .select("member_id, location_id, local_service_date, church_locations(id, name)")
      .eq("church_id", churchId)
      .in("status", ["checked_in", "checked_out"])
      .gte("local_service_date", earliest),
    listDependentMemberIds(churchId, client),
  ]);
  if (error) {
    console.error("[checkin] stats read failed:", error.message);
    if (options.strict) throw new Error("stats read failed");
  }

  const byLocation = new Map<string, LocationHeadcount>();

  for (const raw of (data ?? []) as unknown as SessionJoin[]) {
    if (!dependentIds.has(raw.member_id as string)) continue;

    const location = unwrap(raw.church_locations);
    if (!location) continue;

    const week = serviceWeekStartForDate(raw.local_service_date as string);
    if (!weeks.includes(week)) continue;

    const entry =
      byLocation.get(location.id) ??
      ({
        locationId: location.id,
        locationName: location.name,
        byWeek: Object.fromEntries(weeks.map((w) => [w, 0])),
        total: 0,
      } satisfies LocationHeadcount);

    entry.byWeek[week] = (entry.byWeek[week] ?? 0) + 1;
    entry.total += 1;
    byLocation.set(location.id, entry);
  }

  return {
    weeks,
    rows: Array.from(byLocation.values()).sort((a, b) =>
      a.locationName.localeCompare(b.locationName),
    ),
  };
}

// ---------------------------------------------------------------------------
// PERSON FILES
// ---------------------------------------------------------------------------

export async function listMemberFiles(
  memberId: string,
  supabase?: SupabaseClient,
): Promise<MemberFile[]> {
  const client = supabase ?? db();

  // RLS decides which of these come back: a non-admin sees only the files
  // somebody deliberately marked staff-visible.
  const { data } = await client
    .from("member_files")
    .select(
      "id, member_id, label, file_name, mime_type, size_bytes, visibility, uploaded_by_name, expires_on, created_at",
    )
    .eq("member_id", memberId)
    .order("created_at", { ascending: false });

  return (data ?? []).map((row) => ({
    id: row.id as string,
    memberId: row.member_id as string,
    label: row.label as string,
    fileName: row.file_name as string,
    mimeType: row.mime_type as string,
    sizeBytes: Number(row.size_bytes ?? 0),
    visibility: row.visibility as MemberFile["visibility"],
    uploadedByName: (row.uploaded_by_name as string | null) ?? null,
    expiresOn: (row.expires_on as string | null) ?? null,
    createdAt: row.created_at as string,
  }));
}
