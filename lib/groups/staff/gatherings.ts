import { randomUUID } from "node:crypto";

import { VisitorError } from "@/lib/faithform/errors";
import { isUuid } from "@/lib/groups/context";
import {
  cancelGathering,
  createGathering,
  getAttendanceSheet,
  getGathering,
  listGroupEvents,
  submitAttendance,
  updateGathering,
} from "@/lib/groups/gatherings";
import { loadStaffGroup, staffActor, type StaffContext } from "@/lib/groups/staff/context";

/**
 * A group's gatherings and their attendance, from the dashboard. The shared
 * implementation lives in `lib/groups/gatherings.ts`, which leaders use from
 * the app; staff differ only in reach (any group of their church) and in one
 * capability: counting a known guest from People who is not on the roster.
 */

export async function listStaffGatherings(
  ctx: StaffContext,
  groupId: string,
  when: "upcoming" | "past",
  cursor: { at: string; id: string } | null = null,
) {
  const group = await loadStaffGroup(ctx, groupId, { includeDeleted: false });
  const page = await listGroupEvents(ctx.admin, {
    churchId: ctx.churchId,
    groupId: group.id,
    when,
    accountId: null,
    cursor,
    limit: 25,
  });
  const ids = page.items.map((item) => item.id);
  const { data: records } = ids.length
    ? await ctx.admin
        .from("group_attendance_records")
        .select("event_id, present_count, absent_count, guest_count")
        .eq("church_id", ctx.churchId)
        .in("event_id", ids)
    : { data: [] };
  const byEvent = new Map(
    ((records ?? []) as { event_id: string; present_count: number; absent_count: number; guest_count: number }[]).map((r) => [
      r.event_id,
      r,
    ]),
  );
  return {
    items: page.items.map((item) => {
      const record = byEvent.get(item.id);
      return {
        ...item,
        attendance: record
          ? { present: record.present_count, absent: record.absent_count, guests: record.guest_count }
          : null,
      };
    }),
    nextCursor: page.nextCursor,
  };
}

export async function getStaffGathering(ctx: StaffContext, groupId: string, eventId: string) {
  const group = await loadStaffGroup(ctx, groupId);
  if (!isUuid(eventId)) throw new VisitorError("group_not_found", "That gathering was not found.");
  return getGathering(ctx.admin, {
    churchId: ctx.churchId,
    groupId: group.id,
    eventId,
    accountId: null,
    includeAttendance: true,
  });
}

export async function createStaffGathering(ctx: StaffContext, groupId: string, values: unknown): Promise<{ id: string }> {
  const group = await loadStaffGroup(ctx, groupId);
  if (group.status !== "active") throw new VisitorError("conflict", "Restore this group before adding gatherings.");
  const id = await createGathering(ctx.admin, {
    churchId: ctx.churchId,
    groupId: group.id,
    churchTimezone: ctx.church.timezone,
    actor: staffActor(ctx),
    values,
  });
  return { id };
}

export async function updateStaffGathering(ctx: StaffContext, groupId: string, eventId: string, values: unknown) {
  const group = await loadStaffGroup(ctx, groupId);
  if (!isUuid(eventId)) throw new VisitorError("group_not_found", "That gathering was not found.");
  await updateGathering(ctx.admin, {
    churchId: ctx.churchId,
    groupId: group.id,
    eventId,
    churchTimezone: ctx.church.timezone,
    actor: staffActor(ctx),
    values,
  });
}

export async function cancelStaffGathering(ctx: StaffContext, groupId: string, eventId: string, reason: string | null) {
  const group = await loadStaffGroup(ctx, groupId);
  if (!isUuid(eventId)) throw new VisitorError("group_not_found", "That gathering was not found.");
  await cancelGathering(ctx.admin, {
    churchId: ctx.churchId,
    churchSlug: ctx.church.slug,
    groupId: group.id,
    groupName: group.name,
    eventId,
    reason: reason?.trim().slice(0, 300) || null,
    actor: staffActor(ctx),
  });
}

export async function getStaffAttendanceSheet(ctx: StaffContext, groupId: string, eventId: string) {
  const group = await loadStaffGroup(ctx, groupId);
  if (!isUuid(eventId)) throw new VisitorError("group_not_found", "That gathering was not found.");
  return getAttendanceSheet(ctx.admin, { churchId: ctx.churchId, groupId: group.id, eventId });
}

/**
 * Records attendance. `submissionKey` is generated when the form opens, so a
 * double-click or a retried request is one batch, not two.
 */
export async function submitStaffAttendance(
  ctx: StaffContext,
  groupId: string,
  eventId: string,
  values: unknown,
  submissionKey: string | null,
) {
  const group = await loadStaffGroup(ctx, groupId);
  if (!isUuid(eventId)) throw new VisitorError("group_not_found", "That gathering was not found.");
  // Guests are only People of this church; the SQL command re-checks.
  const guestIds = (values as { guestMemberIds?: unknown })?.guestMemberIds;
  if (Array.isArray(guestIds) && guestIds.length) {
    const ids = guestIds.filter(isUuid);
    const { data } = await ctx.admin.from("members").select("id").eq("church_id", ctx.churchId).in("id", ids);
    if ((data ?? []).length !== ids.length || ids.length !== guestIds.length) {
      throw new VisitorError("invalid_input", "One of those guests isn't in your People.");
    }
  }
  const key =
    submissionKey && /^[A-Za-z0-9_-]{8,80}$/.test(submissionKey) ? submissionKey : `staff-${randomUUID()}`;
  return submitAttendance(ctx.admin, {
    churchId: ctx.churchId,
    groupId: group.id,
    eventId,
    actor: staffActor(ctx),
    idempotencyKey: `${ctx.userId}:${key}`,
    values,
  });
}

/** Adds the next eight weeks of scheduled gatherings now, instead of waiting for the nightly run. */
export async function generateStaffGatherings(ctx: StaffContext, groupId: string): Promise<number> {
  const group = await loadStaffGroup(ctx, groupId);
  const { data, error } = await ctx.admin.rpc("generate_group_events", {
    p_church_id: ctx.churchId,
    p_group_id: group.id,
    p_horizon_days: 56,
  });
  if (error) throw new VisitorError("unavailable", "Could not add gatherings right now.");
  return Number(data ?? 0);
}
