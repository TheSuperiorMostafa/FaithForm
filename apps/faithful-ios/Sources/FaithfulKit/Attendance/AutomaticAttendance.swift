import Foundation

/// Submits evidence and reports what the server decided.
///
/// Abstracted so the whole flow — including retries, terminal refusals and
/// duplicate callbacks — is testable without a network.
public protocol AttendanceSubmitting: Actor {
    /// The eligible occurrence right now, resolved by the server from its own
    /// clock. The client never picks one from a cached window: a cached window
    /// may be stale, and choosing locally would be the client deciding what it
    /// is attending.
    func eligibleOccurrenceId(churchSlug: String) async throws -> String?

    func submit(
        _ evidence: AttendanceEvidence,
        idempotencyKey: String
    ) async throws -> AttendanceResult
}

/// Where the open logical attempt lives.
///
/// Backed by the Keychain on device. It holds an attempt id and, briefly, a
/// position — so this is deliberately *not* `UserDefaults`, a plist, or an
/// ordinary cache.
///
/// **`openIfAbsent` must be atomic.** It is what makes two simultaneous region
/// callbacks produce one attempt rather than two. The actor isolation provides
/// that here; a store implementation that read and then wrote across a
/// suspension point would reintroduce the race.
public protocol AttendanceAttemptStoring: Actor {
    /// The open attempt, if there is one. Expired attempts are not returned.
    func current(partition: CachePartition, now: Date) async -> LogicalAttempt?

    /// Opens `candidate` **only if** no usable attempt is already open for the
    /// same church and occurrence, and returns whichever attempt is now open.
    ///
    /// Returning the *existing* one on a collision is the point: a duplicate
    /// callback joins the attempt already in progress instead of starting a
    /// second one with a different key.
    func openIfAbsent(
        _ candidate: LogicalAttempt,
        partition: CachePartition,
        now: Date
    ) async -> LogicalAttempt

    /// Persists a change to the open attempt — a queued submission, a retry.
    func update(_ attempt: LogicalAttempt, partition: CachePartition) async

    /// Closes and purges. Called on every terminal outcome and on expiry.
    func close(partition: CachePartition) async
}

/// Whether automatic attendance is switched on, as this device last knew.
public struct AutomaticAttendanceSettings: Codable, Equatable, Sendable {
    /// The person's choice in this app. Distinct from the server's consent and
    /// from the OS permission; all three must hold.
    public var enabled: Bool
    /// What the server last said its consent state was.
    public var serverConsent: String
    public var churchSlug: String?

    public init(enabled: Bool = false, serverConsent: String = "unset", churchSlug: String? = nil) {
        self.enabled = enabled
        self.serverConsent = serverConsent
        self.churchSlug = churchSlug
    }

    /// All three gates. Deliberately not `enabled` alone: an app toggle that
    /// silently means nothing because the server withdrew consent, or because
    /// the OS permission was revoked in Settings, would be a lie on screen.
    public func isOperational(authorization: LocationAuthorization) -> Bool {
        enabled && serverConsent == "granted" && authorization.permitsRegionMonitoring
    }
}

/// Drives one region event from callback to server verdict.
///
/// **Single-flight.** One logical check-in intent at a time. Duplicate OS
/// callbacks are routine — Core Location re-delivers, and a person walking in
/// and out of a doorway crosses the boundary repeatedly — and each one must
/// not become another request. A callback arriving while a flow is already
/// running for the same occurrence is dropped.
///
/// **Never counts locally.** The only state that reads as success is a server
/// result of `counted` or `already_counted`.
public actor AutomaticAttendanceCoordinator {
    private let reconciler: GeofenceReconciler
    private let submitter: any AttendanceSubmitting
    private let sampler: any LocationSampling
    private let store: any AttendanceAttemptStoring
    private let authorization: any LocationAuthorizing
    private let now: @Sendable () -> Date
    private let log = FaithfulLog(category: "attendance")

    private var phase: EvidencePhase = .idle
    private var inFlightOccurrence: String?

    /// Set synchronously on entry to `handleRegionEntered`, before any `await`.
    ///
    /// An actor serialises *statements*, not whole functions: every suspension
    /// point is somewhere another task can interleave. Guarding on
    /// `inFlightOccurrence` alone was a real race — the occurrence is only
    /// known after an `await`, so eight concurrent callbacks all passed the
    /// check before any of them set it, and all eight submitted. Found by the
    /// duplicate-callback test, which is exactly the case a real device
    /// produces when someone lingers in a doorway.
    private var isHandlingEvent = false

    /// Occurrences this device has already seen counted.
    ///
    /// The in-flight flag stops *concurrent* duplicates. It does not stop
    /// *sequential* ones — and those are the common case on a real device:
    /// someone stands near the door, Core Location delivers an entry, then
    /// delivers it again minutes later. Without this, every re-entry is another
    /// round trip and another radio wake.
    ///
    /// The server would still refuse to double-count — the idempotency key is
    /// identical and the unique fact is absolute — so this is not a correctness
    /// guard. It is a battery guard, and it was added after the Android suite
    /// caught the same gap.
    ///
    /// Bounded, and cleared whenever the identity changes, so it can never
    /// suppress a legitimate attempt at a different service.
    private var settledOccurrences: [String] = []

    /// Anti-flapping state per occurrence.
    ///
    /// **Never a lockout.** An earlier version capped refusals at five and then
    /// refused permanently, which was the original bug at a larger number: five
    /// poor readings on arrival would stop that person being counted at that
    /// service at all. `AttemptPolicy` replaces the cap with an exponential
    /// cooldown, a rolling budget, and triggers that bypass both when something
    /// materially changed.
    private var policies: [String: AttemptPolicy] = [:]

    /// The accuracy of the most recent fix, so a refusal can record what it was
    /// refused *with* and a later reading can be compared against it.
    private var lastAccuracyMeters: Double?

    /// The configuration version the last decision was made against. A change
    /// is a meaningful trigger: whatever refused before may not refuse now.
    private var lastConfigVersion: Int?

    /// Used only when a server predates `confirmationNotBefore`.
    ///
    /// Deliberately conservative: confirming too early is refused and wastes a
    /// submission, whereas confirming late simply costs a little time.
    private let fallbackDwellSeconds: TimeInterval = 150

    /// Injectable so a test can assert *that* attempt ids differ without
    /// depending on their values, and can force a collision.
    private let newAttemptId: () -> String
    private var settings = AutomaticAttendanceSettings()
    private var partition: CachePartition?
    private var accountId: String?

    public init(
        reconciler: GeofenceReconciler,
        submitter: any AttendanceSubmitting,
        sampler: any LocationSampling,
        store: any AttendanceAttemptStoring,
        authorization: any LocationAuthorizing,
        now: @escaping @Sendable () -> Date = { Date() },
        newAttemptId: @escaping @Sendable () -> String = { LogicalAttempt.newAttemptId() }
    ) {
        self.newAttemptId = newAttemptId
        self.reconciler = reconciler
        self.submitter = submitter
        self.sampler = sampler
        self.store = store
        self.authorization = authorization
        self.now = now
    }

    public func currentPhase() -> EvidencePhase { phase }
    public func currentSettings() -> AutomaticAttendanceSettings { settings }

    public func bind(
        partition: CachePartition,
        accountId: String?,
        settings: AutomaticAttendanceSettings
    ) async {
        if self.partition?.storageKey != partition.storageKey || self.accountId != accountId {
            // A different identity has different occurrences. Never carry the
            // suppression list or the refusal counters across one.
            settledOccurrences = []
            policies = [:]
        }
        self.partition = partition
        self.accountId = accountId
        self.settings = settings
        await reconciler.bind(
            partition: partition,
            churchSlug: settings.churchSlug,
            enabled: settings.enabled && settings.serverConsent == "granted"
        )
    }

    /// Turns the feature on and registers whatever the server authorizes.
    ///
    /// Consent is already recorded server-side by the time this runs — the UI
    /// writes it first — so a refusal here is about the church's configuration
    /// or the People link, not about the person's choice.
    @discardableResult
    public func enable(settings: AutomaticAttendanceSettings) async -> ReconcileOutcome {
        self.settings = settings
        guard let partition else { return .idle }

        await reconciler.bind(
            partition: partition,
            churchSlug: settings.churchSlug,
            enabled: settings.enabled && settings.serverConsent == "granted"
        )
        let outcome = await reconciler.reconcile(trigger: .optIn)
        log.event("automatic_attendance_enabled")
        return outcome
    }

    /// Re-runs reconciliation for a lifecycle reason.
    ///
    /// The single funnel every trigger goes through: foreground, church change,
    /// account change, authorization-version change, permission change, and a
    /// configuration refresh all arrive here rather than each doing their own
    /// registration.
    @discardableResult
    public func reconcile(trigger: ReconcileTrigger) async -> ReconcileOutcome {
        await reconciler.reconcile(trigger: trigger)
    }

    /// Turns the feature off and leaves nothing behind.
    ///
    /// Four things, in this order: stop monitoring, cancel anything in flight,
    /// purge unsent evidence, then record the setting. The order matters — a
    /// crash midway must not leave regions registered with the feature marked
    /// off.
    public func disable() async {
        await reconciler.teardown()
        inFlightOccurrence = nil
        settledOccurrences = []
        policies = [:]
        phase = .idle
        if let partition { await store.close(partition: partition) }
        settings.enabled = false
        log.event("automatic_attendance_disabled")
    }

    /// A boundary crossing, from the OS.
    ///
    /// This is the entry point for everything: a foreground callback, a
    /// background wake, and a relaunch after termination all arrive here.
    @discardableResult
    public func handleRegionEntered(regionId: String) async -> EvidencePhase {
        guard settings.enabled, let partition, let accountId else {
            phase = .refused(reason: .consentRequired)
            return phase
        }

        // Duplicate callbacks are normal, not exceptional. This check and the
        // assignment below happen with no `await` between them, so a second
        // callback cannot slip through.
        guard !isHandlingEvent, inFlightOccurrence == nil else { return phase }
        isHandlingEvent = true
        defer { isHandlingEvent = false }

        phase = .entered(regionId: regionId, at: now())

        // The event may have arrived against an expired or revoked
        // configuration. Waking is allowed; acting on it without rechecking is
        // not. `.regionEvent` forces a refresh rather than trusting the cache.
        phase = .reauthorizing(regionId: regionId)
        let outcome = await reconciler.reconcile(trigger: .regionEvent)
        if let refusal = outcome.refusal {
            return await fail(Self.refusal(forReconcile: refusal), partition: partition)
        }

        // The server picks the occurrence, from its own clock.
        let occurrenceId: String?
        do {
            occurrenceId = try await submitter.eligibleOccurrenceId(
                churchSlug: settings.churchSlug ?? ""
            )
        } catch {
            phase = .retrying(occurrenceId: nil, attempt: 1, nextAttemptAt: nextRetry(1))
            return phase
        }

        guard let occurrenceId else {
            // Outside every check-in window. Normal, not an error: the person
            // drove past the building on a Tuesday.
            phase = .refused(reason: .noOpenOccurrence)
            return phase
        }

        // Already counted here. Re-entering the building does not need another
        // round trip for an answer we have.
        if settledOccurrences.contains(occurrenceId) {
            phase = .counted(occurrenceId: occurrenceId, alreadyCounted: true)
            return phase
        }

        // Take the fix first: whether this attempt may proceed depends on
        // whether the reading is materially better than the one that was
        // refused, and that cannot be known without looking.
        let sample = await sampler.requestOneShotLocation(timeout: 15)
        let accuracy = sample.flatMap { $0.isUsable ? $0.horizontalAccuracyMeters : nil }

        lastAccuracyMeters = accuracy ?? lastAccuracyMeters
        let policy = policies[occurrenceId] ?? AttemptPolicy()
        switch policy.decide(
            now: now(),
            accuracyMeters: accuracy,
            configVersion: lastConfigVersion
        ) {
        case .alreadySettled:
            phase = .counted(occurrenceId: occurrenceId, alreadyCounted: true)
            return phase

        case .waitUntil(let eligible, let reason):
            // **Not a rejection of the occurrence.** The device is backing off;
            // the next meaningful trigger, or simply this instant passing, lets
            // it try again.
            phase = .holding(occurrenceId: occurrenceId, until: eligible, reason: reason)
            return phase

        case .proceed:
            break
        }

        // **Open the logical attempt before anything is submitted.** Two
        // simultaneous callbacks both reach here; `openIfAbsent` is atomic, so
        // the second joins the first attempt rather than starting a second one
        // with a different key.
        let attempt = await store.openIfAbsent(
            LogicalAttempt.open(
                churchSlug: settings.churchSlug ?? "",
                occurrenceId: occurrenceId,
                now: now(),
                randomId: newAttemptId
            ),
            partition: partition,
            now: now()
        )

        inFlightOccurrence = occurrenceId
        defer { inFlightOccurrence = nil }

        policies[occurrenceId] = policy.recordingSubmission(at: now())

        return await runFlow(
            attempt: attempt,
            sample: sample,
            accountId: accountId,
            partition: partition
        )
    }

    /// Leaving before dwell completes abandons the intent.
    public func handleRegionExited(regionId: String) async {
        // A verified exit is the strongest "something changed" signal there is:
        // the person actually left. Recorded for every occurrence being held,
        // so the next entry proceeds regardless of any cooldown.
        for key in policies.keys {
            policies[key] = policies[key]?.recordingExit()
        }

        switch phase {
        case .entered, .reauthorizing, .awaitingDwell:
            phase = .abandoned
            if let partition { await store.close(partition: partition) }
        default:
            break
        }
    }

    private func runFlow(
        attempt: LogicalAttempt,
        sample: LocationSample?,
        accountId: String,
        partition: CachePartition
    ) async -> EvidencePhase {
        let occurrenceId = attempt.occurrenceId

        // A reduced-accuracy grant cannot resolve a campus. Refuse rather than
        // submit a fix that will be banded unusable anyway.
        guard await authorization.currentAccuracy() == .full else {
            return await fail(.insufficientAccuracy, partition: partition)
        }

        let detected = AttendanceEvidence.from(
            occurrenceId: occurrenceId,
            phase: "detected",
            sample: sample,
            // Sent, but **not used by the server** for a geofence attempt: the
            // dwell is measured between two server timestamps. It is here for
            // the audit, and the server treats it as untrusted diagnostics.
            dwellSeconds: 0,
            observedAt: now(),
            attemptId: attempt.attemptId
        )

        let first = await send(
            detected, attempt: attempt, accountId: accountId, partition: partition
        )

        switch first {
        case .refusal(let reason):
            return await fail(reason, partition: partition)
        case .transient:
            return phase
        case .result(let result):
            switch result.outcome {
            case .counted, .alreadyCounted:
                return await succeed(
                    occurrenceId: occurrenceId,
                    alreadyCounted: result.outcome == .alreadyCounted,
                    partition: partition
                )
            case .pendingConfirmation:
                // **Persist when the server said we may come back.** Held in
                // storage rather than memory because this wait spans exactly
                // the window where the process is most likely to be suspended
                // or killed — which on iOS is the ordinary case.
                var awaiting = attempt
                awaiting.confirmationNotBefore =
                    result.confirmationNotBefore.flatMap(FaithfulInstant.parse)
                    // No server instant means an older server. Fall back to the
                    // configuration's dwell rather than confirming blindly.
                    ?? now().addingTimeInterval(fallbackDwellSeconds)
                // The server-issued detection. Without it a confirmation has no
                // identity the server will accept, so it is persisted as
                // carefully as the deadline is.
                awaiting.detectionId = result.detectionId
                await store.update(awaiting, partition: partition)
            default:
                return await fail(.unknown, partition: partition)
            }
        }

        // Dwell. Nothing sleeps here: `confirmIfDue` runs on the next real
        // execution opportunity — another region callback, a granted background
        // refresh, or the person opening the app.
        phase = .awaitingDwell(occurrenceId: occurrenceId, since: now())
        return phase
    }

    /// Confirms a pending attempt **if the server's instant has passed**.
    ///
    /// This is the entry point every legitimate execution opportunity calls:
    /// another region event, an app foreground, a granted background refresh.
    /// It is safe to call at any time and does nothing when it is not due, so
    /// callers do not need to know the policy.
    ///
    /// Returns the phase, unchanged when there was nothing to do.
    @discardableResult
    public func confirmIfDue() async -> EvidencePhase {
        // The account has to exist — a confirmation with nobody to attribute it
        // to is not a check-in — but its value is not needed here: `store` is
        // already partitioned, and the submission reads the account itself.
        guard settings.enabled, let partition, accountId != nil else { return phase }
        guard let attempt = await store.current(partition: partition, now: now()) else {
            return phase
        }
        guard attempt.confirmationNotBefore != nil else { return phase }

        // Not yet. Sending now would be refused for insufficient dwell, which
        // costs a submission and tells the person nothing.
        guard attempt.mayConfirm(now: now()) else { return phase }

        let elapsed = Int(now().timeIntervalSince(attempt.openedAt))
        return await confirmDwell(
            occurrenceId: attempt.occurrenceId,
            dwellSeconds: max(0, elapsed)
        )
    }

    /// Completes a dwell that the caller has determined is satisfied.
    ///
    /// **What iOS actually guarantees, stated plainly.** Core Location has no
    /// dwell transition. `CLCircularRegion` reports entry and exit and nothing
    /// between, so there is no OS event that means "still here two minutes
    /// later" — Android's `GEOFENCE_TRANSITION_DWELL` has no iOS counterpart
    /// and this app does not invent one.
    ///
    /// That leaves three ways a confirmation can happen, and only three:
    ///
    ///  1. **Within the wake the entry produced.** Core Location relaunches the
    ///     app into the background for a boundary crossing, and that execution
    ///     window is measured in seconds — not the minutes a dwell requires. It
    ///     usually will not be enough.
    ///  2. **On a later wake** — another region event, or the person opening
    ///     the app. `flushPending` and this method are both reachable then.
    ///  3. **Not at all.**
    ///
    /// **There is deliberately no in-memory timer.** A `Task.sleep` spanning a
    /// dwell would not survive suspension, and a background task assertion
    /// requested for it would be a request the system is free to refuse. Either
    /// would produce a feature that appeared to work on a plugged-in device in
    /// the foreground and silently did not in a pocket.
    ///
    /// So this method is called with whatever execution time the OS actually
    /// granted, and when it is not called the attempt simply expires — the
    /// person is not counted, and the app never claims otherwise. That is the
    /// honest shape, and it is why the church's `requiresConfirmation` policy
    /// is a real trade-off rather than a free improvement.
    @discardableResult
    public func confirmDwell(occurrenceId: String, dwellSeconds: Int) async -> EvidencePhase {
        guard let partition, let accountId else { return phase }

        // **Deliberately not guarded on the in-memory phase.** After the app is
        // relaunched the phase is `.idle` — which on iOS is the ordinary case
        // for a background wake, not an edge one — and guarding on it made a
        // persisted attempt unconfirmable forever. The stored attempt *is* the
        // state; memory is only a cache of it.
        //
        // The same logical attempt the `detected` submission opened. If it has
        // gone — expired, or closed by a teardown — this confirmation has no
        // identity and must not invent one.
        guard let attempt = await store.current(partition: partition, now: now()),
              attempt.occurrenceId == occurrenceId
        else {
            phase = .refused(reason: .expired)
            return phase
        }

        phase = .confirming(occurrenceId: occurrenceId)

        let sample = await sampler.requestOneShotLocation(timeout: 15)
        let confirm = AttendanceEvidence.from(
            occurrenceId: occurrenceId,
            phase: "confirm",
            sample: sample,
            // Reported for the audit. The server ignores it and measures the
            // dwell from its own detection record.
            dwellSeconds: dwellSeconds,
            observedAt: now(),
            detectionId: attempt.detectionId
        )

        switch await send(confirm, attempt: attempt, accountId: accountId, partition: partition) {
        case .refusal(let reason):
            return await fail(reason, partition: partition)
        case .transient:
            return phase
        case .result(let result):
            switch result.outcome {
            case .counted, .alreadyCounted:
                return await succeed(
                    occurrenceId: occurrenceId,
                    alreadyCounted: result.outcome == .alreadyCounted,
                    partition: partition
                )
            case .pendingConfirmation:
                // Dwell still not satisfied by the server's reckoning.
                phase = .awaitingDwell(occurrenceId: occurrenceId, since: now())
            default:
                return await fail(.unknown, partition: partition)
            }
            return phase
        }
    }

    private enum SendOutcome {
        case result(AttendanceResult)
        case refusal(EvidenceRefusal)
        case transient
    }

    private func send(
        _ evidence: AttendanceEvidence,
        attempt: LogicalAttempt,
        accountId: String,
        partition: CachePartition
    ) async -> SendOutcome {
        // Derived from the *attempt*, not from the occurrence alone. That one
        // change is what stops an early refusal being replayed for the rest of
        // the service.
        let key = IdempotencyKey.geofence(
            accountId: accountId,
            churchSlug: attempt.churchSlug,
            occurrenceId: attempt.occurrenceId,
            attemptId: attempt.attemptId,
            kind: evidence.phase
        )

        do {
            let result = try await submitter.submit(evidence, idempotencyKey: key)
            if result.outcome == .rejected {
                // A rejection is an answer, not an outage, so it is never
                // retried. The reason is not parsed out of the display message
                // — that text is for a person to read, and matching on it would
                // break the moment the wording changed.
                return .refusal(.unknown)
            }
            return .result(result)
        } catch let error as APIError where error.retryable {
            // Queue it against the attempt, so the retry reuses this key.
            var updated = attempt
            updated.queued = QueuedSubmission.from(evidence)
            await store.update(updated, partition: partition)

            phase = .retrying(
                occurrenceId: evidence.occurrenceId,
                attempt: 1,
                nextAttemptAt: nextRetry(1)
            )
            return .transient
        } catch let error as APIError {
            return .refusal(refusal(for: error))
        } catch {
            return .refusal(.unknown)
        }
    }

    /// Retries anything queued. Called on foreground and on connectivity return.
    ///
    /// The key is re-derived from the stored `attemptId`, so a retry after a
    /// process restart is the *same* logical submission and the server
    /// recognises it rather than counting a second one.
    @discardableResult
    public func flushPending() async -> EvidencePhase {
        guard let partition, let accountId, settings.enabled else { return phase }
        guard let attempt = await store.current(partition: partition, now: now()) else {
            // The store purges an expired attempt the moment anything looks at
            // it — the coordinates are past their retention window, and holding
            // them to produce a tidier return value would be the wrong trade.
            //
            // So "gone" while a flow was still open means "expired". Reporting
            // it matters: an earlier version guarded on `isExpired` *after*
            // this lookup, which the purge made unreachable, and the expiry
            // path silently never fired.
            switch phase {
            case .retrying, .awaitingDwell, .confirming, .reauthorizing, .entered:
                phase = .refused(reason: .expired)
            default:
                break
            }
            return phase
        }

        guard let queued = attempt.queued else { return phase }

        guard RetryPolicy.shouldRetry(attempt: queued.retries, isTransient: true) else {
            await store.close(partition: partition)
            phase = .refused(reason: .expired)
            return phase
        }

        var counted = attempt
        counted.queued = queued.withRetry()
        await store.update(counted, partition: partition)

        let evidence = queued.evidence(
            occurrenceId: attempt.occurrenceId,
            attemptId: attempt.attemptId,
            detectionId: attempt.detectionId
        )

        switch await send(evidence, attempt: attempt, accountId: accountId, partition: partition) {
        case .result(let result):
            if result.outcome == .counted || result.outcome == .alreadyCounted {
                return await succeed(
                    occurrenceId: attempt.occurrenceId,
                    alreadyCounted: result.outcome == .alreadyCounted,
                    partition: partition
                )
            }
        case .refusal(let reason):
            return await fail(reason, partition: partition)
        case .transient:
            break
        }
        return phase
    }

    /// A server verdict of counted. Closes the attempt and settles the occurrence.
    private func succeed(
        occurrenceId: String,
        alreadyCounted: Bool,
        partition: CachePartition
    ) async -> EvidencePhase {
        phase = .counted(occurrenceId: occurrenceId, alreadyCounted: alreadyCounted)
        markSettled(occurrenceId)
        policies[occurrenceId] = (policies[occurrenceId] ?? AttemptPolicy()).settling()
        await store.close(partition: partition)
        return phase
    }

    /// A terminal refusal. **Closes the attempt.**
    ///
    /// Closing is the whole correction. The next genuine entry opens a new
    /// attempt with a new id, so the server validates it fresh instead of
    /// replaying this answer — which is what a bad first fix used to earn for
    /// the rest of the service.
    ///
    /// The occurrence is *not* settled: only a count settles it. A refusal is
    /// counted instead, so a device wedged at the boundary cannot generate an
    /// unbounded stream of attempt rows.
    private func fail(_ reason: EvidenceRefusal, partition: CachePartition) async -> EvidencePhase {
        phase = .refused(reason: reason)

        if let attempt = await store.current(partition: partition, now: now()) {
            let occurrenceId = attempt.occurrenceId
            policies[occurrenceId] = (policies[occurrenceId] ?? AttemptPolicy())
                .recordingRefusal(
                    at: now(),
                    accuracyMeters: attempt.queued?.accuracyMeters ?? lastAccuracyMeters,
                    configVersion: lastConfigVersion
                )
            // Bounded: a handful of services, never a growing history.
            if policies.count > 8, let oldest = policies.keys.first {
                policies.removeValue(forKey: oldest)
            }
        }

        await store.close(partition: partition)

        // A loss of authority is not just this event failing — the device has
        // no business watching at all any more.
        if reason.requiresTeardown {
            await reconciler.teardown()
            settings.enabled = false
        }

        log.event("attendance_refused")
        return phase
    }

    /// Bounded: a handful of services, never a growing history.
    private func markSettled(_ occurrenceId: String) {
        guard !settledOccurrences.contains(occurrenceId) else { return }
        settledOccurrences.append(occurrenceId)
        if settledOccurrences.count > 8 { settledOccurrences.removeFirst() }
    }

    private func nextRetry(_ attempt: Int) -> Date {
        now().addingTimeInterval(RetryPolicy.delay(forAttempt: attempt))
    }

    /// Maps the reconciler's vocabulary onto the evidence vocabulary.
    ///
    /// They are deliberately different sets: the reconciler reports why it
    /// cannot *monitor*, and the evidence machine reports why an attempt cannot
    /// *count*. Most overlap, but `needs_full_accuracy` and
    /// `needs_always_authorization` are device conditions with no server
    /// equivalent, and passing them through a raw-value initialiser silently
    /// produced `.unknown` — which lost the reason the UI needed to explain
    /// itself. Mapped explicitly so a new refusal string has to be handled.
    static func refusal(forReconcile reason: String) -> EvidenceRefusal {
        switch reason {
        case "needs_full_accuracy": return .insufficientAccuracy
        case "needs_always_authorization", "location_unavailable",
             "monitoring_unavailable", "configuration_unavailable":
            // Not a server verdict: the device cannot currently participate.
            // Not a teardown reason either — the regions are already gone.
            return .cancelled
        case "disabled": return .consentRequired
        default: return EvidenceRefusal(serverReason: reason)
        }
    }

    private func refusal(for error: APIError) -> EvidenceRefusal {
        switch error.code {
        case .forbidden: return .notEnrolled
        case .blocked: return .blocked
        case .unauthenticated: return .notEnrolled
        case .notFound: return .noOpenOccurrence
        default: return .unknown
        }
    }
}
