import Foundation

/// Sends a scanned or typed code to the server.
///
/// **The whole file.** Everything a check-in decides happens on the other side
/// of this request: which service the code belongs to, whether the display is
/// still running, whether this account has a verified People link, and whether
/// a fact already exists. The client contributes a code and an idempotency key.
///
/// Notice what is not sent, and could not be: no occurrence, no church, no
/// member, no coordinates, no device identifier. `CheckInSubmission` has no
/// field for any of them.
public actor APICheckInSubmitter: CheckInCodeSubmitting {
    private let api: APIClient

    public init(api: APIClient) {
        self.api = api
    }

    public func submit(
        _ submission: CheckInSubmission,
        idempotencyKey: String
    ) async throws -> AttendanceResult {
        let request = ScanAttemptBody(
            source: "qr",
            phase: "confirm",
            qrToken: submission.qrToken,
            shortCode: submission.shortCode,
            scanAttemptId: submission.scanAttemptId
        )

        let response = try await api.send(
            "api/mobile/v1/attendance/attempt",
            method: .post,
            body: request,
            idempotencyKey: idempotencyKey,
            as: AttendanceResult.self
        )

        guard let result = response.value else {
            // A 200 with no body is not a check-in. Treated as unavailable so
            // the person is told nothing was recorded, rather than being shown
            // a success the server never gave.
            throw APIError(code: .unavailable, message: L.checkinScanOfflineBody)
        }
        return result
    }
}

/// The request body, shaped by hand rather than generated.
///
/// The generated `AttendanceAttemptRequest` carries every field the geofence
/// path needs — latitude, longitude, dwell, accuracy, region. Encoding one of
/// those from a scanner would mean a code path that *could* send a position,
/// and the cheapest way to guarantee it never does is for this type not to have
/// the fields at all. `tests/security/checkin-privacy.test.ts` asserts that no
/// location field appears anywhere in the scan path.
private struct ScanAttemptBody: Encodable, Sendable {
    let source: String
    let phase: String
    let qrToken: String?
    let shortCode: String?
    let scanAttemptId: String
}
