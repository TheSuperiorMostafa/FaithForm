import Foundation

// The four automatic-attendance routes, over the shared API client. Each type
// translates one route and decides nothing: which occurrence, what counts and
// whether consent holds are all the server's answers.

// MARK: - Submission

/// `GET attendance/{slug}/occurrence`, `POST attendance/attempt`,
/// `GET attendance/status/{id}`.
public actor APIAttendanceSubmitter: AttendanceSubmitting {
    private let api: APIClient

    public init(api: APIClient) {
        self.api = api
    }

    public func eligibleOccurrenceId(churchSlug: String) async throws -> String? {
        let response = try await api.send(
            "api/mobile/v1/attendance/\(churchSlug)/occurrence",
            as: OccurrenceReply.self
        )
        return response.value?.occurrence?.occurrenceId
    }

    public func submit(
        _ evidence: AttendanceEvidence,
        idempotencyKey: String
    ) async throws -> AttendanceResult {
        let response = try await api.send(
            "api/mobile/v1/attendance/attempt",
            method: .post,
            body: GeofenceAttemptBody(evidence),
            idempotencyKey: idempotencyKey,
            as: AttendanceResult.self
        )
        guard let result = response.value else {
            // A 200 with no body is not a verdict. Treated as unreachable, so
            // the submission stays queued rather than reading as success.
            throw APIError(code: .unavailable, message: L.autoAttendanceOfflineBody, retryable: true)
        }
        return result
    }

    public func isCounted(occurrenceId: String) async -> Bool? {
        let response = try? await api.send(
            "api/mobile/v1/attendance/status/\(occurrenceId)",
            as: AttendanceStatus.self
        )
        return response?.value?.isCounted
    }

    private struct OccurrenceReply: Decodable, Sendable {
        let occurrence: EligibleOccurrence?
    }
}

/// Exactly what a geofence attempt sends, and nothing else.
///
/// Shaped by hand rather than from the generated request, which also carries
/// the QR fields. What leaves the device: the occurrence the server named, the
/// phase, when, one fix (latitude, longitude, accuracy) the server bands and
/// discards, the logical attempt or detection id, the campus region id and the
/// configuration version. No account, no member, no church id, no distance, no
/// result, and — iOS having no such signal — no mock-location flag.
struct GeofenceAttemptBody: Encodable, Sendable {
    let occurrenceId: String
    let source = "geofence"
    let phase: String
    let observedAt: String
    let accuracyMeters: Double?
    let dwellSeconds: Int?
    let latitude: Double?
    let longitude: Double?
    let attemptId: String?
    let detectionId: String?
    let regionId: String?
    let configVersion: Int?

    init(_ evidence: AttendanceEvidence) {
        occurrenceId = evidence.occurrenceId
        phase = evidence.phase
        observedAt = FaithFormInstant.format(evidence.observedAt)
        accuracyMeters = evidence.accuracyMeters
        dwellSeconds = evidence.dwellSeconds
        latitude = evidence.latitude
        longitude = evidence.longitude
        attemptId = evidence.attemptId
        detectionId = evidence.detectionId
        regionId = evidence.regionId
        configVersion = evidence.configVersion
    }

    enum CodingKeys: String, CodingKey {
        case occurrenceId, source, phase, observedAt, accuracyMeters, dwellSeconds
        case latitude, longitude, attemptId, detectionId, regionId, configVersion
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(occurrenceId, forKey: .occurrenceId)
        try container.encode(source, forKey: .source)
        try container.encode(phase, forKey: .phase)
        try container.encode(observedAt, forKey: .observedAt)
        // Absent rather than null: the server's schema treats every one of
        // these as optional, and a missing fix must band `unknown`.
        try container.encodeIfPresent(accuracyMeters, forKey: .accuracyMeters)
        try container.encodeIfPresent(dwellSeconds, forKey: .dwellSeconds)
        try container.encodeIfPresent(latitude, forKey: .latitude)
        try container.encodeIfPresent(longitude, forKey: .longitude)
        try container.encodeIfPresent(attemptId, forKey: .attemptId)
        try container.encodeIfPresent(detectionId, forKey: .detectionId)
        try container.encodeIfPresent(regionId, forKey: .regionId)
        try container.encodeIfPresent(configVersion, forKey: .configVersion)
    }
}

// MARK: - Configuration

/// `GET attendance/{slug}/geofence-config`, revalidated with its ETag.
///
/// Held in memory only. It is the church's public campus position and its
/// service times — nothing about the person — but there is still no reason to
/// write it to disk, and a relaunch asks again anyway.
public actor APIGeofenceConfigurationSource: GeofenceReconciler.ConfigurationSource {
    private let api: APIClient

    private struct Cached {
        let configuration: GeofenceConfiguration
        let etag: String?
        let expiresAt: Date?
    }

    private var cache: [String: Cached] = [:]

    /// A church's refusal, remembered for one revalidation period.
    ///
    /// Someone who follows five churches and belongs to one would otherwise
    /// ask five churches on every foreground, and hear four refusals. A region
    /// event or setup forces a fresh answer regardless.
    private var refusals: [String: (reason: String, until: Date)] = [:]
    private let refusalLifetime: TimeInterval = 15 * 60

    public init(api: APIClient) {
        self.api = api
    }

    public func currentConfiguration(
        churchSlug: String,
        partition: CachePartition,
        now: Date,
        forceRefresh: Bool
    ) async -> GeofenceConfigurationState {
        let key = partition.storageKey
        let cached = cache[key]
        let cachedIsLive = cached.map { entry in entry.expiresAt.map { $0 > now } ?? false } ?? false

        if !forceRefresh, let cached, cachedIsLive {
            return .available(cached.configuration)
        }
        if !forceRefresh, let refused = refusals[key], refused.until > now {
            return .refused(refused.reason)
        }

        do {
            let response = try await api.send(
                "api/mobile/v1/attendance/\(churchSlug)/geofence-config",
                ifNoneMatch: cachedIsLive ? cached?.etag : nil,
                as: GeofenceConfigResponse.self
            )

            if response.notModified, let cached {
                // The server only answers 304 while the cached expiry is still
                // ahead, so this copy is current.
                return .available(cached.configuration)
            }

            guard let body = response.value else { return .unavailable }
            if let configuration = body.configuration {
                refusals[key] = nil
                cache[key] = Cached(
                    configuration: configuration,
                    etag: response.etag,
                    expiresAt: FaithFormInstant.parse(configuration.expiresAt)
                )
                return .available(configuration)
            }
            cache[key] = nil
            let reason = body.refusalReason ?? "not_enrolled"
            refusals[key] = (reason, now.addingTimeInterval(refusalLifetime))
            return .refused(reason)
        } catch let error as APIError {
            switch error.code {
            case .unauthenticated, .sessionExpired, .forbidden, .accountInactive:
                cache[key] = nil
                return .refused("not_enrolled")
            case .blocked:
                cache[key] = nil
                return .refused("blocked")
            case .notFound:
                cache[key] = nil
                return .refused("not_enrolled")
            default:
                // Offline, or the server is having a moment. A copy that has
                // not expired is still the server's word; an expired one is
                // not returned.
                if let cached, cachedIsLive, !forceRefresh { return .available(cached.configuration) }
                return .unavailable
            }
        } catch {
            return .unavailable
        }
    }

    /// Everything, on sign-out.
    public func purge() {
        cache = [:]
        refusals = [:]
    }
}

// MARK: - Consent

/// The server's answer to a consent change.
public struct AttendanceConsentOutcome: Equatable, Sendable {
    public let state: String
    /// The account's new authorization version. Consent changes bump it, so
    /// everything partitioned by the old one is re-keyed.
    public let authorizationVersion: Int?

    public init(state: String, authorizationVersion: Int?) {
        self.state = state
        self.authorizationVersion = authorizationVersion
    }
}

/// `POST attendance/consent`.
public actor APIAttendanceConsent: AutomaticAttendanceModel.ConsentWriting {
    private let api: APIClient

    public init(api: APIClient) {
        self.api = api
    }

    public func setAutoAttendanceConsent(_ value: String) async throws -> AttendanceConsentOutcome {
        let response = try await api.send(
            "api/mobile/v1/attendance/consent",
            method: .post,
            body: AttendanceConsentRequest(autoAttendanceConsent: value),
            as: AttendanceConsentResult.self
        )
        guard let result = response.value else {
            throw APIError(code: .unavailable, message: L.autoAttendanceOfflineBody, retryable: true)
        }
        return AttendanceConsentOutcome(
            state: result.autoAttendanceConsent,
            authorizationVersion: result.authorizationVersion
        )
    }
}

// MARK: - History

/// The person's own attendance at one church.
public protocol AttendanceHistoryReading: Sendable {
    func history(churchSlug: String, limit: Int) async throws -> [AttendanceHistoryItem]
}

/// `GET attendance/{slug}/history`.
public struct APIAttendanceHistory: AttendanceHistoryReading {
    private let api: APIClient

    public init(api: APIClient) {
        self.api = api
    }

    public func history(churchSlug: String, limit: Int) async throws -> [AttendanceHistoryItem] {
        let response = try await api.send(
            "api/mobile/v1/attendance/\(churchSlug)/history",
            query: ["limit": String(limit)],
            as: AttendanceHistoryPage.self
        )
        return response.value?.items ?? []
    }
}
