import { MobileError } from "@/lib/mobile/v1/errors";
import { authenticatedRoute } from "@/lib/mobile/v1/handler";
import { readJsonBody } from "@/lib/mobile/v1/protocol";
import { attendanceConsentRequestSchema } from "@/lib/mobile/v1/contract";
import { recordConsent } from "@/lib/faithful/account";

export const dynamic = "force-dynamic";

/**
 * Grants or withdraws consent for automatic attendance.
 *
 * **Why this route exists.** `attendanceConsentRequestSchema` has been in the
 * contract since Prompt 6 and is already generated into Swift, Kotlin and the
 * JSON Schema — but no route consumed it, so a native client had no way to
 * grant or withdraw consent. Prompt 7 needs both directions: enabling automatic
 * attendance requires server consent, and disabling it must revoke that consent
 * rather than merely removing regions from the device.
 *
 * This is the smallest possible change that closes the gap: a new route over an
 * existing schema and an existing authority. No contract shape changed, so no
 * generated artifact moved.
 *
 * **OS permission is not consent.** They are independent and both required. A
 * person may hold Always-location authorization and still have withdrawn
 * consent here, in which case every automatic attempt is refused — and may
 * grant consent here without ever granting the OS permission, in which case no
 * region is ever monitored. Neither substitutes for the other.
 *
 * `recordConsent` bumps `authorization_version`, so a withdrawal invalidates
 * every cached partition on every device this account holds, and the geofence
 * configuration's `configVersion` moves with it.
 */
export const POST = authenticatedRoute(
  { cache: "private-no-store" },
  async ({ userId, request }) => {
    const parsed = attendanceConsentRequestSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      throw new MobileError("invalid_request", "Could not save that choice.");
    }

    const account = await recordConsent(userId, {
      autoAttendanceConsent: parsed.data.autoAttendanceConsent,
    });

    // The new state and the version the client must re-partition against.
    // Deliberately not the whole profile: this endpoint answers one question.
    return {
      data: {
        autoAttendanceConsent: account.autoAttendanceConsent,
        authorizationVersion: account.authorizationVersion,
      },
    };
  },
);
