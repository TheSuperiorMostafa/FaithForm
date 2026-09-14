import Foundation

/// What a region event can become.
///
/// **The operating system's callback is evidence, not attendance.** A device
/// crossing a circle drawn round a building is a reason to *ask* the server
/// whether that counts; it is never the answer. Nothing in this file marks
/// anyone present, and no state here is shown as success — only a server
/// result of `counted` or `already_counted` produces one.
///
/// This is the platform-neutral specification. Android implements the identical
/// state set in `EvidenceMachine.kt`, and both produce the same canonical
/// request, because the differences between Core Location and
/// `GeofencingClient` are in how a signal is *gathered*, not in what it means.
public enum EvidencePhase: Equatable, Sendable {
    /// Nothing in flight.
    case idle

    /// A boundary was crossed. Nothing has been sent.
    case entered(regionId: String, at: Date)

    /// Re-checking authorization and configuration before anything is sent.
    /// Always passed through after a region event, because the event may have
    /// arrived against a configuration that has since expired or been revoked.
    case reauthorizing(regionId: String)

    /// The server accepted a `detected` attempt and is waiting for dwell.
    case awaitingDwell(occurrenceId: String, since: Date)

    /// Dwell is satisfied; the `confirm` attempt is in flight.
    case confirming(occurrenceId: String)

    /// A transient failure. Retried with bounded backoff.
    case retrying(occurrenceId: String?, attempt: Int, nextAttemptAt: Date)

    /// The server counted it, or had already counted it. The only success.
    case counted(occurrenceId: String, alreadyCounted: Bool)

    /// Terminal, and not retried. Authorization and validation failures are
    /// answers, not outages.
    case refused(reason: EvidenceRefusal)

    /// Left the region before dwell completed. Not a failure — the person
    /// drove past, or stepped out.
    case abandoned

    /// Backing off after refusals, until `until`.
    ///
    /// **Deliberately not `refused`.** This occurrence is still available; the
    /// device is simply not going to submit again this instant. A meaningful
    /// trigger — a verified exit, a materially better fix, a configuration
    /// change — proceeds immediately regardless.
    case holding(occurrenceId: String, until: Date, reason: HoldReason)

    public var isTerminal: Bool {
        switch self {
        case .counted, .refused, .abandoned: return true
        // `holding` is explicitly *not* terminal: the occurrence remains
        // available and the hold lifts on its own.
        default: return false
        }
    }

    /// Whether the UI may show a check-in as having happened. Deliberately
    /// narrow: everything else is "we are working on it" or an explanation.
    public var isSuccess: Bool {
        if case .counted = self { return true }
        return false
    }
}

/// Why an attempt will never succeed as-is.
///
/// Every one of these is fail-closed: the flow stops, the pending evidence is
/// purged, and — where the cause is a loss of authority — the reconciler tears
/// the regions down too.
public enum EvidenceRefusal: String, Equatable, Sendable, CaseIterable {
    case notEnrolled = "not_enrolled"
    case blocked
    case noPeopleLink = "no_people_link"
    case consentRequired = "consent_required"
    case consentRevoked = "consent_revoked"
    case wrongChurch = "wrong_church"
    case noOpenOccurrence = "no_open_occurrence"
    case windowClosed = "window_closed"
    case insufficientAccuracy = "insufficient_accuracy"
    case outsideRegion = "outside_region"
    case geofenceDisabled = "geofence_disabled"
    case cancelled
    case expired
    case unknown

    /// Whether losing this means the device should stop monitoring entirely,
    /// as opposed to simply not counting this one event.
    public var requiresTeardown: Bool {
        switch self {
        case .notEnrolled, .blocked, .noPeopleLink,
             .consentRequired, .consentRevoked, .geofenceDisabled, .wrongChurch:
            return true
        default:
            return false
        }
    }

    /// Whether the loss is the account's rather than one church's.
    ///
    /// Consent is recorded on the account, so withdrawing it stops every
    /// church. A People link, a block or a church switching the feature off is
    /// that church's alone, and must not stop the others being watched.
    public var isAccountWide: Bool {
        self == .consentRequired || self == .consentRevoked
    }

    public init(serverReason: String) {
        self = EvidenceRefusal(rawValue: serverReason) ?? .unknown
    }
}

/// The canonical request both platforms produce.
///
/// Identical field-for-field on iOS and Android. Core Location gives us a
/// `CLLocation` and `GeofencingClient` gives us a `Location`; both are reduced
/// to exactly this before anything leaves the device, so the server sees one
/// shape and neither platform can drift into sending something the other
/// cannot.
public struct AttendanceEvidence: Equatable, Sendable {
    public let occurrenceId: String
    public let phase: String
    /// Sent on `detected`, so the server-side detection is idempotent per
    /// workflow and a retry does not restart the dwell clock.
    public let attemptId: String?
    /// Sent on `confirm`. The server re-reads it and re-checks every binding.
    public let detectionId: String?
    /// Bound at detection and re-checked at confirmation.
    public let regionId: String?
    public let configVersion: Int?
    public let observedAt: Date
    public let accuracyMeters: Double?
    public let dwellSeconds: Int?
    public let latitude: Double?
    public let longitude: Double?
    /// Android's `isFromMockProvider`. Always nil on iOS: no equivalent exists,
    /// and inventing one would be dishonest.
    public let mockLocationReported: Bool?

    public init(
        occurrenceId: String,
        phase: String,
        observedAt: Date,
        accuracyMeters: Double?,
        dwellSeconds: Int?,
        latitude: Double?,
        longitude: Double?,
        mockLocationReported: Bool? = nil,
        attemptId: String? = nil,
        detectionId: String? = nil,
        regionId: String? = nil,
        configVersion: Int? = nil
    ) {
        self.attemptId = attemptId
        self.detectionId = detectionId
        self.regionId = regionId
        self.configVersion = configVersion
        self.occurrenceId = occurrenceId
        self.phase = phase
        self.observedAt = observedAt
        self.accuracyMeters = accuracyMeters
        self.dwellSeconds = dwellSeconds
        self.latitude = latitude
        self.longitude = longitude
        self.mockLocationReported = mockLocationReported
    }

    /// Builds a request from one sample. A missing or unusable fix produces nil
    /// coordinates rather than a guess, and the server bands that `unknown`.
    public static func from(
        occurrenceId: String,
        phase: String,
        sample: LocationSample?,
        dwellSeconds: Int?,
        observedAt: Date,
        attemptId: String? = nil,
        detectionId: String? = nil,
        regionId: String? = nil,
        configVersion: Int? = nil
    ) -> AttendanceEvidence {
        let usable = sample.flatMap { $0.isUsable ? $0 : nil }
        return AttendanceEvidence(
            occurrenceId: occurrenceId,
            phase: phase,
            observedAt: observedAt,
            accuracyMeters: usable?.horizontalAccuracyMeters,
            dwellSeconds: dwellSeconds,
            latitude: usable?.latitude,
            longitude: usable?.longitude,
            attemptId: attemptId,
            detectionId: detectionId,
            regionId: regionId,
            configVersion: configVersion
        )
    }
}

/// One logical check-in workflow.
///
/// **Why this exists, and what it replaced.** The first version derived the
/// idempotency key from `(account, occurrence, phase)` alone. That looked
/// elegant — deterministic, nothing to persist — and it was wrong in a way that
/// broke the feature for exactly the people most likely to need it.
///
/// `record_attendance` checks idempotency *before* validation and replays the
/// earlier result. So a first entry with a poor fix — indoors, cold GPS, a
/// phone still waking up — is rejected `outside_region` and cached under that
/// key. The visitor then walks inside, the fix sharpens, the OS delivers
/// another entry, and the server replays the refusal. **Forever.** They could
/// stand in the sanctuary all morning and never be counted, and nothing on the
/// device or the dashboard would explain why.
///
/// The same trap applied to `insufficient_accuracy`, an expired configuration,
/// and a consent revocation that was later restored.
///
/// The fix is to stop pretending one occurrence means one attempt. A *logical
/// attempt* is one workflow: opened when a genuinely new eligible entry
/// begins, carrying a random id, and **closed** when it reaches any terminal
/// state. A later entry opens a new one, gets a new key, and is validated
/// fresh.
public struct LogicalAttempt: Codable, Equatable, Sendable {
    /// 128 bits of randomness. Not derived from anything about the person.
    public let attemptId: String
    public let churchSlug: String
    public let occurrenceId: String
    public let openedAt: Date
    /// Bounded by the same retention rule as the evidence it carries.
    public let expiresAt: Date
    /// The one submission that could not be sent, if any.
    public var queued: QueuedSubmission?

    /// The earliest instant a `confirm` may succeed, **as the server said**.
    ///
    /// Persisted, not held in memory, because the wait spans exactly the window
    /// where the process is most likely to be suspended or killed. Nil until a
    /// `detected` submission comes back `pending_confirmation`.
    public var confirmationNotBefore: Date?

    /// The **server-issued** detection this attempt opened.
    ///
    /// Opaque, and the only thing that lets a confirmation be judged: the
    /// server measures the dwell between its own `detected_at_server` and
    /// `now()`, so nothing the device reports can shorten it. Persisted for the
    /// same reason `confirmationNotBefore` is — the wait spans exactly the
    /// window where the process is most likely to be killed.
    public var detectionId: String?

    // MARK: Arrival — everything below is optional, so an attempt written by
    // an earlier build still decodes. None of it is a position.

    /// The region the arrival was seen in. An exit from *this* region abandons
    /// the attempt; an exit from another campus of the same church does not.
    public var regionId: String?

    /// Whether the church asks the person to confirm, or checks them in on its
    /// own once they have stayed. Nil on an attempt from an earlier build,
    /// which only ever ran the confirmation flow.
    public var mode: ArrivalMode?

    /// **Automatic mode only**: the earliest instant this device will submit
    /// anything for the arrival — the local dwell, or the moment check-in
    /// opens for someone who arrived early.
    ///
    /// Nothing is sent before it. A person who drives past the building sends
    /// no coordinate at all, because the exit closes the attempt first.
    public var submitNotBefore: Date?

    /// When the person said yes — a tap on the notification or on the
    /// in-app button. A church that asks for confirmation is never answered on
    /// the person's behalf, so a pending attempt without this is not confirmed
    /// whatever the clock says.
    public var personConfirmedAt: Date?

    /// The configuration the arrival was judged against. Sent with the
    /// evidence so the server can bind the detection to it.
    public var configVersion: Int?

    /// The occurrence id came from the configuration's upcoming windows, not
    /// from the server's "open now" answer: the person arrived before check-in
    /// opened. The server still resolves the real occurrence before anything
    /// is submitted, and this hint is replaced if it differs.
    public var awaitingWindow: Bool?

    /// When to ask, when that is not simply `submitNotBefore`: a confirmation
    /// arrival held for an opening window is asked once a dwell could have
    /// passed after it opens, not the moment it opens.
    public var askAt: Date?

    public init(
        attemptId: String,
        churchSlug: String,
        occurrenceId: String,
        openedAt: Date,
        expiresAt: Date,
        queued: QueuedSubmission? = nil,
        confirmationNotBefore: Date? = nil,
        detectionId: String? = nil,
        regionId: String? = nil,
        mode: ArrivalMode? = nil,
        submitNotBefore: Date? = nil,
        personConfirmedAt: Date? = nil,
        configVersion: Int? = nil,
        awaitingWindow: Bool? = nil
    ) {
        self.confirmationNotBefore = confirmationNotBefore
        self.detectionId = detectionId
        self.attemptId = attemptId
        self.churchSlug = churchSlug
        self.occurrenceId = occurrenceId
        self.openedAt = openedAt
        self.expiresAt = expiresAt
        self.queued = queued
        self.regionId = regionId
        self.mode = mode
        self.submitNotBefore = submitNotBefore
        self.personConfirmedAt = personConfirmedAt
        self.configVersion = configVersion
        self.awaitingWindow = awaitingWindow
    }

    public func isExpired(now: Date) -> Bool { now >= expiresAt }

    /// Whether this is an arrival still waiting for its first submission.
    public var isAwaitingArrivalSubmission: Bool {
        submitNotBefore != nil && detectionId == nil && queued == nil
    }

    /// Whether the arrival may be submitted now: its local wait has passed and
    /// nothing has gone to the server yet.
    public func maySubmitArrival(now: Date) -> Bool {
        guard isAwaitingArrivalSubmission, let submitNotBefore else { return false }
        return now >= submitNotBefore && !isExpired(now: now)
    }

    /// Whether the church's policy still needs a yes from the person before
    /// anything more is sent. False for automatic arrivals.
    public var needsPersonConfirmation: Bool {
        (mode ?? .confirmation) == .confirmation && personConfirmedAt == nil
    }

    /// When the person should be asked, if they need to be asked at all.
    ///
    /// For a confirmation the server's own instant; for an automatic arrival
    /// the moment it becomes submittable, as a fallback for when iOS gives the
    /// app no execution time of its own then.
    public var promptAt: Date? {
        if detectionId != nil { return confirmationNotBefore }
        return askAt ?? submitNotBefore
    }

    /// Whether a confirmation may be attempted now.
    ///
    /// False before the server's instant, so the client never sends a `confirm`
    /// that would predictably be refused for insufficient dwell — which would
    /// burn a submission and teach the person nothing.
    /// Whether a confirmation is worth attempting now.
    ///
    /// **Scheduling only.** The server enforces the same deadline again from
    /// its own clock, so this is the client deciding when to bother — not a
    /// decision about whether the dwell elapsed. A device whose clock is fast
    /// will simply be refused `dwell_not_elapsed` and try again.
    public func mayConfirm(now: Date) -> Bool {
        guard let confirmationNotBefore, detectionId != nil else { return false }
        return now >= confirmationNotBefore && !isExpired(now: now)
    }

    /// Whether this attempt covers the workflow now beginning.
    ///
    /// A different occurrence is a different service — the evening one after
    /// the morning one — and must never inherit the morning's identity.
    public func covers(churchSlug: String, occurrenceId: String, now: Date) -> Bool {
        self.churchSlug == churchSlug
            && self.occurrenceId == occurrenceId
            && !isExpired(now: now)
    }

    /// Opens a new attempt with fresh randomness.
    ///
    /// `randomId` is injectable so tests can assert *that* ids differ without
    /// depending on the value, and so a test can force a collision.
    public static func open(
        churchSlug: String,
        occurrenceId: String,
        now: Date,
        lifetime: TimeInterval = pendingAttemptLifetime,
        regionId: String? = nil,
        mode: ArrivalMode? = nil,
        configVersion: Int? = nil,
        randomId: () -> String = { LogicalAttempt.newAttemptId() }
    ) -> LogicalAttempt {
        LogicalAttempt(
            attemptId: randomId(),
            churchSlug: churchSlug,
            occurrenceId: occurrenceId,
            openedAt: now,
            expiresAt: now.addingTimeInterval(lifetime),
            regionId: regionId,
            mode: mode,
            configVersion: configVersion
        )
    }

    /// 128 bits, hex.
    ///
    /// **Not a tracking identifier.** It is scoped to one occurrence, lives at
    /// most as long as the retention policy allows, is never sent anywhere
    /// except folded into an idempotency key, and is deleted when the attempt
    /// closes. Nothing correlates two of them.
    public static func newAttemptId() -> String {
        var bytes = [UInt8](repeating: 0, count: 16)
        for index in bytes.indices { bytes[index] = UInt8.random(in: 0...255) }
        return bytes.map { String(format: "%02x", $0) }.joined()
    }
}

/// A submission that could not be sent, held against its attempt.
public struct QueuedSubmission: Codable, Equatable, Sendable {
    /// `detected` or `confirm` — the server contract's two distinct commands.
    public let kind: String
    public let observedAt: Date
    public let accuracyMeters: Double?
    public let dwellSeconds: Int?
    public let latitude: Double?
    public let longitude: Double?
    public let retries: Int

    public init(
        kind: String,
        observedAt: Date,
        accuracyMeters: Double?,
        dwellSeconds: Int?,
        latitude: Double?,
        longitude: Double?,
        retries: Int = 0
    ) {
        self.kind = kind
        self.observedAt = observedAt
        self.accuracyMeters = accuracyMeters
        self.dwellSeconds = dwellSeconds
        self.latitude = latitude
        self.longitude = longitude
        self.retries = retries
    }

    public func withRetry() -> QueuedSubmission {
        QueuedSubmission(
            kind: kind, observedAt: observedAt, accuracyMeters: accuracyMeters,
            dwellSeconds: dwellSeconds, latitude: latitude, longitude: longitude,
            retries: retries + 1
        )
    }

    public func evidence(
        occurrenceId: String,
        attemptId: String? = nil,
        detectionId: String? = nil,
        regionId: String? = nil,
        configVersion: Int? = nil
    ) -> AttendanceEvidence {
        AttendanceEvidence(
            occurrenceId: occurrenceId, phase: kind, observedAt: observedAt,
            accuracyMeters: accuracyMeters, dwellSeconds: dwellSeconds,
            latitude: latitude, longitude: longitude,
            // `detected` names the workflow; `confirm` names the detection.
            // Each carries only the identity its own command reads.
            attemptId: kind == "detected" ? attemptId : nil,
            detectionId: kind == "confirm" ? detectionId : nil,
            regionId: regionId,
            configVersion: configVersion
        )
    }

    public static func from(_ evidence: AttendanceEvidence, retries: Int = 0) -> QueuedSubmission {
        QueuedSubmission(
            kind: evidence.phase, observedAt: evidence.observedAt,
            accuracyMeters: evidence.accuracyMeters, dwellSeconds: evidence.dwellSeconds,
            latitude: evidence.latitude, longitude: evidence.longitude, retries: retries
        )
    }
}

/// Idempotency keys, derived from a logical attempt.
///
/// ```
/// gf-sha256("faithform.geofence.v2|account|church|occurrence|attemptId|kind")[0:40]
/// ```
///
/// **Each input earns its place:**
///
/// - `account` — the server scopes attempts by `(occurrence, source, key)`,
///   which does not include the account. Two people sharing a device must not
///   collide.
/// - `church` — a defensive boundary. Occurrence ids are uuids, so this cannot
///   currently collide, but a key that spans tenants is not a thing to leave
///   resting on that.
/// - `occurrence` — two services on one day are two answers.
/// - **`attemptId`** — the fix. One *workflow*, not one occurrence. A refused
///   attempt is closed, and the next entry gets a new id and fresh validation.
/// - `kind` — `detected` and `confirm` are two genuinely independent server
///   commands, not internal state: the contract defines both, and the server
///   answers each on its own. Sharing a key would make `confirm` replay the
///   earlier `pending_confirmation` forever, which is the same class of bug
///   this version exists to remove.
///
/// The `v2` prefix means a client mid-upgrade cannot collide with a key it
/// wrote under the old scheme.
public enum IdempotencyKey {
    public static func geofence(
        accountId: String,
        churchSlug: String,
        occurrenceId: String,
        attemptId: String,
        kind: String
    ) -> String {
        let material = [
            "faithform.geofence.v2", accountId, churchSlug, occurrenceId, attemptId, kind,
        ].joined(separator: "|")
        return "gf-" + FaithFormDigest.sha256Hex(material).prefix(40)
    }
}

/// How long an unsent attempt is worth keeping.
///
/// Two hours covers a service that runs long plus a drive home through a dead
/// zone. Beyond that the window has closed server-side anyway, so the queue
/// would only be holding coordinates for nothing.
public let pendingAttemptLifetime: TimeInterval = 2 * 60 * 60

/// Bounded exponential backoff with jitter.
///
/// Jitter matters more than usual here: a whole congregation's phones cross the
/// same boundary within a couple of minutes, and undithered backoff would make
/// them retry in lockstep.
///
/// Applied **only** to transport and 5xx failures. An authorization or
/// validation refusal is an answer and is never retried — retrying a
/// `consent_revoked` would be both pointless and a small denial-of-service
/// against our own server.
public enum RetryPolicy {
    public static let maxAttempts = 5

    public static func delay(
        forAttempt attempt: Int,
        jitter: @Sendable () -> Double = { Double.random(in: 0...1) }
    ) -> TimeInterval {
        let base = min(pow(2.0, Double(max(0, attempt))) * 2.0, 120.0)
        // Full jitter: uniform in [base/2, base]. Keeps a floor so a tight loop
        // is impossible while still spreading the herd.
        return base / 2 + (base / 2) * jitter()
    }

    public static func shouldRetry(attempt: Int, isTransient: Bool) -> Bool {
        isTransient && attempt < maxAttempts
    }
}
