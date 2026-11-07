import { authenticatedRoute } from "@/lib/mobile/v1/handler";
import { parseBody } from "@/lib/mobile/v1/body";
import { z } from "zod";
import { queueGroupAnnouncement } from "@/lib/groups/announcement-notifications";
import { loadGroupForMember, resolveMemberContext } from "@/lib/groups/context";
import { VisitorError } from "@/lib/faithform/errors";

const sendAnnouncementSchema = z.object({
  title: z.string().trim().min(1).max(100),
  message: z.string().trim().min(1).max(500),
});

export const dynamic = "force-dynamic";

/**
 * Send an announcement to all group members (leaders only).
 */
export const POST = authenticatedRoute({ cache: "private-no-store" }, async ({ userId, params, request }) => {
  const { title, message } = await parseBody(request, sendAnnouncementSchema);
  
  // Resolve member context to verify group access
  const ctx = await resolveMemberContext(userId, params.slug);
  
  const { group, membership, banned } = await loadGroupForMember(ctx, params.groupId);
  if (group.status !== "active") {
    throw new VisitorError("conflict", "This group is not active");
  }
  if (banned || !membership || !["leader", "manager"].includes(membership.group_role)) {
    throw new VisitorError("forbidden", "Only group leaders can send announcements");
  }

  // Queue the announcement
  const result = await queueGroupAnnouncement({
    groupId: params.groupId,
    churchId: ctx.church.id,
    title,
    message,
    churchSlug: ctx.church.slug,
  }, ctx.admin);
  
  if (!result.ok) {
    throw new VisitorError("unavailable", result.error || "Failed to send announcement");
  }
  
  return {
    data: {
      sent: true,
      recipientCount: result.recipientCount,
      groupName: String(group.name),
    },
  };
});
