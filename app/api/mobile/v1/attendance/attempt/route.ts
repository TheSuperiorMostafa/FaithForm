import { MobileError } from "@/lib/mobile/v1/errors";
import { authenticatedRoute } from "@/lib/mobile/v1/handler";
import { readJsonBody, requireIdempotencyKey } from "@/lib/mobile/v1/protocol";
import { attendanceAttemptRequestSchema } from "@/lib/mobile/v1/contract";
import { submitAttempt } from "@/lib/mobile/v1/attendance-service";

export const dynamic = "force-dynamic";

/**
 * Submits an attendance attempt.
 *
 * The idempotency key is mandatory: a phone that loses the response and retries
 * must find its own earlier attempt rather than create a second one — and the
 * unique counted fact means even a duplicate cannot double-count.
 *
 * A client sends an *observation*. It cannot send a member, a church, a
 * distance, or a result.
 */
export const POST = authenticatedRoute(
  { cache: "private-no-store" },
  async ({ userId, request }) => {
    const idempotencyKey = requireIdempotencyKey(request);
    const parsed = attendanceAttemptRequestSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      throw new MobileError("invalid_request", "Could not record that check-in.");
    }

    return {
      data: await submitAttempt(userId, idempotencyKey, {
        occurrenceId: parsed.data.occurrenceId,
        source: parsed.data.source,
        phase: parsed.data.phase,
        observedAt: parsed.data.observedAt,
        accuracyMeters: parsed.data.accuracyMeters,
        dwellSeconds: parsed.data.dwellSeconds,
        latitude: parsed.data.latitude,
        longitude: parsed.data.longitude,
        mockLocationReported: parsed.data.mockLocationReported,
        attemptId: parsed.data.attemptId,
        detectionId: parsed.data.detectionId,
        regionId: parsed.data.regionId,
        configVersion: parsed.data.configVersion,
        qrToken: parsed.data.qrToken,
        shortCode: parsed.data.shortCode,
        scanAttemptId: parsed.data.scanAttemptId,
      }),
    };
  },
);
