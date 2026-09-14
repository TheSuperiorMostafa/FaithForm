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

    /// The same, for the campus the person is at. At a church with several
    /// campuses the open service depends on which door they came through, so
    /// the region entered is named. Carries no location.
    ///
    /// **Always asked before a position is read**, and a nil answer ends the
    /// flow: nothing is sent outside a check-in window.
    func eligibleOccurrenceId(churchSlug: String, regionId: String?) async throws -> String?

    func submit(
        _ evidence: AttendanceEvidence,
        idempotencyKey: String
    ) async throws -> AttendanceResult

    /// Whether this account is already counted at an occurrence, or nil when
    /// it could not be found out.
    ///
    /// Asked only after a `confirm` is refused. The server redeems a detection
    /// *before* its idempotency replay, so a confirmation whose response was
    /// lost in a dead zone is refused `detection_already_used` on retry even
    /// though it counted. Reading the status back is what stops that person
    /// being told they were not checked in.
    func isCounted(occurrenceId: String) async -> Bool?
}

extension AttendanceSubmitting {
    public func isCounted(occurrenceId: String) async -> Bool? { nil }

    public func eligibleOccurrenceId(churchSlug: String, regionId: String?) async throws -> String? {
        try await eligibleOccurrenceId(churchSlug: churchSlug)
    }
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
    /// The person's choice on this device. Distinct from the server's consent
    /// and from the OS permission; all three must hold.
    public var enabled: Bool
    /// What the server last said its consent state was.
    public var serverConsent: String
    /// Every church this account may be checked in at. Consent is
    /// account-wide on the server, so this is not the church on screen.
    public var churches: [AttendanceChurch]

    public init(enabled: Bool = false, serverConsent: String = "unset", churchSlug: String? = nil) {
        self.enabled = enabled
        self.serverConsent = serverConsent
        self.churches = churchSlug.map { [AttendanceChurch(slug: $0, name: nil)] } ?? []
    }

    public init(enabled: Bool, serverConsent: String, churches: [AttendanceChurch]) {
        self.enabled = enabled
        self.serverConsent = serverConsent
        self.churches = churches
    }

    /// The first church, for callers that only ever bound one.
    public var churchSlug: String? {
        get { churches.first?.slug }
        set { churches = newValue.map { [AttendanceChurch(slug: $0, name: nil)] } ?? [] }
    }

    /// All three gates. Deliberately not `enabled` alone: an app toggle that
    /// silently means nothing because the server withdrew consent, or because
    /// the OS permission was revoked in Settings, would be a lie on screen.
    public func isOperational(authorization: LocationAuthorization) -> Bool {
        enabled && serverConsent == "granted" && authorization.permitsRegionMonitoring
    }
}

/// An arrival that has not reached a verdict yet, for the status screen.
///
/// Carries no position and no region: which church, which service, and whether
/// the person still has to say yes.
public struct PendingArrival: Equatable, Sendable {
    public let churchSlug: String
    public let churchName: String?
    public let occurrenceId: String
    public let mode: ArrivalMode
    /// When the person will be — or was — asked.
    public let promptAt: Date?
    public let needsPersonConfirmation: Bool
    /// A submission is waiting for the network.
    public let isQueued: Bool

    public init(
        churchSlug: String,
        churchName: String?,
        occurrenceId: String,
        mode: ArrivalMode,
        promptAt: Date?,
        needsPersonConfirmation: Bool,
        isQueued: Bool
    ) {
        self.churchSlug = churchSlug
        self.churchName = churchName
        self.occurrenceId = occurrenceId
        self.mode = mode
        self.promptAt = promptAt
        self.needsPersonConfirmation = needsPersonConfirmation
        self.isQueued = isQueued
    }

    /// Whether the in-app "Check in" button should be offered now.
    public func canConfirm(now: Date) -> Bool {
        guard needsPersonConfirmation, !isQueued else { return false }
        guard let promptAt else { return false }
        return now >= promptAt
    }
}

/// Drives a region event from callback to server verdict.
///
/// **Single-flight.** One logical check-in intent at a time. Duplicate OS
/// callbacks are routine — Core Location re-delivers, and a person walking in
/// and out of a doorway crosses the boundary repeatedly — and each one must
/// not become another request. A callback arriving while a flow is already
/// running is dropped.
///
/// **Never counts locally.** The only state that reads as success is a server
/// result of `counted` or `already_counted`.
///
/// **Two ways a church can want an arrival handled**, and both are honoured:
///
/// - *Confirmation* (`requiresConfirmation`). `detected` is sent on arrival so
///   the server's dwell clock starts at the door; the person is asked "Are you
///   at …? Tap to check in" at the server's `confirmationNotBefore`, and
///   `confirm` is sent only after they say yes.
/// - *Automatic*. Nothing is sent until the person has stayed — the server
///   counts a `detected` straight away when no confirmation is required, so a
///   drive past must never produce one. After the dwell the first execution
///   opportunity iOS offers checks them in; a notification at that moment is
///   the opportunity when iOS offers none of its own.
public actor AutomaticAttendanceCoordinator {
    private let reconciler: GeofenceReconciler
    private let submitter: any AttendanceSubmitting
    private let sampler: any LocationSampling
    private let store: any AttendanceAttemptStoring
    private let authorization: any LocationAuthorizing
    private let notifier: (any AttendanceNotifying)?
    private let now: @Sendable () -> Date
    private let log = FaithFormLog(category: "attendance")

    private var phase: EvidencePhase = .idle
    private var inFlightOccurrence: String?

    /// Set synchronously on entry to every flow, before any `await`.
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
    /// guard. It is a battery guard.
    ///
    /// Bounded, and cleared whenever the identity changes, so it can never
    /// suppress a legitimate attempt at a different service.
    private var settledOccurrences: [String] = []

    /// Anti-flapping state per occurrence. **Never a lockout** — see
    /// `AttemptPolicy`.
    private var policies: [String: AttemptPolicy] = [:]

    /// The accuracy of the most recent fix, so a refusal can record what it was
    /// refused *with* and a later reading can be compared against it.
    private var lastAccuracyMeters: Double?

    /// The configuration version the last decision was made against. A change
    /// is a meaningful trigger: whatever refused before may not refuse now.
    private var lastConfigVersion: Int?

    /// Exits seen per region in this process. A flow captures the count when
    /// it starts and refuses to persist anything if it moved: an exit that
    /// lands while a request is in flight must not be undone by the response.
    private var exitEpochs: [String: Int] = [:]

    /// When each region last produced an entry, so a region-state answer of
    /// "inside" on every foreground does not become a request every time.
    private var lastEntryAt: [String: Date] = [:]
    private let stateEntryInterval: TimeInterval = 10 * 60

    /// Used only when a server predates `confirmationNotBefore`.
    ///
    /// Deliberately conservative: confirming too early is refused and wastes a
    /// submission, whereas confirming late simply costs a little time.
    private let fallbackDwellSeconds: TimeInterval = 150

    /// How long after the server's instant the person is asked.
    ///
    /// The notification fires on the device's clock and the server judges the
    /// dwell on its own; a small margin keeps a phone a few seconds fast from
    /// being refused `dwell_not_elapsed` — a refusal the response does not let
    /// the client tell apart from a final one.
    private let promptMargin: TimeInterval = 15

    /// Injectable so a test can assert *that* attempt ids differ without
    /// depending on their values, and can force a collision.
    private let newAttemptId: @Sendable () -> String
    private var settings = AutomaticAttendanceSettings()
    private var partition: CachePartition?
    private var accountId: String?

    public init(
        reconciler: GeofenceReconciler,
        submitter: any AttendanceSubmitting,
        sampler: any LocationSampling,
        store: any AttendanceAttemptStoring,
        authorization: any LocationAuthorizing,
        notifier: (any AttendanceNotifying)? = nil,
        now: @escaping @Sendable () -> Date = { Date() },
        newAttemptId: @escaping @Sendable () -> String = { LogicalAttempt.newAttemptId() }
    ) {
        self.newAttemptId = newAttemptId
        self.reconciler = reconciler
        self.submitter = submitter
        self.sampler = sampler
        self.store = store
        self.authorization = authorization
        self.notifier = notifier
        self.now = now
    }

    public func currentPhase() -> EvidencePhase { phase }
    public func currentSettings() -> AutomaticAttendanceSettings { settings }

    public func bind(
        partition: CachePartition,
        accountId: String?,
        settings: AutomaticAttendanceSettings
    ) async {
        if GeofenceReconciler.identity(partition) != self.partition.map(GeofenceReconciler.identity)
            || self.accountId != accountId {
            // A different identity has different occurrences. Never carry the
            // suppression list or the refusal counters across one.
            settledOccurrences = []
            policies = [:]
            exitEpochs = [:]
            lastEntryAt = [:]
        }
        self.partition = partition
        self.accountId = accountId
        self.settings = Self.withBoundChurch(settings, partition: partition)
        await bindReconciler()
    }

    /// Turns the feature on and registers whatever the server authorizes.
    ///
    /// Consent is already recorded server-side by the time this runs — the UI
    /// writes it first — so a refusal here is about a church's configuration
    /// or the People link, not about the person's choice.
    @discardableResult
    public func enable(settings: AutomaticAttendanceSettings) async -> ReconcileOutcome {
        self.settings = partition.map { Self.withBoundChurch(settings, partition: $0) } ?? settings
        guard partition != nil else { return .idle }

        await bindReconciler()
        let outcome = await reconciler.reconcile(trigger: .optIn)
        // Someone turning this on while already inside their church gets no
        // entry event from iOS. Asking for the region state is how they are
        // noticed anyway.
        await reconciler.determineRegionStates()
        log.event("automatic_attendance_enabled")
        return outcome
    }

    /// Re-runs reconciliation for a lifecycle reason.
    ///
    /// The single funnel every trigger goes through: launch, foreground, church
    /// change, account change, authorization-version change, permission change,
    /// and a configuration refresh all arrive here rather than each doing their
    /// own registration.
    @discardableResult
    public func reconcile(trigger: ReconcileTrigger) async -> ReconcileOutcome {
        await bindReconciler()
        return await reconciler.reconcile(trigger: trigger)
    }

    /// Asks the OS whether the device is inside any monitored region.
    public func determineRegionStates() async {
        await reconciler.determineRegionStates()
    }

    /// The configuration a church last made available, for the status screen.
    public func configuration(forChurch slug: String) async -> GeofenceConfiguration? {
        await reconciler.configuration(forChurch: slug)
    }

    public func lastReconcileOutcome() async -> ReconcileOutcome {
        await reconciler.currentOutcome()
    }

    /// Turns the feature off and leaves nothing behind.
    ///
    /// In this order: stop monitoring, cancel anything in flight, purge unsent
    /// evidence, withdraw every notification, then record the setting. The
    /// order matters — a crash midway must not leave regions registered with
    /// the feature marked off.
    public func disable() async {
        await reconciler.teardown()
        inFlightOccurrence = nil
        settledOccurrences = []
        policies = [:]
        exitEpochs = [:]
        lastEntryAt = [:]
        phase = .idle
        for church in knownChurches {
            if let scoped = scopedPartition(church) { await store.close(partition: scoped) }
        }
        await notifier?.cancelAll()
        settings.enabled = false
        log.event("automatic_attendance_disabled")
    }

    /// A boundary crossing, from the OS.
    ///
    /// This is the entry point for everything: a foreground callback, a
    /// background wake, and a relaunch after termination all arrive here.
    @discardableResult
    public func handleRegionEntered(regionId: String) async -> EvidencePhase {
        guard settings.enabled, partition != nil, let accountId else {
            phase = .refused(reason: .consentRequired)
            return phase
        }

        // Duplicate callbacks are normal, not exceptional. This check and the
        // assignment below happen with no `await` between them, so a second
        // callback cannot slip through.
        guard !isHandlingEvent, inFlightOccurrence == nil else { return phase }
        isHandlingEvent = true
        defer { isHandlingEvent = false }

        let epoch = exitEpochs[regionId, default: 0]
        lastEntryAt[regionId] = now()
        phase = .entered(regionId: regionId, at: now())

        // The event may have arrived against an expired or revoked
        // configuration. Waking is allowed; acting on it without rechecking is
        // not. `.regionEvent` forces a refresh rather than trusting the cache.
        phase = .reauthorizing(regionId: regionId)
        let hinted = await reconciler.churchSlug(forRegion: regionId)
        await bindReconciler()
        let outcome = await reconciler.reconcile(trigger: .regionEvent, forceChurch: hinted)

        guard let church = await reconciler.churchSlug(forRegion: regionId) ?? hinted,
              let churchPartition = scopedPartition(church)
        else {
            // Not a region any bound church authorizes. Reconciliation has
            // already removed it.
            if let refusal = outcome.refusal, refusal != Self.unavailableRefusal {
                return await fail(Self.refusal(forReconcile: refusal), church: nil)
            }
            phase = .refused(reason: .cancelled)
            return phase
        }

        if let refusal = outcome.churchRefusals[church] ?? outcome.refusal {
            if refusal != Self.unavailableRefusal {
                return await fail(Self.refusal(forReconcile: refusal), church: church)
            }
            // Offline. A church whose policy is not remembered cannot be acted
            // on, but nothing that was in progress is thrown away either.
            guard await reconciler.configuration(forChurch: church) != nil else {
                phase = .retrying(occurrenceId: nil, attempt: 1, nextAttemptAt: nextRetry(1))
                return phase
            }
        }

        let configuration = await reconciler.configuration(forChurch: church)
        if let version = configuration?.configVersion { lastConfigVersion = version }
        let mode = configuration.map(ArrivalPolicy.mode(for:)) ?? .confirmation

        // The server picks the occurrence, from its own clock, for the campus
        // entered. Asked before any position is read.
        let occurrenceId: String?
        switch await resolveOccurrence(church: church, regionId: regionId) {
        case .open(let id): occurrenceId = id
        case .closed: occurrenceId = nil
        case .unreachable:
            phase = .retrying(occurrenceId: nil, attempt: 1, nextAttemptAt: nextRetry(1))
            return phase
        case .refused(let reason, let accountWide):
            return await fail(reason, church: accountWide ? nil : church)
        }

        guard let occurrenceId else {
            // Arrived before check-in opened — the choir, the volunteers, the
            // family that is always early. Held until the window opens rather
            // than lost, and only when one opens soon enough to wait for.
            if let configuration, let early = ArrivalPolicy.earlyArrival(in: configuration, now: now()) {
                return await holdArrival(
                    church: church,
                    occurrenceId: early.window.occurrenceId,
                    regionId: regionId,
                    mode: mode,
                    configVersion: configuration.configVersion,
                    notBefore: early.notBefore,
                    askAt: early.askAt,
                    awaitingWindow: true,
                    epoch: epoch,
                    partition: churchPartition
                )
            }
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

        // An arrival already under way for this service is resumed, never
        // restarted: restarting would reset a dwell the person has been
        // sitting through.
        if let existing = await store.current(partition: churchPartition, now: now()),
           existing.occurrenceId == occurrenceId || existing.awaitingWindow == true,
           existing.detectionId != nil || existing.isAwaitingArrivalSubmission {
            await schedulePromptIfAhead(existing)
            phase = .awaitingDwell(occurrenceId: existing.occurrenceId, since: existing.openedAt)
            return await resume(existing, accountId: accountId, partition: churchPartition)
        }

        // Counted already — at the door by a greeter, by a scanned code, or by
        // this phone before it was relaunched and forgot. Asked before a new
        // arrival opens, because a new `detected` would be answered "pending"
        // and the person asked "Are you at …?" about a service they are
        // already counted at. A status read, and no position sent.
        if await submitter.isCounted(occurrenceId: occurrenceId) == true {
            markSettled(occurrenceId)
            phase = .counted(occurrenceId: occurrenceId, alreadyCounted: true)
            return phase
        }

        if mode == .automatic {
            let dwell = ArrivalPolicy.automaticDwell(minDwellSeconds: configuration?.minDwellSeconds ?? 0)
            return await holdArrival(
                church: church,
                occurrenceId: occurrenceId,
                regionId: regionId,
                mode: .automatic,
                configVersion: configuration?.configVersion,
                notBefore: now().addingTimeInterval(dwell),
                askAt: nil,
                awaitingWindow: false,
                epoch: epoch,
                partition: churchPartition
            )
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
                churchSlug: church,
                occurrenceId: occurrenceId,
                now: now(),
                regionId: regionId,
                mode: .confirmation,
                configVersion: configuration?.configVersion,
                randomId: newAttemptId
            ),
            partition: churchPartition,
            now: now()
        )

        // The person left while the configuration and occurrence were being
        // fetched. Nothing is sent for an arrival that has already ended.
        guard exitEpochs[regionId, default: 0] == epoch else {
            return await abandon(church: church)
        }

        inFlightOccurrence = occurrenceId
        defer { inFlightOccurrence = nil }

        policies[occurrenceId] = policy.recordingSubmission(at: now())

        return await runFlow(
            attempt: attempt,
            sample: sample,
            accountId: accountId,
            partition: churchPartition
        )
    }

    /// Leaving before the dwell completes abandons the intent.
    ///
    /// **Read from the Keychain, not from memory.** After a background relaunch
    /// the in-memory phase is `.idle`, and an exit judged on it would leave a
    /// persisted arrival — and its scheduled "Are you at …?" — in place for
    /// someone who has driven away.
    public func handleRegionExited(regionId: String) async {
        exitEpochs[regionId, default: 0] += 1
        lastEntryAt[regionId] = nil

        // A verified exit is the strongest "something changed" signal there is:
        // the person actually left. Recorded for every occurrence being held,
        // so the next entry proceeds regardless of any cooldown.
        for key in policies.keys {
            policies[key] = policies[key]?.recordingExit()
        }

        let owner = await reconciler.churchSlug(forRegion: regionId)
        var abandoned = false
        for church in owner.map({ [$0] }) ?? knownChurches {
            guard let scoped = scopedPartition(church),
                  let attempt = await store.current(partition: scoped, now: now())
            else { continue }
            // Another campus of the same church is a different door.
            guard attempt.regionId == nil || attempt.regionId == regionId else { continue }
            // Evidence already captured while the person was there, and only
            // waiting for a network, is still true. Keep it.
            guard attempt.queued == nil else { continue }
            await store.close(partition: scoped)
            await notifier?.cancelArrivalPrompt(churchSlug: church)
            abandoned = true
        }

        if abandoned {
            phase = .abandoned
            return
        }
        switch phase {
        case .entered, .reauthorizing, .awaitingDwell:
            phase = .abandoned
        default:
            break
        }
    }

    /// The OS's answer to "is the device inside this region right now?".
    ///
    /// Inside is treated as an arrival — at most once per region in ten
    /// minutes, so asking on every foreground does not become a request every
    /// time. Outside abandons an arrival that is still open for that region,
    /// which covers an exit iOS never delivered.
    public func handleRegionState(regionId: String, inside: Bool) async {
        guard settings.enabled else { return }
        let open = await hasOpenArrival(regionId: regionId)

        guard inside else {
            if open { await handleRegionExited(regionId: regionId) }
            return
        }
        if open {
            _ = await resumePending()
            return
        }
        if let last = lastEntryAt[regionId], now().timeIntervalSince(last) < stateEntryInterval {
            return
        }
        _ = await handleRegionEntered(regionId: regionId)
    }

    /// Every legitimate execution opportunity lands here: a launch, a
    /// foreground, a region callback, a tap on "Check in".
    ///
    /// `confirmedBy` names the church whose question the person just answered
    /// yes. That yes is persisted before anything else, so it survives a flow
    /// that is already running or a process that is killed mid-request.
    ///
    /// Safe to call at any time: it does nothing that is not due.
    @discardableResult
    public func resumePending(confirmedBy church: String? = nil) async -> EvidencePhase {
        guard settings.enabled, partition != nil, let accountId else { return phase }

        if let church, let scoped = scopedPartition(church),
           var attempt = await store.current(partition: scoped, now: now()),
           attempt.personConfirmedAt == nil {
            attempt.personConfirmedAt = now()
            await store.update(attempt, partition: scoped)
        }

        guard !isHandlingEvent, inFlightOccurrence == nil else { return phase }
        isHandlingEvent = true
        defer { isHandlingEvent = false }

        let order = church.map { first in [first] + knownChurches.filter { $0 != first } } ?? knownChurches
        for slug in order {
            guard let scoped = scopedPartition(slug),
                  let attempt = await store.current(partition: scoped, now: now())
            else { continue }
            phase = await resume(attempt, accountId: accountId, partition: scoped)
        }
        return phase
    }

    /// "Not now": the person said they are not there. The arrival is closed and
    /// nothing more is sent for it.
    public func declineArrival(churchSlug church: String) async {
        guard let scoped = scopedPartition(church) else { return }
        if await store.current(partition: scoped, now: now()) != nil {
            await store.close(partition: scoped)
            phase = .abandoned
        }
        await notifier?.cancelArrivalPrompt(churchSlug: church)
    }

    /// What is waiting on each church, for the status screen.
    public func pendingArrivals() async -> [PendingArrival] {
        var pending: [PendingArrival] = []
        for church in knownChurches {
            guard let scoped = scopedPartition(church),
                  let attempt = await store.current(partition: scoped, now: now())
            else { continue }
            pending.append(
                PendingArrival(
                    churchSlug: church,
                    churchName: settings.churches.first(where: { $0.slug == church })?.name,
                    occurrenceId: attempt.occurrenceId,
                    mode: attempt.mode ?? .confirmation,
                    promptAt: attempt.promptAt,
                    needsPersonConfirmation: attempt.needsPersonConfirmation,
                    isQueued: attempt.queued != nil
                )
            )
        }
        return pending
    }

    /// Continues one stored attempt as far as it is due.
    private func resume(
        _ attempt: LogicalAttempt,
        accountId: String,
        partition scoped: CachePartition
    ) async -> EvidencePhase {
        if attempt.queued != nil {
            return await flush(attempt, accountId: accountId, partition: scoped)
        }
        if attempt.detectionId != nil {
            // A church that asks is never answered on the person's behalf.
            guard attempt.mayConfirm(now: now()), !attempt.needsPersonConfirmation else { return phase }
            let elapsed = Int(now().timeIntervalSince(attempt.openedAt))
            return await confirmDwell(occurrenceId: attempt.occurrenceId, dwellSeconds: max(0, elapsed))
        }
        if attempt.maySubmitArrival(now: now()) {
            // No yes is needed here in either mode. An automatic arrival's
            // wait *was* the condition; a confirmation arrival held for an
            // opening window only sends `detected`, which never counts — it
            // starts the server's dwell clock so the person is asked once.
            return await submitArrival(attempt, accountId: accountId, partition: scoped)
        }
        return phase
    }

    /// Records an arrival that is not submitted yet: an automatic one waiting
    /// out its dwell, or an early one waiting for check-in to open.
    private func holdArrival(
        church: String,
        occurrenceId: String,
        regionId: String,
        mode: ArrivalMode,
        configVersion: Int?,
        notBefore: Date,
        askAt: Date?,
        awaitingWindow: Bool,
        epoch: Int,
        partition scoped: CachePartition
    ) async -> EvidencePhase {
        var attempt = await store.openIfAbsent(
            LogicalAttempt.open(
                churchSlug: church,
                occurrenceId: occurrenceId,
                now: now(),
                regionId: regionId,
                mode: mode,
                configVersion: configVersion,
                randomId: newAttemptId
            ),
            partition: scoped,
            now: now()
        )

        guard exitEpochs[regionId, default: 0] == epoch else {
            return await abandon(church: church)
        }

        if attempt.submitNotBefore == nil, attempt.detectionId == nil, attempt.queued == nil {
            attempt.mode = mode
            attempt.regionId = attempt.regionId ?? regionId
            attempt.configVersion = configVersion
            attempt.submitNotBefore = notBefore
            attempt.askAt = askAt
            attempt.awaitingWindow = awaitingWindow ? true : nil
            await store.update(attempt, partition: scoped)
        }

        // **Nothing sleeps here.** The OS delivers the question at the instant;
        // the app itself holds no timer and no background assertion.
        await schedulePromptIfAhead(attempt)
        phase = .awaitingDwell(occurrenceId: attempt.occurrenceId, since: attempt.openedAt)
        return phase
    }

    /// Submits an arrival whose wait is over.
    private func submitArrival(
        _ arrival: LogicalAttempt,
        accountId: String,
        partition scoped: CachePartition
    ) async -> EvidencePhase {
        let church = arrival.churchSlug
        let regionId = arrival.regionId ?? ""
        let epoch = exitEpochs[regionId, default: 0]

        // Authority is re-derived before anything leaves the device, exactly
        // as for a region event: the wait may have spanned a revocation.
        phase = .reauthorizing(regionId: regionId)
        await bindReconciler()
        let outcome = await reconciler.reconcile(trigger: .regionEvent, forceChurch: church)
        if let refusal = outcome.churchRefusals[church] ?? outcome.refusal,
           refusal != Self.unavailableRefusal {
            return await fail(Self.refusal(forReconcile: refusal), church: church)
        }

        let occurrenceId: String?
        switch await resolveOccurrence(church: church, regionId: arrival.regionId) {
        case .open(let id): occurrenceId = id
        case .closed: occurrenceId = nil
        case .unreachable:
            phase = .retrying(occurrenceId: arrival.occurrenceId, attempt: 1, nextAttemptAt: nextRetry(1))
            return phase
        case .refused(let reason, let accountWide):
            return await fail(reason, church: accountWide ? nil : church)
        }

        guard let occurrenceId else {
            if arrival.awaitingWindow == true {
                // The window the configuration named has not opened by the
                // server's clock yet. Still waiting, not refused.
                phase = .awaitingDwell(occurrenceId: arrival.occurrenceId, since: arrival.openedAt)
                return phase
            }
            await store.close(partition: scoped)
            await notifier?.cancelArrivalPrompt(churchSlug: church)
            phase = .refused(reason: .noOpenOccurrence)
            return phase
        }

        if settledOccurrences.contains(occurrenceId) {
            await store.close(partition: scoped)
            await notifier?.cancelArrivalPrompt(churchSlug: church)
            phase = .counted(occurrenceId: occurrenceId, alreadyCounted: true)
            return phase
        }

        if await submitter.isCounted(occurrenceId: occurrenceId) == true {
            // Counted some other way while this arrival waited. Nothing to send.
            markSettled(occurrenceId)
            await store.close(partition: scoped)
            await notifier?.cancelArrivalPrompt(churchSlug: church)
            phase = .counted(occurrenceId: occurrenceId, alreadyCounted: true)
            return phase
        }

        var attempt = arrival
        if occurrenceId != arrival.occurrenceId {
            // The server's occurrence is the one attended. An early arrival's
            // hint, or a service that rolled over during the wait, is replaced
            // by a fresh attempt — never re-used under another occurrence's key.
            await store.close(partition: scoped)
            var rekeyed = LogicalAttempt.open(
                churchSlug: church,
                occurrenceId: occurrenceId,
                now: now(),
                regionId: arrival.regionId,
                mode: arrival.mode,
                configVersion: arrival.configVersion,
                randomId: newAttemptId
            )
            rekeyed.personConfirmedAt = arrival.personConfirmedAt
            attempt = await store.openIfAbsent(rekeyed, partition: scoped, now: now())
        }

        guard exitEpochs[regionId, default: 0] == epoch,
              await store.current(partition: scoped, now: now())?.attemptId == attempt.attemptId
        else {
            return await abandon(church: church)
        }

        let sample = await sampler.requestOneShotLocation(timeout: 15)
        let accuracy = sample.flatMap { $0.isUsable ? $0.horizontalAccuracyMeters : nil }
        lastAccuracyMeters = accuracy ?? lastAccuracyMeters

        let policy = policies[occurrenceId] ?? AttemptPolicy()
        switch policy.decide(now: now(), accuracyMeters: accuracy, configVersion: lastConfigVersion) {
        case .alreadySettled:
            phase = .counted(occurrenceId: occurrenceId, alreadyCounted: true)
            return phase
        case .waitUntil(let eligible, let reason):
            phase = .holding(occurrenceId: occurrenceId, until: eligible, reason: reason)
            return phase
        case .proceed:
            break
        }

        inFlightOccurrence = occurrenceId
        defer { inFlightOccurrence = nil }
        policies[occurrenceId] = policy.recordingSubmission(at: now())

        return await runFlow(attempt: attempt, sample: sample, accountId: accountId, partition: scoped)
    }

    private func runFlow(
        attempt: LogicalAttempt,
        sample: LocationSample?,
        accountId: String,
        partition scoped: CachePartition
    ) async -> EvidencePhase {
        let occurrenceId = attempt.occurrenceId

        // A reduced-accuracy grant cannot resolve a campus. Refuse rather than
        // submit a fix that will be banded unusable anyway.
        guard await authorization.currentAccuracy() == .full else {
            return await fail(.insufficientAccuracy, church: attempt.churchSlug)
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
            attemptId: attempt.attemptId,
            regionId: attempt.regionId,
            configVersion: attempt.configVersion
        )

        let first = await send(
            detected, attempt: attempt, accountId: accountId, partition: scoped
        )

        switch first {
        case .refusal(let reason):
            return await fail(reason, church: attempt.churchSlug)
        case .transient:
            return phase
        case .result(let result):
            switch result.outcome {
            case .counted, .alreadyCounted:
                return await succeed(
                    occurrenceId: occurrenceId,
                    alreadyCounted: result.outcome == .alreadyCounted,
                    church: attempt.churchSlug
                )
            case .pendingConfirmation:
                // Left while the request was in flight: an exit closed the
                // attempt, and a late response must not bring it back.
                guard var awaiting = await store.current(partition: scoped, now: now()),
                      awaiting.attemptId == attempt.attemptId
                else {
                    return await abandon(church: attempt.churchSlug)
                }
                // **Persist when the server said we may come back.** Held in
                // storage rather than memory because this wait spans exactly
                // the window where the process is most likely to be suspended
                // or killed — which on iOS is the ordinary case.
                awaiting.confirmationNotBefore =
                    result.confirmationNotBefore.flatMap(FaithFormInstant.parse)
                    // No server instant means an older server. Fall back to the
                    // configuration's dwell rather than confirming blindly.
                    ?? now().addingTimeInterval(fallbackDwellSeconds)
                // The server-issued detection. Without it a confirmation has no
                // identity the server will accept, so it is persisted as
                // carefully as the deadline is.
                awaiting.detectionId = result.detectionId
                // The occurrence the server opened the detection against. At a
                // church with several campuses it can differ from the one this
                // device named, and `confirm` must present the server's.
                awaiting.occurrenceId = result.occurrenceId ?? awaiting.occurrenceId
                // The server wants a confirmation, whatever this device
                // expected: the person will be asked.
                awaiting.mode = .confirmation
                awaiting.submitNotBefore = nil
                awaiting.awaitingWindow = nil
                await store.update(awaiting, partition: scoped)
                await schedulePromptIfAhead(awaiting)
            default:
                return await fail(.unknown, church: attempt.churchSlug)
            }
        }

        // Dwell. Nothing sleeps here: the confirmation happens on the next real
        // execution opportunity — the person's tap on the question the OS
        // delivers, another region callback, or opening the app.
        phase = .awaitingDwell(occurrenceId: occurrenceId, since: now())
        return phase
    }

    /// Confirms a pending attempt **if the server's instant has passed**.
    ///
    /// For a church that asks, the person's yes is also required —
    /// `confirmedByPerson`, or a yes already persisted on the attempt. Returns
    /// the phase, unchanged when there was nothing to do.
    @discardableResult
    public func confirmIfDue(confirmedByPerson: Bool = false) async -> EvidencePhase {
        // The account has to exist — a confirmation with nobody to attribute it
        // to is not a check-in — but its value is not needed here: `store` is
        // already partitioned, and the submission reads the account itself.
        guard settings.enabled, partition != nil, accountId != nil else { return phase }
        for church in knownChurches {
            guard let scoped = scopedPartition(church),
                  let attempt = await store.current(partition: scoped, now: now()),
                  attempt.confirmationNotBefore != nil
            else { continue }

            // Not yet. Sending now would be refused for insufficient dwell,
            // which costs a submission and tells the person nothing.
            guard attempt.mayConfirm(now: now()) else { continue }
            guard confirmedByPerson || !attempt.needsPersonConfirmation else { continue }

            let elapsed = Int(now().timeIntervalSince(attempt.openedAt))
            return await confirmDwell(
                occurrenceId: attempt.occurrenceId,
                dwellSeconds: max(0, elapsed)
            )
        }
        return phase
    }

    /// Completes a dwell that the caller has determined is satisfied.
    ///
    /// **What iOS actually guarantees, stated plainly.** Core Location has no
    /// dwell transition. `CLCircularRegion` reports entry and exit and nothing
    /// between, so there is no OS event that means "still here two minutes
    /// later" — Android's `GEOFENCE_TRANSITION_DWELL` has no iOS counterpart
    /// and this app does not invent one. What iOS *does* deliver reliably is a
    /// local notification at an instant, and a tap on it is execution time.
    @discardableResult
    public func confirmDwell(occurrenceId: String, dwellSeconds: Int) async -> EvidencePhase {
        guard partition != nil, let accountId else { return phase }

        // **Deliberately not guarded on the in-memory phase.** After the app is
        // relaunched the phase is `.idle` — which on iOS is the ordinary case
        // for a background wake, not an edge one — and guarding on it made a
        // persisted attempt unconfirmable forever. The stored attempt *is* the
        // state; memory is only a cache of it.
        var found: (LogicalAttempt, CachePartition)?
        for church in knownChurches {
            guard let scoped = scopedPartition(church) else { continue }
            if let attempt = await store.current(partition: scoped, now: now()),
               attempt.occurrenceId == occurrenceId {
                found = (attempt, scoped)
                break
            }
        }
        // If it has gone — expired, or closed by a teardown — this
        // confirmation has no identity and must not invent one.
        guard let (attempt, scoped) = found else {
            phase = .refused(reason: .expired)
            return phase
        }

        // Still inside a check-in window? Asked before the position is read, so
        // a yes given after the service has closed sends nothing.
        switch await resolveOccurrence(church: attempt.churchSlug, regionId: attempt.regionId) {
        case .open:
            break
        case .closed:
            return await fail(.windowClosed, church: attempt.churchSlug)
        case .unreachable:
            // Nothing is read or sent. The yes is already stored; asking again
            // shortly is the next opportunity.
            if attempt.personConfirmedAt != nil {
                await notifier?.scheduleArrivalPrompt(
                    churchSlug: attempt.churchSlug,
                    churchName: name(of: attempt.churchSlug),
                    at: now().addingTimeInterval(60)
                )
            }
            phase = .retrying(occurrenceId: occurrenceId, attempt: 1, nextAttemptAt: nextRetry(1))
            return phase
        case .refused(let reason, let accountWide):
            return await fail(reason, church: accountWide ? nil : attempt.churchSlug)
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
            detectionId: attempt.detectionId,
            regionId: attempt.regionId,
            configVersion: attempt.configVersion
        )

        switch await send(confirm, attempt: attempt, accountId: accountId, partition: scoped) {
        case .refusal(let reason):
            return await fail(reason, church: attempt.churchSlug)
        case .transient:
            return phase
        case .result(let result):
            switch result.outcome {
            case .counted, .alreadyCounted:
                return await succeed(
                    occurrenceId: occurrenceId,
                    alreadyCounted: result.outcome == .alreadyCounted,
                    church: attempt.churchSlug
                )
            case .pendingConfirmation:
                // Dwell still not satisfied by the server's reckoning.
                phase = .awaitingDwell(occurrenceId: occurrenceId, since: now())
            default:
                return await fail(.unknown, church: attempt.churchSlug)
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
        partition scoped: CachePartition
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
                // A confirmation can be refused *because* it already counted —
                // see `AttendanceSubmitting.isCounted`. The status is the
                // server's own answer, so reading it is not a local guess.
                if evidence.phase == "confirm",
                   await submitter.isCounted(occurrenceId: attempt.occurrenceId) == true {
                    return .result(
                        AttendanceResult(
                            outcome: .alreadyCounted,
                            message: result.message,
                            occurrenceId: attempt.occurrenceId,
                            countedAt: nil
                        )
                    )
                }
                // A rejection is an answer, not an outage, so it is never
                // retried. The reason is not parsed out of the display message
                // — that text is for a person to read, and matching on it would
                // break the moment the wording changed.
                return .refusal(.unknown)
            }
            return .result(result)
        } catch let error as APIError where error.retryable {
            // Queue it against the attempt, so the retry reuses this key. Read
            // back first: a yes the person gave while this was in flight is
            // part of the attempt now.
            var updated = await store.current(partition: scoped, now: now()) ?? attempt
            guard updated.attemptId == attempt.attemptId else { return .transient }
            updated.queued = QueuedSubmission.from(evidence)
            await store.update(updated, partition: scoped)

            // iOS gives a background app no timer to retry on. The question,
            // asked again, *is* the retry opportunity when iOS offers none: a
            // minute from now for someone who already said yes or who is
            // checked in without asking, and after a dwell for someone whose
            // arrival never reached the server to start one.
            let waited = updated.personConfirmedAt != nil || updated.mode == .automatic
            await notifier?.scheduleArrivalPrompt(
                churchSlug: attempt.churchSlug,
                churchName: name(of: attempt.churchSlug),
                at: now().addingTimeInterval(
                    waited ? max(60, RetryPolicy.delay(forAttempt: 1)) : fallbackDwellSeconds
                )
            )

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
        guard let accountId, partition != nil, settings.enabled else { return phase }

        var sawAttempt = false
        for church in knownChurches {
            guard let scoped = scopedPartition(church),
                  let attempt = await store.current(partition: scoped, now: now())
            else { continue }
            sawAttempt = true
            phase = await flush(attempt, accountId: accountId, partition: scoped)
        }

        if !sawAttempt {
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
        }
        return phase
    }

    private func flush(
        _ attempt: LogicalAttempt,
        accountId: String,
        partition scoped: CachePartition
    ) async -> EvidencePhase {
        guard let queued = attempt.queued else { return phase }

        guard RetryPolicy.shouldRetry(attempt: queued.retries, isTransient: true) else {
            await store.close(partition: scoped)
            await notifier?.cancelArrivalPrompt(churchSlug: attempt.churchSlug)
            phase = .refused(reason: .expired)
            return phase
        }

        // A position captured in a window is not sent once that window has
        // closed — the server would refuse it anyway — so the queue is checked
        // against the server's clock first.
        switch await resolveOccurrence(church: attempt.churchSlug, regionId: attempt.regionId) {
        case .open:
            break
        case .closed:
            return await fail(.windowClosed, church: attempt.churchSlug)
        case .unreachable:
            // Still offline. Nothing sent, and no retry spent.
            return phase
        case .refused(let reason, let accountWide):
            return await fail(reason, church: accountWide ? nil : attempt.churchSlug)
        }

        var counting = attempt
        counting.queued = queued.withRetry()
        await store.update(counting, partition: scoped)

        let evidence = queued.evidence(
            occurrenceId: attempt.occurrenceId,
            attemptId: attempt.attemptId,
            detectionId: attempt.detectionId,
            regionId: attempt.regionId,
            configVersion: attempt.configVersion
        )

        switch await send(evidence, attempt: counting, accountId: accountId, partition: scoped) {
        case .result(let result):
            switch result.outcome {
            case .counted, .alreadyCounted:
                return await succeed(
                    occurrenceId: attempt.occurrenceId,
                    alreadyCounted: result.outcome == .alreadyCounted,
                    church: attempt.churchSlug
                )
            case .pendingConfirmation:
                // A queued `detected` finally arrived. Its detection is now the
                // attempt's, exactly as if it had gone through first time.
                guard var awaiting = await store.current(partition: scoped, now: now()) else { return phase }
                awaiting.queued = nil
                awaiting.confirmationNotBefore = result.confirmationNotBefore.flatMap(FaithFormInstant.parse)
                    ?? now().addingTimeInterval(fallbackDwellSeconds)
                awaiting.detectionId = result.detectionId
                awaiting.occurrenceId = result.occurrenceId ?? awaiting.occurrenceId
                awaiting.mode = .confirmation
                awaiting.submitNotBefore = nil
                await store.update(awaiting, partition: scoped)
                await schedulePromptIfAhead(awaiting)
                phase = .awaitingDwell(occurrenceId: awaiting.occurrenceId, since: now())
            default:
                return await fail(.unknown, church: attempt.churchSlug)
            }
        case .refusal(let reason):
            return await fail(reason, church: attempt.churchSlug)
        case .transient:
            break
        }
        return phase
    }

    /// A server verdict of counted. Closes the attempt and settles the occurrence.
    private func succeed(
        occurrenceId: String,
        alreadyCounted: Bool,
        church: String
    ) async -> EvidencePhase {
        phase = .counted(occurrenceId: occurrenceId, alreadyCounted: alreadyCounted)
        markSettled(occurrenceId)
        policies[occurrenceId] = (policies[occurrenceId] ?? AttemptPolicy()).settling()
        if let scoped = scopedPartition(church) { await store.close(partition: scoped) }
        // Only ever after a server verdict: this is the one notification that
        // says something happened.
        await notifier?.postCheckedIn(churchSlug: church, churchName: name(of: church))
        return phase
    }

    /// A terminal refusal. **Closes the attempt.**
    ///
    /// Closing is the whole correction. The next genuine entry opens a new
    /// attempt with a new id, so the server validates it fresh instead of
    /// replaying this answer — which is what a bad first fix used to earn for
    /// the rest of the service.
    private func fail(_ reason: EvidenceRefusal, church: String?) async -> EvidencePhase {
        phase = .refused(reason: reason)
        var closed: LogicalAttempt?
        if let church, let scoped = scopedPartition(church) {
            closed = await store.current(partition: scoped, now: now())
            await store.close(partition: scoped)
        } else if reason.requiresTeardown {
            // An account-wide loss: no church's arrival survives it.
            for other in knownChurches {
                if let scoped = scopedPartition(other) { await store.close(partition: scoped) }
                await notifier?.cancelArrivalPrompt(churchSlug: other)
            }
        }

        // The occurrence is *not* settled: only a count settles it. The refusal
        // is recorded instead, so a device wedged at the boundary cannot
        // generate an unbounded stream of attempt rows.
        if let closed {
            let occurrenceId = closed.occurrenceId
            policies[occurrenceId] = (policies[occurrenceId] ?? AttemptPolicy())
                .recordingRefusal(
                    at: now(),
                    accuracyMeters: closed.queued?.accuracyMeters ?? lastAccuracyMeters,
                    configVersion: lastConfigVersion
                )
            // Bounded: a handful of services, never a growing history.
            if policies.count > 8, let oldest = policies.keys.sorted().first {
                policies.removeValue(forKey: oldest)
            }
        }

        if let church {
            await notifier?.cancelArrivalPrompt(churchSlug: church)
            // Somebody who tapped "Check in" is owed an answer. Somebody who
            // was never asked is not interrupted with one.
            if closed?.personConfirmedAt != nil {
                await notifier?.postNotCheckedIn(churchSlug: church, churchName: name(of: church))
            }
        }

        // A loss of authority is not just this event failing — the device has
        // no business watching at all any more. Consent is account-wide, so
        // losing it stops everything; a church-level refusal stops that church.
        if reason.requiresTeardown {
            if reason.isAccountWide || church == nil {
                await reconciler.teardown()
                settings.enabled = false
            } else if let church {
                await reconciler.exclude(churchSlug: church)
            }
        }

        log.event("attendance_refused")
        return phase
    }

    private enum OccurrenceAnswer {
        case open(String)
        /// No check-in window is open for that campus. Not an error.
        case closed
        /// Offline, or the server is having a moment.
        case unreachable
        /// The server will not serve this account at this church — or at all.
        case refused(EvidenceRefusal, accountWide: Bool)
    }

    /// `GET attendance/{slug}/occurrence?regionId=`, read into what the flow
    /// does next. Carries no location, and every flow asks it before reading
    /// one.
    private func resolveOccurrence(church: String, regionId: String?) async -> OccurrenceAnswer {
        do {
            guard let id = try await submitter.eligibleOccurrenceId(churchSlug: church, regionId: regionId) else {
                return .closed
            }
            return .open(id)
        } catch let error as APIError {
            switch error.code {
            // No relationship with this church any more, or blocked, or left.
            case .notFound, .forbidden: return .refused(.notEnrolled, accountWide: false)
            case .blocked: return .refused(.blocked, accountWide: false)
            // The account itself is inactive: nothing may be watched anywhere.
            case .accountInactive: return .refused(.notEnrolled, accountWide: true)
            default: return .unreachable
            }
        } catch {
            return .unreachable
        }
    }

    private func abandon(church: String) async -> EvidencePhase {
        if let scoped = scopedPartition(church) { await store.close(partition: scoped) }
        await notifier?.cancelArrivalPrompt(churchSlug: church)
        phase = .abandoned
        return phase
    }

    /// Schedules the question for an attempt, only while its instant is ahead.
    ///
    /// Re-adding a notification whose moment has passed would deliver it again
    /// at once — a second buzz for a re-entry — so a passed one is left alone.
    private func schedulePromptIfAhead(_ attempt: LogicalAttempt) async {
        guard let notifier, var at = attempt.promptAt else { return }
        if attempt.detectionId != nil { at = at.addingTimeInterval(promptMargin) }
        guard at > now() else { return }
        await notifier.scheduleArrivalPrompt(
            churchSlug: attempt.churchSlug,
            churchName: name(of: attempt.churchSlug),
            at: at
        )
    }

    private func hasOpenArrival(regionId: String) async -> Bool {
        let owner = await reconciler.churchSlug(forRegion: regionId)
        for church in owner.map({ [$0] }) ?? knownChurches {
            guard let scoped = scopedPartition(church),
                  let attempt = await store.current(partition: scoped, now: now())
            else { continue }
            if attempt.regionId == nil || attempt.regionId == regionId { return true }
        }
        return false
    }

    private func bindReconciler() async {
        guard let partition else { return }
        await reconciler.bind(
            partition: partition,
            churchSlugs: knownChurches,
            enabled: settings.enabled && settings.serverConsent == "granted"
        )
    }

    private var knownChurches: [String] {
        Array(Set(settings.churches.map(\.slug))).sorted()
    }

    private func scopedPartition(_ church: String) -> CachePartition? {
        partition.map { GeofenceReconciler.scoped($0, to: church) }
    }

    private func name(of church: String) -> String {
        settings.churches.first(where: { $0.slug == church })?.name ?? ""
    }

    /// A caller that bound a church-scoped partition and settings with no
    /// churches meant that church.
    private static func withBoundChurch(
        _ settings: AutomaticAttendanceSettings,
        partition: CachePartition
    ) -> AutomaticAttendanceSettings {
        guard settings.churches.isEmpty, let slug = partition.churchSlug else { return settings }
        var bound = settings
        bound.churches = [AttendanceChurch(slug: slug, name: nil)]
        return bound
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

    static let unavailableRefusal = "configuration_unavailable"

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
        case "no_campus_configured": return .geofenceDisabled
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
