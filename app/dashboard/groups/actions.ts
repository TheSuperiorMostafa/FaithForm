"use server";

import { revalidatePath } from "next/cache";
import { requireGroupsStaff, runStaffAction, type StaffContext } from "@/lib/groups/staff/context";
import * as groups from "@/lib/groups/staff/groups";
import * as people from "@/lib/groups/staff/people";
import * as events from "@/lib/groups/staff/gatherings";
import * as moderation from "@/lib/messaging/moderation";
import { saveChurchMessagingSettings } from "@/lib/messaging/settings";
import type { GroupRole } from "@/lib/groups/types";
import { VisitorError } from "@/lib/faithform/errors";

async function action<T>(name: string, operation: (ctx: StaffContext) => Promise<T>, adminOnly = false) {
  return runStaffAction(name, async () => {
    const ctx = await requireGroupsStaff({ adminOnly });
    const result = await operation(ctx);
    revalidatePath("/dashboard/groups", "layout");
    return result;
  });
}
export async function saveGroup(id: string | null, values: unknown, version: number) {
  return action("save group", async ctx => id ? (await groups.updateStaffGroup(ctx, id, values, version), { id }) : groups.createStaffGroup(ctx, values));
}
export async function lifecycle(id: string, status: "active" | "archived" | "deleted", confirmation: string) {
  return action("group lifecycle", async ctx => {
    const detail = await groups.getStaffGroup(ctx, id);
    if (status === "deleted" && confirmation !== detail.group.name) throw new VisitorError("invalid_input", "Type the group name to confirm deletion.");
    return groups.setStaffGroupLifecycle(ctx, id, status === "active" ? "restore" : status === "archived" ? "archive" : "delete");
  });
}
export async function uploadCover(id: string, form: FormData) {
  return action("cover", async ctx => {
    const file = form.get("cover");
    if (!(file instanceof File)) throw new VisitorError("invalid_input", "Choose an image first.");
    return groups.uploadStaffGroupCover(ctx, id, file, null);
  });
}
export async function removeCover(id: string) { return action("remove cover", ctx => groups.removeStaffGroupCover(ctx, id)); }
export async function saveCategory(id: string | null, values: unknown) { return action("category", ctx => groups.saveStaffGroupType(ctx, id, values)); }
export async function deleteCategory(id: string) { return action("delete category", ctx => groups.deleteStaffGroupType(ctx, id)); }
export async function saveSchedule(id: string, scheduleId: string | null, values: unknown) { return action("schedule", ctx => groups.saveStaffSchedule(ctx, id, scheduleId, values)); }
export async function stopSchedule(id: string, scheduleId: string) { return action("stop schedule", ctx => groups.stopStaffSchedule(ctx, id, scheduleId)); }
export async function findPeople(id: string, query: string) { return runStaffAction("find people", async () => people.searchPeopleForGroup(await requireGroupsStaff(), id, query)); }
export async function addMembers(id: string, memberIds: string[], role: GroupRole) { return action("add members", ctx => people.addStaffMembers(ctx, id, { memberIds, role })); }
export async function removeMember(id: string, membershipId: string, ban: boolean, reason: string) { return action("remove member", ctx => people.removeStaffMembers(ctx, id, { membershipIds: [membershipId], ban, reason })); }
export async function memberRole(id: string, membershipId: string, role: GroupRole) { return action("member role", ctx => people.setStaffMemberRole(ctx, id, membershipId, role)); }
export async function liftBan(id: string, banId: string) { return action("lift ban", ctx => people.liftStaffBan(ctx, id, banId)); }
export async function decideRequest(id: string, requestId: string, decision: "approve" | "decline") {
  return action("join request", async ctx => {
    const result = await people.decideStaffRequests(ctx, id, { requestIds: [requestId], decision });
    if (result.full) throw new VisitorError("conflict", "This group is full. Increase its capacity before approving this request.");
    if (result.banned || result.requester_unavailable || result.not_found) throw new VisitorError("conflict", "This person can no longer join. Refresh to see the latest requests.");
    return result;
  });
}
export async function createInvitation(id: string, maxUses: number, expiresInDays: number) { return action("invitation", ctx => people.createStaffInvitation(ctx, id, { maxUses, expiresInDays })); }
export async function revokeInvitation(id: string, inviteId: string) { return action("revoke invitation", ctx => people.revokeStaffInvitation(ctx, id, inviteId)); }
export async function saveGathering(id: string, eventId: string | null, values: unknown) { return action("gathering", async ctx => { if (eventId) { await events.updateStaffGathering(ctx, id, eventId, values); return { id: eventId }; } return events.createStaffGathering(ctx, id, values); }); }
export async function cancelGathering(id: string, eventId: string, reason: string) { return action("cancel gathering", ctx => events.cancelStaffGathering(ctx, id, eventId, reason)); }
export async function generateGatherings(id: string) { return action("generate gatherings", ctx => events.generateStaffGatherings(ctx, id)); }
export async function attendanceSheet(id: string, eventId: string) { return runStaffAction("attendance", async () => events.getStaffAttendanceSheet(await requireGroupsStaff(), id, eventId)); }
export async function recordAttendance(id: string, eventId: string, values: unknown, key: string) {
  return action("record attendance", async ctx => {
    const result = await events.submitStaffAttendance(ctx, id, eventId, values, key);
    if (result.rejected) throw new VisitorError("conflict", "The roster changed. Refresh attendance before saving again.");
    return result;
  });
}
export async function readReport(id: string) { return runStaffAction("report", async () => moderation.getReportDetail(await requireGroupsStaff(), id)); }
export async function resolveReport(id: string, resolution: "dismiss" | "remove_message" | "remove_member" | "ban_member" | "suspend", note: string, duration: moderation.SuspensionDuration = "7d") {
  return action("resolve report", async ctx => {
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
export async function liftSuspension(id: string) { return action("lift suspension", ctx => moderation.liftSuspension(ctx, id)); }
export async function retrySync() { return action("retry sync", ctx => moderation.retryFailedSync(ctx), true); }
export async function saveMessagingSettings(values: unknown) { return action("messaging settings", ctx => saveChurchMessagingSettings(ctx.admin, ctx.churchId, ctx.userId, values), true); }
export async function markRead(id: string) { return runStaffAction("read group", async () => groups.markStaffGroupRead(await requireGroupsStaff(), id)); }

export async function gatheringDetails(id: string, eventId: string) {
  return runStaffAction("gathering details", async () => events.getStaffGathering(await requireGroupsStaff(), id, eventId));
}
export async function moreGatherings(id: string, when: "upcoming" | "past", cursor: { at: string; id: string }) {
  return runStaffAction("more gatherings", async () => events.listStaffGatherings(await requireGroupsStaff(), id, when, cursor));
}
