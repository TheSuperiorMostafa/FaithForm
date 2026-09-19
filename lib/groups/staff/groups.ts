import { randomUUID } from "node:crypto";

import { z } from "zod";

import { VisitorError } from "@/lib/faithform/errors";
import { isUuid } from "@/lib/groups/context";
import { labelMemberships, type GroupRow, GROUP_COLUMNS, chatStateFor, messagingAvailableFor } from "@/lib/groups/read-models";
import { describeSchedule, scheduleFromRow, scheduleInputSchema } from "@/lib/groups/schedule";
import {
  GROUP_ENROLLMENTS,
  GROUP_TYPE_ICONS,
  GROUP_VISIBILITIES,
  type GroupRole,
} from "@/lib/groups/types";
import { StaffFieldError, loadStaffGroup, staffActor, type StaffContext } from "@/lib/groups/staff/context";
import { dedupeKey, syncNow } from "@/lib/messaging/sync/worker";
import { normalizeSiteImage } from "@/lib/security/validate-image";
import { getAspect } from "@/lib/sites/image-aspects";

/**
 * Groups as church staff manage them: the list, a group's settings, its
 * meeting schedules, its category, its cover, and its lifecycle.
 *
 * Every read and write names the staff member's own church. Lifecycle changes
 * go through `group_set_lifecycle`, one transaction each; everything the chat
 * provider must learn about follows from the triggers in 0092.
 */

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

export type StaffGroupListItem = {
  id: string;
  name: string;
  coverImageUrl: string | null;
  status: GroupRow["status"];
  visibility: GroupRow["visibility"];
  enrollment: GroupRow["enrollment"];
  type: { id: string; name: string; icon: string } | null;
  memberCount: number;
  capacity: number | null;
  pendingRequestCount: number;
  leaders: string[];
  scheduleText: string | null;
  nextGatheringAt: string | null;
  lastActivityAt: string | null;
  messagesLast7Days: number;
  hasUnseenActivity: boolean;
  isYouth: boolean;
  chatState: "ready" | "read_only" | "unavailable";
};

export type StaffGroupFilters = {
  status?: "active" | "archived";
  typeId?: string | null;
  query?: string | null;
  needsAttention?: boolean;
};

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function listStaffGroups(ctx: StaffContext, filters: StaffGroupFilters = {}): Promise<StaffGroupListItem[]> {
  let query = ctx.admin
    .from("groups")
    .select(GROUP_COLUMNS)
    .eq("church_id", ctx.churchId)
    .eq("status", filters.status ?? "active")
    .order("name", { ascending: true })
    .limit(1000);
  if (filters.typeId && isUuid(filters.typeId)) query = query.eq("type_id", filters.typeId);
  const needle = filters.query?.trim().slice(0, 80);
  if (needle) query = query.ilike("name", `%${escapeLike(needle)}%`);
  if (filters.needsAttention) query = query.gt("pending_request_count", 0);

  const { data, error } = await query;
  if (error) throw new VisitorError("unavailable", "Could not load groups.");
  const groups = (data ?? []) as unknown as GroupRow[];
  if (groups.length === 0) return [];
  const ids = groups.map((g) => g.id);
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  const nowIso = new Date().toISOString();

  const [types, schedules, leaders, events, activity, reads, bindings, messagingAvailable] = await Promise.all([
    ctx.admin.from("group_types").select("id, name, icon").eq("church_id", ctx.churchId),
    ctx.admin
      .from("group_meeting_schedules")
      .select("id, group_id, frequency, day_of_week, week_of_month, start_time, duration_minutes, timezone, starts_on, ends_on, is_active")
      .eq("church_id", ctx.churchId)
      .eq("is_active", true)
      .in("group_id", ids),
    ctx.admin
      .from("group_memberships")
      .select("id, group_id, member_id, account_id")
      .eq("church_id", ctx.churchId)
      .eq("status", "active")
      .eq("group_role", "leader")
      .in("group_id", ids),
    ctx.admin
      .from("group_events")
      .select("group_id, starts_at")
      .eq("church_id", ctx.churchId)
      .eq("status", "scheduled")
      .gte("starts_at", nowIso)
      .in("group_id", ids)
      .order("starts_at", { ascending: true })
      .limit(3000),
    ctx.admin
      .from("group_activity_daily")
      .select("group_id, message_count")
      .eq("church_id", ctx.churchId)
      .gte("day", since)
      .in("group_id", ids),
    ctx.admin.from("group_staff_reads").select("group_id, last_viewed_at").eq("user_id", ctx.userId).in("group_id", ids),
    ctx.admin.from("group_chat_bindings").select("group_id, state").in("group_id", ids),
    messagingAvailableFor(ctx.admin, ctx.churchId),
  ]);

  const typeById = new Map(((types.data ?? []) as { id: string; name: string; icon: string }[]).map((t) => [t.id, t]));
  const scheduleByGroup = new Map<string, string>();
  for (const row of (schedules.data ?? []) as Record<string, unknown>[]) {
    const groupId = row.group_id as string;
    if (!scheduleByGroup.has(groupId)) scheduleByGroup.set(groupId, describeSchedule(scheduleFromRow(row)));
  }
  const leaderRows = (leaders.data ?? []) as { id: string; group_id: string; member_id: string | null; account_id: string | null }[];
  const labels = await labelMemberships(ctx.admin, leaderRows);
  const leadersByGroup = new Map<string, string[]>();
  for (const row of leaderRows) {
    const list = leadersByGroup.get(row.group_id) ?? [];
    list.push(labels.get(row.id)?.name ?? "Leader");
    leadersByGroup.set(row.group_id, list);
  }
  const nextByGroup = new Map<string, string>();
  for (const row of (events.data ?? []) as { group_id: string; starts_at: string }[]) {
    if (!nextByGroup.has(row.group_id)) nextByGroup.set(row.group_id, new Date(row.starts_at).toISOString());
  }
  const messagesByGroup = new Map<string, number>();
  for (const row of (activity.data ?? []) as { group_id: string; message_count: number }[]) {
    messagesByGroup.set(row.group_id, (messagesByGroup.get(row.group_id) ?? 0) + row.message_count);
  }
  const readByGroup = new Map(((reads.data ?? []) as { group_id: string; last_viewed_at: string }[]).map((r) => [r.group_id, r.last_viewed_at]));
  const bindingByGroup = new Map(((bindings.data ?? []) as { group_id: string; state: string }[]).map((b) => [b.group_id, b.state]));

  return groups.map((group) => {
    const lastViewed = readByGroup.get(group.id);
    return {
      id: group.id,
      name: group.name,
      coverImageUrl: group.cover_image_url,
      status: group.status,
      visibility: group.visibility,
      enrollment: group.enrollment,
      type: group.type_id ? typeById.get(group.type_id) ?? null : null,
      memberCount: group.member_count,
      capacity: group.capacity,
      pendingRequestCount: group.pending_request_count,
      leaders: (leadersByGroup.get(group.id) ?? []).sort((a, b) => a.localeCompare(b)),
      scheduleText: scheduleByGroup.get(group.id) ?? null,
      nextGatheringAt: nextByGroup.get(group.id) ?? null,
      lastActivityAt: group.last_activity_at,
      messagesLast7Days: messagesByGroup.get(group.id) ?? 0,
      hasUnseenActivity: Boolean(
        group.last_activity_at && (!lastViewed || Date.parse(group.last_activity_at) > Date.parse(lastViewed)),
      ),
      isYouth: group.safety_profile === "youth",
      chatState: chatStateFor(group, bindingByGroup.get(group.id) ?? null, messagingAvailable),
    };
  });
}

// ---------------------------------------------------------------------------
// One group
// ---------------------------------------------------------------------------

export type StaffGroupDetail = {
  group: GroupRow;
  type: { id: string; name: string; icon: string } | null;
  campus: { id: string; name: string } | null;
  schedules: (ReturnType<typeof scheduleFromRow> & { description: string })[];
  leaders: { membershipId: string; name: string; avatarUrl: string | null; role: GroupRole }[];
  openReportCount: number;
  chatState: "ready" | "read_only" | "unavailable";
  chatCid: string | null;
  churchSlug: string | null;
};

export async function getStaffGroup(ctx: StaffContext, groupId: string): Promise<StaffGroupDetail> {
  const group = await loadStaffGroup(ctx, groupId);
  const [type, campus, schedules, leaders, reports, binding, messagingAvailable] = await Promise.all([
    group.type_id
      ? ctx.admin.from("group_types").select("id, name, icon").eq("id", group.type_id).eq("church_id", ctx.churchId).maybeSingle()
      : Promise.resolve({ data: null }),
    group.campus_id
      ? ctx.admin.from("church_campuses").select("id, name").eq("id", group.campus_id).eq("church_id", ctx.churchId).maybeSingle()
      : Promise.resolve({ data: null }),
    ctx.admin
      .from("group_meeting_schedules")
      .select("id, frequency, day_of_week, week_of_month, start_time, duration_minutes, timezone, starts_on, ends_on, is_active")
      .eq("group_id", group.id)
      .eq("church_id", ctx.churchId)
      .order("created_at", { ascending: true }),
    ctx.admin
      .from("group_memberships")
      .select("id, member_id, account_id, group_role")
      .eq("group_id", group.id)
      .eq("church_id", ctx.churchId)
      .eq("status", "active")
      .in("group_role", ["leader", "manager"]),
    ctx.admin
      .from("messaging_reports")
      .select("id", { count: "exact", head: true })
      .eq("church_id", ctx.churchId)
      .eq("group_id", group.id)
      .eq("status", "open"),
    ctx.admin.from("group_chat_bindings").select("state, channel_id").eq("group_id", group.id).maybeSingle(),
    messagingAvailableFor(ctx.admin, ctx.churchId),
  ]);

  const leaderRows = (leaders.data ?? []) as { id: string; member_id: string | null; account_id: string | null; group_role: GroupRole }[];
  const labels = await labelMemberships(ctx.admin, leaderRows);

  return {
    group,
    type: (type.data as StaffGroupDetail["type"]) ?? null,
    campus: (campus.data as StaffGroupDetail["campus"]) ?? null,
    schedules: ((schedules.data ?? []) as Record<string, unknown>[]).map((row) => {
      const schedule = scheduleFromRow(row);
      return { ...schedule, description: describeSchedule(schedule) };
    }),
    leaders: leaderRows
      .map((row) => ({
        membershipId: row.id,
        name: labels.get(row.id)?.name ?? "Leader",
        avatarUrl: labels.get(row.id)?.avatarUrl ?? null,
        role: row.group_role,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    openReportCount: reports.count ?? 0,
    chatState: chatStateFor(group, (binding.data?.state as string | undefined) ?? null, messagingAvailable),
    chatCid: binding.data?.channel_id ? `ff_group:${binding.data.channel_id as string}` : null,
    churchSlug: ctx.church.slug,
  };
}

// ---------------------------------------------------------------------------
// Create and edit
// ---------------------------------------------------------------------------

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null));

export const groupInputSchema = z.object({
  name: z.string().trim().min(1, "Give the group a name.").max(80, "Keep the name under 80 characters."),
  description: optionalText(4000),
  typeId: z.string().uuid().nullable().optional().transform((v) => v ?? null),
  visibility: z.enum(GROUP_VISIBILITIES),
  enrollment: z.enum(GROUP_ENROLLMENTS),
  capacity: z.coerce.number().int().min(1, "Capacity must be at least 1.").max(5000).nullable().optional().transform((v) => v ?? null),
  campusId: z.string().uuid().nullable().optional().transform((v) => v ?? null),
  locationName: optionalText(200),
  locationAddress: optionalText(500),
  locationVisibility: z.enum(["public", "members"]).default("members"),
  onlineMeetingUrl: z
    .string()
    .trim()
    .max(2048)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || /^https:\/\/[^\s]+$/i.test(v), "Meeting links must start with https://"),
  chatEnabled: z.boolean().default(true),
  chatPosting: z.enum(["everyone", "leaders"]).default("everyone"),
  allowMemberMedia: z.boolean().default(true),
  allowMemberLinks: z.boolean().default(true),
  memberListVisibility: z.enum(["members", "leaders"]).default("members"),
  safetyProfile: z.enum(["standard", "youth"]).default("standard"),
  defaultNotificationLevel: z.enum(["all", "mentions"]).default("all"),
});

export type GroupInput = z.input<typeof groupInputSchema>;

function parseGroupInput(input: unknown) {
  const parsed = groupInputSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new StaffFieldError(issue?.message ?? "Check the form and try again.", issue?.path.join("."));
  }
  return parsed.data;
}

async function assertOwnedReferences(ctx: StaffContext, values: { typeId: string | null; campusId: string | null }) {
  const [type, campus] = await Promise.all([
    values.typeId
      ? ctx.admin.from("group_types").select("id").eq("id", values.typeId).eq("church_id", ctx.churchId).maybeSingle()
      : Promise.resolve({ data: { id: null } }),
    values.campusId
      ? ctx.admin.from("church_campuses").select("id").eq("id", values.campusId).eq("church_id", ctx.churchId).maybeSingle()
      : Promise.resolve({ data: { id: null } }),
  ]);
  if (!type.data) throw new StaffFieldError("Choose one of your church's categories.", "typeId");
  if (!campus.data) throw new StaffFieldError("Choose one of your church's campuses.", "campusId");
}

function toColumns(values: ReturnType<typeof parseGroupInput>) {
  return {
    name: values.name,
    description: values.description,
    type_id: values.typeId,
    visibility: values.visibility,
    enrollment: values.enrollment,
    capacity: values.capacity,
    campus_id: values.campusId,
    location_name: values.locationName,
    location_address: values.locationAddress,
    location_visibility: values.locationVisibility,
    online_meeting_url: values.onlineMeetingUrl,
    chat_enabled: values.chatEnabled,
    chat_posting: values.chatPosting,
    allow_member_media: values.allowMemberMedia,
    allow_member_links: values.allowMemberLinks,
    member_list_visibility: values.memberListVisibility,
    safety_profile: values.safetyProfile,
    default_notification_level: values.defaultNotificationLevel,
  };
}

export async function createStaffGroup(ctx: StaffContext, input: unknown): Promise<{ id: string }> {
  const values = parseGroupInput(input);
  await assertOwnedReferences(ctx, values);
  const { data, error } = await ctx.admin
    .from("groups")
    .insert({ ...toColumns(values), church_id: ctx.churchId, created_by: ctx.userId, updated_by: ctx.userId })
    .select("id")
    .single();
  if (error || !data) throw new VisitorError("unavailable", "Could not create the group. Please try again.");
  await ctx.admin.rpc("log_group_event", {
    p_church_id: ctx.churchId,
    p_group_id: data.id,
    p_action: "group_created",
    p_actor_type: "staff",
    p_actor_user_id: ctx.userId,
    p_membership_id: null,
    p_account_id: null,
    p_member_id: null,
    p_detail: {},
  });
  await syncNow([dedupeKey("group.channel", data.id as string)], { budgetMs: 3_000 });
  return { id: data.id as string };
}

/**
 * Saves a group's settings. `expectedVersion` is the version the form was
 * loaded at: a group someone else changed meanwhile is not silently
 * overwritten.
 */
export async function updateStaffGroup(
  ctx: StaffContext,
  groupId: string,
  input: unknown,
  expectedVersion: number,
): Promise<{ version: number }> {
  const group = await loadStaffGroup(ctx, groupId);
  if (group.status === "archived") {
    throw new VisitorError("conflict", "Restore this group before changing its settings.");
  }
  const values = parseGroupInput(input);
  await assertOwnedReferences(ctx, values);
  if (values.capacity !== null && values.capacity < group.member_count) {
    throw new StaffFieldError(
      `This group already has ${group.member_count} members. Capacity can't be lower than that.`,
      "capacity",
    );
  }

  const { data, error } = await ctx.admin
    .from("groups")
    .update({ ...toColumns(values), updated_by: ctx.userId })
    .eq("id", group.id)
    .eq("church_id", ctx.churchId)
    .eq("version", expectedVersion)
    .select("version");
  if (error) throw new VisitorError("unavailable", "Could not save the group. Please try again.");
  if (!data || data.length === 0) {
    throw new VisitorError("conflict", "Someone else changed this group while you were editing. Reload to see their changes.");
  }
  await ctx.admin.rpc("log_group_event", {
    p_church_id: ctx.churchId,
    p_group_id: group.id,
    p_action: "settings_changed",
    p_actor_type: "staff",
    p_actor_user_id: ctx.userId,
    p_membership_id: null,
    p_account_id: null,
    p_member_id: null,
    p_detail: {},
  });
  await syncNow([dedupeKey("group.channel", group.id)], { budgetMs: 3_000 });
  return { version: Number((data[0] as { version: number }).version) };
}

export async function setStaffGroupLifecycle(
  ctx: StaffContext,
  groupId: string,
  action: "archive" | "restore" | "delete",
): Promise<"archived" | "restored" | "deleted" | "unchanged"> {
  const group = await loadStaffGroup(ctx, groupId);
  const { data, error } = await ctx.admin.rpc("group_set_lifecycle", {
    p_group_id: group.id,
    p_church_id: ctx.churchId,
    p_action: action,
    p_actor_user_id: ctx.userId,
  });
  if (error) throw new VisitorError("unavailable", "Could not update the group. Please try again.");
  const outcome = data as string;
  if (outcome === "not_found") throw new VisitorError("group_not_found", "Group not found.");
  if (outcome === "not_archived") throw new VisitorError("conflict", "Archive a group before deleting it.");

  if (outcome === "deleted" && group.cover_image_url) {
    const path = coverPathFromUrl(ctx.churchId, group.id, group.cover_image_url);
    if (path) await ctx.admin.storage.from(COVER_BUCKET).remove([path]).catch(() => undefined);
  }
  await syncNow([dedupeKey("group.channel", group.id), dedupeKey("group.members", group.id)], { budgetMs: 4_000 });
  return outcome as "archived" | "restored" | "deleted" | "unchanged";
}

// ---------------------------------------------------------------------------
// Cover image
// ---------------------------------------------------------------------------

const COVER_BUCKET = "church-covers";
const MAX_COVER_BYTES = 12 * 1024 * 1024;

function coverPrefix(churchId: string, groupId: string): string {
  return `${churchId}/groups/${groupId}/`;
}

/** The storage path behind a cover URL — only when it is this group's own file. */
function coverPathFromUrl(churchId: string, groupId: string, url: string): string | null {
  const marker = `/object/public/${COVER_BUCKET}/`;
  const index = url.indexOf(marker);
  if (index < 0) return null;
  const path = decodeURIComponent(url.slice(index + marker.length).split("?")[0] ?? "");
  return path.startsWith(coverPrefix(churchId, groupId)) && !path.includes("..") ? path : null;
}

export async function uploadStaffGroupCover(
  ctx: StaffContext,
  groupId: string,
  file: File,
  crop: { x: number; y: number; width: number; height: number } | null,
): Promise<{ url: string }> {
  const group = await loadStaffGroup(ctx, groupId);
  if (file.size === 0) throw new StaffFieldError("Choose an image to upload.", "cover");
  if (file.size > MAX_COVER_BYTES) throw new StaffFieldError("That image is over 12MB. Please pick a smaller one.", "cover");

  const aspect = getAspect("video");
  const normalized = await normalizeSiteImage(Buffer.from(await file.arrayBuffer()), {
    crop,
    output: aspect.output,
  });
  if (!normalized) {
    throw new StaffFieldError("That file doesn't look like an image we can use. Try a JPG, PNG, or HEIC photo.", "cover");
  }

  const path = `${coverPrefix(ctx.churchId, group.id)}${Date.now().toString(36)}-${randomUUID().slice(0, 8)}.${normalized.ext}`;
  const { error } = await ctx.admin.storage
    .from(COVER_BUCKET)
    .upload(path, normalized.buffer, { contentType: normalized.contentType, upsert: false });
  if (error) throw new VisitorError("unavailable", "That image could not be uploaded. Please try again.");
  const url = ctx.admin.storage.from(COVER_BUCKET).getPublicUrl(path).data.publicUrl;

  const { error: updateError } = await ctx.admin
    .from("groups")
    .update({ cover_image_url: url, cover_image_path: path, updated_by: ctx.userId })
    .eq("id", group.id)
    .eq("church_id", ctx.churchId);
  if (updateError) {
    await ctx.admin.storage.from(COVER_BUCKET).remove([path]).catch(() => undefined);
    throw new VisitorError("unavailable", "That image could not be saved. Please try again.");
  }
  const previous = group.cover_image_url ? coverPathFromUrl(ctx.churchId, group.id, group.cover_image_url) : null;
  if (previous) await ctx.admin.storage.from(COVER_BUCKET).remove([previous]).catch(() => undefined);
  await syncNow([dedupeKey("group.channel", group.id)], { budgetMs: 2_000 });
  return { url };
}

export async function removeStaffGroupCover(ctx: StaffContext, groupId: string): Promise<void> {
  const group = await loadStaffGroup(ctx, groupId);
  if (!group.cover_image_url) return;
  await ctx.admin
    .from("groups")
    .update({ cover_image_url: null, cover_image_path: null, updated_by: ctx.userId })
    .eq("id", group.id)
    .eq("church_id", ctx.churchId);
  const path = coverPathFromUrl(ctx.churchId, group.id, group.cover_image_url);
  if (path) await ctx.admin.storage.from(COVER_BUCKET).remove([path]).catch(() => undefined);
  await syncNow([dedupeKey("group.channel", group.id)], { budgetMs: 2_000 });
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export type StaffGroupType = { id: string; name: string; icon: string; sortOrder: number; isActive: boolean; groupCount: number };

export async function listStaffGroupTypes(ctx: StaffContext): Promise<StaffGroupType[]> {
  await ctx.admin.rpc("ensure_default_group_types", { p_church_id: ctx.churchId });
  const [{ data: types }, { data: groups }] = await Promise.all([
    ctx.admin
      .from("group_types")
      .select("id, name, icon, sort_order, is_active")
      .eq("church_id", ctx.churchId)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    ctx.admin.from("groups").select("type_id").eq("church_id", ctx.churchId).neq("status", "deleted").limit(5000),
  ]);
  const counts = new Map<string, number>();
  for (const row of (groups ?? []) as { type_id: string | null }[]) {
    if (row.type_id) counts.set(row.type_id, (counts.get(row.type_id) ?? 0) + 1);
  }
  return ((types ?? []) as { id: string; name: string; icon: string; sort_order: number; is_active: boolean }[]).map((t) => ({
    id: t.id,
    name: t.name,
    icon: t.icon,
    sortOrder: t.sort_order,
    isActive: t.is_active,
    groupCount: counts.get(t.id) ?? 0,
  }));
}

const groupTypeSchema = z.object({
  name: z.string().trim().min(1, "Give the category a name.").max(60),
  icon: z.enum(GROUP_TYPE_ICONS),
  isActive: z.boolean().default(true),
});

export async function saveStaffGroupType(ctx: StaffContext, typeId: string | null, input: unknown): Promise<{ id: string }> {
  const parsed = groupTypeSchema.safeParse(input);
  if (!parsed.success) throw new StaffFieldError(parsed.error.issues[0]?.message ?? "Check the category.", "name");
  if (typeId) {
    if (!isUuid(typeId)) throw new VisitorError("group_not_found", "Category not found.");
    const { data } = await ctx.admin
      .from("group_types")
      .update({ name: parsed.data.name, icon: parsed.data.icon, is_active: parsed.data.isActive, updated_at: new Date().toISOString() })
      .eq("id", typeId)
      .eq("church_id", ctx.churchId)
      .select("id");
    if (!data?.length) throw new VisitorError("group_not_found", "Category not found.");
    return { id: typeId };
  }
  const { data: last } = await ctx.admin
    .from("group_types")
    .select("sort_order")
    .eq("church_id", ctx.churchId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data, error } = await ctx.admin
    .from("group_types")
    .insert({
      church_id: ctx.churchId,
      name: parsed.data.name,
      icon: parsed.data.icon,
      is_active: parsed.data.isActive,
      sort_order: Number(last?.sort_order ?? 0) + 10,
    })
    .select("id")
    .single();
  if (error || !data) throw new VisitorError("unavailable", "Could not save the category.");
  return { id: data.id as string };
}

/** Deleting a category leaves its groups uncategorized (FK `on delete set null`). */
export async function deleteStaffGroupType(ctx: StaffContext, typeId: string): Promise<void> {
  if (!isUuid(typeId)) throw new VisitorError("group_not_found", "Category not found.");
  await ctx.admin.from("group_types").delete().eq("id", typeId).eq("church_id", ctx.churchId);
}

// ---------------------------------------------------------------------------
// Schedules
// ---------------------------------------------------------------------------

export async function saveStaffSchedule(
  ctx: StaffContext,
  groupId: string,
  scheduleId: string | null,
  input: unknown,
): Promise<{ id: string; generated: number }> {
  const group = await loadStaffGroup(ctx, groupId);
  if (group.status !== "active") throw new VisitorError("conflict", "Restore this group before changing its schedule.");
  const parsed = scheduleInputSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new StaffFieldError(issue?.message ?? "Check the schedule.", issue?.path.join("."));
  }
  const v = parsed.data;
  const columns = {
    frequency: v.frequency,
    day_of_week: v.dayOfWeek,
    week_of_month: v.frequency === "monthly" ? v.weekOfMonth : null,
    start_time: `${v.startTime}:00`,
    duration_minutes: v.durationMinutes,
    timezone: v.timezone,
    starts_on: v.startsOn,
    ends_on: v.endsOn,
    is_active: true,
    updated_at: new Date().toISOString(),
  };

  let id = scheduleId;
  if (scheduleId) {
    if (!isUuid(scheduleId)) throw new VisitorError("group_not_found", "Schedule not found.");
    const { data } = await ctx.admin
      .from("group_meeting_schedules")
      .update(columns)
      .eq("id", scheduleId)
      .eq("group_id", group.id)
      .eq("church_id", ctx.churchId)
      .select("id");
    if (!data?.length) throw new VisitorError("group_not_found", "Schedule not found.");
  } else {
    const { count } = await ctx.admin
      .from("group_meeting_schedules")
      .select("id", { count: "exact", head: true })
      .eq("group_id", group.id)
      .eq("is_active", true);
    if ((count ?? 0) >= 5) throw new VisitorError("conflict", "A group can have at most five meeting schedules.");
    const { data, error } = await ctx.admin
      .from("group_meeting_schedules")
      .insert({ ...columns, church_id: ctx.churchId, group_id: group.id })
      .select("id")
      .single();
    if (error || !data) throw new VisitorError("unavailable", "Could not save the schedule.");
    id = data.id as string;
  }

  // Future generated gatherings follow the new pattern; edited or attended
  // ones are left alone (0091 `regenerate_group_schedule_events`).
  const { data: generated, error: genError } = await ctx.admin.rpc("regenerate_group_schedule_events", {
    p_schedule_id: id,
    p_church_id: ctx.churchId,
  });
  if (genError) throw new VisitorError("unavailable", "The schedule was saved, but its gatherings could not be updated yet.");
  await ctx.admin.rpc("log_group_event", {
    p_church_id: ctx.churchId,
    p_group_id: group.id,
    p_action: scheduleId ? "schedule_changed" : "schedule_added",
    p_actor_type: "staff",
    p_actor_user_id: ctx.userId,
    p_membership_id: null,
    p_account_id: null,
    p_member_id: null,
    p_detail: { scheduleId: id },
  });
  return { id: id!, generated: Number(generated ?? 0) };
}

/** Stops a schedule: its future, untouched gatherings go; history stays. */
export async function stopStaffSchedule(ctx: StaffContext, groupId: string, scheduleId: string): Promise<void> {
  const group = await loadStaffGroup(ctx, groupId);
  if (!isUuid(scheduleId)) throw new VisitorError("group_not_found", "Schedule not found.");
  const { data } = await ctx.admin
    .from("group_meeting_schedules")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", scheduleId)
    .eq("group_id", group.id)
    .eq("church_id", ctx.churchId)
    .select("id");
  if (!data?.length) throw new VisitorError("group_not_found", "Schedule not found.");
  await ctx.admin.rpc("regenerate_group_schedule_events", { p_schedule_id: scheduleId, p_church_id: ctx.churchId });
  await ctx.admin.rpc("log_group_event", {
    p_church_id: ctx.churchId,
    p_group_id: group.id,
    p_action: "schedule_stopped",
    p_actor_type: "staff",
    p_actor_user_id: ctx.userId,
    p_membership_id: null,
    p_account_id: null,
    p_member_id: null,
    p_detail: { scheduleId },
  });
}

export async function listStaffCampuses(ctx: StaffContext): Promise<{ id: string; name: string }[]> {
  const { data } = await ctx.admin
    .from("church_campuses")
    .select("id, name")
    .eq("church_id", ctx.churchId)
    .eq("is_active", true)
    .order("name", { ascending: true });
  return (data ?? []) as { id: string; name: string }[];
}

/** Records that this staff member has seen a group's messages, for "new activity". */
export async function markStaffGroupRead(ctx: StaffContext, groupId: string): Promise<void> {
  const group = await loadStaffGroup(ctx, groupId);
  await ctx.admin
    .from("group_staff_reads")
    .upsert(
      { user_id: ctx.userId, group_id: group.id, church_id: ctx.churchId, last_viewed_at: new Date().toISOString() },
      { onConflict: "user_id,group_id" },
    );
}

export { staffActor };
