package io.faithform.faithful.attendance

import io.faithform.faithful.contract.AttendanceResult
import io.faithform.faithful.network.ApiClient
import io.faithform.faithful.network.ApiException
import io.faithform.faithful.network.MobileSuccess
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.serializer

/**
 * Sends a scanned or typed code to the server.
 *
 * **The whole file.** Everything a check-in decides happens on the other side of
 * this request: which service the code belongs to, whether the display is still
 * running, whether this account has a verified People link, and whether a fact
 * already exists. The client contributes a code and an idempotency key.
 *
 * Notice what is not sent, and could not be: no occurrence, no church, no
 * member, no coordinates, no device identifier. [ScanAttemptBody] has no field
 * for any of them, which is a stronger guarantee than remembering not to fill
 * one in.
 */
class ApiCheckInSubmitter(
    private val api: ApiClient,
    private val json: Json = Json { encodeDefaults = false; explicitNulls = false },
) : CheckInCodeSubmitting {

    override suspend fun submit(
        submission: CheckInSubmission,
        idempotencyKey: String,
    ): CheckInServerResult {
        val body = json.encodeToString(
            ScanAttemptBody.serializer(),
            ScanAttemptBody(
                qrToken = submission.qrToken,
                shortCode = submission.shortCode,
                scanAttemptId = submission.scanAttemptId,
            ),
        )

        val result = try {
            api.send(
                path = "api/mobile/v1/attendance/attempt",
                serializer = attendanceResultSerializer,
                method = "POST",
                body = body,
                idempotencyKey = idempotencyKey,
            )
        } catch (error: ApiException) {
            // Every failure that is not a decided outcome. The person is told
            // nothing was recorded rather than shown a success the server never
            // gave.
            throw CheckInTransportException(error.message ?: "Faithful could not reach the server.")
        }

        val value = result.value
            // A 200 with no body is not a check-in.
            ?: throw CheckInTransportException("Faithful could not reach the server.")

        // `wire` rather than `name`: the coordinator matches the server's own
        // strings, and an outcome this build does not recognise arrives as
        // `UNKNOWN` — which maps to a refusal, never to a check-in.
        return CheckInServerResult(outcome = value.outcome.wire, message = value.message)
    }

    private companion object {
        val attendanceResultSerializer: KSerializer<MobileSuccess<AttendanceResult>> =
            serializer()
    }
}

/**
 * The request body, written by hand rather than reused.
 *
 * The generated `AttendanceAttemptRequest` carries every field the geofence path
 * needs — latitude, longitude, dwell, accuracy, region. Encoding one of those
 * from a scanner would mean a code path that *could* send a position, and the
 * cheapest way to guarantee it never does is for this type not to have the
 * fields. `tests/security/checkin-privacy.test.ts` asserts that no location
 * field appears anywhere in the scan path.
 */
@Serializable
private data class ScanAttemptBody(
    val source: String = "qr",
    val phase: String = "confirm",
    val qrToken: String? = null,
    val shortCode: String? = null,
    val scanAttemptId: String,
)
