import { authenticatedRoute } from "@/lib/mobile/v1/handler";
import { parseBody } from "@/lib/mobile/v1/body";
import { submitGroupAttendanceRequestSchema } from "@/lib/mobile/v1/contract";
import { requireIdempotencyKey } from "@/lib/mobile/v1/protocol";
import { attendanceSheet, recordAttendance } from "@/lib/groups/member-service";

export const dynamic = "force-dynamic";

/** The roster for one gathering, with who is already counted. Leaders only. */
export const GET = authenticatedRoute({ cache: "private-no-store" }, async ({ userId, params }) => {
  return { data: await attendanceSheet(userId, params.slug, params.groupId, params.eventId) };
});

/**
 * Records attendance as the full picture: everyone listed present is counted
 * (through the church's attendance authority), everyone else on the roster is
 * absent, and guests are a headcount. Sending it again with the same
 * Idempotency-Key is the same submission.
 */
export const PUT = authenticatedRoute({ cache: "private-no-store" }, async ({ userId, params, request }) => {
  const key = requireIdempotencyKey(request);
  const values = await parseBody(request, submitGroupAttendanceRequestSchema, "Check the attendance.");
  return { data: await recordAttendance(userId, params.slug, params.groupId, params.eventId, `${userId}:${key}`, values) };
});
