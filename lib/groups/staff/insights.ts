import { VisitorError } from "@/lib/faithform/errors";
import { loadStaffGroup, type StaffContext } from "@/lib/groups/staff/context";

/**
 * Groups insights for the dashboard.
 *
 * Every number here has one definition, stated where it is shown, and none
 * is designed to make anyone feel behind:
 *
 *   attendance rate   present ÷ (present + absent) over gatherings where
 *                     attendance was taken. Guests are not in the rate —
 *                     they are reported as a count beside it.
 *   average attendance  present + guests per recorded gathering.
 *   active member     attended at least one of the group's last six recorded
 *                     gatherings they were on the roster for.
 *   messages          counts only, per day, from delivery events — never
 *                     content, and never per person.
 *
 * A gathering without attendance taken is not "zero attendance"; it is
 * simply not in the numbers.
 */

export type ChurchGroupSummary = {
  activeGroups: number;
  archivedGroups: number;
  memberships: number;
  peopleInGroups: number;
  leaders: number;
  pendingRequests: number;
  joinedInWindow: number;
  leftInWindow: number;
  gatheringsInWindow: number;
  averageAttendance: number | null;
  attendanceRate: number | null;
  upcomingGatherings7d: number;
  groupsWithoutRecentGathering: number;
  windowDays: number;
};

export type WeeklyPoint = {
  weekStart: string;
  joined: number;
  departed: number;
  gatherings: number;
  present: number;
  guests: number;
  expected: number;
};

export async function churchGroupSummary(ctx: StaffContext, windowDays = 30): Promise<ChurchGroupSummary> {
  const days = Math.min(Math.max(Math.round(windowDays), 7), 365);
  const { data, error } = await ctx.admin.rpc("group_church_summary", { p_church_id: ctx.churchId, p_window_days: days });
  if (error) throw new VisitorError("unavailable", "Could not load group insights.");
  const row = ((data ?? []) as Record<string, number | string | null>[])[0] ?? {};
  const num = (key: string) => Number(row[key] ?? 0);
  const maybe = (key: string) => (row[key] === null || row[key] === undefined ? null : Number(row[key]));
  return {
    activeGroups: num("active_groups"),
    archivedGroups: num("archived_groups"),
    memberships: num("memberships"),
    peopleInGroups: num("people_in_groups"),
    leaders: num("leaders"),
    pendingRequests: num("pending_requests"),
    joinedInWindow: num("joined_in_window"),
    leftInWindow: num("left_in_window"),
    gatheringsInWindow: num("gatherings_in_window"),
    averageAttendance: maybe("average_attendance"),
    attendanceRate: maybe("attendance_rate"),
    upcomingGatherings7d: num("upcoming_gatherings_7d"),
    groupsWithoutRecentGathering: num("groups_without_recent_gathering"),
    windowDays: days,
  };
}

export async function weeklyTrend(ctx: StaffContext, groupId: string | null, weeks = 12): Promise<WeeklyPoint[]> {
  const group = groupId ? await loadStaffGroup(ctx, groupId, { includeDeleted: false }) : null;
  const { data, error } = await ctx.admin.rpc("group_weekly_trend", {
    p_church_id: ctx.churchId,
    p_group_id: group?.id ?? null,
    p_weeks: Math.min(Math.max(Math.round(weeks), 4), 52),
  });
  if (error) throw new VisitorError("unavailable", "Could not load the trend.");
  return ((data ?? []) as Record<string, string | number>[]).map((row) => ({
    weekStart: String(row.week_start),
    joined: Number(row.joined ?? 0),
    departed: Number(row.departed ?? 0),
    gatherings: Number(row.gatherings ?? 0),
    present: Number(row.present ?? 0),
    guests: Number(row.guests ?? 0),
    expected: Number(row.expected ?? 0),
  }));
}

export type GroupHealthRow = {
  groupId: string;
  name: string;
  memberCount: number;
  gatheringsRecorded: number;
  attendanceRate: number | null;
  averageAttendance: number | null;
  messages30d: number;
  lastGatheringAt: string | null;
  openReports: number;
};

/** One row per active group, over the last `windowDays`. */
export async function groupHealth(ctx: StaffContext, windowDays = 30): Promise<GroupHealthRow[]> {
  const days = Math.min(Math.max(Math.round(windowDays), 7), 365);
  const since = new Date(Date.now() - days * 86_400_000);
  const [{ data: groups }, { data: records }, { data: activity }, { data: reports }] = await Promise.all([
    ctx.admin
      .from("groups")
      .select("id, name, member_count")
      .eq("church_id", ctx.churchId)
      .eq("status", "active")
      .order("name", { ascending: true })
      .limit(1000),
    ctx.admin
      .from("group_attendance_records")
      .select("group_id, present_count, absent_count, guest_count, group_events!inner(starts_at)")
      .eq("church_id", ctx.churchId)
      .gte("group_events.starts_at", since.toISOString())
      .lte("group_events.starts_at", new Date().toISOString())
      .limit(10000),
    ctx.admin
      .from("group_activity_daily")
      .select("group_id, message_count")
      .eq("church_id", ctx.churchId)
      .gte("day", since.toISOString().slice(0, 10)),
    ctx.admin
      .from("messaging_reports")
      .select("group_id")
      .eq("church_id", ctx.churchId)
      .eq("status", "open")
      .not("group_id", "is", null),
  ]);

  type Tally = { gatherings: number; present: number; absent: number; guests: number; last: string | null };
  const tallies = new Map<string, Tally>();
  for (const row of (records ?? []) as {
    group_id: string;
    present_count: number;
    absent_count: number;
    guest_count: number;
    group_events: { starts_at: string } | { starts_at: string }[];
  }[]) {
    const event = Array.isArray(row.group_events) ? row.group_events[0] : row.group_events;
    const t = tallies.get(row.group_id) ?? { gatherings: 0, present: 0, absent: 0, guests: 0, last: null };
    t.gatherings += 1;
    t.present += row.present_count;
    t.absent += row.absent_count;
    t.guests += row.guest_count;
    if (event?.starts_at && (!t.last || event.starts_at > t.last)) t.last = event.starts_at;
    tallies.set(row.group_id, t);
  }
  const messages = new Map<string, number>();
  for (const row of (activity ?? []) as { group_id: string; message_count: number }[]) {
    messages.set(row.group_id, (messages.get(row.group_id) ?? 0) + row.message_count);
  }
  const openReports = new Map<string, number>();
  for (const row of (reports ?? []) as { group_id: string }[]) {
    openReports.set(row.group_id, (openReports.get(row.group_id) ?? 0) + 1);
  }

  return ((groups ?? []) as { id: string; name: string; member_count: number }[]).map((group) => {
    const t = tallies.get(group.id);
    return {
      groupId: group.id,
      name: group.name,
      memberCount: group.member_count,
      gatheringsRecorded: t?.gatherings ?? 0,
      attendanceRate: t && t.present + t.absent > 0 ? Math.round((t.present / (t.present + t.absent)) * 1000) / 1000 : null,
      averageAttendance: t && t.gatherings > 0 ? Math.round(((t.present + t.guests) / t.gatherings) * 10) / 10 : null,
      messages30d: messages.get(group.id) ?? 0,
      lastGatheringAt: t?.last ? new Date(t.last).toISOString() : null,
      openReports: openReports.get(group.id) ?? 0,
    };
  });
}

/** Participation for one group's roster, with the definitions in the header. */
export async function groupParticipation(ctx: StaffContext, groupId: string) {
  const group = await loadStaffGroup(ctx, groupId);
  const { data, error } = await ctx.admin.rpc("group_member_participation", {
    p_group_id: group.id,
    p_church_id: ctx.churchId,
    p_lookback: 6,
  });
  if (error) throw new VisitorError("unavailable", "Could not load participation.");
  const rows = (data ?? []) as { expected: number; attended: number; joined_at: string }[];
  const newCutoff = Date.now() - 30 * 86_400_000;
  let active = 0;
  let inactive = 0;
  let notYetExpected = 0;
  let recentlyJoined = 0;
  for (const row of rows) {
    if (Date.parse(row.joined_at) >= newCutoff) recentlyJoined += 1;
    if (Number(row.expected) === 0) notYetExpected += 1;
    else if (Number(row.attended) > 0) active += 1;
    else inactive += 1;
  }
  return { active, inactive, notYetExpected, recentlyJoined, lookback: 6 };
}
