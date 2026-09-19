import type { SupabaseClient } from "@supabase/supabase-js";

import { isMessagingConfigured } from "@/lib/messaging/config";
import { chatUserIdFor, cidOf, GROUP_CHANNEL_TYPE, groupChannelId } from "@/lib/messaging/ids";
import { joinActionFor } from "@/lib/groups/permissions";
import { describeSchedule, scheduleFromRow } from "@/lib/groups/schedule";
import type {
  GroupEnrollment,
  GroupRole,
  GroupStatus,
  GroupVisibility,
  MembershipState,
} from "@/lib/groups/types";

/**
 * Group projections, built in bulk.
 *
 * Every list of groups — My Groups, Discover, the dashboard — goes through
 * `buildGroupSummaries`, which reads types, campuses, schedules, the next
 * gathering, the viewer's own standing and chat bindings in one query each,
 * whatever the number of groups. Every field a client sees is chosen here.
 */

export const GROUP_COLUMNS =
  "id, church_id, type_id, name, description, cover_image_url, status, visibility, enrollment, capacity, campus_id, location_name, location_address, location_visibility, online_meeting_url, chat_enabled, chat_posting, allow_member_media, allow_member_links, member_list_visibility, safety_profile, default_notification_level, member_count, leader_count, pending_request_count, last_activity_at, version, created_at, updated_at, archived_at";

export type GroupRow = {
  id: string;
  church_id: string;
  type_id: string | null;
  name: string;
  description: string | null;
  cover_image_url: string | null;
  status: GroupStatus;
  visibility: GroupVisibility;
  enrollment: GroupEnrollment;
  capacity: number | null;
  campus_id: string | null;
  location_name: string | null;
  location_address: string | null;
  location_visibility: "public" | "members";
  online_meeting_url: string | null;
  chat_enabled: boolean;
  chat_posting: "everyone" | "leaders";
  allow_member_media: boolean;
  allow_member_links: boolean;
  member_list_visibility: "members" | "leaders";
  safety_profile: "standard" | "youth";
  default_notification_level: "all" | "mentions";
  member_count: number;
  leader_count: number;
  pending_request_count: number;
  last_activity_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

export type EventSummary = {
  id: string;
  groupId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  locationName: string | null;
  isCancelled: boolean;
  rsvp: string | null;
  goingCount: number;
};

export type ChatInfo = {
  cid: string;
  channelType: string;
  channelId: string;
  state: "ready" | "read_only" | "unavailable";
  postingPolicy: string;
};

export type GroupSummary = {
  id: string;
  name: string;
  summary: string | null;
  coverImageUrl: string | null;
  type: { id: string; name: string; icon: string } | null;
  memberCount: number;
  capacity: number | null;
  enrollment: string;
  visibility: string;
  status: string;
  scheduleText: string | null;
  meetingDays: number[];
  campusName: string | null;
  locationName: string | null;
  nextEvent: EventSummary | null;
  membershipState: MembershipState;
  groupRole: GroupRole | null;
  joinAction: string;
  chat: ChatInfo | null;
  isYouth: boolean;
  version: number;
};

export type Viewer =
  | { kind: "member"; accountId: string; linkedMemberId: string | null }
  | { kind: "staff" };

export function summarize(description: string | null): string | null {
  if (!description) return null;
  const flat = description.replace(/\s+/g, " ").trim();
  if (flat.length <= 280) return flat || null;
  const cut = flat.slice(0, 279);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 200)).trimEnd()}…`;
}

export function chatStateFor(
  group: Pick<GroupRow, "status" | "chat_enabled">,
  bindingState: string | null,
  messagingAvailable: boolean,
): ChatInfo["state"] {
  if (!messagingAvailable || !bindingState || bindingState === "pending" || bindingState === "deleted") {
    return "unavailable";
  }
  if (bindingState === "frozen" || group.status !== "active" || !group.chat_enabled) return "read_only";
  return "ready";
}

export function chatInfoFor(
  group: Pick<GroupRow, "id" | "status" | "chat_enabled" | "chat_posting">,
  bindingState: string | null,
  messagingAvailable: boolean,
): ChatInfo {
  const channelId = groupChannelId(group.id);
  return {
    cid: cidOf(GROUP_CHANNEL_TYPE, channelId),
    channelType: GROUP_CHANNEL_TYPE,
    channelId,
    state: chatStateFor(group, bindingState, messagingAvailable),
    postingPolicy: group.chat_posting,
  };
}

/** Whether chat is configured and switched on for this church. */
export async function messagingAvailableFor(admin: SupabaseClient, churchId: string): Promise<boolean> {
  if (!isMessagingConfigured()) return false;
  const { data } = await admin
    .from("church_messaging_settings")
    .select("messaging_enabled")
    .eq("church_id", churchId)
    .maybeSingle();
  return data ? data.messaging_enabled !== false : true;
}

export async function loadNextEvents(
  admin: SupabaseClient,
  groupIds: string[],
  accountId: string | null,
  now: Date = new Date(),
): Promise<Map<string, EventSummary>> {
  const result = new Map<string, EventSummary>();
  if (groupIds.length === 0) return result;
  const horizon = new Date(now.getTime() + 62 * 86_400_000).toISOString();
  const { data } = await admin
    .from("group_events")
    .select("id, group_id, title, starts_at, ends_at, timezone, location_name, status")
    .in("group_id", groupIds)
    .eq("status", "scheduled")
    .gte("ends_at", now.toISOString())
    .lte("starts_at", horizon)
    .order("starts_at", { ascending: true })
    .limit(Math.min(groupIds.length * 10, 1000));

  const firsts: Record<string, unknown>[] = [];
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const groupId = row.group_id as string;
    if (!result.has(groupId)) {
      firsts.push(row);
      result.set(groupId, toEventSummary(row, null, 0));
    }
  }
  const counts = await rsvpCounts(admin, firsts.map((row) => row.id as string), accountId);
  for (const row of firsts) {
    const eventId = row.id as string;
    const tally = counts.get(eventId);
    result.set(row.group_id as string, toEventSummary(row, tally?.mine ?? null, tally?.going ?? 0));
  }
  return result;
}

export async function rsvpCounts(
  admin: SupabaseClient,
  eventIds: string[],
  accountId: string | null,
): Promise<Map<string, { going: number; maybe: number; notGoing: number; mine: string | null }>> {
  const result = new Map<string, { going: number; maybe: number; notGoing: number; mine: string | null }>();
  if (eventIds.length === 0) return result;
  const { data } = await admin
    .from("group_event_rsvps")
    .select("event_id, account_id, response")
    .in("event_id", eventIds)
    .limit(10_000);
  for (const eventId of eventIds) result.set(eventId, { going: 0, maybe: 0, notGoing: 0, mine: null });
  for (const row of (data ?? []) as { event_id: string; account_id: string; response: string }[]) {
    const tally = result.get(row.event_id)!;
    if (row.response === "going") tally.going += 1;
    else if (row.response === "maybe") tally.maybe += 1;
    else tally.notGoing += 1;
    if (accountId && row.account_id === accountId) tally.mine = row.response;
  }
  return result;
}

export function toEventSummary(row: Record<string, unknown>, rsvp: string | null, goingCount: number): EventSummary {
  return {
    id: row.id as string,
    groupId: row.group_id as string,
    title: row.title as string,
    startsAt: new Date(row.starts_at as string).toISOString(),
    endsAt: new Date(row.ends_at as string).toISOString(),
    timezone: row.timezone as string,
    locationName: (row.location_name as string | null) ?? null,
    isCancelled: row.status === "cancelled",
    rsvp,
    goingCount,
  };
}

export async function buildGroupSummaries(
  admin: SupabaseClient,
  groups: GroupRow[],
  viewer: Viewer,
  options: { messagingAvailable?: boolean; now?: Date } = {},
): Promise<GroupSummary[]> {
  if (groups.length === 0) return [];
  const ids = groups.map((g) => g.id);
  const typeIds = [...new Set(groups.map((g) => g.type_id).filter((id): id is string => Boolean(id)))];
  const campusIds = [...new Set(groups.map((g) => g.campus_id).filter((id): id is string => Boolean(id)))];
  const accountId = viewer.kind === "member" ? viewer.accountId : null;

  const [types, campuses, schedules, nextEvents, memberships, requests, bindings] = await Promise.all([
    typeIds.length
      ? admin.from("group_types").select("id, name, icon").in("id", typeIds)
      : Promise.resolve({ data: [] }),
    campusIds.length
      ? admin.from("church_campuses").select("id, name").in("id", campusIds)
      : Promise.resolve({ data: [] }),
    admin
      .from("group_meeting_schedules")
      .select("id, group_id, frequency, day_of_week, week_of_month, start_time, duration_minutes, timezone, starts_on, ends_on, is_active, created_at")
      .in("group_id", ids)
      .eq("is_active", true)
      .order("created_at", { ascending: true }),
    loadNextEvents(admin, ids, accountId, options.now),
    viewer.kind === "member"
      ? admin
          .from("group_memberships")
          .select("group_id, group_role, status, account_id, member_id")
          .in("group_id", ids)
          .eq("status", "active")
          .or(
            viewer.linkedMemberId
              ? `account_id.eq.${viewer.accountId},member_id.eq.${viewer.linkedMemberId}`
              : `account_id.eq.${viewer.accountId}`,
          )
      : Promise.resolve({ data: [] }),
    viewer.kind === "member"
      ? admin
          .from("group_join_requests")
          .select("group_id")
          .in("group_id", ids)
          .eq("account_id", viewer.accountId)
          .eq("status", "pending")
      : Promise.resolve({ data: [] }),
    admin.from("group_chat_bindings").select("group_id, state").in("group_id", ids),
  ]);

  const typeById = new Map(
    ((types.data ?? []) as { id: string; name: string; icon: string }[]).map((t) => [t.id, t]),
  );
  const campusById = new Map(
    ((campuses.data ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]),
  );
  const schedulesByGroup = new Map<string, Record<string, unknown>[]>();
  for (const row of (schedules.data ?? []) as Record<string, unknown>[]) {
    const list = schedulesByGroup.get(row.group_id as string) ?? [];
    list.push(row);
    schedulesByGroup.set(row.group_id as string, list);
  }
  const roleByGroup = new Map(
    ((memberships.data ?? []) as { group_id: string; group_role: GroupRole }[]).map((m) => [m.group_id, m.group_role]),
  );
  const requested = new Set(((requests.data ?? []) as { group_id: string }[]).map((r) => r.group_id));
  const bindingByGroup = new Map(
    ((bindings.data ?? []) as { group_id: string; state: string }[]).map((b) => [b.group_id, b.state]),
  );
  const messagingAvailable = options.messagingAvailable ?? isMessagingConfigured();

  return groups.map((group) => {
    const role = roleByGroup.get(group.id) ?? null;
    const state: MembershipState =
      viewer.kind === "staff" ? "not_member" : role ? "member" : requested.has(group.id) ? "requested" : "not_member";
    const groupSchedules = (schedulesByGroup.get(group.id) ?? []).map(scheduleFromRow);
    const primary = groupSchedules[0];
    const type = group.type_id ? typeById.get(group.type_id) ?? null : null;
    const canSeeChat = viewer.kind === "staff" || Boolean(role);

    return {
      id: group.id,
      name: group.name,
      summary: summarize(group.description),
      coverImageUrl: group.cover_image_url,
      type: type ? { id: type.id, name: type.name, icon: type.icon } : null,
      memberCount: group.member_count,
      capacity: group.capacity,
      enrollment: group.enrollment,
      visibility: group.visibility,
      status: group.status,
      scheduleText: primary ? describeSchedule(primary) : null,
      meetingDays: [...new Set(groupSchedules.map((s) => s.dayOfWeek))].sort(),
      campusName: group.campus_id ? campusById.get(group.campus_id) ?? null : null,
      locationName:
        group.location_visibility === "public" || role || viewer.kind === "staff" ? group.location_name : null,
      nextEvent: nextEvents.get(group.id) ?? null,
      membershipState: state,
      groupRole: role,
      joinAction: joinActionFor({
        state,
        status: group.status,
        visibility: group.visibility,
        enrollment: group.enrollment,
        capacity: group.capacity,
        memberCount: group.member_count,
      }),
      chat: canSeeChat ? chatInfoFor(group, bindingByGroup.get(group.id) ?? null, messagingAvailable) : null,
      isYouth: group.safety_profile === "youth",
      version: group.version,
    };
  });
}

export type PersonLabel = {
  name: string;
  avatarUrl: string | null;
  chatUserId: string | null;
  authUserId: string | null;
};

/**
 * Names for memberships: the People record's name when there is one, else the
 * app account's display name. Never an email address.
 */
export async function labelMemberships(
  admin: SupabaseClient,
  rows: { id: string; member_id: string | null; account_id: string | null }[],
): Promise<Map<string, PersonLabel>> {
  const memberIds = [...new Set(rows.map((r) => r.member_id).filter((id): id is string => Boolean(id)))];
  const accountIds = [...new Set(rows.map((r) => r.account_id).filter((id): id is string => Boolean(id)))];
  const [members, accounts] = await Promise.all([
    memberIds.length
      ? admin.from("members").select("id, first_name, last_name, photo_url").in("id", memberIds)
      : Promise.resolve({ data: [] }),
    accountIds.length
      ? admin.from("visitor_accounts").select("id, user_id, display_name, avatar_url").in("id", accountIds)
      : Promise.resolve({ data: [] }),
  ]);
  const memberById = new Map(
    ((members.data ?? []) as { id: string; first_name: string; last_name: string; photo_url: string | null }[]).map(
      (m) => [m.id, m],
    ),
  );
  const accountById = new Map(
    ((accounts.data ?? []) as { id: string; user_id: string; display_name: string | null; avatar_url: string | null }[]).map(
      (a) => [a.id, a],
    ),
  );

  const labels = new Map<string, PersonLabel>();
  for (const row of rows) {
    const member = row.member_id ? memberById.get(row.member_id) : undefined;
    const account = row.account_id ? accountById.get(row.account_id) : undefined;
    const peopleName = member ? `${member.first_name} ${member.last_name}`.replace(/\s+/g, " ").trim() : "";
    const name = peopleName || account?.display_name?.trim() || "Church member";
    const avatar =
      (account?.avatar_url && /^https:\/\//.test(account.avatar_url) ? account.avatar_url : null) ??
      (member?.photo_url && /^https:\/\//.test(member.photo_url) ? member.photo_url : null);
    labels.set(row.id, {
      name: name.slice(0, 120),
      avatarUrl: avatar,
      chatUserId: account ? chatUserIdFor(account.user_id) : null,
      authUserId: account?.user_id ?? null,
    });
  }
  return labels;
}
