import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { UserFacingError } from "@/lib/errors/user-error";
import { compareKeys } from "@/lib/service-plans/fractional-index";
import { toHm } from "@/lib/service-plans/timing";
import {
  NOTE_CATEGORIES,
  type ItemType,
  type Leader,
  type NoteCategory,
  type PersonOption,
  type Plan,
  type PlanItem,
  type PlanListRow,
  type PlanNote,
  type PlanTeamMember,
  type PlanTime,
  type ServiceType,
  type ServiceTypeSummary,
  type Team,
  type TeamMemberStatus,
  type TeamStatus,
  type TimeKind,
} from "@/lib/service-plans/types";

/**
 * Reads for Service Plans. Each takes the client to read with: the signed-in
 * user's (RLS decides) on dashboard pages, the service role only behind a
 * verified share token. Every query also filters by church explicitly, so a
 * service-role read can never cross churches either.
 *
 * Flat queries in parallel rather than nested embeds: several tables here have
 * two relationships to each other (a plan's type, and a type's default
 * template), which makes PostgREST embeds ambiguous.
 */

type Row = Record<string, unknown>;

function fail(context: string, error: { message: string } | null): void {
  if (error) {
    console.error(`service-plans ${context}:`, error.message);
    throw new UserFacingError("We couldn't load your service plans. Please try again.");
  }
}

function personName(row: { first_name?: unknown; last_name?: unknown } | null | undefined): string {
  if (!row) return "Someone";
  return [row.first_name, row.last_name].filter(Boolean).join(" ").trim() || "Someone";
}

function mapTime(row: Row): PlanTime {
  return {
    id: row.id as string,
    kind: row.kind as TimeKind,
    label: row.label as string,
    startsAt: row.starts_at as string,
  };
}

function mapServiceType(row: Row, times: Row[]): ServiceType {
  return {
    id: row.id as string,
    name: row.name as string,
    defaultWeekday: (row.default_weekday as number | null) ?? null,
    targetSeconds: (row.target_seconds as number | null) ?? null,
    defaultTemplateId: (row.default_template_id as string | null) ?? null,
    times: times
      .filter((t) => t.service_type_id === row.id)
      .map((t) => ({
        id: t.id as string,
        kind: t.kind as TimeKind,
        label: t.label as string,
        weekday: t.weekday as number,
        localTime: toHm(t.local_time as string),
      })),
  };
}

const TYPE_COLUMNS = "id, name, default_weekday, target_seconds, default_template_id, sort_order";
const TIME_COLUMNS = "id, service_type_id, kind, label, weekday, local_time, sort_order";

export async function listServiceTypes(
  client: SupabaseClient,
  churchId: string,
  todayYmd: string,
): Promise<ServiceTypeSummary[]> {
  const [types, times, upcoming, templates] = await Promise.all([
    client
      .from("service_types")
      .select(TYPE_COLUMNS)
      .eq("church_id", churchId)
      .is("archived_at", null)
      .order("sort_order")
      .order("name"),
    client
      .from("service_type_times")
      .select(TIME_COLUMNS)
      .eq("church_id", churchId)
      .order("sort_order"),
    client
      .from("plans")
      .select("id, service_type_id, plan_date")
      .eq("church_id", churchId)
      .eq("is_template", false)
      .gte("plan_date", todayYmd)
      .order("plan_date")
      .limit(500),
    client
      .from("plans")
      .select("id, title")
      .eq("church_id", churchId)
      .eq("is_template", true),
  ]);
  fail("types", types.error);
  fail("type times", times.error);
  fail("upcoming", upcoming.error);
  fail("templates", templates.error);

  const nextIds = new Map<string, Row>();
  const counts = new Map<string, number>();
  for (const plan of upcoming.data ?? []) {
    const typeId = plan.service_type_id as string;
    counts.set(typeId, (counts.get(typeId) ?? 0) + 1);
    if (!nextIds.has(typeId)) nextIds.set(typeId, plan);
  }

  const nextPlanIds = [...nextIds.values()].map((p) => p.id as string);
  const firstTimes = new Map<string, string>();
  if (nextPlanIds.length) {
    const { data, error } = await client
      .from("plan_times")
      .select("plan_id, starts_at, kind")
      .in("plan_id", nextPlanIds)
      .order("starts_at");
    fail("next times", error);
    for (const t of data ?? []) {
      if (t.kind === "service" && !firstTimes.has(t.plan_id as string)) {
        firstTimes.set(t.plan_id as string, t.starts_at as string);
      }
    }
  }
  const templateNames = new Map((templates.data ?? []).map((t) => [t.id as string, t.title as string]));

  return (types.data ?? []).map((row) => {
    const type = mapServiceType(row, times.data ?? []);
    const next = nextIds.get(type.id);
    return {
      ...type,
      nextPlan: next
        ? {
            id: next.id as string,
            date: next.plan_date as string,
            firstTime: firstTimes.get(next.id as string) ?? null,
          }
        : null,
      upcomingCount: counts.get(type.id) ?? 0,
      defaultTemplateName: type.defaultTemplateId ? (templateNames.get(type.defaultTemplateId) ?? null) : null,
    };
  });
}

export async function getServiceType(
  client: SupabaseClient,
  churchId: string,
  serviceTypeId: string,
): Promise<ServiceType | null> {
  const [type, times] = await Promise.all([
    client
      .from("service_types")
      .select(TYPE_COLUMNS)
      .eq("church_id", churchId)
      .eq("id", serviceTypeId)
      .is("archived_at", null)
      .maybeSingle(),
    client
      .from("service_type_times")
      .select(TIME_COLUMNS)
      .eq("church_id", churchId)
      .eq("service_type_id", serviceTypeId)
      .order("sort_order"),
  ]);
  fail("type", type.error);
  fail("type times", times.error);
  return type.data ? mapServiceType(type.data, times.data ?? []) : null;
}

function teamStatusFor(
  planId: string,
  members: Row[],
  openSlots: Map<string, number>,
): TeamStatus {
  const mine = members.filter((m) => m.plan_id === planId);
  return {
    confirmed: mine.filter((m) => m.status === "confirmed").length,
    pending: mine.filter((m) => m.status === "unconfirmed").length,
    unfilled: openSlots.get(planId) ?? 0,
  };
}

export async function listPlans(
  client: SupabaseClient,
  churchId: string,
  serviceTypeId: string,
  todayYmd: string,
): Promise<{ upcoming: PlanListRow[]; past: PlanListRow[] }> {
  const [upcoming, past] = await Promise.all([
    client
      .from("plans")
      .select("id, plan_date, title, series")
      .eq("church_id", churchId)
      .eq("service_type_id", serviceTypeId)
      .eq("is_template", false)
      .gte("plan_date", todayYmd)
      .order("plan_date")
      .limit(52),
    client
      .from("plans")
      .select("id, plan_date, title, series")
      .eq("church_id", churchId)
      .eq("service_type_id", serviceTypeId)
      .eq("is_template", false)
      .lt("plan_date", todayYmd)
      .order("plan_date", { ascending: false })
      .limit(26),
  ]);
  fail("plans upcoming", upcoming.error);
  fail("plans past", past.error);

  const all = [...(upcoming.data ?? []), ...(past.data ?? [])];
  const ids = all.map((p) => p.id as string);
  const stats = await planStats(client, churchId, ids);

  const toRow = (p: Row): PlanListRow => ({
    id: p.id as string,
    date: p.plan_date as string,
    title: (p.title as string | null) ?? null,
    series: (p.series as string | null) ?? null,
    itemCount: stats.items.get(p.id as string)?.count ?? 0,
    totalSeconds: stats.items.get(p.id as string)?.seconds ?? 0,
    teamStatus: teamStatusFor(p.id as string, stats.members, stats.openSlots),
  });

  return { upcoming: (upcoming.data ?? []).map(toRow), past: (past.data ?? []).map(toRow) };
}

async function planStats(client: SupabaseClient, churchId: string, planIds: string[]) {
  const items = new Map<string, { count: number; seconds: number }>();
  const openSlots = new Map<string, number>();
  if (!planIds.length) return { items, members: [] as Row[], openSlots };

  const [itemRows, members, leaders] = await Promise.all([
    client
      .from("plan_items")
      .select("plan_id, item_type, length_seconds")
      .eq("church_id", churchId)
      .in("plan_id", planIds)
      .is("deleted_at", null),
    client
      .from("plan_team_members")
      .select("plan_id, status, team_position_id")
      .eq("church_id", churchId)
      .in("plan_id", planIds),
    client
      .from("plan_item_leaders")
      .select("plan_id, team_position_id, person_id")
      .eq("church_id", churchId)
      .in("plan_id", planIds)
      .is("person_id", null),
  ]);
  fail("item stats", itemRows.error);
  fail("team stats", members.error);
  fail("open slots", leaders.error);

  for (const row of itemRows.data ?? []) {
    const entry = items.get(row.plan_id as string) ?? { count: 0, seconds: 0 };
    if (row.item_type !== "header") {
      entry.count += 1;
      entry.seconds += (row.length_seconds as number) ?? 0;
    }
    items.set(row.plan_id as string, entry);
  }

  // An open position counts as unfilled until someone on the plan's team
  // holds it and has not declined.
  const filled = new Set(
    (members.data ?? [])
      .filter((m) => m.status !== "declined")
      .map((m) => `${m.plan_id}:${m.team_position_id}`),
  );
  const seen = new Set<string>();
  for (const l of leaders.data ?? []) {
    const key = `${l.plan_id}:${l.team_position_id}`;
    if (filled.has(key) || seen.has(key)) continue;
    seen.add(key);
    openSlots.set(l.plan_id as string, (openSlots.get(l.plan_id as string) ?? 0) + 1);
  }

  return { items, members: members.data ?? [], openSlots };
}

export async function listTemplates(
  client: SupabaseClient,
  churchId: string,
  serviceTypeId: string,
): Promise<{ id: string; title: string; itemCount: number; totalSeconds: number }[]> {
  const { data, error } = await client
    .from("plans")
    .select("id, title")
    .eq("church_id", churchId)
    .eq("service_type_id", serviceTypeId)
    .eq("is_template", true)
    .order("title");
  fail("templates", error);
  const stats = await planStats(client, churchId, (data ?? []).map((t) => t.id as string));
  return (data ?? []).map((t) => ({
    id: t.id as string,
    title: t.title as string,
    itemCount: stats.items.get(t.id as string)?.count ?? 0,
    totalSeconds: stats.items.get(t.id as string)?.seconds ?? 0,
  }));
}

export async function listTeams(
  client: SupabaseClient,
  churchId: string,
  serviceTypeId: string,
): Promise<Team[]> {
  const { data: teams, error } = await client
    .from("teams")
    .select("id, name, sort_order")
    .eq("church_id", churchId)
    .eq("service_type_id", serviceTypeId)
    .is("archived_at", null)
    .order("sort_order")
    .order("name");
  fail("teams", error);
  const ids = (teams ?? []).map((t) => t.id as string);
  if (!ids.length) return [];

  const [positions, categories] = await Promise.all([
    client
      .from("team_positions")
      .select("id, team_id, name, sort_order")
      .eq("church_id", churchId)
      .in("team_id", ids)
      .order("sort_order")
      .order("name"),
    client
      .from("team_note_categories")
      .select("team_id, category")
      .eq("church_id", churchId)
      .in("team_id", ids),
  ]);
  fail("positions", positions.error);
  fail("team categories", categories.error);

  return (teams ?? []).map((t) => ({
    id: t.id as string,
    name: t.name as string,
    positions: (positions.data ?? [])
      .filter((p) => p.team_id === t.id)
      .map((p) => ({ id: p.id as string, name: p.name as string })),
    noteCategories: NOTE_CATEGORIES.filter((c) =>
      (categories.data ?? []).some((row) => row.team_id === t.id && row.category === c),
    ),
  }));
}

/** Teams and positions for every service type, for leader pickers. */
async function positionLabels(
  client: SupabaseClient,
  churchId: string,
  positionIds: string[],
): Promise<Map<string, { name: string; teamId: string; teamName: string }>> {
  const out = new Map<string, { name: string; teamId: string; teamName: string }>();
  if (!positionIds.length) return out;
  const { data: positions, error } = await client
    .from("team_positions")
    .select("id, name, team_id")
    .eq("church_id", churchId)
    .in("id", positionIds);
  fail("position labels", error);
  const teamIds = [...new Set((positions ?? []).map((p) => p.team_id as string))];
  const { data: teams, error: teamError } = teamIds.length
    ? await client.from("teams").select("id, name").eq("church_id", churchId).in("id", teamIds)
    : { data: [], error: null };
  fail("team labels", teamError);
  const teamNames = new Map((teams ?? []).map((t) => [t.id as string, t.name as string]));
  for (const p of positions ?? []) {
    out.set(p.id as string, {
      name: p.name as string,
      teamId: p.team_id as string,
      teamName: teamNames.get(p.team_id as string) ?? "Team",
    });
  }
  return out;
}

async function peopleById(
  client: SupabaseClient,
  churchId: string,
  ids: string[],
): Promise<Map<string, Row>> {
  if (!ids.length) return new Map();
  const { data, error } = await client
    .from("members")
    .select("id, first_name, last_name, photo_url")
    .eq("church_id", churchId)
    .in("id", ids);
  fail("people", error);
  return new Map((data ?? []).map((m) => [m.id as string, m]));
}

export async function getPlan(
  client: SupabaseClient,
  churchId: string,
  planId: string,
): Promise<Plan | null> {
  const { data: plan, error } = await client
    .from("plans")
    .select("id, service_type_id, plan_date, title, series, is_template, share_version, updated_at")
    .eq("church_id", churchId)
    .eq("id", planId)
    .maybeSingle();
  fail("plan", error);
  if (!plan) return null;

  const [type, times, items, leaders, notes, team, shares] = await Promise.all([
    client
      .from("service_types")
      .select("name, target_seconds")
      .eq("church_id", churchId)
      .eq("id", plan.service_type_id as string)
      .maybeSingle(),
    client
      .from("plan_times")
      .select("id, kind, label, starts_at")
      .eq("church_id", churchId)
      .eq("plan_id", planId)
      .order("starts_at"),
    client
      .from("plan_items")
      .select(
        "id, position, item_type, title, length_seconds, description, media_url, song_id, arrangement_id, song_key, updated_at, updated_by",
      )
      .eq("church_id", churchId)
      .eq("plan_id", planId)
      .is("deleted_at", null),
    client
      .from("plan_item_leaders")
      .select("plan_item_id, person_id, team_position_id, sort_order")
      .eq("church_id", churchId)
      .eq("plan_id", planId)
      .order("sort_order"),
    client
      .from("plan_notes")
      .select("id, plan_item_id, category, body, updated_at")
      .eq("church_id", churchId)
      .eq("plan_id", planId),
    client
      .from("plan_team_members")
      .select("id, team_position_id, person_id, status")
      .eq("church_id", churchId)
      .eq("plan_id", planId),
    client
      .from("plan_shares")
      .select("version_sent")
      .eq("church_id", churchId)
      .eq("plan_id", planId)
      .is("revoked_at", null)
      .order("version_sent", { ascending: false })
      .limit(1),
  ]);
  for (const [name, result] of Object.entries({ type, times, items, leaders, notes, team, shares })) {
    fail(name, result.error);
  }

  const songIds = [...new Set((items.data ?? []).map((i) => i.song_id).filter(Boolean) as string[])];
  const arrangementIds = [
    ...new Set((items.data ?? []).map((i) => i.arrangement_id).filter(Boolean) as string[]),
  ];
  const personIds = [
    ...new Set(
      [...(leaders.data ?? []), ...(team.data ?? [])].map((r) => r.person_id).filter(Boolean) as string[],
    ),
  ];
  const positionIds = [
    ...new Set(
      [...(leaders.data ?? []), ...(team.data ?? [])].map((r) => r.team_position_id).filter(Boolean) as string[],
    ),
  ];

  const [songs, arrangements, people, positions] = await Promise.all([
    songIds.length
      ? client.from("songs").select("id, title, author, ccli_number").eq("church_id", churchId).in("id", songIds)
      : Promise.resolve({ data: [] as Row[], error: null }),
    arrangementIds.length
      ? client
          .from("song_arrangements")
          .select("id, name, key")
          .eq("church_id", churchId)
          .in("id", arrangementIds)
      : Promise.resolve({ data: [] as Row[], error: null }),
    peopleById(client, churchId, personIds),
    positionLabels(client, churchId, positionIds),
  ]);
  fail("songs", songs.error);
  fail("arrangements", arrangements.error);
  const songMap = new Map((songs.data ?? []).map((s) => [s.id as string, s]));
  const arrangementMap = new Map((arrangements.data ?? []).map((a) => [a.id as string, a]));

  const leadersFor = (itemId: string): Leader[] =>
    (leaders.data ?? [])
      .filter((l) => l.plan_item_id === itemId)
      .map((l) => {
        const person = l.person_id ? people.get(l.person_id as string) : null;
        const position = l.team_position_id ? positions.get(l.team_position_id as string) : null;
        return {
          personId: (l.person_id as string | null) ?? null,
          teamPositionId: (l.team_position_id as string | null) ?? null,
          name: person ? personName(person) : (position?.name ?? "Open position"),
          positionLabel: position ? `${position.teamName} · ${position.name}` : null,
          photoUrl: (person?.photo_url as string | null) ?? null,
        };
      });

  const mappedItems: PlanItem[] = (items.data ?? [])
    .sort((a, b) => compareKeys(a.position as string, b.position as string))
    .map((i) => {
      const song = i.song_id ? songMap.get(i.song_id as string) : null;
      const arrangement = i.arrangement_id ? arrangementMap.get(i.arrangement_id as string) : null;
      return {
        id: i.id as string,
        position: i.position as string,
        itemType: i.item_type as ItemType,
        title: i.title as string,
        lengthSeconds: i.length_seconds as number,
        description: (i.description as string | null) ?? null,
        mediaUrl: (i.media_url as string | null) ?? null,
        song: song
          ? {
              songId: song.id as string,
              title: song.title as string,
              author: (song.author as string | null) ?? null,
              ccliNumber: (song.ccli_number as string | null) ?? null,
              arrangementId: (arrangement?.id as string | undefined) ?? null,
              arrangementName: (arrangement?.name as string | undefined) ?? null,
              key: (i.song_key as string | null) ?? (arrangement?.key as string | null) ?? null,
            }
          : null,
        leaders: leadersFor(i.id as string),
        updatedAt: i.updated_at as string,
        updatedBy: (i.updated_by as string | null) ?? null,
      };
    });

  const mappedNotes: PlanNote[] = (notes.data ?? []).map((n) => ({
    id: n.id as string,
    itemId: (n.plan_item_id as string | null) ?? null,
    category: n.category as NoteCategory,
    body: n.body as string,
    updatedAt: n.updated_at as string,
  }));

  const mappedTeam: PlanTeamMember[] = (team.data ?? []).map((m) => {
    const position = positions.get(m.team_position_id as string);
    return {
      id: m.id as string,
      teamId: position?.teamId ?? "",
      teamName: position?.teamName ?? "Team",
      positionId: m.team_position_id as string,
      positionName: position?.name ?? "Position",
      personId: m.person_id as string,
      personName: personName(people.get(m.person_id as string)),
      status: m.status as TeamMemberStatus,
    };
  });

  return {
    id: plan.id as string,
    serviceTypeId: plan.service_type_id as string,
    serviceTypeName: (type.data?.name as string | undefined) ?? "Service",
    date: (plan.plan_date as string | null) ?? null,
    title: (plan.title as string | null) ?? null,
    series: (plan.series as string | null) ?? null,
    isTemplate: plan.is_template as boolean,
    shareVersion: plan.share_version as number,
    lastSharedVersion: (shares.data?.[0]?.version_sent as number | undefined) ?? null,
    targetSeconds: (type.data?.target_seconds as number | null | undefined) ?? null,
    times: (times.data ?? []).map(mapTime),
    items: mappedItems,
    notes: mappedNotes,
    team: mappedTeam,
    updatedAt: plan.updated_at as string,
  };
}

/**
 * Names for pickers. Deliberately no email or phone: a planner may not hold
 * the People feature, and sending looks contact details up on the server.
 */
export async function listPeopleOptions(
  client: SupabaseClient,
  churchId: string,
): Promise<PersonOption[]> {
  const { data, error } = await client
    .from("members")
    .select("id, first_name, last_name, photo_url")
    .eq("church_id", churchId)
    .eq("is_active", true)
    .order("first_name")
    .order("last_name")
    .limit(5000);
  fail("people options", error);
  return (data ?? []).map((m) => ({
    id: m.id as string,
    name: personName(m),
    photoUrl: (m.photo_url as string | null) ?? null,
  }));
}

/** Plans that share a service type, for Copy a previous plan. */
export async function listRecentPlansForCopy(
  client: SupabaseClient,
  churchId: string,
  serviceTypeId: string,
): Promise<{ id: string; date: string; title: string | null }[]> {
  const { data, error } = await client
    .from("plans")
    .select("id, plan_date, title")
    .eq("church_id", churchId)
    .eq("service_type_id", serviceTypeId)
    .eq("is_template", false)
    .order("plan_date", { ascending: false })
    .limit(20);
  fail("recent plans", error);
  return (data ?? []).map((p) => ({
    id: p.id as string,
    date: p.plan_date as string,
    title: (p.title as string | null) ?? null,
  }));
}
