import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
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
  options: { includeInactive?: boolean } = {},
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

  const { data } = await query;
  return (data ?? []).map((row) => mapLocation(row as Record<string, unknown>));
}

/**
 * How much history a room is carrying, asked before it is deleted.
 *
 * The spec asks for a warning rather than a silent orphaning, and a warning
 * that cannot say "37 check-ins, 4 people default here" is not one anybody can
 * act on. `head: true` keeps this to a count — the rows themselves are never
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
    // Guardians first, then children, then everyone else — the order a person
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

/**
 * The household a person belongs to, found from any member's name.
 *
 * This is the whole point of the directory: a volunteer types "John Doe" and
 * gets the Doe household, not John. Two steps rather than one query because
 * the match is on a *member* and the result is a *household* — searching the
 * household name instead would miss a child whose surname differs from the
 * household's.
 */
export async function findHouseholdsByPersonName(
  churchId: string,
  search: string,
  supabase?: SupabaseClient,
): Promise<HouseholdDetail[]> {
  const term = search.trim();
  if (!term) return [];

  const client = supabase ?? db();
  const pattern = `%${term.replace(/[%_]/g, (c) => `\\${c}`)}%`;

  const { data: matches } = await client
    .from("members")
    .select("id")
    .eq("church_id", churchId)
    .or(`first_name.ilike.${pattern},last_name.ilike.${pattern}`)
    .limit(50);

  const memberIds = (matches ?? []).map((row) => row.id as string);
  if (memberIds.length === 0) return [];

  const { data: links } = await client
    .from("household_members")
    .select("household_id")
    .in("member_id", memberIds);

  const householdIds = Array.from(
    new Set((links ?? []).map((row) => row.household_id as string)),
  ).slice(0, 20);

  const households = await Promise.all(
    householdIds.map((id) => getHousehold(churchId, id, client)),
  );

  return households.filter((row): row is HouseholdDetail => row !== null);
}

// ---------------------------------------------------------------------------
// ROSTER
// ---------------------------------------------------------------------------

const SESSION_SELECT = `
  id, member_id, household_id, location_id, status, local_service_date,
  pre_checked_in_at, checked_in_at, checked_out_at,
  checkin_method, checkout_method, checkout_override_reason,
  members(id, first_name, last_name, medical_notes),
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
  options: { locationId?: string; includeClosed?: boolean } = {},
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

  const { data } = await query.order("checked_in_at", { ascending: true });

  return ((data ?? []) as unknown as SessionJoin[])
    .map(mapSession)
    .filter((row): row is CheckinSessionRow => row !== null);
}

/** The open sessions for one household — what a checkout desk is releasing. */
export async function getHouseholdOpenSessions(
  churchId: string,
  householdId: string,
  localServiceDate: string,
  supabase?: SupabaseClient,
): Promise<CheckinSessionRow[]> {
  const client = supabase ?? db();

  const { data } = await client
    .from("checkin_sessions")
    .select(SESSION_SELECT)
    .eq("church_id", churchId)
    .eq("household_id", householdId)
    .eq("local_service_date", localServiceDate)
    .in("status", ["pre_checked_in", "checked_in"]);

  return ((data ?? []) as unknown as SessionJoin[])
    .map(mapSession)
    .filter((row): row is CheckinSessionRow => row !== null);
}

// ---------------------------------------------------------------------------
// STATS
// ---------------------------------------------------------------------------

/**
 * Headcount per room per week.
 *
 * Counts sessions that reached `checked_in` or beyond. A pre-check-in that
 * nobody turned up for is not attendance, and counting it would make the
 * numbers drift upward the moment parents start using the app — which is
 * exactly when a director would be looking at them.
 */
export async function getLocationStats(
  churchId: string,
  options: { weeks?: number; endWeekStart: string } ,
  supabase?: SupabaseClient,
): Promise<{ weeks: string[]; rows: LocationHeadcount[] }> {
  const client = supabase ?? db();
  const weeks = recentServiceWeeks(options.endWeekStart, options.weeks ?? 8);
  const earliest = weeks[0];

  const { data } = await client
    .from("checkin_sessions")
    .select("location_id, local_service_date, church_locations(id, name)")
    .eq("church_id", churchId)
    .in("status", ["checked_in", "checked_out"])
    .gte("local_service_date", earliest);

  const byLocation = new Map<string, LocationHeadcount>();

  for (const raw of (data ?? []) as unknown as SessionJoin[]) {
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
