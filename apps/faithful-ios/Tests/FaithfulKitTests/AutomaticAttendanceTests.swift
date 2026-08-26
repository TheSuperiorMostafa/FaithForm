import Foundation
import Testing
@testable import FaithfulKit

// ---------------------------------------------------------------------------
// Doubles
// ---------------------------------------------------------------------------

/// A Core Location stand-in that records what was asked of it.
///
/// The point of the whole abstraction: every permission progression, every
/// denial, and every region-limit case below runs on a plain macOS test runner
/// with no device, no simulator, and no movement.
actor FakeLocation: LocationAuthorizing, LocationSampling, RegionMonitoring {
    var authorization: LocationAuthorization
    var accuracy: LocationAccuracyAuthorization
    var servicesEnabled: Bool
    var monitoringAvailable: Bool
    var sample: LocationSample?

    /// Every prompt raised, in order. The heart of "never prompt at launch".
    private(set) var prompts: [String] = []
    private(set) var regions: Set<MonitoredRegion> = []
    private(set) var startCalls: [String] = []
    private(set) var stopCalls: [String] = []

    /// What the OS will answer once asked.
    var whenInUseAnswer: LocationAuthorization = .authorizedWhenInUse
    var alwaysAnswer: LocationAuthorization = .authorizedAlways

    init(
        authorization: LocationAuthorization = .notDetermined,
        accuracy: LocationAccuracyAuthorization = .full,
        servicesEnabled: Bool = true,
        monitoringAvailable: Bool = true,
        sample: LocationSample? = LocationSample(
            latitude: 38.2527, longitude: -85.7585,
            horizontalAccuracyMeters: 12, capturedAt: Date(timeIntervalSince1970: 1_800_000_000)
        )
    ) {
        self.authorization = authorization
        self.accuracy = accuracy
        self.servicesEnabled = servicesEnabled
        self.monitoringAvailable = monitoringAvailable
        self.sample = sample
    }

    func currentAuthorization() -> LocationAuthorization { authorization }
    func currentAccuracy() -> LocationAccuracyAuthorization { accuracy }
    func areLocationServicesEnabled() -> Bool { servicesEnabled }
    func isRegionMonitoringAvailable() -> Bool { monitoringAvailable }

    func requestWhenInUse() async -> LocationAuthorization {
        prompts.append("whenInUse")
        authorization = whenInUseAnswer
        return authorization
    }

    func requestAlways() async -> LocationAuthorization {
        prompts.append("always")
        authorization = alwaysAnswer
        return authorization
    }

    func requestOneShotLocation(timeout: TimeInterval) async -> LocationSample? {
        prompts.append("oneShot")
        return sample
    }

    func monitoredRegions() -> Set<MonitoredRegion> { regions }

    func startMonitoring(_ region: MonitoredRegion) {
        regions.insert(region)
        startCalls.append(region.identifier)
    }

    func stopMonitoring(identifier: String) {
        regions = regions.filter { $0.identifier != identifier }
        stopCalls.append(identifier)
    }

    func stopMonitoringAll() {
        for region in regions { stopCalls.append(region.identifier) }
        regions = []
    }

    func set(authorization: LocationAuthorization) { self.authorization = authorization }
    func set(whenInUseAnswer: LocationAuthorization) { self.whenInUseAnswer = whenInUseAnswer }
    func set(alwaysAnswer: LocationAuthorization) { self.alwaysAnswer = alwaysAnswer }
    func set(accuracy: LocationAccuracyAuthorization) { self.accuracy = accuracy }
    func set(servicesEnabled: Bool) { self.servicesEnabled = servicesEnabled }
    func set(sample: LocationSample?) { self.sample = sample }
    func resetPrompts() { prompts = [] }
}

actor ScriptedConfigSource: GeofenceReconciler.ConfigurationSource {
    var state: GeofenceConfigurationState
    private(set) var calls: [(slug: String, partition: String, forced: Bool)] = []

    init(state: GeofenceConfigurationState) { self.state = state }

    func currentConfiguration(
        churchSlug: String,
        partition: CachePartition,
        now: Date,
        forceRefresh: Bool
    ) async -> GeofenceConfigurationState {
        calls.append((churchSlug, partition.storageKey, forceRefresh))
        return state
    }

    func set(_ next: GeofenceConfigurationState) { state = next }
    func forcedCount() -> Int { calls.filter(\.forced).count }
}

actor ScriptedSubmitter: AttendanceSubmitting {
    struct Sent: Equatable {
        let evidence: AttendanceEvidence
        let key: String
    }

    private(set) var sent: [Sent] = []
    var occurrenceId: String? = "occ-1"
    var occurrenceError: Error?
    /// Answers, consumed in order. The last one repeats.
    var answers: [Result<AttendanceResult, Error>] = []

    func eligibleOccurrenceId(churchSlug: String) async throws -> String? {
        if let occurrenceError { throw occurrenceError }
        return occurrenceId
    }

    func submit(_ evidence: AttendanceEvidence, idempotencyKey: String) async throws -> AttendanceResult {
        sent.append(Sent(evidence: evidence, key: idempotencyKey))
        let answer = answers.count > 1 ? answers.removeFirst() : (answers.first ?? .success(counted))
        return try answer.get()
    }

    func set(answers: [Result<AttendanceResult, Error>]) { self.answers = answers }
    func set(occurrenceId: String?) { self.occurrenceId = occurrenceId }
    func set(occurrenceError: Error?) { self.occurrenceError = occurrenceError }
    func keys() -> [String] { sent.map(\.key) }
    func phases() -> [String] { sent.map(\.evidence.phase) }
}

let counted = AttendanceResult(outcome: .counted, message: "You're checked in.", occurrenceId: "occ-1", countedAt: nil)
let alreadyCounted = AttendanceResult(outcome: .alreadyCounted, message: "Already checked in.", occurrenceId: "occ-1", countedAt: nil)
let pending = AttendanceResult(outcome: .pendingConfirmation, message: "Nearly there.", occurrenceId: "occ-1", countedAt: nil)

/// `pending_confirmation` carrying the server's confirmation instant and the
/// server-issued detection a confirmation must present.
func pendingUntil(_ date: Date, detectionId: String? = "detection-1") -> AttendanceResult {
    AttendanceResult(
        outcome: .pendingConfirmation,
        message: "Nearly there.",
        occurrenceId: "occ-1",
        countedAt: nil,
        confirmationNotBefore: FaithfulInstant.format(date),
        detectionId: detectionId
    )
}
let rejected = AttendanceResult(outcome: .rejected, message: "Not counted.", occurrenceId: "occ-1", countedAt: nil)

actor MemoryAttemptStore: AttendanceAttemptStoring {
    private var items: [String: LogicalAttempt] = [:]
    private(set) var closes = 0
    private(set) var opens = 0

    func current(partition: CachePartition, now: Date) async -> LogicalAttempt? {
        guard let attempt = items[partition.storageKey] else { return nil }
        if attempt.isExpired(now: now) {
            items[partition.storageKey] = nil
            return nil
        }
        return attempt
    }

    func openIfAbsent(
        _ candidate: LogicalAttempt,
        partition: CachePartition,
        now: Date
    ) async -> LogicalAttempt {
        if let existing = await current(partition: partition, now: now),
           existing.covers(
               churchSlug: candidate.churchSlug,
               occurrenceId: candidate.occurrenceId,
               now: now
           ) {
            return existing
        }
        opens += 1
        items[partition.storageKey] = candidate
        return candidate
    }

    func update(_ attempt: LogicalAttempt, partition: CachePartition) async {
        items[partition.storageKey] = attempt
    }

    func close(partition: CachePartition) async {
        if items[partition.storageKey] != nil { closes += 1 }
        items[partition.storageKey] = nil
    }

    func count() -> Int { items.count }
    func peek(_ partition: CachePartition) -> LogicalAttempt? { items[partition.storageKey] }
    /// Seeds an attempt directly, to simulate what a killed process left behind.
    func seed(_ attempt: LogicalAttempt, partition: CachePartition) {
        items[partition.storageKey] = attempt
    }
}

actor FakeConsent: AutomaticAttendanceModel.ConsentWriting {
    private(set) var writes: [String] = []
    var answer = "granted"
    var failure: Error?

    func setAutoAttendanceConsent(_ value: String) async throws -> String {
        writes.append(value)
        if let failure { throw failure }
        return value == "revoked" ? "revoked" : answer
    }
    func set(answer: String) { self.answer = answer }
    func set(failure: Error?) { self.failure = failure }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/// Attempt ids in a scripted order, so a test can name them.
///
/// Lock-backed because the coordinator takes a `@Sendable` closure and a
/// captured `var` is not Sendable under Swift 6.
final class ScriptedIds: @unchecked Sendable {
    private let lock = NSLock()
    private var remaining: [String]

    init(_ ids: [String]) { self.remaining = ids }

    func next() -> String {
        lock.lock(); defer { lock.unlock() }
        return remaining.isEmpty ? "extra-\(UUID().uuidString)" : remaining.removeFirst()
    }
}

/// A movable clock the coordinator can read from a `@Sendable` closure.
///
/// Time is the one thing these tests genuinely need to control — queue expiry
/// is a real behaviour, not a detail — and a captured `var` is not Sendable
/// under Swift 6 strict concurrency.
final class MutableClock: @unchecked Sendable {
    private let lock = NSLock()
    private var value: Date

    init(_ value: Date) { self.value = value }

    var now: Date {
        lock.lock(); defer { lock.unlock() }
        return value
    }

    func advance(by interval: TimeInterval) {
        lock.lock(); defer { lock.unlock() }
        value = value.addingTimeInterval(interval)
    }
}

let testPartition = CachePartition(
    environment: "test", accountId: "acct-1", churchSlug: "grace", authorizationVersion: 7
)

func region(_ id: String, lat: Double = 38.2527, lon: Double = -85.7585, radius: Int = 150) -> GeofenceRegion {
    GeofenceRegion(regionId: id, campusName: "Main", latitude: lat, longitude: lon, radiusMeters: radius)
}

func configuration(
    regions: [GeofenceRegion] = [region("faithful.campus.a")],
    version: Int = 7003,
    expiresAt: String = "2026-08-30T13:30:00Z"
) -> GeofenceConfiguration {
    GeofenceConfiguration(
        churchSlug: "grace",
        regions: regions,
        windows: [],
        sources: AttendanceSourceAvailability(geofence: true, qr: false, manual: true),
        requiresConfirmation: true,
        minDwellSeconds: 120,
        maxLocationAccuracyM: 100,
        configVersion: version,
        expiresAt: expiresAt
    )
}

// ---------------------------------------------------------------------------
// Permission progression
// ---------------------------------------------------------------------------

@MainActor
@Suite("Automatic attendance permissions")
struct PermissionTests {
    private func makeModel(
        location: FakeLocation,
        consent: FakeConsent = FakeConsent(),
        source: ScriptedConfigSource = ScriptedConfigSource(state: .available(configuration()))
    ) async -> (AutomaticAttendanceModel, AutomaticAttendanceCoordinator) {
        let reconciler = GeofenceReconciler(
            monitor: location, authorization: location, source: source
        )
        let coordinator = AutomaticAttendanceCoordinator(
            reconciler: reconciler,
            submitter: ScriptedSubmitter(),
            sampler: location,
            store: MemoryAttemptStore(),
            authorization: location
        )
        await coordinator.bind(
            partition: testPartition,
            accountId: "acct-1",
            settings: AutomaticAttendanceSettings(churchSlug: "grace")
        )
        let model = AutomaticAttendanceModel(
            coordinator: coordinator, authorizer: location, consent: consent
        )
        return (model, coordinator)
    }

    @Test("nothing is requested until the person asks for it")
    func noPromptAtLaunch() async {
        let location = FakeLocation()
        let (model, _) = await makeModel(location: location)

        // Everything an app does on launch and while browsing.
        await model.refresh()
        model.begin()
        model.continueToForegroundEducation()
        await model.refresh()

        #expect(await location.prompts.isEmpty, "a prompt was raised before the person agreed")
    }

    @Test("the progression is When In Use, then education, then Always")
    func progressiveEscalation() async {
        let location = FakeLocation()
        let (model, _) = await makeModel(location: location)

        model.begin()
        #expect(model.step == .introduction)
        #expect(await location.prompts.isEmpty)

        model.continueToForegroundEducation()
        #expect(model.step == .foregroundEducation)
        #expect(await location.prompts.isEmpty)

        await model.requestForegroundPermission()
        #expect(await location.prompts == ["whenInUse"])
        // Critically: it does NOT chain into Always. iOS shows that prompt once,
        // and spending it before the explanation is how an app gets denied.
        #expect(model.step == .backgroundEducation)

        await model.requestBackgroundPermission()
        #expect(await location.prompts == ["whenInUse", "always"])
        #expect(model.step == .ready)
    }

    @Test("declining foreground stops the flow with a recoverable state")
    func foregroundDenied() async {
        let location = FakeLocation()
        await location.set(whenInUseAnswer: .denied)
        let (model, _) = await makeModel(location: location)

        model.begin()
        model.continueToForegroundEducation()
        await model.requestForegroundPermission()

        #expect(model.step == .blocked(.locationDenied))
        // Never asks for Always after a foreground refusal.
        #expect(await location.prompts == ["whenInUse"])
    }

    @Test("restricted is distinct from denied and offers no dead-end Settings link")
    func restricted() async {
        let location = FakeLocation()
        await location.set(whenInUseAnswer: .restricted)
        let (model, _) = await makeModel(location: location)

        model.begin()
        model.continueToForegroundEducation()
        await model.requestForegroundPermission()

        #expect(model.step == .blocked(.locationRestricted))
        #expect(AutomaticAttendanceBlocker.locationRestricted.isRecoverableInSettings == false)
        #expect(AutomaticAttendanceBlocker.locationDenied.isRecoverableInSettings == true)
    }

    @Test("granting only When In Use is a blocked state, not a working feature")
    func whenInUseIsNotEnough() async {
        let location = FakeLocation()
        await location.set(alwaysAnswer: .authorizedWhenInUse)
        let (model, _) = await makeModel(location: location)

        model.begin()
        model.continueToForegroundEducation()
        await model.requestForegroundPermission()
        await model.requestBackgroundPermission()

        // Core Location delivers no region events on When In Use, so claiming
        // this works would be a feature that silently never fires.
        #expect(model.step == .blocked(.needsAlwaysAuthorization))
        #expect(LocationAuthorization.authorizedWhenInUse.permitsRegionMonitoring == false)
        #expect(LocationAuthorization.authorizedAlways.permitsRegionMonitoring == true)
    }

    @Test("reduced accuracy is its own state — a campus is smaller than the error")
    func reducedAccuracy() async {
        let location = FakeLocation(accuracy: .reduced)
        let (model, _) = await makeModel(location: location)

        model.begin()
        model.continueToForegroundEducation()
        await model.requestForegroundPermission()
        await model.requestBackgroundPermission()

        #expect(model.step == .blocked(.reducedAccuracy))
    }

    @Test("location services off device-wide is not the same as denied")
    func servicesOff() async {
        let location = FakeLocation(authorization: .unavailable, servicesEnabled: false)
        await location.set(whenInUseAnswer: .unavailable)
        let (model, _) = await makeModel(location: location)

        model.begin()
        model.continueToForegroundEducation()
        await model.requestForegroundPermission()

        #expect(model.step == .blocked(.locationServicesOff))
    }

    @Test("consent is written to the server before any region is registered")
    func consentBeforeMonitoring() async {
        let location = FakeLocation()
        let consent = FakeConsent()
        let (model, _) = await makeModel(location: location, consent: consent)

        model.begin()
        model.continueToForegroundEducation()
        await model.requestForegroundPermission()
        await model.requestBackgroundPermission()

        #expect(await consent.writes == ["granted"])
        #expect(model.step == .ready)
        // Monitoring someone while the server would refuse every attempt would
        // be collecting location for nothing.
        #expect(await location.startCalls.count == 1)
    }

    @Test("a server that refuses consent leaves nothing monitored")
    func consentRefused() async {
        let location = FakeLocation()
        let consent = FakeConsent()
        await consent.set(answer: "denied")
        let (model, _) = await makeModel(location: location, consent: consent)

        model.begin()
        model.continueToForegroundEducation()
        await model.requestForegroundPermission()
        await model.requestBackgroundPermission()

        #expect(model.step == .blocked(.consentMissing))
        #expect(await location.regions.isEmpty)
    }

    @Test("OS permission and server consent are independent gates")
    func permissionIsNotConsent() async {
        // Always granted, consent withdrawn: not operational.
        var settings = AutomaticAttendanceSettings(enabled: true, serverConsent: "revoked")
        #expect(settings.isOperational(authorization: .authorizedAlways) == false)

        // Consent granted, permission missing: also not operational.
        settings = AutomaticAttendanceSettings(enabled: true, serverConsent: "granted")
        #expect(settings.isOperational(authorization: .authorizedWhenInUse) == false)
        #expect(settings.isOperational(authorization: .denied) == false)

        // Both, plus the person's own toggle.
        #expect(settings.isOperational(authorization: .authorizedAlways) == true)
        settings.enabled = false
        #expect(settings.isOperational(authorization: .authorizedAlways) == false)
    }

    @Test("turning it off revokes consent, removes regions and purges evidence")
    func disableTearsEverythingDown() async {
        let location = FakeLocation()
        let consent = FakeConsent()
        let (model, coordinator) = await makeModel(location: location, consent: consent)

        model.begin()
        model.continueToForegroundEducation()
        await model.requestForegroundPermission()
        await model.requestBackgroundPermission()
        #expect(await location.regions.count == 1)

        await model.disable()

        #expect(await location.regions.isEmpty)
        #expect(await consent.writes == ["granted", "revoked"])
        #expect(model.step == .notStarted)
        #expect(await coordinator.currentSettings().enabled == false)
    }

    @Test("every blocked state has its own copy — none falls through to a generic line")
    func everyBlockerHasCopy() {
        var titles = Set<String>()
        for blocker in AutomaticAttendanceBlocker.allCases {
            let title = AutomaticAttendanceStatusView.title(for: blocker)
            let body = AutomaticAttendanceStatusView.explanation(for: blocker)
            #expect(!title.isEmpty, "\(blocker) has no title")
            #expect(!body.isEmpty, "\(blocker) has no explanation")
            titles.insert(title)
        }
        // Distinct titles: two different problems must not read identically,
        // or the screen cannot tell someone what to actually do.
        #expect(titles.count >= AutomaticAttendanceBlocker.allCases.count - 1)
    }

    @Test("no permission copy leans on guilt or misdirection")
    func copyIsHonest() {
        let allCopy = [
            L.autoAttendanceIntroTitle, L.autoAttendanceIntroBody,
            L.autoAttendanceForegroundTitle, L.autoAttendanceForegroundBody,
            L.autoAttendanceBackgroundTitle, L.autoAttendanceBackgroundBody,
            L.autoAttendancePrivacyPointOne, L.autoAttendancePrivacyPointTwo,
            L.autoAttendancePrivacyPointThree, L.autoAttendancePrivacyPointFour,
        ].joined(separator: " ").lowercased()

        for phrase in [
            "you must", "required to", "don't let", "miss out", "everyone else",
            "your church expects", "only takes a second", "we promise",
        ] {
            #expect(!allCopy.contains(phrase), "permission copy uses \"\(phrase)\"")
        }

        // And it does say what actually happens.
        #expect(L.autoAttendancePrivacyPointTwo.lowercased().contains("never"))
    }
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

@Suite("Geofence reconciliation")
struct ReconcilerTests {
    private func make(
        location: FakeLocation,
        source: ScriptedConfigSource
    ) async -> GeofenceReconciler {
        let reconciler = GeofenceReconciler(
            monitor: location, authorization: location, source: source
        )
        await reconciler.bind(partition: testPartition, churchSlug: "grace", enabled: true)
        return reconciler
    }

    @Test("registers exactly what the server authorizes")
    func registersAuthorized() async {
        let location = FakeLocation(authorization: .authorizedAlways)
        let source = ScriptedConfigSource(
            state: .available(configuration(regions: [region("a"), region("b", lat: 39)]))
        )
        let reconciler = await make(location: location, source: source)

        let outcome = await reconciler.reconcile(trigger: .optIn)

        #expect(outcome.added == ["a", "b"])
        #expect(outcome.monitoring == 2)
        #expect(await location.regions.count == 2)
    }

    @Test("reconciling twice changes nothing the second time")
    func idempotent() async {
        let location = FakeLocation(authorization: .authorizedAlways)
        let source = ScriptedConfigSource(state: .available(configuration()))
        let reconciler = await make(location: location, source: source)

        _ = await reconciler.reconcile(trigger: .optIn)
        await location.resetPrompts()
        let startsBefore = await location.startCalls.count

        for trigger in [ReconcileTrigger.foreground, .permissionChanged, .configurationRefreshed] {
            let outcome = await reconciler.reconcile(trigger: trigger)
            #expect(outcome.changedAnything == false, "\(trigger) re-registered")
        }
        #expect(await location.startCalls.count == startsBefore)
    }

    @Test("a moved campus is re-registered, an unchanged one is left alone")
    func updatesOnlyWhatMoved() async {
        let location = FakeLocation(authorization: .authorizedAlways)
        let source = ScriptedConfigSource(
            state: .available(configuration(regions: [region("a"), region("b", lat: 39)]))
        )
        let reconciler = await make(location: location, source: source)
        _ = await reconciler.reconcile(trigger: .optIn)

        // 'a' moves; 'b' does not.
        await source.set(.available(configuration(regions: [region("a", lat: 40), region("b", lat: 39)])))
        let outcome = await reconciler.reconcile(trigger: .configurationRefreshed)

        #expect(outcome.updated == ["a"])
        #expect(outcome.added.isEmpty)
        #expect(outcome.removed.isEmpty)
    }

    @Test("a region the server withdrew is removed")
    func removesWithdrawn() async {
        let location = FakeLocation(authorization: .authorizedAlways)
        let source = ScriptedConfigSource(
            state: .available(configuration(regions: [region("a"), region("b", lat: 39)]))
        )
        let reconciler = await make(location: location, source: source)
        _ = await reconciler.reconcile(trigger: .optIn)

        await source.set(.available(configuration(regions: [region("a")])))
        let outcome = await reconciler.reconcile(trigger: .configurationRefreshed)

        #expect(outcome.removed == ["b"])
        #expect(await location.regions.count == 1)
    }

    @Test("Apple's 20-region limit is respected with a deterministic selection")
    func respectsRegionLimit() async {
        let many = (0..<35).map { region(String(format: "faithful.campus.%02d", $0), lat: 38 + Double($0) / 100) }
        let location = FakeLocation(authorization: .authorizedAlways)
        let source = ScriptedConfigSource(state: .available(configuration(regions: many)))
        let reconciler = await make(location: location, source: source)

        let outcome = await reconciler.reconcile(trigger: .optIn)

        #expect(outcome.monitoring == appleMonitoredRegionLimit)
        #expect(appleMonitoredRegionLimit == 20)
        #expect(outcome.droppedForCapacity.count == 15)

        // Deterministic: the same configuration selects the same 20 every time,
        // on every device. A proximity-based rule would not, and could not be
        // reproduced in a bug report.
        let again = GeofenceReconciler.selectRegions(from: configuration(regions: many))
        #expect(again.map(\.identifier) == outcome.added)
    }

    @Test("invalid geometry is dropped rather than registered")
    func dropsInvalidGeometry() async {
        let regions = [
            region("good"),
            region("bad-lat", lat: 91),
            region("bad-lon", lon: 181),
            region("bad-radius", radius: 0),
        ]
        let selected = GeofenceReconciler.selectRegions(from: configuration(regions: regions))
        #expect(selected.map(\.identifier) == ["good"])
    }

    @Test("losing Always authorization removes every region")
    func authorizationLossTearsDown() async {
        let location = FakeLocation(authorization: .authorizedAlways)
        let source = ScriptedConfigSource(state: .available(configuration()))
        let reconciler = await make(location: location, source: source)
        _ = await reconciler.reconcile(trigger: .optIn)
        #expect(await location.regions.count == 1)

        await location.set(authorization: .authorizedWhenInUse)
        let outcome = await reconciler.reconcile(trigger: .permissionChanged)

        #expect(outcome.refusal == "needs_always_authorization")
        #expect(await location.regions.isEmpty)
    }

    @Test("dropping to reduced accuracy removes every region")
    func accuracyLossTearsDown() async {
        let location = FakeLocation(authorization: .authorizedAlways)
        let source = ScriptedConfigSource(state: .available(configuration()))
        let reconciler = await make(location: location, source: source)
        _ = await reconciler.reconcile(trigger: .optIn)

        await location.set(accuracy: .reduced)
        let outcome = await reconciler.reconcile(trigger: .permissionChanged)

        #expect(outcome.refusal == "needs_full_accuracy")
        #expect(await location.regions.isEmpty)
    }

    @Test("a server refusal removes every region")
    func serverRefusalTearsDown() async {
        let location = FakeLocation(authorization: .authorizedAlways)
        let source = ScriptedConfigSource(state: .available(configuration()))
        let reconciler = await make(location: location, source: source)
        _ = await reconciler.reconcile(trigger: .optIn)

        for reason in ["consent_required", "no_people_link", "geofence_disabled", "not_enrolled"] {
            await source.set(.refused(reason))
            let outcome = await reconciler.reconcile(trigger: .configurationRefreshed)
            #expect(outcome.refusal == reason)
            #expect(await location.regions.isEmpty, "\(reason) left regions registered")
            await source.set(.available(configuration()))
            _ = await reconciler.reconcile(trigger: .configurationRefreshed)
        }
    }

    @Test("switching church clears the previous church's regions first")
    func churchSwitchClears() async {
        let location = FakeLocation(authorization: .authorizedAlways)
        let source = ScriptedConfigSource(state: .available(configuration(regions: [region("grace-a")])))
        let reconciler = await make(location: location, source: source)
        _ = await reconciler.reconcile(trigger: .optIn)

        await source.set(.available(configuration(regions: [region("hope-a")])))
        await reconciler.bind(partition: testPartition, churchSlug: "hope", enabled: true)

        // Binding alone removes them — before any new configuration arrives.
        #expect(await location.regions.isEmpty)

        let outcome = await reconciler.reconcile(trigger: .churchChanged)
        #expect(outcome.added == ["hope-a"])
        #expect(await location.regions.count == 1)
    }

    @Test("an authorization-version bump is a different identity")
    func authorizationVersionClears() async {
        let location = FakeLocation(authorization: .authorizedAlways)
        let source = ScriptedConfigSource(state: .available(configuration()))
        let reconciler = await make(location: location, source: source)
        _ = await reconciler.reconcile(trigger: .optIn)

        let bumped = CachePartition(
            environment: "test", accountId: "acct-1", churchSlug: "grace", authorizationVersion: 8
        )
        await reconciler.bind(partition: bumped, churchSlug: "grace", enabled: true)
        #expect(await location.regions.isEmpty)
    }

    @Test("signing out removes everything")
    func signOutClears() async {
        let location = FakeLocation(authorization: .authorizedAlways)
        let source = ScriptedConfigSource(state: .available(configuration()))
        let reconciler = await make(location: location, source: source)
        _ = await reconciler.reconcile(trigger: .optIn)

        await reconciler.teardown()
        #expect(await location.regions.isEmpty)
        #expect(await reconciler.isEnabled() == false)
    }

    @Test("a region event forces a configuration refresh rather than trusting the cache")
    func regionEventForcesRefresh() async {
        let location = FakeLocation(authorization: .authorizedAlways)
        let source = ScriptedConfigSource(state: .available(configuration()))
        let reconciler = await make(location: location, source: source)

        _ = await reconciler.reconcile(trigger: .foreground)
        #expect(await source.forcedCount() == 0)

        _ = await reconciler.reconcile(trigger: .regionEvent)
        // The event may have arrived against an expired or revoked
        // configuration. Waking is allowed; acting on a stale one is not.
        #expect(await source.forcedCount() == 1)
    }

    @Test("being offline leaves a working setup alone rather than tearing it down")
    func offlineIsNotTeardown() async {
        let location = FakeLocation(authorization: .authorizedAlways)
        let source = ScriptedConfigSource(state: .available(configuration()))
        let reconciler = await make(location: location, source: source)
        _ = await reconciler.reconcile(trigger: .optIn)

        await source.set(.unavailable)
        let outcome = await reconciler.reconcile(trigger: .foreground)

        #expect(outcome.refusal == "configuration_unavailable")
        // One failed request must not disable a feature that was working.
        #expect(await location.regions.count == 1)
    }

    @Test("region ids are Faithful-scoped and collision-resistant")
    func regionIdsAreScoped() {
        let selected = GeofenceReconciler.selectRegions(
            from: configuration(regions: [region("faithful.campus.6b1f2c48-9d3a-4e51-8b27-0c5a9e4d1f30")])
        )
        #expect(selected.first?.identifier.hasPrefix("faithful.campus.") == true)
        // The uuid is what makes it collision-resistant across churches.
        #expect(selected.first?.identifier.count ?? 0 > 20)
    }
}

// ---------------------------------------------------------------------------
// Evidence and submission
// ---------------------------------------------------------------------------

@Suite("Evidence submission")
struct EvidenceTests {
    private func make(
        location: FakeLocation = FakeLocation(authorization: .authorizedAlways),
        submitter: ScriptedSubmitter = ScriptedSubmitter(),
        store: MemoryAttemptStore = MemoryAttemptStore(),
        source: ScriptedConfigSource = ScriptedConfigSource(state: .available(configuration())),
        now: @escaping @Sendable () -> Date = { Date(timeIntervalSince1970: 1_800_000_000) },
        newAttemptId: @escaping @Sendable () -> String = { LogicalAttempt.newAttemptId() }
    ) async -> (AutomaticAttendanceCoordinator, ScriptedSubmitter, FakeLocation, MemoryAttemptStore) {
        let reconciler = GeofenceReconciler(
            monitor: location, authorization: location, source: source, now: now
        )
        await reconciler.bind(partition: testPartition, churchSlug: "grace", enabled: true)
        let coordinator = AutomaticAttendanceCoordinator(
            reconciler: reconciler, submitter: submitter, sampler: location,
            store: store, authorization: location, now: now, newAttemptId: newAttemptId
        )
        await coordinator.bind(
            partition: testPartition,
            accountId: "acct-1",
            settings: AutomaticAttendanceSettings(
                enabled: true, serverConsent: "granted", churchSlug: "grace"
            )
        )
        return (coordinator, submitter, location, store)
    }

    @Test("a region event produces one detected attempt with server-checkable evidence")
    func regionEventSubmits() async {
        let submitter = ScriptedSubmitter()
        await submitter.set(answers: [.success(pending)])
        let (coordinator, _, _, _) = await make(submitter: submitter)

        let phase = await coordinator.handleRegionEntered(regionId: "faithful.campus.a")

        let sent = await submitter.sent
        #expect(sent.count == 1)
        #expect(sent[0].evidence.phase == "detected")
        #expect(sent[0].evidence.occurrenceId == "occ-1")
        // Coordinates are sent so the *server* can band them. The client never
        // computes or claims a distance.
        #expect(sent[0].evidence.latitude != nil)
        #expect(sent[0].evidence.accuracyMeters == 12)
        #expect(sent[0].evidence.mockLocationReported == nil, "iOS has no mock-location signal")

        if case .awaitingDwell = phase {} else {
            Issue.record("expected awaitingDwell, got \(phase)")
        }
    }

    @Test("success is only ever a server verdict")
    func onlyServerCounts() async {
        let submitter = ScriptedSubmitter()
        await submitter.set(answers: [.success(counted)])
        let (coordinator, _, _, _) = await make(submitter: submitter)

        let phase = await coordinator.handleRegionEntered(regionId: "r")
        #expect(phase == .counted(occurrenceId: "occ-1", alreadyCounted: false))
        #expect(phase.isSuccess)

        // No other phase reads as success — including the ones that look
        // encouraging.
        #expect(EvidencePhase.entered(regionId: "r", at: Date()).isSuccess == false)
        #expect(EvidencePhase.awaitingDwell(occurrenceId: "o", since: Date()).isSuccess == false)
        #expect(EvidencePhase.confirming(occurrenceId: "o").isSuccess == false)
        #expect(EvidencePhase.reauthorizing(regionId: "r").isSuccess == false)
    }

    @Test("already_counted is a success, not an error")
    func alreadyCountedIsSuccess() async {
        let submitter = ScriptedSubmitter()
        await submitter.set(answers: [.success(alreadyCounted)])
        let (coordinator, _, _, _) = await make(submitter: submitter)

        let phase = await coordinator.handleRegionEntered(regionId: "r")
        #expect(phase == .counted(occurrenceId: "occ-1", alreadyCounted: true))
        #expect(phase.isSuccess)
    }

    @Test("duplicate OS callbacks produce one logical attempt")
    func duplicateCallbacks() async {
        let submitter = ScriptedSubmitter()
        await submitter.set(answers: [.success(counted)])
        let (coordinator, _, _, _) = await make(submitter: submitter)

        // Core Location re-delivers, and a person in a doorway crosses the
        // boundary repeatedly. Each must not become another request.
        await withTaskGroup(of: Void.self) { group in
            for _ in 0..<8 {
                group.addTask { _ = await coordinator.handleRegionEntered(regionId: "r") }
            }
        }

        let phases = await submitter.phases()
        #expect(phases.filter { $0 == "detected" }.count <= 1, "sent \(phases.count) attempts")
    }

    @Test("sequential re-entries after a count send nothing further")
    func sequentialDuplicates() async {
        let submitter = ScriptedSubmitter()
        await submitter.set(answers: [.success(counted)])
        let (coordinator, _, _, _) = await make(submitter: submitter)

        // The real pattern: someone lingers near the door and the OS delivers
        // ENTER again minutes later. The in-flight flag does not help here,
        // because nothing is in flight any more.
        for _ in 0..<5 {
            let phase = await coordinator.handleRegionEntered(regionId: "r")
            #expect(phase.isSuccess)
        }

        let sends = await submitter.sent.count
        #expect(sends == 1, "re-entry cost \(sends) submissions")
    }

    @Test("a different service on the same day is not suppressed")
    func settlementIsPerOccurrence() async {
        let submitter = ScriptedSubmitter()
        await submitter.set(answers: [.success(counted)])
        let (coordinator, _, _, _) = await make(submitter: submitter)

        _ = await coordinator.handleRegionEntered(regionId: "r")
        #expect(await submitter.sent.count == 1)

        // The evening service. Suppressing this would lose real attendance.
        await submitter.set(occurrenceId: "occ-2")
        await submitter.set(answers: [.success(counted)])
        let phase = await coordinator.handleRegionEntered(regionId: "r")

        #expect(phase == .counted(occurrenceId: "occ-2", alreadyCounted: false))
        #expect(await submitter.sent.count == 2)
    }

    @Test("the key is derived from the logical attempt, not from the occurrence")
    func keyInputs() {
        let base = IdempotencyKey.geofence(
            accountId: "acct-1", churchSlug: "grace",
            occurrenceId: "occ-1", attemptId: "aaa", kind: "confirm"
        )

        // Every input changes it.
        #expect(base != IdempotencyKey.geofence(
            accountId: "acct-2", churchSlug: "grace",
            occurrenceId: "occ-1", attemptId: "aaa", kind: "confirm"))
        #expect(base != IdempotencyKey.geofence(
            accountId: "acct-1", churchSlug: "hope",
            occurrenceId: "occ-1", attemptId: "aaa", kind: "confirm"))
        #expect(base != IdempotencyKey.geofence(
            accountId: "acct-1", churchSlug: "grace",
            occurrenceId: "occ-2", attemptId: "aaa", kind: "confirm"))
        #expect(base != IdempotencyKey.geofence(
            accountId: "acct-1", churchSlug: "grace",
            occurrenceId: "occ-1", attemptId: "bbb", kind: "confirm"))
        #expect(base != IdempotencyKey.geofence(
            accountId: "acct-1", churchSlug: "grace",
            occurrenceId: "occ-1", attemptId: "aaa", kind: "detected"))

        // And it is stable for identical inputs.
        #expect(base == IdempotencyKey.geofence(
            accountId: "acct-1", churchSlug: "grace",
            occurrenceId: "occ-1", attemptId: "aaa", kind: "confirm"))

        #expect(base.hasPrefix("gf-"))
        #expect(base.count <= 45)
    }

    @Test("an attempt id is random, unguessable, and not a tracking identifier")
    func attemptIdShape() {
        let ids = (0..<200).map { _ in LogicalAttempt.newAttemptId() }
        // 128 bits, hex.
        #expect(ids.allSatisfy { $0.count == 32 })
        #expect(ids.allSatisfy { $0.allSatisfy(\.isHexDigit) })
        // No collisions, and nothing derived from the account or the device.
        #expect(Set(ids).count == 200)
    }

    // -----------------------------------------------------------------------
    // 1. Duplicate callbacks reuse one attempt and one key
    // -----------------------------------------------------------------------

    @Test("duplicate callbacks reuse one attempt and one key")
    func duplicatesShareOneAttempt() async {
        let submitter = ScriptedSubmitter()
        await submitter.set(answers: [.success(pending)])
        let store = MemoryAttemptStore()
        let (coordinator, _, _, _) = await make(submitter: submitter, store: store)

        await withTaskGroup(of: Void.self) { group in
            for _ in 0..<6 {
                group.addTask { _ = await coordinator.handleRegionEntered(regionId: "r") }
            }
        }

        let opens = await store.opens
        #expect(opens == 1, "opened \(opens) attempts")
        let keys = Set(await submitter.keys())
        #expect(keys.count <= 1, "used \(keys.count) distinct keys")
    }

    // -----------------------------------------------------------------------
    // 7. Two simultaneous callbacks create one pending attempt
    // -----------------------------------------------------------------------

    @Test("two simultaneous callbacks create one pending attempt")
    func simultaneousCallbacksOneAttempt() async {
        let store = MemoryAttemptStore()
        let now = Date(timeIntervalSince1970: 1_800_000_000)

        // Straight at the store, so the race is on the store's own atomicity
        // rather than on the coordinator's in-flight flag.
        await withTaskGroup(of: LogicalAttempt.self) { group in
            for _ in 0..<10 {
                group.addTask {
                    await store.openIfAbsent(
                        LogicalAttempt.open(
                            churchSlug: "grace", occurrenceId: "occ-1", now: now
                        ),
                        partition: testPartition,
                        now: now
                    )
                }
            }
            var seen = Set<String>()
            for await attempt in group { seen.insert(attempt.attemptId) }
            #expect(seen.count == 1, "\(seen.count) attempts were opened")
        }
        #expect(await store.count() == 1)
    }

    // -----------------------------------------------------------------------
    // 2 & 3. Restart and transient failure reuse the key
    // -----------------------------------------------------------------------

    @Test("a restart during a pending attempt reuses the key")
    func restartReusesKey() async {
        let store = MemoryAttemptStore()
        let clock = Date(timeIntervalSince1970: 1_800_000_000)

        let first = ScriptedSubmitter()
        await first.set(answers: [.failure(APIError.offline)])
        let (coordinatorA, _, _, _) = await make(submitter: first, store: store)
        _ = await coordinatorA.handleRegionEntered(regionId: "r")

        let heldKey = await first.keys().first
        let heldAttempt = await store.peek(testPartition)
        #expect(heldAttempt != nil, "the attempt must survive for the retry")

        // A whole new coordinator, as after the process was killed.
        let second = ScriptedSubmitter()
        await second.set(answers: [.success(counted)])
        let (coordinatorB, _, _, _) = await make(submitter: second, store: store)
        _ = await coordinatorB.flushPending()

        #expect(await second.keys().last == heldKey, "a restart must reuse the key")
        _ = clock
    }

    @Test("a transient network failure reuses the key")
    func transientReusesKey() async {
        let submitter = ScriptedSubmitter()
        await submitter.set(answers: [.failure(APIError.offline), .success(counted)])
        let store = MemoryAttemptStore()
        let (coordinator, _, _, _) = await make(submitter: submitter, store: store)

        _ = await coordinator.handleRegionEntered(regionId: "r")
        _ = await coordinator.flushPending()

        let keys = await submitter.keys()
        #expect(keys.count == 2)
        #expect(keys[0] == keys[1], "a retry must reuse the key")
        #expect(await store.count() == 0, "a counted attempt must be closed")
    }

    // -----------------------------------------------------------------------
    // 4, 5, 6 — THE REGRESSION
    // -----------------------------------------------------------------------

    @Test("a terminally refused attempt is closed")
    func refusalClosesAttempt() async {
        let submitter = ScriptedSubmitter()
        await submitter.set(answers: [.success(rejected)])
        let store = MemoryAttemptStore()
        let (coordinator, _, _, _) = await make(submitter: submitter, store: store)

        _ = await coordinator.handleRegionEntered(regionId: "r")

        let remaining = await store.count()
        let closes = await store.closes
        #expect(remaining == 0, "a refused attempt must not stay open")
        #expect(closes >= 1)
    }

    @Test("an outside_region refusal does NOT poison the rest of the service")
    func refusalIsNotReplayed() async {
        // The regression this whole redesign exists for.
        //
        // Someone walks up with a cold GPS fix and is refused `outside_region`.
        // They walk inside, the fix sharpens, and the OS delivers another
        // entry. Under the old key — derived from the occurrence alone — the
        // server replayed the refusal for the rest of the morning, and the
        // person could never be counted.
        let submitter = ScriptedSubmitter()
        await submitter.set(answers: [.success(rejected), .success(counted)])
        let store = MemoryAttemptStore()

        let ids = ScriptedIds(["attempt-one", "attempt-two"])
        let (coordinator, _, _, _) = await make(
            submitter: submitter,
            store: store,
            newAttemptId: { ids.next() }
        )

        // First entry: refused.
        let firstPhase = await coordinator.handleRegionEntered(regionId: "r")
        #expect(firstPhase == .refused(reason: .unknown))

        // A verified exit — the person left and came back. That is a meaningful
        // trigger, so the cooldown is bypassed and a new attempt opens.
        await coordinator.handleRegionExited(regionId: "r")
        let secondPhase = await coordinator.handleRegionEntered(regionId: "r")

        let keys = await submitter.keys()
        #expect(keys.count == 2)
        #expect(keys[0] != keys[1], "the second entry reused the poisoned key")

        // It was revalidated and it succeeded.
        #expect(secondPhase == .counted(occurrenceId: "occ-1", alreadyCounted: false))
        #expect(secondPhase.isSuccess)
    }

    @Test("a refused attempt does not settle the occurrence")
    func refusalDoesNotSuppress() async {
        let submitter = ScriptedSubmitter()
        await submitter.set(answers: [.success(rejected)])
        let (coordinator, _, _, _) = await make(submitter: submitter)

        _ = await coordinator.handleRegionEntered(regionId: "r")

        // A second identical entry is *held*, not resubmitted — the reading has
        // not changed and neither has anything else, so sending again would
        // spend a submission on the same doomed evidence.
        let held = await coordinator.handleRegionEntered(regionId: "r")
        if case .holding = held {} else {
            Issue.record("expected a hold, got \(held)")
        }
        #expect(await submitter.sent.count == 1)

        // But it is a hold, not a lockout: an exit and re-entry proceeds.
        await coordinator.handleRegionExited(regionId: "r")
        _ = await coordinator.handleRegionEntered(regionId: "r")
        #expect(await submitter.sent.count == 2, "the occurrence was locked out")
    }

    // -----------------------------------------------------------------------
    // Anti-flapping — bounded, never permanent
    // -----------------------------------------------------------------------

    @Test("five refusals do NOT lock the occurrence out")
    func refusalsNeverLockOut() async {
        // The regression this section exists for. A hard cap of five was the
        // original bug at a larger number: five poor readings on arrival —
        // indoors, phone cold — would stop that person being counted at that
        // service at all.
        var policy = AttemptPolicy()
        let start = Date(timeIntervalSince1970: 1_800_000_000)

        for index in 0..<5 {
            policy = policy
                .recordingSubmission(at: start.addingTimeInterval(Double(index)))
                .recordingRefusal(
                    at: start.addingTimeInterval(Double(index)),
                    accuracyMeters: 120,
                    configVersion: 7003
                )
        }
        #expect(policy.refusals == 5)

        // Still not settled, and still eligible once something changes.
        #expect(!policy.settled)

        // A materially better fix proceeds immediately, cooldown or not.
        switch policy.decide(now: start, accuracyMeters: 12, configVersion: 7003) {
        case .proceed(.improvedAccuracy):
            break
        case let other:
            Issue.record("a sharpened fix was refused: \(other)")
        }
    }

    @Test("the cooldown is exponential and bounded, never infinite")
    func cooldownShape() {
        var policy = AttemptPolicy()
        let start = Date(timeIntervalSince1970: 1_800_000_000)
        var previous: TimeInterval = 0

        for _ in 0..<12 {
            policy = policy.recordingRefusal(at: start, accuracyMeters: 120, configVersion: 1)
            #expect(policy.cooldown >= previous, "the cooldown went backwards")
            #expect(policy.cooldown <= AttemptPolicy.maxCooldown, "the cooldown is unbounded")
            previous = policy.cooldown
        }
        // Capped well below a service, so a hold can never outlast the window.
        #expect(previous == AttemptPolicy.maxCooldown)
        #expect(AttemptPolicy.maxCooldown <= 10 * 60)
    }

    @Test("a hold names when it lifts and is never permanent")
    func holdIsTemporary() {
        let start = Date(timeIntervalSince1970: 1_800_000_000)
        let policy = AttemptPolicy()
            .recordingSubmission(at: start)
            .recordingRefusal(at: start, accuracyMeters: 120, configVersion: 1)

        // Immediately after: held.
        switch policy.decide(now: start, accuracyMeters: 120, configVersion: 1) {
        case .waitUntil(let until, let reason):
            #expect(reason == .cooldown)
            #expect(until > start)
        case let other:
            Issue.record("expected a hold, got \(other)")
        }

        // After the cooldown: proceeds on its own, with no new signal at all.
        let later = start.addingTimeInterval(AttemptPolicy.baseCooldown + 1)
        switch policy.decide(now: later, accuracyMeters: 120, configVersion: 1) {
        case .proceed(.cooldownElapsed):
            break
        case let other:
            Issue.record("the hold did not lift: \(other)")
        }
    }

    @Test("a verified exit bypasses the cooldown entirely")
    func exitBypassesCooldown() {
        let start = Date(timeIntervalSince1970: 1_800_000_000)
        let policy = AttemptPolicy()
            .recordingRefusal(at: start, accuracyMeters: 120, configVersion: 1)
            .recordingExit()

        // The person actually left and came back. That is new information, and
        // waiting on it would be the lockout in slower motion.
        switch policy.decide(now: start, accuracyMeters: 120, configVersion: 1) {
        case .proceed(.exitThenReentry): break
        case let other: Issue.record("an exit did not bypass the hold: \(other)")
        }
    }

    @Test("a configuration change bypasses the cooldown")
    func configChangeBypassesCooldown() {
        let start = Date(timeIntervalSince1970: 1_800_000_000)
        let policy = AttemptPolicy()
            .recordingRefusal(at: start, accuracyMeters: 120, configVersion: 7003)

        // Whatever refused before may not refuse now — a policy edit, a moved
        // campus, a restored consent.
        switch policy.decide(now: start, accuracyMeters: 120, configVersion: 7004) {
        case .proceed(.configurationChanged): break
        case let other: Issue.record("a config change did not bypass: \(other)")
        }
    }

    @Test("only a materially better fix counts as improvement")
    func improvementIsMaterial() {
        let start = Date(timeIntervalSince1970: 1_800_000_000)
        let policy = AttemptPolicy()
            .recordingRefusal(at: start, accuracyMeters: 100, configVersion: 1)

        // Noise is not news.
        #expect(!policy.isImproved(98))
        #expect(!policy.isImproved(95))
        // Halved, or 25 m better, is a different observation.
        #expect(policy.isImproved(50))
        #expect(policy.isImproved(70))
        // Worse is not better.
        #expect(!policy.isImproved(200))
        // No fix at all is not an improvement.
        #expect(!policy.isImproved(nil))
        #expect(!policy.isImproved(-1))
    }

    @Test("the token bucket empties under a burst and refills continuously")
    func tokenBucketRefills() {
        let start = Date(timeIntervalSince1970: 1_800_000_000)
        var policy = AttemptPolicy()

        // A burst spends the bucket.
        for _ in 0..<Int(AttemptPolicy.bucketCapacity) {
            policy = policy.recordingSubmission(at: start)
        }
        #expect(policy.availableTokens(now: start) < 1)

        // It refills continuously — no window has to slide past. One interval
        // later there is exactly one token.
        let oneInterval = start.addingTimeInterval(AttemptPolicy.tokenRefillInterval)
        #expect(policy.availableTokens(now: oneInterval) >= 1)

        // And it is capped: waiting a day does not bank a day's worth.
        let aDay = start.addingTimeInterval(24 * 60 * 60)
        #expect(policy.availableTokens(now: aDay) == AttemptPolicy.bucketCapacity)
    }

    @Test("an empty bucket holds for at most one refill interval")
    func throttleIsBounded() {
        // The replacement for a 12-per-rolling-hour budget, which could hold a
        // device for nearly an hour — longer than the service it was sitting
        // in. A bucket's worst case is one token, not a window.
        let start = Date(timeIntervalSince1970: 1_800_000_000)
        var policy = AttemptPolicy()
        for _ in 0..<Int(AttemptPolicy.bucketCapacity) {
            policy = policy.recordingSubmission(at: start)
        }

        let next = policy.nextTokenAt(now: start)
        let wait = next.timeIntervalSince(start)
        #expect(wait > 0)
        #expect(
            wait <= AttemptPolicy.tokenRefillInterval,
            "an empty bucket held for \(wait)s"
        )
        #expect(AttemptPolicy.tokenRefillInterval == 60)
    }

    @Test("the maximum local hold is explicit, bounded, and deterministic")
    func maxLocalHoldIsBounded() {
        // Whatever combination of cooldown and throttle applies, a device is
        // eligible again within this. Ten minutes, well under a service.
        #expect(AttemptPolicy.maxLocalHold == AttemptPolicy.maxCooldown)
        #expect(AttemptPolicy.maxLocalHold == 10 * 60)
        // The throttle can never be the binding constraint.
        #expect(AttemptPolicy.tokenRefillInterval < AttemptPolicy.maxLocalHold)

        // Exhaustively: no state produces a hold beyond the bound.
        let start = Date(timeIntervalSince1970: 1_800_000_000)
        var policy = AttemptPolicy()
        for index in 0..<40 {
            let at = start.addingTimeInterval(Double(index))
            policy = policy.recordingSubmission(at: at).recordingRefusal(
                at: at, accuracyMeters: 120, configVersion: 1
            )

            if case .waitUntil(let until, _) = policy.decide(
                now: at, accuracyMeters: 120, configVersion: 1
            ) {
                let wait = until.timeIntervalSince(at)
                #expect(
                    wait <= AttemptPolicy.maxLocalHold,
                    "hold of \(wait)s exceeded the stated bound after \(index) refusals"
                )
            }
        }
    }

    @Test("a valid later signal becomes eligible within the bound")
    func eligibleWithinBound() {
        let start = Date(timeIntervalSince1970: 1_800_000_000)
        var policy = AttemptPolicy()
        for index in 0..<30 {
            let at = start.addingTimeInterval(Double(index))
            policy = policy.recordingSubmission(at: at).recordingRefusal(
                at: at, accuracyMeters: 120, configVersion: 1
            )
        }

        // However badly it has gone, one `maxLocalHold` later the device tries
        // again — with no new signal at all.
        let later = start.addingTimeInterval(AttemptPolicy.maxLocalHold + 60)
        switch policy.decide(now: later, accuracyMeters: 120, configVersion: 1) {
        case .proceed: break
        case let other:
            Issue.record("still held after the stated maximum: \(other)")
        }
    }

    @Test("neither an exhausted bucket nor any refusal count settles the occurrence")
    func throttlingNeverSettles() {
        let start = Date(timeIntervalSince1970: 1_800_000_000)
        var policy = AttemptPolicy()
        for _ in 0..<50 {
            policy = policy
                .recordingSubmission(at: start)
                .recordingRefusal(at: start, accuracyMeters: 120, configVersion: 1)
            #expect(!policy.settled)
            #expect(policy.decide(now: start, accuracyMeters: 120, configVersion: 1) != .alreadySettled)
        }

        // Only a count does.
        #expect(
            policy.settling().decide(now: start, accuracyMeters: 12, configVersion: 1)
                == .alreadySettled
        )
    }

    @Test("only a count settles an occurrence")
    func onlyCountSettles() {
        let start = Date(timeIntervalSince1970: 1_800_000_000)
        var policy = AttemptPolicy()

        for _ in 0..<20 {
            policy = policy.recordingRefusal(at: start, accuracyMeters: 120, configVersion: 1)
            #expect(!policy.settled, "a refusal settled the occurrence")
            #expect(policy.decide(now: start, accuracyMeters: 12, configVersion: 1) != .alreadySettled)
        }

        #expect(policy.settling().decide(now: start, accuracyMeters: 12, configVersion: 1) == .alreadySettled)
    }

    @Test("THE REGRESSION: five refusals, then a real re-entry counts")
    func fiveRefusalsThenCounted() async {
        // End to end, through the coordinator: five inaccurate refusals, a
        // cooldown that holds rather than rejects, then a genuine re-entry with
        // a sharp fix that is validated afresh and counted exactly once.
        let clock = MutableClock(Date(timeIntervalSince1970: 1_800_000_000))
        let location = FakeLocation(authorization: .authorizedAlways)
        await location.set(
            sample: LocationSample(
                latitude: 38.2527, longitude: -85.7585,
                horizontalAccuracyMeters: 140, capturedAt: clock.now
            )
        )
        let submitter = ScriptedSubmitter()
        await submitter.set(answers: [.success(rejected)])
        let (coordinator, _, _, _) = await make(
            location: location, submitter: submitter, now: { clock.now }
        )

        // Five poor readings, spaced past each cooldown.
        for _ in 0..<5 {
            _ = await coordinator.handleRegionEntered(regionId: "r")
            clock.advance(by: AttemptPolicy.maxCooldown + 1)
        }
        let refusedCount = await submitter.sent.count
        #expect(refusedCount == 5, "sent \(refusedCount), expected five refusals")

        // The person walks inside. The fix sharpens dramatically.
        await location.set(
            sample: LocationSample(
                latitude: 38.2527, longitude: -85.7585,
                horizontalAccuracyMeters: 8, capturedAt: clock.now
            )
        )
        await submitter.set(answers: [.success(counted)])

        let phase = await coordinator.handleRegionEntered(regionId: "r")

        // Validated afresh, and counted.
        #expect(phase == .counted(occurrenceId: "occ-1", alreadyCounted: false))
        let keys = await submitter.keys()
        #expect(Set(keys).count == keys.count, "an idempotency key was reused across attempts")

        // And exactly once: further entries send nothing.
        _ = await coordinator.handleRegionEntered(regionId: "r")
        #expect(await submitter.sent.count == 6)
    }

    @Test("a cooldown holds rather than spamming")
    func cooldownPreventsSpam() async {
        let clock = MutableClock(Date(timeIntervalSince1970: 1_800_000_000))
        let submitter = ScriptedSubmitter()
        await submitter.set(answers: [.success(rejected)])
        let (coordinator, _, _, _) = await make(submitter: submitter, now: { clock.now })

        // Twenty callbacks in quick succession, as a flapping boundary produces.
        for _ in 0..<20 {
            _ = await coordinator.handleRegionEntered(regionId: "r")
            clock.advance(by: 1)
        }

        let sent = await submitter.sent.count
        #expect(sent <= 3, "a flapping boundary sent \(sent) submissions")

        // And the phase says *held*, not refused-forever.
        if case .holding = await coordinator.currentPhase() {} else {
            if case .refused = await coordinator.currentPhase() {
                Issue.record("a flapping boundary produced a terminal refusal")
            }
        }
    }

    // -----------------------------------------------------------------------
    // 8 & 9
    // -----------------------------------------------------------------------

    @Test("counted suppresses later submissions for that occurrence")
    func countedSuppresses() async {
        let submitter = ScriptedSubmitter()
        await submitter.set(answers: [.success(counted)])
        let (coordinator, _, _, _) = await make(submitter: submitter)

        for _ in 0..<5 {
            let phase = await coordinator.handleRegionEntered(regionId: "r")
            #expect(phase.isSuccess)
        }
        #expect(await submitter.sent.count == 1)
    }

    @Test("already_counted also suppresses, without incrementing anything")
    func alreadyCountedSuppresses() async {
        let submitter = ScriptedSubmitter()
        await submitter.set(answers: [.success(alreadyCounted)])
        let (coordinator, _, _, _) = await make(submitter: submitter)

        for _ in 0..<4 { _ = await coordinator.handleRegionEntered(regionId: "r") }
        #expect(await submitter.sent.count == 1)
        // The database fact uniqueness remains the final invariant; this is
        // only about not asking again for an answer already held.
        #expect(await coordinator.currentPhase().isSuccess)
    }

    @Test("an expired pending attempt is purged and never sent")
    func expiredAttemptPurged() async {
        let clock = MutableClock(Date(timeIntervalSince1970: 1_800_000_000))
        let submitter = ScriptedSubmitter()
        await submitter.set(answers: [.failure(APIError.offline)])
        let store = MemoryAttemptStore()
        let (coordinator, _, _, _) = await make(
            submitter: submitter, store: store, now: { clock.now }
        )

        _ = await coordinator.handleRegionEntered(regionId: "r")
        #expect(await store.count() == 1)

        clock.advance(by: pendingAttemptLifetime + 1)
        let phase = await coordinator.flushPending()

        #expect(phase == .refused(reason: .expired))
        #expect(await store.count() == 0, "an expired attempt must be purged")
        let sentAfterExpiry = await submitter.sent.count
        #expect(sentAfterExpiry == 1, "nothing may be sent after expiry")
    }

    @Test("an attempt for a different occurrence never inherits the previous identity")
    func attemptIsPerOccurrence() async {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let store = MemoryAttemptStore()

        let morning = await store.openIfAbsent(
            LogicalAttempt.open(churchSlug: "grace", occurrenceId: "occ-1", now: now),
            partition: testPartition, now: now
        )
        let evening = await store.openIfAbsent(
            LogicalAttempt.open(churchSlug: "grace", occurrenceId: "occ-2", now: now),
            partition: testPartition, now: now
        )

        #expect(morning.attemptId != evening.attemptId)
        #expect(evening.occurrenceId == "occ-2")
    }

    @Test("an attempt from another church is never reused")
    func attemptIsPerChurch() async {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let store = MemoryAttemptStore()

        let grace = await store.openIfAbsent(
            LogicalAttempt.open(churchSlug: "grace", occurrenceId: "occ-1", now: now),
            partition: testPartition, now: now
        )
        let hope = await store.openIfAbsent(
            LogicalAttempt.open(churchSlug: "hope", occurrenceId: "occ-1", now: now),
            partition: testPartition, now: now
        )
        #expect(grace.attemptId != hope.attemptId)
    }

    @Test("dwell completes into a counted result")
    func dwellCompletes() async {
        let submitter = ScriptedSubmitter()
        await submitter.set(answers: [.success(pending), .success(counted)])
        let (coordinator, _, _, _) = await make(submitter: submitter)

        _ = await coordinator.handleRegionEntered(regionId: "r")
        let phase = await coordinator.confirmDwell(occurrenceId: "occ-1", dwellSeconds: 180)

        #expect(phase == .counted(occurrenceId: "occ-1", alreadyCounted: false))
        let sent = await submitter.sent
        #expect(sent[1].evidence.phase == "confirm")
        #expect(sent[1].evidence.dwellSeconds == 180)
    }

    // -----------------------------------------------------------------------
    // detected → confirm
    // -----------------------------------------------------------------------

    @Test("a detected attempt records the server's confirmation instant")
    func detectedRecordsConfirmationInstant() async {
        let clock = MutableClock(Date(timeIntervalSince1970: 1_800_000_000))
        let submitter = ScriptedSubmitter()
        await submitter.set(answers: [.success(pendingUntil(clock.now.addingTimeInterval(120)))])
        let store = MemoryAttemptStore()
        let (coordinator, _, _, _) = await make(
            submitter: submitter, store: store, now: { clock.now }
        )

        _ = await coordinator.handleRegionEntered(regionId: "r")

        let attempt = await store.peek(testPartition)
        #expect(attempt?.confirmationNotBefore != nil)
        // Persisted, not held in memory: this wait spans exactly the window
        // where the process is most likely to be suspended or killed.
        #expect(attempt?.mayConfirm(now: clock.now) == false)
    }

    @Test("confirmation cannot happen before the server's instant")
    func confirmationRespectsServerInstant() async {
        let clock = MutableClock(Date(timeIntervalSince1970: 1_800_000_000))
        let submitter = ScriptedSubmitter()
        await submitter.set(answers: [.success(pendingUntil(clock.now.addingTimeInterval(120)))])
        let (coordinator, _, _, _) = await make(submitter: submitter, now: { clock.now })

        _ = await coordinator.handleRegionEntered(regionId: "r")
        let afterDetected = await submitter.sent.count

        // Every execution opportunity before the instant does nothing at all —
        // sending would be refused for insufficient dwell, which costs a
        // submission and tells the person nothing.
        for _ in 0..<5 {
            clock.advance(by: 10)
            _ = await coordinator.confirmIfDue()
        }

        let sent = await submitter.sent.count
        #expect(sent == afterDetected, "a predictably-refused confirm was sent")
    }

    @Test("confirmation succeeds after the server's instant")
    func confirmationSucceedsAfterInstant() async {
        let clock = MutableClock(Date(timeIntervalSince1970: 1_800_000_000))
        let submitter = ScriptedSubmitter()
        await submitter.set(answers: [
            .success(pendingUntil(clock.now.addingTimeInterval(120))),
            .success(counted),
        ])
        let (coordinator, _, _, _) = await make(submitter: submitter, now: { clock.now })

        _ = await coordinator.handleRegionEntered(regionId: "r")
        clock.advance(by: 121)
        let phase = await coordinator.confirmIfDue()

        #expect(phase == .counted(occurrenceId: "occ-1", alreadyCounted: false))
        let sent = await submitter.sent
        #expect(sent.count == 2)
        #expect(sent[1].evidence.phase == "confirm")
        // Fresh evidence and the elapsed dwell.
        #expect(sent[1].evidence.latitude != nil)
        #expect((sent[1].evidence.dwellSeconds ?? 0) >= 120)
    }

    @Test("a restart preserves the pending detected attempt")
    func restartPreservesPendingConfirmation() async {
        let clock = MutableClock(Date(timeIntervalSince1970: 1_800_000_000))
        let store = MemoryAttemptStore()

        let first = ScriptedSubmitter()
        await first.set(answers: [.success(pendingUntil(clock.now.addingTimeInterval(120)))])
        let (coordinatorA, _, _, _) = await make(
            submitter: first, store: store, now: { clock.now }
        )
        _ = await coordinatorA.handleRegionEntered(regionId: "r")

        // A whole new coordinator, as after the app was relaunched. Its phase
        // is `.idle` — which is exactly why the confirmation path must not
        // depend on in-memory state.
        clock.advance(by: 121)
        let second = ScriptedSubmitter()
        await second.set(answers: [.success(counted)])
        let (coordinatorB, _, _, _) = await make(
            submitter: second, store: store, now: { clock.now }
        )
        let phase = await coordinatorB.confirmIfDue()

        #expect(phase == .counted(occurrenceId: "occ-1", alreadyCounted: false))
    }

    @Test("a missing confirmation never creates a fact")
    func missingConfirmationCountsNothing() async {
        let clock = MutableClock(Date(timeIntervalSince1970: 1_800_000_000))
        let submitter = ScriptedSubmitter()
        await submitter.set(answers: [.success(pendingUntil(clock.now.addingTimeInterval(120)))])
        let store = MemoryAttemptStore()
        let (coordinator, _, _, _) = await make(
            submitter: submitter, store: store, now: { clock.now }
        )

        _ = await coordinator.handleRegionEntered(regionId: "r")

        // No execution opportunity ever comes — the ordinary iOS outcome. The
        // attempt simply expires and nobody is counted.
        clock.advance(by: pendingAttemptLifetime + 1)
        _ = await coordinator.confirmIfDue()

        #expect(await submitter.sent.count == 1, "a confirm was sent after expiry")
        #expect(await coordinator.currentPhase().isSuccess == false)
        #expect(await store.peek(testPartition) == nil)
    }

    @Test("consent revoked before confirmation fails closed")
    func revocationBeforeConfirmation() async {
        let clock = MutableClock(Date(timeIntervalSince1970: 1_800_000_000))
        let location = FakeLocation(authorization: .authorizedAlways)
        let source = ScriptedConfigSource(state: .available(configuration()))
        let submitter = ScriptedSubmitter()
        await submitter.set(answers: [
            .success(pendingUntil(clock.now.addingTimeInterval(120))),
            .failure(APIError(code: .blocked, message: "no")),
        ])
        let (coordinator, _, _, _) = await make(
            location: location, submitter: submitter, source: source, now: { clock.now }
        )
        _ = await coordinator.enable(
            settings: AutomaticAttendanceSettings(
                enabled: true, serverConsent: "granted", churchSlug: "grace"
            )
        )

        _ = await coordinator.handleRegionEntered(regionId: "r")
        clock.advance(by: 121)
        let phase = await coordinator.confirmIfDue()

        #expect(phase == .refused(reason: .blocked))
        // A loss of authority stops the device watching entirely.
        #expect(await location.regions.isEmpty)
    }

    @Test("an older server with no confirmation instant still gets a fallback")
    func fallbackConfirmationInstant() async {
        let clock = MutableClock(Date(timeIntervalSince1970: 1_800_000_000))
        let submitter = ScriptedSubmitter()
        // `confirmationNotBefore` absent, as a pre-Prompt-7 server would send.
        await submitter.set(answers: [.success(pending)])
        let store = MemoryAttemptStore()
        let (coordinator, _, _, _) = await make(
            submitter: submitter, store: store, now: { clock.now }
        )

        _ = await coordinator.handleRegionEntered(regionId: "r")

        let attempt = await store.peek(testPartition)
        #expect(attempt?.confirmationNotBefore != nil)
        // Conservative: confirming too early is refused and wastes a
        // submission, whereas confirming late costs only a little time.
        #expect(attempt?.mayConfirm(now: clock.now) == false)

        // But without a detection there is nothing the server would accept, so
        // it still never confirms — the fallback is a *deadline*, not an
        // identity, and an older server supplies neither.
        clock.advance(by: 200)
        #expect(attempt?.detectionId == nil)
        #expect(attempt?.mayConfirm(now: clock.now) == false)
    }

    @Test("a pending response with no detection never confirms")
    func noDetectionNeverConfirms() async {
        let clock = MutableClock(Date(timeIntervalSince1970: 1_800_000_000))
        let submitter = ScriptedSubmitter()
        await submitter.set(answers: [
            .success(pendingUntil(clock.now.addingTimeInterval(60), detectionId: nil)),
        ])
        let (coordinator, _, _, _) = await make(submitter: submitter, now: { clock.now })

        _ = await coordinator.handleRegionEntered(regionId: "r")

        // Well past the deadline.
        clock.advance(by: 600)
        _ = await coordinator.confirmIfDue()

        // Nothing was sent: a confirmation without a server-issued detection is
        // one the server will refuse, and guessing an id would be worse.
        #expect(await submitter.sent.count == 1)
    }

    @Test("the confirm submission carries the server-issued detection")
    func confirmCarriesDetection() async {
        let clock = MutableClock(Date(timeIntervalSince1970: 1_800_000_000))
        let submitter = ScriptedSubmitter()
        await submitter.set(answers: [
            .success(pendingUntil(clock.now.addingTimeInterval(60), detectionId: "det-abc")),
            .success(counted),
        ])
        let (coordinator, _, _, _) = await make(submitter: submitter, now: { clock.now })

        _ = await coordinator.handleRegionEntered(regionId: "r")
        clock.advance(by: 61)
        _ = await coordinator.confirmIfDue()

        let sent = await submitter.sent
        #expect(sent.count == 2)
        // `detected` carries the client's attempt id, so the server-side
        // detection is idempotent per workflow.
        #expect(sent[0].evidence.attemptId != nil)
        #expect(sent[0].evidence.detectionId == nil)
        // `confirm` carries the detection the server issued.
        #expect(sent[1].evidence.detectionId == "det-abc")
    }

    @Test("the client's dwell figure is reported but never decides")
    func dwellIsServerMeasured() async {
        let clock = MutableClock(Date(timeIntervalSince1970: 1_800_000_000))
        let submitter = ScriptedSubmitter()
        await submitter.set(answers: [
            .success(pendingUntil(clock.now.addingTimeInterval(60))),
            .success(counted),
        ])
        let (coordinator, _, _, _) = await make(submitter: submitter, now: { clock.now })

        _ = await coordinator.handleRegionEntered(regionId: "r")
        clock.advance(by: 61)
        _ = await coordinator.confirmIfDue()

        // The number is sent for the audit — but the server measures the dwell
        // between its own `detected_at_server` and `now()`, so this cannot
        // shorten anything. A device clock days out changes nothing.
        let sent = await submitter.sent
        #expect(sent[1].evidence.dwellSeconds != nil)
        #expect(sent[1].evidence.detectionId != nil)
    }

    @Test("no in-memory timer spans a dwell — confirmation needs a real wake")
    func noDwellTimer() async {
        let submitter = ScriptedSubmitter()
        await submitter.set(answers: [.success(pending)])
        let (coordinator, _, _, _) = await make(submitter: submitter)

        let phase = await coordinator.handleRegionEntered(regionId: "r")

        // The flow stops at `awaitingDwell` and returns. It does not sleep,
        // does not schedule, and does not hold the OS's background window open
        // — a `Task.sleep` spanning a dwell would not survive suspension, and a
        // background assertion for one is a request the system may refuse.
        guard case .awaitingDwell = phase else {
            Issue.record("expected awaitingDwell, got \(phase)")
            return
        }
        // Exactly one submission: nothing was sent speculatively.
        #expect(await submitter.sent.count == 1)
    }

    @Test("a confirmation with no surviving attempt fails safely rather than inventing one")
    func confirmationWithoutAttempt() async {
        let submitter = ScriptedSubmitter()
        await submitter.set(answers: [.success(pending)])
        let store = MemoryAttemptStore()
        let (coordinator, _, _, _) = await make(submitter: submitter, store: store)

        _ = await coordinator.handleRegionEntered(regionId: "r")

        // The process was killed and the attempt expired before any wake came.
        // This is the ordinary iOS outcome, not an error case.
        await store.close(partition: testPartition)

        let phase = await coordinator.confirmDwell(occurrenceId: "occ-1", dwellSeconds: 180)

        #expect(phase == .refused(reason: .expired))
        // No second submission with a fabricated identity.
        #expect(await submitter.sent.count == 1)
    }

    @Test("a confirmation for a different occurrence is refused")
    func confirmationOccurrenceMismatch() async {
        let submitter = ScriptedSubmitter()
        await submitter.set(answers: [.success(pending)])
        let (coordinator, _, _, _) = await make(submitter: submitter)

        _ = await coordinator.handleRegionEntered(regionId: "r")
        let phase = await coordinator.confirmDwell(occurrenceId: "occ-999", dwellSeconds: 180)

        #expect(phase == .refused(reason: .expired))
        #expect(await submitter.sent.count == 1)
    }

    @Test("leaving before dwell abandons the intent and purges evidence")
    func exitAbandons() async {
        let submitter = ScriptedSubmitter()
        await submitter.set(answers: [.success(pending)])
        let (coordinator, _, _, store) = await make(submitter: submitter)

        _ = await coordinator.handleRegionEntered(regionId: "r")
        await coordinator.handleRegionExited(regionId: "r")

        #expect(await coordinator.currentPhase() == .abandoned)
        #expect(await store.count() == 0)
    }

    @Test("no open occurrence is a normal refusal, not an error")
    func noOpenOccurrence() async {
        let submitter = ScriptedSubmitter()
        await submitter.set(occurrenceId: nil)
        let (coordinator, _, _, _) = await make(submitter: submitter)

        let phase = await coordinator.handleRegionEntered(regionId: "r")
        #expect(phase == .refused(reason: .noOpenOccurrence))
        // Driving past the building on a Tuesday sends nothing at all.
        #expect(await submitter.sent.isEmpty)
    }

    @Test("a revocation between the event and submission fails closed and tears down")
    func revocationMidFlow() async {
        let location = FakeLocation(authorization: .authorizedAlways)
        let source = ScriptedConfigSource(state: .available(configuration()))
        let (coordinator, submitter, _, _) = await make(location: location, source: source)

        // Register something first.
        _ = await coordinator.enable(
            settings: AutomaticAttendanceSettings(
                enabled: true, serverConsent: "granted", churchSlug: "grace"
            )
        )
        #expect(await location.regions.count == 1)

        // Consent is withdrawn on another device between the wake and the send.
        await source.set(.refused("consent_revoked"))
        let phase = await coordinator.handleRegionEntered(regionId: "r")

        #expect(phase == .refused(reason: .consentRevoked))
        #expect(await submitter.sent.isEmpty, "nothing may be submitted after revocation")
        // And the device stops watching entirely.
        #expect(await location.regions.isEmpty)
    }

    @Test("an authority loss tears down; a transient one does not")
    func teardownClassification() {
        for reason in [
            EvidenceRefusal.notEnrolled, .blocked, .noPeopleLink,
            .consentRequired, .consentRevoked, .geofenceDisabled, .wrongChurch,
        ] {
            #expect(reason.requiresTeardown, "\(reason) should stop monitoring")
        }
        for reason in [
            EvidenceRefusal.noOpenOccurrence, .windowClosed,
            .insufficientAccuracy, .outsideRegion, .expired, .cancelled,
        ] {
            #expect(!reason.requiresTeardown, "\(reason) should not stop monitoring")
        }
    }

    @Test("reduced accuracy refuses rather than sending a fix that cannot count")
    func reducedAccuracyRefuses() async {
        let location = FakeLocation(authorization: .authorizedAlways)
        let (coordinator, submitter, _, _) = await make(location: location)
        await location.set(accuracy: .reduced)

        let phase = await coordinator.handleRegionEntered(regionId: "r")
        #expect(phase == .refused(reason: .insufficientAccuracy))
        #expect(await submitter.sent.isEmpty)
    }

    @Test("no usable fix still submits, and the server bands it unknown")
    func noFixStillSubmits() async {
        let location = FakeLocation(authorization: .authorizedAlways, sample: nil)
        let submitter = ScriptedSubmitter()
        await submitter.set(answers: [.success(rejected)])
        let (coordinator, _, _, _) = await make(location: location, submitter: submitter)

        _ = await coordinator.handleRegionEntered(regionId: "r")

        let sent = await submitter.sent
        #expect(sent.count == 1)
        // Nil rather than a guess. The server bands nil `unknown` and refuses,
        // which is the fail-closed outcome.
        #expect(sent[0].evidence.latitude == nil)
        #expect(sent[0].evidence.longitude == nil)
        #expect(sent[0].evidence.accuracyMeters == nil)
    }

    @Test("an invalid fix is treated as no fix")
    func invalidFixDiscarded() {
        let bad = LocationSample(
            latitude: 38.25, longitude: -85.75,
            horizontalAccuracyMeters: -1, capturedAt: Date()
        )
        #expect(bad.isUsable == false)

        let evidence = AttendanceEvidence.from(
            occurrenceId: "o", phase: "confirm", sample: bad,
            dwellSeconds: 0, observedAt: Date()
        )
        #expect(evidence.latitude == nil)
    }

    @Test("an offline attempt is queued against its attempt, bounded by the retention rule")
    func offlineQueueIsBounded() async {
        let clock = MutableClock(Date(timeIntervalSince1970: 1_800_000_000))
        let submitter = ScriptedSubmitter()
        await submitter.set(answers: [.failure(APIError.offline)])
        let store = MemoryAttemptStore()
        let (coordinator, _, _, _) = await make(
            submitter: submitter, store: store, now: { clock.now }
        )

        _ = await coordinator.handleRegionEntered(regionId: "r")

        let held = await store.peek(testPartition)
        #expect(held != nil, "a dead zone must not lose the check-in")
        #expect(held?.queued != nil, "the submission must be held against its attempt")
        // The attempt id bounds the coordinates, not a separate lifetime.
        #expect(held?.expiresAt == clock.now.addingTimeInterval(pendingAttemptLifetime))
        #expect(held?.queued?.latitude != nil)

        // Past the lifetime: purged unsent rather than kept as a location record.
        clock.advance(by: pendingAttemptLifetime + 1)
        let phase = await coordinator.flushPending()

        #expect(phase == .refused(reason: .expired))
        let remaining = await store.count()
        #expect(remaining == 0)
    }

    @Test("the queued submission carries no key of its own — it is re-derived")
    func queuedCarriesNoKey() async {
        // A key stored alongside the payload could drift from the attempt it
        // belongs to. Storing only the attempt id and re-deriving means the two
        // cannot disagree.
        let submitter = ScriptedSubmitter()
        await submitter.set(answers: [.failure(APIError.offline), .success(counted)])
        let store = MemoryAttemptStore()
        let (coordinator, _, _, _) = await make(submitter: submitter, store: store)

        _ = await coordinator.handleRegionEntered(regionId: "r")
        let attempt = await store.peek(testPartition)
        let expected = IdempotencyKey.geofence(
            accountId: "acct-1",
            churchSlug: attempt!.churchSlug,
            occurrenceId: attempt!.occurrenceId,
            attemptId: attempt!.attemptId,
            kind: attempt!.queued!.kind
        )

        _ = await coordinator.flushPending()

        let keys = await submitter.keys()
        #expect(keys.allSatisfy { $0 == expected })
    }

    @Test("backoff is bounded, jittered, and never zero")
    func backoffPolicy() {
        // Deterministic ends of the jitter range.
        for attempt in 0..<8 {
            let low = RetryPolicy.delay(forAttempt: attempt, jitter: { 0 })
            let high = RetryPolicy.delay(forAttempt: attempt, jitter: { 1 })
            #expect(low > 0, "attempt \(attempt) could spin")
            #expect(high <= 120, "attempt \(attempt) exceeded the ceiling")
            #expect(low <= high)
        }
        // It grows.
        #expect(RetryPolicy.delay(forAttempt: 3, jitter: { 0 }) > RetryPolicy.delay(forAttempt: 0, jitter: { 0 }))
        // A whole congregation's phones must not retry in lockstep.
        #expect(RetryPolicy.delay(forAttempt: 3, jitter: { 0 }) != RetryPolicy.delay(forAttempt: 3, jitter: { 1 }))
    }

    @Test("a terminal refusal is never retried")
    func terminalNotRetried() {
        #expect(RetryPolicy.shouldRetry(attempt: 0, isTransient: false) == false)
        #expect(RetryPolicy.shouldRetry(attempt: 0, isTransient: true) == true)
        // And it is bounded even when transient.
        #expect(RetryPolicy.shouldRetry(attempt: RetryPolicy.maxAttempts, isTransient: true) == false)
    }

    @Test("both platforms produce the same canonical request")
    func canonicalRequest() {
        let evidence = AttendanceEvidence.from(
            occurrenceId: "occ-1",
            phase: "confirm",
            sample: LocationSample(
                latitude: 38.2527, longitude: -85.7585,
                horizontalAccuracyMeters: 15, capturedAt: Date(timeIntervalSince1970: 1_800_000_000)
            ),
            dwellSeconds: 180,
            observedAt: Date(timeIntervalSince1970: 1_800_000_000)
        )

        // Field-for-field identical to what Kotlin's `AttendanceEvidence`
        // produces; the Kotlin suite asserts the mirror of this.
        #expect(evidence.occurrenceId == "occ-1")
        #expect(evidence.phase == "confirm")
        #expect(evidence.dwellSeconds == 180)
        #expect(evidence.accuracyMeters == 15)
        #expect(evidence.latitude == 38.2527)
        #expect(evidence.longitude == -85.7585)
        // iOS never claims a mock-location signal it does not have.
        #expect(evidence.mockLocationReported == nil)
    }
}
