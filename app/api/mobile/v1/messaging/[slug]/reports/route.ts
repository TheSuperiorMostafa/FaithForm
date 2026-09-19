import { authenticatedRoute } from "@/lib/mobile/v1/handler";
import { parseBody } from "@/lib/mobile/v1/body";
import { chatReportRequestSchema } from "@/lib/mobile/v1/contract";
import { submitReport } from "@/lib/messaging/safety";

export const dynamic = "force-dynamic";

/**
 * Report a message or a person to the church. Only from a conversation the
 * caller is in; the church's staff see it in their moderation queue.
 */
export const POST = authenticatedRoute({ cache: "private-no-store" }, async ({ userId, params, request }) => {
  const body = await parseBody(request, chatReportRequestSchema, "Choose a reason for the report.");
  return {
    data: await submitReport(userId, params.slug, {
      cid: body.cid,
      messageId: body.messageId ?? null,
      reportedChatUserId: body.reportedChatUserId ?? null,
      reason: body.reason,
      details: body.details ?? null,
    }),
  };
});
