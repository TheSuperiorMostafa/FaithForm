import { authenticatedRoute } from "@/lib/mobile/v1/handler";
import { parseBody } from "@/lib/mobile/v1/body";
import { z } from "zod";
import { queueGroupAnnouncement, canSendGroupAnnouncement } from "@/lib/groups/announcement-notifications";
import { resolveMemberContext } from "@/lib/groups/context";
import { VisitorError } from "@/lib/faithform/errors";

const sendAnnouncementSchema = z.object({
  title: z.string().trim().min(1).max(100),
  message: z.string().trim().min(1).max(500),
  deepLink: z.string().optional(),
});

export const dynamic = "force-dynamic";

/**
 * Send an announcement to all group members (leaders only).
 */
export const POST = authenticatedRoute({ cache: "private-no-store" }, async ({ userId, params, request }) => {
  const { title, message, deepLink } = await parseBody(request, sendAnnouncementSchema);
  
  // Resolve member context to verify group access
  const ctx = await resolveMemberContext(userId, params.slug);
  
  // Verify group exists and belongs to church
  const { data: group, error: groupError } = await ctx.admin
    .from("groups")
    .select("id, name, status")
    .eq("id", params.groupId)
    .eq("church_id", ctx.church.id)
    .maybeSingle();
  
  if (groupError || !group) {
    throw new VisitorError("group_not_found", "Group not found");
  }
  
  if (group.status !== "active") {
    throw new VisitorError("conflict", "This group is not active");
  }
  
  // Verify user has permission to send announcements
  const canSend = await canSendGroupAnnouncement(userId, params.groupId, ctx.church.id, ctx.admin);
  if (!canSend) {
    throw new VisitorError("forbidden", "Only group leaders can send announcements");
  }
  
  // Queue the announcement
  const result = await queueGroupAnnouncement({
    groupId: params.groupId,
    churchId: ctx.church.id,
    title,
    message,
    deepLink,
    actorUserId: userId,
  }, ctx.admin);
  
  if (!result.ok) {
    throw new VisitorError("unavailable", result.error || "Failed to send announcement");
  }
  
  return {
    data: {
      sent: true,
      recipientCount: result.recipientCount,
      groupName: group.name,
    },
  };
});
