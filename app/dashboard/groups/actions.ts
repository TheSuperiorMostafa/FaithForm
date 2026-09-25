"use server";

import { parseImageCrop } from "@/lib/branding/images";
import { revalidatePath } from "next/cache";
import { isUuid } from "@/lib/groups/context";
import { loadStaffGroup, requireGroupsStaff, StaffFieldError, type StaffActionResult, type StaffContext } from "@/lib/groups/staff/context";
import * as groups from "@/lib/groups/staff/groups";
import * as people from "@/lib/groups/staff/people";
import * as events from "@/lib/groups/staff/gatherings";
import * as moderation from "@/lib/messaging/moderation";
import { saveChurchMessagingSettings } from "@/lib/messaging/settings";
import type { GroupRole } from "@/lib/groups/types";
import { VisitorError } from "@/lib/faithform/errors";
import { toUserError } from "@/lib/errors/user-error";
import { capacityProblem } from "@/components/groups/labels";

/**
 * Every Groups action re-derives the church and the staff member's rights
 * from the session (`requireGroupsStaff`), exactly as before. A domain refusal
 * (VisitorError, StaffFieldError) was written for people and is shown as is;
 * anything else becomes a plain sentence through `toUserError`.
 */
async function attempt<T>(fallback: string, operation: () => Promise<T>): Promise<StaffActionResult<T>> {
  try {
    return { ok: true, data: await operation() };
  } catch (error) {
    if (error instanceof VisitorError) return { ok: false, error: error.message };
    if (error instanceof StaffFieldError) return { ok: false, error: error.message, field: error.field };
    return { ok: false, error: toUserError(error, fallback) };
  }
}
async function action<T>(fallback: string, operation: (ctx: StaffContext) => Promise<T>, adminOnly = false) {
  return attempt(fallback, async () => {
    const ctx = await requireGroupsStaff({ adminOnly });
    const result = await operation(ctx);
    revalidatePath("/dashboard/groups", "layout");
    return result;
  });
}
async function read<T>(fallback: string, operation: (ctx: StaffContext) => Promise<T>) {
  return attempt(fallback, async () => operation(await requireGroupsStaff()));
}

type AddTally = { added: number; alreadyMembers: number; refused: number };

/**
 * Adds chosen people to a group in one go: leaders first (as leaders), then
 * everyone else (as members). The whole choice is checked against the group's
 * size up front, so it never half-fits.
 */
async function addChosenPeople(ctx: StaffContext, groupId: string, memberIds: string[], leaderIds: string[]): Promise<AddTally> {
  const chosen = [...new Set(memberIds.filter(isUuid))].slice(0, 200);
  const leaderSet = new Set(leaderIds.filter((id) => chosen.includes(id)));
  const group = await loadStaffGroup(ctx, groupId);
  const problem = capacityProblem(group.capacity, group.member_count, chosen.length);
  if (problem) throw new VisitorError("conflict", problem);
  const tally: AddTally = { added: 0, alreadyMembers: 0, refused: 0 };
  const count = (t: AddTally) => { tally.added += t.added; tally.alreadyMembers += t.alreadyMembers; tally.refused += t.refused; };
  const leaders = chosen.filter((id) => leaderSet.has(id));
  const members = chosen.filter((id) => !leaderSet.has(id));
  if (leaders.length) count(await people.addStaffMembers(ctx, group.id, { memberIds: leaders, role: "leader" }));
  if (members.length) count(await people.addStaffMembers(ctx, group.id, { memberIds: members, role: "member" }));
  return tally;
}

export async function saveGroup(id: string | null, values: unknown, version: number) {
  return action("We couldn’t save the group.", async ctx => id ? (await groups.updateStaffGroup(ctx, id, values, version), { id }) : groups.createStaffGroup(ctx, values));
}
/**
 * The quick create flow: makes the group, then adds the chosen people with
 * the same guarded staff functions as "Add people". If adding fails, the group
 * still exists and the person is told plainly what to do next.
 */
export async function createGroupWithPeople(values: unknown, memberIds: string[], leaderIds: string[]) {
  return action("We couldn’t create the group.", async ctx => {
    const { id } = await groups.createStaffGroup(ctx, values);
    if (!memberIds.length) return { id, added: 0, addError: null as string | null };
    try {
      const tally = await addChosenPeople(ctx, id, memberIds, leaderIds);
      return { id, added: tally.added, addError: null as string | null };
    } catch (error) {
      const message = error instanceof VisitorError ? error.message : toUserError(error, "We couldn’t add the people you chose.");
      return { id, added: 0, addError: `The group was created, but the people weren’t added. ${message}` };
    }
  });
}
export async function lifecycle(id: string, status: "active" | "archived" | "deleted", confirmation: string) {
  return action("We couldn’t update the group.", async ctx => {
    const detail = await groups.getStaffGroup(ctx, id);
    if (status === "deleted" && confirmation !== detail.group.name) throw new VisitorError("invalid_input", "Type the group name to confirm deletion.");
    return groups.setStaffGroupLifecycle(ctx, id, status === "active" ? "restore" : status === "archived" ? "archive" : "delete");
  });
}
export async function uploadCover(id: string, form: FormData) {
  return action("We couldn’t save the photo.", async ctx => {
    const file = form.get("cover");
    if (!(file instanceof File)) throw new VisitorError("invalid_input", "Choose an image first.");
    return groups.uploadStaffGroupCover(ctx, id, file, parseImageCrop(form.get("crop")));
  });
}
export async function removeCover(id: string) { return action("We couldn’t remove the photo.", ctx => groups.removeStaffGroupCover(ctx, id)); }
export async function saveCategory(id: string | null, values: unknown) { return action("We couldn’t save the category.", ctx => groups.saveStaffGroupType(ctx, id, values)); }
export async function deleteCategory(id: string) { return action("We couldn’t delete the category.", ctx => groups.deleteStaffGroupType(ctx, id)); }
export async function saveSchedule(id: string, scheduleId: string | null, values: unknown) { return action("We couldn’t save the schedule.", ctx => groups.saveStaffSchedule(ctx, id, scheduleId, values)); }
export async function stopSchedule(id: string, scheduleId: string) { return action("We couldn’t stop the schedule.", ctx => groups.stopStaffSchedule(ctx, id, scheduleId)); }
/** The church’s People roster for the type-ahead picker. `id` marks who is already in that group. */
export async function peopleDirectory(id: string | null) { return read("We couldn’t load your people.", ctx => people.listStaffPeopleOptions(ctx, id)); }
export async function addPeople(id: string, memberIds: string[], leaderIds: string[]) { return action("We couldn’t add those people.", ctx => addChosenPeople(ctx, id, memberIds, leaderIds)); }
export async function removeMember(id: string, membershipId: string, ban: boolean, reason: string) { return action("We couldn’t remove them from the group.", ctx => people.removeStaffMembers(ctx, id, { membershipIds: [membershipId], ban, reason })); }
export async function memberRole(id: string, membershipId: string, role: GroupRole) { return action("We couldn’t change their role.", ctx => people.setStaffMemberRole(ctx, id, membershipId, role)); }
export async function liftBan(id: string, banId: string) { return action("We couldn’t let them rejoin.", ctx => people.liftStaffBan(ctx, id, banId)); }
export async function decideRequest(id: string, requestId: string, decision: "approve" | "decline") {
  return action("We couldn’t answer the request.", async ctx => {
    const result = await people.decideStaffRequests(ctx, id, { requestIds: [requestId], decision });
    if (result.full) throw new VisitorError("conflict", "This group is full. Raise its size in Group settings, then approve this request.");
    if (result.banned || result.requester_unavailable || result.not_found) throw new VisitorError("conflict", "This person can no longer join. Refresh to see the latest requests.");
    return result;
  });
}
export async function createInvitation(id: string, maxUses: number, expiresInDays: number) { return action("We couldn’t make the invite link.", ctx => people.createStaffInvitation(ctx, id, { maxUses, expiresInDays })); }
export async function revokeInvitation(id: string, inviteId: string) { return action("We couldn’t turn off the invite link.", ctx => people.revokeStaffInvitation(ctx, id, inviteId)); }
export async function saveGathering(id: string, eventId: string | null, values: unknown) { return action("We couldn’t save the meeting.", async ctx => { if (eventId) { await events.updateStaffGathering(ctx, id, eventId, values); return { id: eventId }; } return events.createStaffGathering(ctx, id, values); }); }
export async function cancelGathering(id: string, eventId: string, reason: string) { return action("We couldn’t cancel the meeting.", ctx => events.cancelStaffGathering(ctx, id, eventId, reason)); }
export async function generateGatherings(id: string) { return action("We couldn’t add the upcoming meetings.", ctx => events.generateStaffGatherings(ctx, id)); }
export async function attendanceSheet(id: string, eventId: string) { return read("We couldn’t open attendance.", ctx => events.getStaffAttendanceSheet(ctx, id, eventId)); }
export async function recordAttendance(id: string, eventId: string, values: unknown, key: string) {
  return action("We couldn’t save attendance.", async ctx => {
    const result = await events.submitStaffAttendance(ctx, id, eventId, values, key);
    if (result.rejected) throw new VisitorError("conflict", "The roster changed. Refresh attendance before saving again.");
    return result;
  });
}
export async function readReport(id: string) { return read("We couldn’t open this report.", ctx => moderation.getReportDetail(ctx, id)); }
export async function resolveReport(id: string, resolution: "dismiss" | "remove_message" | "remove_member" | "ban_member" | "suspend", note: string, duration: moderation.SuspensionDuration = "7d") {
  return action("We couldn’t save your decision on this report.", async ctx => {
    if (resolution === "dismiss") return moderation.dismissReport(ctx, id, note);
    if (resolution === "remove_message") return moderation.removeReportedMessage(ctx, id, note);
    if (resolution === "remove_member" || resolution === "ban_member") return moderation.removeReportedFromGroup(ctx, id, { ban: resolution === "ban_member", note });
    if (resolution === "suspend") {
      const report = await moderation.getReportDetail(ctx, id);
      if (!report.reportedPerson.authUserId) throw new VisitorError("invalid_input", "This person is no longer available.");
      return moderation.suspendMessaging(ctx, { userId: report.reportedPerson.authUserId, duration, reason: note, reportId: id });
    }
    throw new VisitorError("invalid_input", "Choose an action.");
  });
}
export async function liftSuspension(id: string) { return action("We couldn’t turn their messages back on.", ctx => moderation.liftSuspension(ctx, id)); }
export async function retrySync() { return action("We couldn’t try those changes again.", ctx => moderation.retryFailedSync(ctx), true); }
export async function saveMessagingSettings(values: unknown) { return action("We couldn’t save the message settings.", ctx => saveChurchMessagingSettings(ctx.admin, ctx.churchId, ctx.userId, values), true); }
export async function markRead(id: string) { return read("We couldn’t mark this chat as read.", ctx => groups.markStaffGroupRead(ctx, id)); }

export async function gatheringDetails(id: string, eventId: string) {
  return read("We couldn’t open this meeting.", ctx => events.getStaffGathering(ctx, id, eventId));
}
export async function moreGatherings(id: string, when: "upcoming" | "past", cursor: { at: string; id: string }) {
  return read("We couldn’t load more meetings.", ctx => events.listStaffGatherings(ctx, id, when, cursor));
}
