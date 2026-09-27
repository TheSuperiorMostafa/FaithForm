import type { SupabaseClient } from "@supabase/supabase-js";

import { getAuthUsersByIds } from "@/lib/auth/auth-users";
import { createAdminClientOrNull } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { readAllById } from "@/lib/queries/paged-read";
import { staffLabel, type NoCodeRelease } from "@/lib/checkin/release-log";
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

  if (sessions.error || defaultFor.error || openNow.error ||
      !Number.isSafeInteger(sessions.count) || !Number.isSafeInteger(defaultFor.count) ||
      !Number.isSafeInteger(openNow.count)) {
    throw new Error("room usage read failed");
  }

  return {
    sessions: sessions.count as number,
    defaultFor: defaultFor.count as number,
    openNow: openNow.count as number,
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

  const [households, memberships] = await Promise.all([
    readAllById(async (afterId, includeCount, pageSize) => {
      let query = client
        .from("households")
        .select("id, name", includeCount ? { count: "exact" } : {})
        .eq("church_id", churchId);
      if (afterId) query = query.gt("id", afterId);
      return query.order("id", { ascending: true }).limit(pageSize);
    }, { label: "households" }),
    readAllById(async (afterId, includeCount, pageSize) => {
      let query = client
        .from("household_members")
        .select("id, household_id, relationship", includeCount ? { count: "exact" } : {})
        .eq("church_id", churchId);
      if (afterId) query = query.gt("id", afterId);
      return query.order("id", { ascending: true }).limit(pageSize);
    }, { label: "household members" }),
  ]);

  const counts = new Map<
    string,
    { total: number; guardians: number; dependents: number }
  >();

  for (const row of memberships) {
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
  }).sort((a, b) => a.name.localeCompare(b.name));
}

export async function getHousehold(
  churchId: string,
  householdId: string,
  supabase?: SupabaseClient,
): Promise<HouseholdDetail | null> {
  const client = supabase ?? db();
  const medicalClient = createAdminClientOrNull() ?? client;

  const { data: household, error: householdError } = await client
    .from("households")
    .select("id, name, notes, code_rotation")
    .eq("church_id", churchId)
    .eq("id", householdId)
    .maybeSingle();

  if (householdError) throw new Error("household read failed");
  if (!household) return null;

  const [memberRows, pickupRows] = await Promise.all([
    readAllById<HouseholdMemberJoin>(async (afterId, includeCount, pageSize) => {
      let query = medicalClient
        .from("household_members")
        .select(HOUSEHOLD_MEMBER_SELECT, includeCount ? { count: "exact" } : {})
        .eq("church_id", churchId)
        .eq("household_id", householdId);
      if (afterId) query = query.gt("id", afterId);
      const result = await query.order("id", { ascending: true }).limit(pageSize);
      return { ...result, data: result.data as unknown as HouseholdMemberJoin[] | null };
    }, { label: "family members" }),
    readAllById(async (afterId, includeCount, pageSize) => {
      let query = client
        .from("household_pickup_authorizations")
        .select(
          "id, member_id, relationship_label, members(id, first_name, last_name)",
          includeCount ? { count: "exact" } : {},
        )
        .eq("household_id", householdId)
        .eq("is_active", true);
      if (afterId) query = query.gt("id", afterId);
      return query.order("id", { ascending: true }).limit(pageSize);
    }, { label: "family pickup authorizations" }),
  ]);

  const mappedMembers = memberRows.map(mapHouseholdMember);
  if (mappedMembers.some((row) => row === null)) throw new Error("family members read incomplete");
  const members = mappedMembers
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

  const mappedPickups = (pickupRows as unknown as {
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
    });
  if (mappedPickups.some((row) => row === null)) {
    throw new Error("family pickup authorizations read incomplete");
  }
  const pickupAuthorizations = mappedPickups.filter(
    (row): row is NonNullable<typeof row> => row !== null,
  );

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
      .select("id", { count: "exact" })
      .eq("church_id", churchId)
      .or(memberFilter)
      .order("last_name", { ascending: true })
      .order("first_name", { ascending: true })
      .limit(100),
    client
      .from("households")
      .select("id", { count: "exact" })
      .eq("church_id", churchId)
      .ilike("name", householdPattern)
      .order("name", { ascending: true })
      .limit(50),
    openOn
      ? client
          .from("checkin_sessions")
          .select("id, household_id", { count: "exact" })
          .eq("church_id", churchId)
          .eq("local_service_date", openOn)
          .in("status", ["pre_checked_in", "checked_in"])
          .limit(1000)
      : null,
  ]);

  const readError = members.error ?? named.error ?? open?.error;
  const incomplete =
    members.count !== members.data?.length ||
    named.count !== named.data?.length ||
    (open !== null && open.count !== open.data?.length);
  if (readError || incomplete) {
    console.error("[checkin] household name search failed:", readError?.message ?? "incomplete result");
    return { ok: false, error: NAME_SEARCH_FAILED };
  }

  const memberIds = (members.data ?? []).map((row) => row.id as string);
  let linkedIds: string[] = [];
  if (memberIds.length > 0) {
    const { data: links, error, count } = await client
      .from("household_members")
      .select("id, household_id", { count: "exact" })
      .eq("church_id", churchId)
      .in("member_id", memberIds);

    if (error || count !== links?.length) {
      console.error("[checkin] household name search failed:", error?.message ?? "incomplete links");
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

  let households: (HouseholdDetail | null)[];
  try {
    households = await Promise.all(
      householdIds.map((id) => getHousehold(churchId, id, client)),
    );
  } catch (error) {
    console.error("[checkin] household name search failed:", error);
    return { ok: false, error: NAME_SEARCH_FAILED };
  }

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
  id: string;
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
  const medicalClient = createAdminClientOrNull() ?? client;

  let data: SessionJoin[];
  try {
    data = await readAllById<SessionJoin>(async (afterId, includeCount, pageSize) => {
      let query = medicalClient
        .from("checkin_sessions")
        .select(SESSION_SELECT, includeCount ? { count: "exact" } : {})
        .eq("church_id", churchId)
        .eq("local_service_date", localServiceDate);
      if (options.locationId) query = query.eq("location_id", options.locationId);
      if (!options.includeClosed) query = query.in("status", ["pre_checked_in", "checked_in"]);
      if (afterId) query = query.gt("id", afterId);
      const result = await query.order("id", { ascending: true }).limit(pageSize);
      return { ...result, data: result.data as unknown as SessionJoin[] | null };
    }, { label: "check-in roster" });
  } catch (error) {
    console.error("[checkin] roster read failed:", error);
    if (options.strict) throw new Error("roster read failed");
    return [];
  }

  const mapped = data.map(mapSession);
  if (options.strict && mapped.some((row) => row === null)) {
    throw new Error("roster read incomplete");
  }
  const rows = mapped.filter((row): row is CheckinSessionRow => row !== null);

  // Adults (guardians / other) are never part of kids check-in. If an old
  // session somehow exists for one, keep it off the board.
  const dependentIds = await listDependentMemberIds(churchId, client, { strict: options.strict });
  return rows.filter((row) => dependentIds.has(row.memberId))
    .sort((a, b) => (a.checkedInAt ?? "").localeCompare(b.checkedInAt ?? ""));
}

/**
 * Member ids marked as household dependents: the only people kids check-in
 * receives or releases.
 */
export async function listDependentMemberIds(
  churchId: string,
  supabase?: SupabaseClient,
  options: { strict?: boolean } = {},
): Promise<Set<string>> {
  const client = supabase ?? db();
  try {
    const data = await readAllById(async (afterId, includeCount, pageSize) => {
      let query = client
        .from("household_members")
        .select("id, member_id", includeCount ? { count: "exact" } : {})
        .eq("church_id", churchId)
        .eq("relationship", "dependent");
      if (afterId) query = query.gt("id", afterId);
      return query.order("id", { ascending: true }).limit(pageSize);
    }, { label: "check-in dependents" });
    return new Set(data.map((row) => row.member_id as string));
  } catch (error) {
    console.error("[checkin] dependent members read failed:", error);
    if (options.strict) throw new Error("dependent members read failed");
    return new Set();
  }
}

type ChildMembershipJoin = {
  id: string;
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
  const medicalClient = createAdminClientOrNull() ?? client;
  let data: ChildMembershipJoin[];
  try {
    data = await readAllById<ChildMembershipJoin>(async (afterId, includeCount, pageSize) => {
      let query = medicalClient
        .from("household_members")
        .select(
          "id, member_id, household_id, relationship, households(name), members(first_name, last_name, is_active, default_location_id, medical_notes)",
          includeCount ? { count: "exact" } : {},
        )
        .eq("church_id", churchId)
        .in("relationship", ["dependent", "guardian"]);
      if (afterId) query = query.gt("id", afterId);
      const result = await query.order("id", { ascending: true }).limit(pageSize);
      return { ...result, data: result.data as unknown as ChildMembershipJoin[] | null };
    }, { label: "check-in children" });
  } catch (error) {
    console.error("[checkin] children read failed:", error);
    if (options.strict) throw new Error("children read failed");
    return [];
  }

  const rows: HouseholdMembership[] = [];
  for (const row of data) {
    const member = unwrap(row.members);
    if (!member) {
      if (options.strict) throw new Error("children read incomplete");
      continue;
    }
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
  const medicalClient = createAdminClientOrNull() ?? client;

  const [sessions, dependents] = await Promise.all([
    readAllById<SessionJoin>(async (afterId, includeCount, pageSize) => {
      let query = medicalClient
        .from("checkin_sessions")
        .select(SESSION_SELECT, includeCount ? { count: "exact" } : {})
        .eq("church_id", churchId)
        .eq("household_id", householdId)
        .eq("local_service_date", localServiceDate)
        .in("status", ["pre_checked_in", "checked_in"]);
      if (afterId) query = query.gt("id", afterId);
      const result = await query.order("id", { ascending: true }).limit(pageSize);
      return { ...result, data: result.data as unknown as SessionJoin[] | null };
    }, { label: "household check-in sessions" }),
    readAllById(async (afterId, includeCount, pageSize) => {
      let query = client
        .from("household_members")
        .select("id, member_id", includeCount ? { count: "exact" } : {})
        .eq("church_id", churchId)
        .eq("household_id", householdId)
        .eq("relationship", "dependent");
      if (afterId) query = query.gt("id", afterId);
      return query.order("id", { ascending: true }).limit(pageSize);
    }, { label: "household dependents" }),
  ]).catch((error: unknown) => {
    console.error("[checkin] household sessions read failed:", error);
    throw error;
  });

  const mapped = sessions.map(mapSession);
  if (mapped.some((row) => row === null)) throw new Error("household sessions read incomplete");
  const rows = mapped.filter((row): row is CheckinSessionRow => row !== null);
  const dependentIds = new Set(
    dependents.map((row) => row.member_id as string),
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

  let data: SessionJoin[];
  let dependentIds: Set<string>;
  try {
    [data, dependentIds] = await Promise.all([
      readAllById<SessionJoin>(async (afterId, includeCount, pageSize) => {
        let query = client
          .from("checkin_sessions")
          .select(
            "id, member_id, location_id, local_service_date, church_locations(id, name)",
            includeCount ? { count: "exact" } : {},
          )
          .eq("church_id", churchId)
          .in("status", ["checked_in", "checked_out"])
          .gte("local_service_date", earliest);
        if (afterId) query = query.gt("id", afterId);
        const result = await query.order("id", { ascending: true }).limit(pageSize);
        return { ...result, data: result.data as unknown as SessionJoin[] | null };
      }, { label: "check-in statistics" }),
      listDependentMemberIds(churchId, client, { strict: true }),
    ]);
  } catch (error) {
    console.error("[checkin] stats read failed:", error);
    if (options.strict) throw new Error("stats read failed");
    return { weeks, rows: [] };
  }

  const byLocation = new Map<string, LocationHeadcount>();

  for (const raw of data) {
    if (!dependentIds.has(raw.member_id as string)) continue;

    const location = unwrap(raw.church_locations);
    if (!location) {
      if (options.strict) throw new Error("stats read incomplete");
      continue;
    }

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
// RELEASES WITHOUT A PICKUP CODE
// ---------------------------------------------------------------------------

/** The most the Reports log lists at once; the count above it is still exact. */
export const NO_CODE_RELEASE_LIMIT = 200;

type NoCodeReleaseJoin = {
  id: string;
  checked_out_at: string;
  checked_out_by: string | null;
  checkout_override_reason: string | null;
  child: { first_name: string; last_name: string } | { first_name: string; last_name: string }[] | null;
  released_to:
    | { first_name: string; last_name: string }
    | { first_name: string; last_name: string }[]
    | null;
  church_locations: { name: string } | { name: string }[] | null;
};

/**
 * Names for the team members who released children, one lookup per person
 * rather than per row, and never a page-through of every login (that is what
 * rate-limited the auth API before). The name is the one they chose in the
 * FaithForm app, if they use it; otherwise their email.
 */
async function staffLabelsFor(userIds: string[]): Promise<Map<string, string>> {
  const unique = Array.from(new Set(userIds.filter(Boolean)));
  if (unique.length === 0) return new Map();

  const admin = createAdminClientOrNull();
  const [authUsers, accounts] = await Promise.all([
    getAuthUsersByIds(unique),
    admin
      ? admin.from("visitor_accounts").select("user_id, display_name").in("user_id", unique)
      : Promise.resolve({ data: null }),
  ]);

  const names = new Map<string, string | null>(
    ((accounts.data ?? []) as { user_id: string; display_name: string | null }[]).map((row) => [
      row.user_id,
      row.display_name,
    ]),
  );

  return new Map(
    unique.map((id) => [
      id,
      staffLabel({ displayName: names.get(id) ?? null, email: authUsers.get(id)?.email ?? null }),
    ]),
  );
}

/**
 * Every child released without the family's pickup code since
 * `sinceServiceDate` (the first week the Reports numbers cover), newest
 * first: who, which room, who released them, when, and the reason written.
 */
export async function listNoCodeReleases(
  churchId: string,
  options: { sinceServiceDate: string; limit?: number; strict?: boolean },
  supabase?: SupabaseClient,
): Promise<{ releases: NoCodeRelease[]; total: number; failed: boolean }> {
  const client = supabase ?? db();

  const { data, error, count } = await client
    .from("checkin_sessions")
    .select(
      `id, checked_out_at, checked_out_by, checkout_override_reason,
       child:members!member_id(first_name, last_name),
       released_to:members!checkout_released_to_member_id(first_name, last_name),
       church_locations(name)`,
      { count: "exact" },
    )
    .eq("church_id", churchId)
    .eq("status", "checked_out")
    .eq("checkout_method", "override")
    .gte("local_service_date", options.sinceServiceDate)
    .order("checked_out_at", { ascending: false })
    .limit(options.limit ?? NO_CODE_RELEASE_LIMIT);

  if (error) {
    console.error("[checkin] no-code release read failed:", error.message);
    if (options.strict) throw new Error("no-code release read failed");
    // Said as a failure on the page, never as "none": an empty log would read
    // as every child having gone home with a code.
    return { releases: [], total: 0, failed: true };
  }

  const rows = (data ?? []) as unknown as NoCodeReleaseJoin[];
  const labels = await staffLabelsFor(
    rows.map((row) => row.checked_out_by).filter((id): id is string => Boolean(id)),
  );

  const fullName = (person: { first_name: string; last_name: string } | null) =>
    person ? `${person.first_name} ${person.last_name}`.trim() : null;

  const releases = rows.map((row) => ({
    sessionId: row.id,
    childName: fullName(unwrap(row.child)) || "A child no longer in People",
    roomName: unwrap(row.church_locations)?.name ?? null,
    releasedToName: fullName(unwrap(row.released_to)),
    releasedAt: row.checked_out_at,
    releasedByUserId: row.checked_out_by,
    releasedByLabel: row.checked_out_by
      ? (labels.get(row.checked_out_by) ?? staffLabel(null))
      : staffLabel(null),
    reason: row.checkout_override_reason?.trim() || null,
  }));

  return { releases, total: count ?? releases.length, failed: false };
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
