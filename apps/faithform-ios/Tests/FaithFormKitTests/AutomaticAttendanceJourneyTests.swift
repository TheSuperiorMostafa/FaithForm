import Foundation
import Testing
@testable import FaithFormKit

// Automatic check-in as a person meets it: setup, the churches watched, an
// arrival that stays or drives past, the question and the answer, a dead zone,
// a relaunch, and turning it all off. Everything runs on a plain macOS runner.

// ---------------------------------------------------------------------------
// Doubles
// ---------------------------------------------------------------------------

/// Records every notification the flow asks for.
actor FakeNotifier: AttendanceNotifying {
    var status: NotificationAuthorization
    var answer: NotificationAuthorization = .authorized
    private(set) var permissionRequests = 0
    /// Church slug → when the question is due.
    private(set) var scheduled: [String: Date] = [:]
    private(set) var scheduleCount = 0
    private(set) var cancelled: [String] = []
    private(set) var cancelAllCount = 0
    private(set) var checkedIn: [String] = []
    private(set) var notCheckedIn: [String] = []

    init(status: NotificationAuthorization = .notDetermined) { self.status = status }

    func authorizationStatus() async -> NotificationAuthorization { status }

    func requestAuthorization() async -> NotificationAuthorization {
        permissionRequests += 1
        status = answer
        return status
    }

    func scheduleArrivalPrompt(churchSlug: String, churchName: String, at: Date) async {
        scheduled[churchSlug] = at
        scheduleCount += 1
    }

    func cancelArrivalPrompt(churchSlug: String) async {
        scheduled[churchSlug] = nil
        cancelled.append(churchSlug)
    }

    func cancelAll() async {
        scheduled = [:]
        cancelAllCount += 1
    }

    func postCheckedIn(churchSlug: String, churchName: String) async {
        scheduled[churchSlug] = nil
        checkedIn.append(churchSlug)
    }

    func postNotCheckedIn(churchSlug: String, churchName: String) async {
        scheduled[churchSlug] = nil
        notCheckedIn.append(churchSlug)
    }

    func set(answer: NotificationAuthorization) { self.answer = answer }
}

/// One configuration state per church.
actor ChurchConfigSource: GeofenceReconciler.ConfigurationSource {
    var states: [String: GeofenceConfigurationState]
    private(set) var calls: [(slug: String, forced: Bool)] = []

    init(_ states: [String: GeofenceConfigurationState]) { self.states = states }

    func currentConfiguration(
        churchSlug: String,
        partition: CachePartition,
        now: Date,
        forceRefresh: Bool
    ) async -> GeofenceConfigurationState {
        calls.append((churchSlug, forceRefresh))
        return states[churchSlug] ?? .refused("not_enrolled")
    }

    func set(_ slug: String, _ state: GeofenceConfigurationState) { states[slug] = state }
    func callCount(_ slug: String) -> Int { calls.filter { $0.slug == slug }.count }
}

actor MemorySettingsStore: AutomaticAttendanceSettingsStoring {
    private(set) var stored: StoredAutomaticAttendance?
    private(set) var clears = 0

    init(_ stored: StoredAutomaticAttendance? = nil) { self.stored = stored }

    func load(environment: String) async -> StoredAutomaticAttendance? { stored }
    func save(_ stored: StoredAutomaticAttendance) async { self.stored = stored }
    func clear(environment: String) async {
        stored = nil
        clears += 1
    }
}

struct AttendanceHistoryStub: AttendanceHistoryReading {
    let items: [AttendanceHistoryItem]
    func history(churchSlug: String, limit: Int) async throws -> [AttendanceHistoryItem] { items }
}

/// A submitter whose `detected` answer waits until the test lets it go — for
/// an exit that lands while a request is in flight.
actor GatedSubmitter: AttendanceSubmitting {
    private var gate: CheckedContinuation<Void, Never>?
    private var released = false
    private(set) var sent: [AttendanceEvidence] = []
    let answer: AttendanceResult

    init(answer: AttendanceResult) { self.answer = answer }

    func eligibleOccurrenceId(churchSlug: String) async throws -> String? { "occ-1" }

    func submit(_ evidence: AttendanceEvidence, idempotencyKey: String) async throws -> AttendanceResult {
        sent.append(evidence)
        if !released {
            await withCheckedContinuation { gate = $0 }
        }
        return answer
    }

    func isWaiting() -> Bool { gate != nil }

    func release() {
        released = true
        gate?.resume()
        gate = nil
    }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let journeyStart = Date(timeIntervalSince1970: 1_800_000_000)
let accountPartition = CachePartition(environment: "test", accountId: "acct-1", authorizationVersion: 7)
let grace = AttendanceChurch(slug: "grace", name: "Grace Community")
let hope = AttendanceChurch(slug: "hope", name: "Hope Chapel")

func partition(_ slug: String, version: Int = 7) -> CachePartition {
    CachePartition(environment: "test", accountId: "acct-1", churchSlug: slug, authorizationVersion: version)
}

func window(
    _ occurrenceId: String,
    opensIn opens: TimeInterval,
    closesIn closes: TimeInterval = 2 * 60 * 60,
    label: String = "Sunday Service",
    now: Date = journeyStart
) -> GeofenceWindow {
    GeofenceWindow(
        occurrenceId: occurrenceId,
        label: label,
        startsAt: FaithFormInstant.format(now.addingTimeInterval(opens + 30 * 60)),
        endsAt: FaithFormInstant.format(now.addingTimeInterval(opens + 90 * 60)),
        checkinOpensAt: FaithFormInstant.format(now.addingTimeInterval(opens)),
        checkinClosesAt: FaithFormInstant.format(now.addingTimeInterval(closes)),
        timezone: "America/New_York"
    )
}

func churchConfiguration(
    _ slug: String,
    regions: [GeofenceRegion]? = nil,
    windows: [GeofenceWindow] = [],
    requiresConfirmation: Bool = true,
    minDwellSeconds: Int = 120,
    version: Int = 7003
) -> GeofenceConfiguration {
    GeofenceConfiguration(
        churchSlug: slug,
        regions: regions ?? [region("faithform.campus.\(slug)-main")],
        windows: windows,
        sources: AttendanceSourceAvailability(geofence: true, qr: true, manual: true),
        requiresConfirmation: requiresConfirmation,
        minDwellSeconds: minDwellSeconds,
        maxLocationAccuracyM: 100,
        configVersion: version,
        expiresAt: FaithFormInstant.format(journeyStart.addingTimeInterval(15 * 60))
    )
}

/// The whole stack below the screen, wired the way the app wires it.
struct AttendanceStack {
    let location: FakeLocation
    let source: ChurchConfigSource
    let submitter: ScriptedSubmitter
    let store: MemoryAttemptStore
    let notifier: FakeNotifier
    let settingsStore: MemorySettingsStore
    let reconciler: GeofenceReconciler
    let coordinator: AutomaticAttendanceCoordinator
    let service: AutomaticAttendanceService
    let clock: MutableClock

    static func make(
        location: FakeLocation = FakeLocation(authorization: .authorizedAlways),
        states: [String: GeofenceConfigurationState] = ["grace": .available(churchConfiguration("grace"))],
        submitter: ScriptedSubmitter = ScriptedSubmitter(),
        store: MemoryAttemptStore = MemoryAttemptStore(),
        notifier: FakeNotifier = FakeNotifier(status: .authorized),
        settingsStore: MemorySettingsStore = MemorySettingsStore(),
        clock: MutableClock = MutableClock(journeyStart)
    ) -> AttendanceStack {
        let source = ChurchConfigSource(states)
        let reconciler = GeofenceReconciler(
            monitor: location, authorization: location, source: source, now: { clock.now }
        )
        let coordinator = AutomaticAttendanceCoordinator(
            reconciler: reconciler,
            submitter: submitter,
            sampler: location,
            store: store,
            authorization: location,
            notifier: notifier,
            now: { clock.now }
        )
        let service = AutomaticAttendanceService(
            coordinator: coordinator,
            reconciler: reconciler,
            settingsStore: settingsStore,
            environment: "test"
        )
        return AttendanceStack(
            location: location, source: source, submitter: submitter, store: store,
            notifier: notifier, settingsStore: settingsStore, reconciler: reconciler,
            coordinator: coordinator, service: service, clock: clock
        )
    }

    /// Signed in, consent granted, switched on, for the given churches.
    func switchedOn(_ churches: [AttendanceChurch] = [grace]) async {
        await service.updateAccount(
            accountId: "acct-1", authorizationVersion: 7, serverConsent: "granted", churches: churches
        )
        await service.enable()
    }

    @MainActor
    func model(
        consent: FakeConsent = FakeConsent(),
        history: (any AttendanceHistoryReading)? = nil
    ) -> AutomaticAttendanceModel {
        AutomaticAttendanceModel(
            service: service,
            authorizer: location,
            consent: consent,
            notifications: notifier,
            history: history,
            now: { clock.now }
        )
    }
}

// ---------------------------------------------------------------------------
// Setup: consent, permission, notifications
// ---------------------------------------------------------------------------

@MainActor
@Suite("Automatic check-in setup")
struct SetupJourneyTests {
    private func signedIn(_ stack: AttendanceStack, churches: [AttendanceChurch] = [grace]) async {
        await stack.service.updateAccount(
            accountId: "acct-1", authorizationVersion: 7, serverConsent: "unset", churches: churches
        )
    }

    @Test("nothing is requested until the person asks for it")
    func noPromptAtLaunch() async {
        let stack = AttendanceStack.make(location: FakeLocation(), notifier: FakeNotifier())
        let consent = FakeConsent()
        await signedIn(stack)
        let model = stack.model(consent: consent)

        // Everything the app does on launch and while browsing.
        await stack.service.start()
        await model.refresh()
        await model.select(church: grace)
        model.begin()

        #expect(await stack.location.prompts.isEmpty, "a location prompt was raised before the person agreed")
        #expect(await stack.notifier.permissionRequests == 0)
        #expect(await consent.writes.isEmpty, "consent was recorded before the person agreed")
        #expect(model.step == .introduction)
    }

    @Test("the order is: what it does, consent, When In Use, Always, notifications")
    func order() async {
        let stack = AttendanceStack.make(location: FakeLocation(), notifier: FakeNotifier())
        let consent = FakeConsent()
        await signedIn(stack)
        let model = stack.model(consent: consent)

        model.begin()
        await model.acceptIntroduction()
        // Consent first — and nothing prompted yet.
        #expect(await consent.writes == ["granted"])
        #expect(await stack.location.prompts.isEmpty)
        #expect(model.step == .foregroundEducation)

        await model.requestForegroundPermission()
        #expect(await stack.location.prompts == ["whenInUse"])
        // Never chained straight into Always.
        #expect(model.step == .backgroundEducation)
        #expect(await stack.location.regions.isEmpty)

        await model.requestBackgroundPermission()
        #expect(await stack.location.prompts == ["whenInUse", "always"])
        // Watching starts the moment Always is given, before notifications are
        // even asked about.
        #expect(await stack.location.regions.count == 1)
        #expect(model.step == .notificationEducation)
        #expect(await stack.notifier.permissionRequests == 0)

        await model.requestNotificationPermission()
        #expect(await stack.notifier.permissionRequests == 1)
        #expect(model.step == .ready)
        #expect(model.isEnabled)
    }

    @Test("consent is recorded before any region is registered")
    func consentBeforeMonitoring() async {
        let stack = AttendanceStack.make(location: FakeLocation(), notifier: FakeNotifier())
        let consent = FakeConsent()
        await signedIn(stack)
        let model = stack.model(consent: consent)

        model.begin()
        await model.acceptIntroduction()
        #expect(await stack.location.startCalls.isEmpty)
        await model.requestForegroundPermission()
        await model.requestBackgroundPermission()
        #expect(await consent.writes == ["granted"])
        #expect(await stack.location.startCalls.count == 1)
    }

    @Test("when no church offers it, consent is withdrawn and no location prompt appears")
    func noChurchOffersIt() async {
        for reason in ["no_people_link", "geofence_disabled", "no_campus_configured"] {
            let stack = AttendanceStack.make(
                location: FakeLocation(), states: ["grace": .refused(reason)], notifier: FakeNotifier()
            )
            let consent = FakeConsent()
            await signedIn(stack)
            let model = stack.model(consent: consent)

            model.begin()
            await model.acceptIntroduction()

            #expect(await consent.writes == ["granted", "revoked"], "\(reason) kept consent nothing can use")
            #expect(await stack.location.prompts.isEmpty, "\(reason) still asked for location")
            #expect(model.step == .blocked(AutomaticAttendanceBlocker.from(refusal: reason)))
            #expect(model.isEnabled == false)
        }
    }

    @Test("one church that offers it is enough, whatever the others say")
    func oneChurchIsEnough() async {
        let stack = AttendanceStack.make(
            location: FakeLocation(),
            states: ["grace": .available(churchConfiguration("grace")), "hope": .refused("no_people_link")],
            notifier: FakeNotifier()
        )
        await signedIn(stack, churches: [grace, hope])
        let model = stack.model()
        model.begin()
        await model.acceptIntroduction()
        #expect(model.step == .foregroundEducation)
    }

    @Test("when every church refuses, the one on screen answers, by name")
    func refusalIsTheChurchOnScreen() async {
        // Grace sorts first by address. Before, its answer was shown whatever
        // church the person was looking at — "no location" for a church that
        // had one, because a different church did not.
        let states: [String: GeofenceConfigurationState] = [
            "grace": .refused("no_campus_configured"),
            "hope": .refused("no_people_link"),
        ]
        let stack = AttendanceStack.make(location: FakeLocation(), states: states, notifier: FakeNotifier())
        await signedIn(stack, churches: [grace, hope])
        let model = stack.model()
        await model.select(church: hope)

        model.begin()
        await model.acceptIntroduction()

        #expect(model.step == .blocked(.noPeopleLink))
        #expect(model.blockedChurchName == "Hope Chapel")
        #expect(model.status.blockedChurchName == "Hope Chapel")
        #expect(AutomaticAttendanceStatusView.title(for: .noPeopleLink, churchName: "Hope Chapel").contains("Hope Chapel"))
    }

    @Test("with no church on screen, the first by address answers, and says which")
    func refusalWithoutSelection() async {
        let stack = AttendanceStack.make(
            location: FakeLocation(),
            states: ["grace": .refused("no_campus_configured"), "hope": .refused("geofence_disabled")],
            notifier: FakeNotifier()
        )
        await signedIn(stack, churches: [hope, grace])
        let report = await stack.service.eligibilityReport(preferring: nil)
        #expect(report.eligibility == .refused("no_campus_configured"))
        #expect(report.church == grace)

        // A preference for a church that did not refuse falls back the same way.
        let unknown = await stack.service.eligibilityReport(preferring: "nowhere")
        #expect(unknown.church == grace)

        // And one church that offers it is still enough, whichever is preferred.
        await stack.source.set("hope", .available(churchConfiguration("hope")))
        let available = await stack.service.eligibilityReport(preferring: "grace")
        #expect(available.eligibility == .available)
        #expect(available.church == nil)
    }

    @Test("starting setup again forgets the church an old refusal named")
    func blockedNameIsForgotten() async {
        let stack = AttendanceStack.make(
            location: FakeLocation(), states: ["grace": .refused("no_campus_configured")], notifier: FakeNotifier()
        )
        await signedIn(stack)
        let model = stack.model()
        model.begin()
        await model.acceptIntroduction()
        #expect(model.blockedChurchName == "Grace Community")

        model.begin()
        #expect(model.blockedChurchName == nil)
    }

    @Test("a dropped connection while checking the churches does not end setup")
    func offlineEligibilityContinues() async {
        let stack = AttendanceStack.make(location: FakeLocation(), states: ["grace": .unavailable], notifier: FakeNotifier())
        await signedIn(stack)
        let model = stack.model()
        model.begin()
        await model.acceptIntroduction()
        #expect(model.step == .foregroundEducation)
    }

    @Test("a server that refuses consent leaves nothing monitored and nothing prompted")
    func consentRefused() async {
        let stack = AttendanceStack.make(location: FakeLocation(), notifier: FakeNotifier())
        let consent = FakeConsent()
        await consent.set(answer: "denied")
        await signedIn(stack)
        let model = stack.model(consent: consent)

        model.begin()
        await model.acceptIntroduction()

        #expect(model.step == .blocked(.consentMissing))
        #expect(await stack.location.prompts.isEmpty)
        #expect(await stack.location.regions.isEmpty)
    }

    @Test("declining When In Use leaves it on, blocked, with Settings and Turn off")
    func foregroundDenied() async {
        let location = FakeLocation()
        await location.set(whenInUseAnswer: .denied)
        let stack = AttendanceStack.make(location: location, notifier: FakeNotifier())
        await signedIn(stack)
        let model = stack.model()

        model.begin()
        await model.acceptIntroduction()
        await model.requestForegroundPermission()

        #expect(model.step == .blocked(.locationDenied))
        #expect(await location.prompts == ["whenInUse"], "Always was asked after a refusal")
        #expect(AutomaticAttendanceBlocker.locationDenied.isRecoverableInSettings)
        #expect(model.isEnabled, "the person's choice is kept so Settings can finish it")
        #expect(await location.regions.isEmpty)
    }

    @Test("restricted is not sent to a Settings dead end")
    func restricted() async {
        let location = FakeLocation()
        await location.set(whenInUseAnswer: .restricted)
        let stack = AttendanceStack.make(location: location, notifier: FakeNotifier())
        await signedIn(stack)
        let model = stack.model()

        model.begin()
        await model.acceptIntroduction()
        await model.requestForegroundPermission()

        #expect(model.step == .blocked(.locationRestricted))
        #expect(AutomaticAttendanceBlocker.locationRestricted.isRecoverableInSettings == false)
    }

    @Test("When In Use alone is a blocked state, not a working feature")
    func whenInUseOnly() async {
        let location = FakeLocation()
        await location.set(alwaysAnswer: .authorizedWhenInUse)
        let stack = AttendanceStack.make(location: location, notifier: FakeNotifier())
        await signedIn(stack)
        let model = stack.model()

        model.begin()
        await model.acceptIntroduction()
        await model.requestForegroundPermission()
        await model.requestBackgroundPermission()

        #expect(model.step == .blocked(.needsAlwaysAuthorization))
        #expect(await location.regions.isEmpty)
        // Notifications are not asked for a feature that cannot run.
        #expect(await stack.notifier.permissionRequests == 0)
    }

    @Test("precise location off is its own state, recovered in Settings")
    func reducedAccuracy() async {
        let location = FakeLocation(accuracy: .reduced)
        let stack = AttendanceStack.make(location: location, notifier: FakeNotifier())
        await signedIn(stack)
        let model = stack.model()

        model.begin()
        await model.acceptIntroduction()
        await model.requestForegroundPermission()
        await model.requestBackgroundPermission()

        #expect(model.step == .blocked(.reducedAccuracy))
        #expect(AutomaticAttendanceBlocker.reducedAccuracy.isRecoverableInSettings)
        #expect(await location.regions.isEmpty)
    }

    @Test("location services off device-wide is not the same as denied")
    func servicesOff() async {
        let location = FakeLocation(authorization: .unavailable, servicesEnabled: false)
        await location.set(whenInUseAnswer: .unavailable)
        let stack = AttendanceStack.make(location: location, notifier: FakeNotifier())
        await signedIn(stack)
        let model = stack.model()

        model.begin()
        await model.acceptIntroduction()
        await model.requestForegroundPermission()

        #expect(model.step == .blocked(.locationServicesOff))
    }

    @Test("someone who already allowed location skips the prompts they have answered")
    func alreadyAlways() async {
        let stack = AttendanceStack.make(location: FakeLocation(authorization: .authorizedAlways), notifier: FakeNotifier())
        await signedIn(stack)
        let model = stack.model()

        model.begin()
        await model.acceptIntroduction()

        #expect(model.step == .notificationEducation)
        #expect(await stack.location.prompts.isEmpty)
    }

    @Test("Not now before the location prompt withdraws the consent just given")
    func notNowWithdraws() async {
        let stack = AttendanceStack.make(location: FakeLocation(), notifier: FakeNotifier())
        let consent = FakeConsent()
        await signedIn(stack)
        let model = stack.model(consent: consent)

        model.begin()
        await model.acceptIntroduction()
        await model.notNow()

        #expect(await consent.writes == ["granted", "revoked"])
        #expect(model.step == .notStarted)
        #expect(await stack.location.prompts.isEmpty)
    }

    @Test("Not now on notifications only skips notifications")
    func notNowOnNotifications() async {
        let stack = AttendanceStack.make(location: FakeLocation(), notifier: FakeNotifier())
        let consent = FakeConsent()
        await signedIn(stack)
        let model = stack.model(consent: consent)

        model.begin()
        await model.acceptIntroduction()
        await model.requestForegroundPermission()
        await model.requestBackgroundPermission()
        await model.notNow()

        #expect(model.step == .ready)
        #expect(await stack.notifier.permissionRequests == 0)
        #expect(await consent.writes == ["granted"])
        #expect(await stack.location.regions.count == 1)
    }

    @Test("turning it off removes regions, revokes consent, purges evidence and notifications")
    func turnOff() async {
        let submitter = ScriptedSubmitter()
        await submitter.set(answers: [.success(pendingUntil(journeyStart.addingTimeInterval(120)))])
        let stack = AttendanceStack.make(location: FakeLocation(), submitter: submitter, notifier: FakeNotifier())
        let consent = FakeConsent()
        await signedIn(stack)
        let model = stack.model(consent: consent)

        model.begin()
        await model.acceptIntroduction()
        await model.requestForegroundPermission()
        await model.requestBackgroundPermission()
        await model.requestNotificationPermission()
        #expect(await stack.location.regions.count == 1)

        // An arrival is waiting on the server when the person turns it off.
        _ = await stack.coordinator.handleRegionEntered(regionId: "faithform.campus.grace-main")
        let version = await stack.service.snapshot().settings
        #expect(version.enabled)
        #expect(await stack.store.count() == 1)

        await model.disable()

        #expect(await stack.location.regions.isEmpty)
        #expect(await consent.writes == ["granted", "revoked"])
        #expect(await stack.store.count() == 0, "unsent evidence survived turning it off")
        #expect(await stack.notifier.cancelAllCount >= 1)
        #expect(await stack.notifier.scheduled.isEmpty)
        #expect(model.step == .notStarted)
        #expect(model.isEnabled == false)
        #expect(await stack.settingsStore.stored?.settings.enabled == false)
    }

    @Test("every blocked state has its own copy")
    func everyBlockerHasCopy() {
        var titles = Set<String>()
        for blocker in AutomaticAttendanceBlocker.allCases {
            let title = AutomaticAttendanceStatusView.title(for: blocker)
            let body = AutomaticAttendanceStatusView.explanation(for: blocker)
            #expect(!title.isEmpty, "\(blocker) has no title")
            #expect(!body.isEmpty, "\(blocker) has no explanation")
            titles.insert(title)
        }
        #expect(titles.count >= AutomaticAttendanceBlocker.allCases.count - 1)
    }

    @Test("a church's refusal names the church; the device's own do not")
    func churchRefusalsAreNamed() {
        for blocker in [AutomaticAttendanceBlocker.noPeopleLink, .churchDisabled, .noCampus] {
            let named = AutomaticAttendanceStatusView.title(for: blocker, churchName: "Hope Chapel")
            #expect(named.contains("Hope Chapel"), "\(blocker) does not say which church")
            #expect(!named.contains("%@"), "\(blocker) left its placeholder unfilled")
            #expect(
                AutomaticAttendanceStatusView.title(for: blocker, churchName: nil)
                    == AutomaticAttendanceStatusView.title(for: blocker)
            )
        }
        for blocker in [AutomaticAttendanceBlocker.locationDenied, .reducedAccuracy, .needsAlwaysAuthorization] {
            #expect(
                AutomaticAttendanceStatusView.title(for: blocker, churchName: "Hope Chapel")
                    == AutomaticAttendanceStatusView.title(for: blocker)
            )
        }
    }

    @Test("no permission or notification copy leans on guilt or misdirection")
    func copyIsHonest() {
        let allCopy = [
            L.autoAttendanceIntroTitle, L.autoAttendanceIntroBody,
            L.autoAttendanceForegroundTitle, L.autoAttendanceForegroundBody,
            L.autoAttendanceBackgroundTitle, L.autoAttendanceBackgroundBody,
            L.autoAttendancePrivacyPointOne, L.autoAttendancePrivacyPointTwo,
            L.autoAttendancePrivacyPointThree, L.autoAttendancePrivacyPointFour,
            L.autoAttendanceNotificationTitle, L.autoAttendanceNotificationBody,
            L.autoAttendancePromptTitle, L.autoAttendancePromptBody,
        ].joined(separator: " ").lowercased()

        for phrase in [
            "you must", "required to", "don't let", "miss out", "everyone else",
            "your church expects", "only takes a second", "we promise",
        ] {
            #expect(!allCopy.contains(phrase), "copy uses \"\(phrase)\"")
        }
        #expect(L.autoAttendancePrivacyPointTwo.lowercased().contains("never"))
    }

    @Test("OS permission and server consent are independent gates")
    func permissionIsNotConsent() {
        var settings = AutomaticAttendanceSettings(enabled: true, serverConsent: "revoked")
        #expect(settings.isOperational(authorization: .authorizedAlways) == false)
        settings = AutomaticAttendanceSettings(enabled: true, serverConsent: "granted")
        #expect(settings.isOperational(authorization: .authorizedWhenInUse) == false)
        #expect(settings.isOperational(authorization: .authorizedAlways) == true)
        settings.enabled = false
        #expect(settings.isOperational(authorization: .authorizedAlways) == false)
    }
}

// ---------------------------------------------------------------------------
// Authorization → what the screen says
// ---------------------------------------------------------------------------

@Suite("Status mapping")
struct StatusMappingTests {
    private let on = AutomaticAttendanceSettings(enabled: true, serverConsent: "granted", churches: [grace])
    private let watching = ReconcileOutcome(
        added: [], removed: [], updated: [], monitoring: 1, refusal: nil, droppedForCapacity: []
    )

    private func outcome(_ refusal: String?, monitoring: Int = 0) -> ReconcileOutcome {
        ReconcileOutcome(added: [], removed: [], updated: [], monitoring: monitoring, refusal: refusal, droppedForCapacity: [])
    }

    @Test("every authorization state has a next step")
    func authorizationStates() {
        let table: [(LocationAuthorization, LocationAccuracyAuthorization, AutomaticAttendanceStep)] = [
            (.notDetermined, .full, .blocked(.locationNotRequested)),
            (.authorizedWhenInUse, .full, .blocked(.needsAlwaysAuthorization)),
            (.authorizedAlways, .full, .ready),
            (.authorizedAlways, .reduced, .blocked(.reducedAccuracy)),
            (.denied, .full, .blocked(.locationDenied)),
            (.restricted, .full, .blocked(.locationRestricted)),
            (.unavailable, .full, .blocked(.locationServicesOff)),
        ]
        for (authorization, accuracy, expected) in table {
            let step = AutomaticAttendanceModel.resolveStep(
                settings: on, outcome: watching, authorization: authorization, accuracy: accuracy
            )
            #expect(step == expected, "\(authorization)/\(accuracy) → \(step)")
        }
    }

    @Test("each blocked state offers exactly the action that can help")
    func actions() {
        #expect(AutomaticAttendanceBlocker.locationNotRequested.isRecoverableInSetup)
        for blocker in AutomaticAttendanceBlocker.allCases {
            // Never both, and never Settings for something Settings cannot fix.
            #expect(!(blocker.isRecoverableInSettings && blocker.isRecoverableInSetup))
        }
        for blocker in [AutomaticAttendanceBlocker.noPeopleLink, .churchDisabled, .noCampus, .locationRestricted] {
            #expect(!blocker.isRecoverableInSettings, "\(blocker) sends someone to Settings for nothing")
        }
    }

    @Test("off is off, whatever the permission")
    func off() {
        let settings = AutomaticAttendanceSettings(enabled: false, serverConsent: "unset", churches: [grace])
        for authorization in [LocationAuthorization.authorizedAlways, .denied, .notDetermined] {
            #expect(
                AutomaticAttendanceModel.resolveStep(
                    settings: settings, outcome: .idle, authorization: authorization, accuracy: .full
                ) == .notStarted
            )
        }
    }

    @Test("the church's answer is shown once the device can monitor")
    func churchRefusals() {
        let cases: [(String, AutomaticAttendanceBlocker)] = [
            ("no_people_link", .noPeopleLink),
            ("geofence_disabled", .churchDisabled),
            ("no_campus_configured", .noCampus),
            ("consent_revoked", .consentMissing),
        ]
        for (refusal, blocker) in cases {
            #expect(
                AutomaticAttendanceModel.resolveStep(
                    settings: on, outcome: outcome(refusal), authorization: .authorizedAlways, accuracy: .full
                ) == .blocked(blocker)
            )
        }
    }

    @Test("offline with regions still registered is still on")
    func offline() {
        #expect(
            AutomaticAttendanceModel.resolveStep(
                settings: on, outcome: outcome("configuration_unavailable", monitoring: 1),
                authorization: .authorizedAlways, accuracy: .full
            ) == .ready
        )
        #expect(
            AutomaticAttendanceModel.resolveStep(
                settings: on, outcome: outcome("configuration_unavailable", monitoring: 0),
                authorization: .authorizedAlways, accuracy: .full
            ) == .blocked(.unavailable)
        )
    }

    @Test("the last automatic check-in comes from the server's own history")
    func lastAutomatic() {
        let items = [
            AttendanceHistoryItem(occurrenceId: "o1", label: "Sunday 9am", localServiceDate: "2026-09-06", campusName: nil, source: .geofence, status: "active", countedAt: "2026-09-06T13:05:00Z"),
            AttendanceHistoryItem(occurrenceId: "o2", label: "Sunday 11am", localServiceDate: "2026-09-13", campusName: nil, source: .qr, status: "active", countedAt: "2026-09-13T15:05:00Z"),
            AttendanceHistoryItem(occurrenceId: "o3", label: "Wednesday", localServiceDate: "2026-09-09", campusName: nil, source: .geofence, status: "reversed", countedAt: "2026-09-09T23:05:00Z"),
        ]
        let recent = AutomaticAttendanceModel.lastAutomatic(in: items)
        // Not the scanned one, and not the one a church reversed.
        #expect(recent?.occurrenceLabel == "Sunday 9am")
        #expect(AutomaticAttendanceModel.lastAutomatic(in: []) == nil)
    }
}

// ---------------------------------------------------------------------------
// Which churches, which regions
// ---------------------------------------------------------------------------

@Suite("Churches watched")
struct MultiChurchReconcileTests {
    private func reconciler(
        _ location: FakeLocation,
        _ source: ChurchConfigSource,
        churches: [String],
        clock: MutableClock = MutableClock(journeyStart)
    ) async -> GeofenceReconciler {
        let reconciler = GeofenceReconciler(monitor: location, authorization: location, source: source, now: { clock.now })
        await reconciler.bind(partition: accountPartition, churchSlugs: churches, enabled: true)
        return reconciler
    }

    @Test("every church the account may use is watched, not only the one on screen")
    func watchesEveryChurch() async {
        let location = FakeLocation(authorization: .authorizedAlways)
        let source = ChurchConfigSource([
            "grace": .available(churchConfiguration("grace")),
            "hope": .available(churchConfiguration("hope")),
        ])
        let reconciler = await reconciler(location, source, churches: ["grace", "hope"])

        let outcome = await reconciler.reconcile(trigger: .launch)

        #expect(outcome.monitoring == 2)
        #expect(await reconciler.churchSlug(forRegion: "faithform.campus.hope-main") == "hope")
        #expect(await reconciler.churchSlug(forRegion: "faithform.campus.grace-main") == "grace")
    }

    @Test("a church that refuses does not stop the others")
    func refusalIsPerChurch() async {
        let location = FakeLocation(authorization: .authorizedAlways)
        let source = ChurchConfigSource([
            "grace": .available(churchConfiguration("grace")),
            "hope": .refused("no_people_link"),
        ])
        let reconciler = await reconciler(location, source, churches: ["grace", "hope"])

        let outcome = await reconciler.reconcile(trigger: .launch)

        #expect(outcome.refusal == nil)
        #expect(outcome.churchRefusals == ["hope": "no_people_link"])
        #expect(await location.regions.map(\.identifier) == ["faithform.campus.grace-main"])
    }

    @Test("leaving a church removes its regions and leaves the others untouched")
    func leavingOneChurch() async {
        let location = FakeLocation(authorization: .authorizedAlways)
        let source = ChurchConfigSource([
            "grace": .available(churchConfiguration("grace")),
            "hope": .available(churchConfiguration("hope")),
        ])
        let reconciler = await reconciler(location, source, churches: ["grace", "hope"])
        _ = await reconciler.reconcile(trigger: .launch)
        let startsBefore = await location.startCalls.count

        await reconciler.bind(partition: accountPartition, churchSlugs: ["grace"], enabled: true)
        #expect(await location.regions.map(\.identifier) == ["faithform.campus.grace-main"])

        let outcome = await reconciler.reconcile(trigger: .churchChanged)
        // Grace's region was not re-registered: that would reset the OS's
        // state for it.
        #expect(outcome.changedAnything == false)
        #expect(await location.startCalls.count == startsBefore)
    }

    @Test("a church that cannot be reached keeps the regions it had")
    func partialOutage() async {
        let location = FakeLocation(authorization: .authorizedAlways)
        let source = ChurchConfigSource([
            "grace": .available(churchConfiguration("grace")),
            "hope": .available(churchConfiguration("hope")),
        ])
        let reconciler = await reconciler(location, source, churches: ["grace", "hope"])
        _ = await reconciler.reconcile(trigger: .launch)

        await source.set("hope", .unavailable)
        let outcome = await reconciler.reconcile(trigger: .foreground)

        #expect(outcome.removed.isEmpty)
        #expect(await location.regions.count == 2)
    }

    @Test("excluding one church after a refusal leaves the other watched")
    func excludeOneChurch() async {
        let location = FakeLocation(authorization: .authorizedAlways)
        let source = ChurchConfigSource([
            "grace": .available(churchConfiguration("grace")),
            "hope": .available(churchConfiguration("hope")),
        ])
        let reconciler = await reconciler(location, source, churches: ["grace", "hope"])
        _ = await reconciler.reconcile(trigger: .launch)

        await reconciler.exclude(churchSlug: "hope")

        #expect(await location.regions.map(\.identifier) == ["faithform.campus.grace-main"])
        #expect(await reconciler.isEnabled())
    }

    @Test("over the limit, the church with check-in open wins, then the soonest service")
    func prioritisedBySoonestService() {
        func campuses(_ prefix: String, _ count: Int) -> [GeofenceRegion] {
            (0..<count).map { region(String(format: "faithform.campus.%@-%02d", prefix, $0)) }
        }
        // Sorted by id alone, "a…" would take every slot.
        let noSchedule = churchConfiguration("a-church", regions: campuses("a", 12))
        let sunday = churchConfiguration("b-church", regions: campuses("b", 12), windows: [window("sun", opensIn: 3 * 24 * 3600)])
        let openNow = churchConfiguration("c-church", regions: campuses("c", 6), windows: [window("now", opensIn: -600)])
        let tonight = churchConfiguration("d-church", regions: campuses("d", 6), windows: [window("tonight", opensIn: 6 * 3600)])

        let selected = GeofenceReconciler.selectRegions(
            from: [noSchedule, sunday, openNow, tonight], now: journeyStart
        ).map(\.identifier)

        #expect(selected.count == appleMonitoredRegionLimit)
        #expect(selected.prefix(6).allSatisfy { $0.hasPrefix("faithform.campus.c-") }, "open check-in did not come first")
        #expect(selected.dropFirst(6).prefix(6).allSatisfy { $0.hasPrefix("faithform.campus.d-") })
        #expect(selected.dropFirst(12).allSatisfy { $0.hasPrefix("faithform.campus.b-") })
        #expect(!selected.contains { $0.hasPrefix("faithform.campus.a-") })

        // Deterministic: the same schedule and the same moment choose the same set.
        let again = GeofenceReconciler.selectRegions(from: [tonight, openNow, sunday, noSchedule], now: journeyStart)
        #expect(again.map(\.identifier) == selected)
    }

    @Test("a region shared by two configurations is registered once")
    func duplicateRegion() {
        let shared = region("faithform.campus.shared")
        let selected = GeofenceReconciler.selectRegions(
            from: [churchConfiguration("x", regions: [shared]), churchConfiguration("y", regions: [shared])],
            now: journeyStart
        )
        #expect(selected.count == 1)
    }

    @Test("asking whether a church offers it touches no OS region")
    func preflightTouchesNothing() async {
        let location = FakeLocation(authorization: .notDetermined)
        let source = ChurchConfigSource(["grace": .available(churchConfiguration("grace"))])
        let reconciler = GeofenceReconciler(monitor: location, authorization: location, source: source)

        let states = await reconciler.preflight(partition: accountPartition, churchSlugs: ["grace"])

        #expect(states["grace"] == .available(churchConfiguration("grace")))
        #expect(await location.startCalls.isEmpty)
        #expect(await location.prompts.isEmpty)
    }

    @Test("a region event refreshes only the church it belongs to")
    func regionEventForcesItsChurch() async {
        let location = FakeLocation(authorization: .authorizedAlways)
        let source = ChurchConfigSource([
            "grace": .available(churchConfiguration("grace")),
            "hope": .available(churchConfiguration("hope")),
        ])
        let reconciler = await reconciler(location, source, churches: ["grace", "hope"])
        _ = await reconciler.reconcile(trigger: .regionEvent, forceChurch: "hope")
        let calls = await source.calls
        #expect(calls.contains { $0.slug == "hope" && $0.forced })
        #expect(calls.contains { $0.slug == "grace" && !$0.forced })
    }
}

// ---------------------------------------------------------------------------
// Arrivals
// ---------------------------------------------------------------------------

@Suite("Arrival and dwell")
struct ArrivalTests {
    private let campus = "faithform.campus.grace-main"

    @Test("automatic: arriving sends nothing, not even a fix, until the person has stayed")
    func automaticWaits() async {
        let stack = AttendanceStack.make(
            states: ["grace": .available(churchConfiguration("grace", requiresConfirmation: false))]
        )
        await stack.switchedOn()

        let phase = await stack.coordinator.handleRegionEntered(regionId: campus)

        guard case .awaitingDwell = phase else {
            Issue.record("expected awaitingDwell, got \(phase)")
            return
        }
        #expect(await stack.submitter.sent.isEmpty)
        #expect(!(await stack.location.prompts.contains("oneShot")), "a fix was taken before the dwell")
        // The question is booked for the end of the dwell, as the fallback for
        // when iOS gives the app no time of its own then.
        #expect(await stack.notifier.scheduled["grace"] == journeyStart.addingTimeInterval(120))
    }

    @Test("automatic: a drive past checks nobody in and leaves nothing behind")
    func shortPass() async {
        let stack = AttendanceStack.make(
            states: ["grace": .available(churchConfiguration("grace", requiresConfirmation: false))]
        )
        await stack.switchedOn()

        _ = await stack.coordinator.handleRegionEntered(regionId: campus)
        stack.clock.advance(by: 40)
        await stack.coordinator.handleRegionExited(regionId: campus)
        stack.clock.advance(by: 200)
        _ = await stack.coordinator.resumePending()

        #expect(await stack.submitter.sent.isEmpty, "a drive past was submitted")
        #expect(await stack.store.count() == 0)
        #expect(await stack.notifier.scheduled["grace"] == nil, "the question survived the exit")
        #expect(await stack.notifier.checkedIn.isEmpty)
    }

    @Test("automatic: after the dwell, the next opportunity checks in exactly once")
    func automaticChecksInOnce() async {
        let submitter = ScriptedSubmitter()
        await submitter.set(answers: [.success(counted)])
        let stack = AttendanceStack.make(
            states: ["grace": .available(churchConfiguration("grace", requiresConfirmation: false))],
            submitter: submitter
        )
        await stack.switchedOn()

        _ = await stack.coordinator.handleRegionEntered(regionId: campus)
        stack.clock.advance(by: 60)
        _ = await stack.coordinator.resumePending()
        #expect(await submitter.sent.isEmpty, "submitted before the dwell")

        stack.clock.advance(by: 61)
        let phase = await stack.coordinator.resumePending()

        #expect(phase == .counted(occurrenceId: "occ-1", alreadyCounted: false))
        let sent = await submitter.sent
        #expect(sent.map(\.evidence.phase) == ["detected"])
        #expect(sent[0].evidence.attemptId != nil)
        #expect(sent[0].evidence.regionId == campus)
        #expect(sent[0].evidence.configVersion == 7003)
        #expect(sent[0].evidence.latitude != nil)
        #expect(await stack.notifier.checkedIn == ["grace"])

        // Every later opportunity, and re-entering, sends nothing more.
        _ = await stack.coordinator.resumePending()
        _ = await stack.coordinator.handleRegionEntered(regionId: campus)
        #expect(await submitter.sent.count == 1)
    }

    @Test("automatic: a church with no dwell still waits the device's minimum")
    func automaticFloor() async {
        #expect(ArrivalPolicy.automaticDwell(minDwellSeconds: 0) == ArrivalPolicy.minimumAutomaticDwell)
        #expect(ArrivalPolicy.automaticDwell(minDwellSeconds: -5) == ArrivalPolicy.minimumAutomaticDwell)
        #expect(ArrivalPolicy.automaticDwell(minDwellSeconds: 300) == 300)

        let stack = AttendanceStack.make(
            states: ["grace": .available(churchConfiguration("grace", requiresConfirmation: false, minDwellSeconds: 0))]
        )
        await stack.switchedOn()
        _ = await stack.coordinator.handleRegionEntered(regionId: campus)
        _ = await stack.coordinator.resumePending()
        #expect(await stack.submitter.sent.isEmpty)
    }

    @Test("an exit after a relaunch still abandons the stored arrival")
    func exitAfterRelaunch() async {
        let store = MemoryAttemptStore()
        let notifier = FakeNotifier(status: .authorized)
        let config: [String: GeofenceConfigurationState] = [
            "grace": .available(churchConfiguration("grace", requiresConfirmation: false)),
        ]
        let first = AttendanceStack.make(states: config, store: store, notifier: notifier)
        await first.switchedOn()
        _ = await first.coordinator.handleRegionEntered(regionId: campus)
        #expect(await store.count() == 1)

        // The process was killed. A new one is launched for the exit, with an
        // idle phase and nothing in memory.
        let second = AttendanceStack.make(states: config, store: store, notifier: notifier)
        await second.switchedOn()
        await second.coordinator.handleRegionExited(regionId: campus)

        #expect(await store.count() == 0)
        #expect(await notifier.scheduled["grace"] == nil)
    }

    @Test("leaving by another campus's door does not abandon this one")
    func otherCampusExit() async {
        let stack = AttendanceStack.make(
            states: [
                "grace": .available(
                    churchConfiguration(
                        "grace",
                        regions: [region("faithform.campus.grace-main"), region("faithform.campus.grace-north", lat: 39)],
                        requiresConfirmation: false
                    )
                ),
            ]
        )
        await stack.switchedOn()
        _ = await stack.coordinator.handleRegionEntered(regionId: campus)
        await stack.coordinator.handleRegionExited(regionId: "faithform.campus.grace-north")
        #expect(await stack.store.count() == 1)
    }

    @Test("an exit while the arrival is being sent is not undone by the response")
    func exitDuringRequest() async {
        let gated = GatedSubmitter(answer: pendingUntil(journeyStart.addingTimeInterval(120)))
        let location = FakeLocation(authorization: .authorizedAlways)
        let source = ChurchConfigSource(["grace": .available(churchConfiguration("grace"))])
        let store = MemoryAttemptStore()
        let notifier = FakeNotifier(status: .authorized)
        let reconciler = GeofenceReconciler(monitor: location, authorization: location, source: source, now: { journeyStart })
        let coordinator = AutomaticAttendanceCoordinator(
            reconciler: reconciler, submitter: gated, sampler: location, store: store,
            authorization: location, notifier: notifier, now: { journeyStart }
        )
        await coordinator.bind(
            partition: accountPartition, accountId: "acct-1",
            settings: AutomaticAttendanceSettings(enabled: true, serverConsent: "granted", churches: [grace])
        )

        let entry = Task { await coordinator.handleRegionEntered(regionId: campus) }
        while !(await gated.isWaiting()) { await Task.yield() }

        await coordinator.handleRegionExited(regionId: campus)
        await gated.release()
        let phase = await entry.value

        #expect(phase == .abandoned)
        #expect(await store.count() == 0, "the late response resurrected the arrival")
        #expect(await notifier.scheduled["grace"] == nil)
    }

    @Test("confirmation: arrival starts the server's clock; the person is asked at its instant")
    func confirmationAsks() async {
        let submitter = ScriptedSubmitter()
        await submitter.set(answers: [.success(pendingUntil(journeyStart.addingTimeInterval(120), detectionId: "det-1")), .success(counted)])
        let stack = AttendanceStack.make(submitter: submitter)
        await stack.switchedOn()

        _ = await stack.coordinator.handleRegionEntered(regionId: campus)

        #expect(await submitter.phases() == ["detected"])
        let asked = await stack.notifier.scheduled["grace"]
        // At the server's instant, with a small margin for a fast clock.
        #expect(asked != nil && asked! > journeyStart.addingTimeInterval(120))
        #expect(asked! <= journeyStart.addingTimeInterval(150))
    }

    @Test("confirmation: the dwell passing is not a yes — only the person's tap confirms")
    func confirmationNeedsTheTap() async {
        let submitter = ScriptedSubmitter()
        await submitter.set(answers: [.success(pendingUntil(journeyStart.addingTimeInterval(120), detectionId: "det-1")), .success(counted)])
        let stack = AttendanceStack.make(submitter: submitter)
        await stack.switchedOn()
        _ = await stack.coordinator.handleRegionEntered(regionId: campus)

        stack.clock.advance(by: 300)
        // Opening the app, another region callback, a foreground: none is a yes.
        _ = await stack.coordinator.resumePending()
        _ = await stack.coordinator.confirmIfDue()
        _ = await stack.service.foreground()
        #expect(await submitter.phases() == ["detected"], "confirmed on the person's behalf")

        await stack.service.handleNotification(.checkIn(churchSlug: "grace", opensApp: false))

        let sent = await submitter.sent
        #expect(sent.map(\.evidence.phase) == ["detected", "confirm"])
        #expect(sent[1].evidence.detectionId == "det-1")
        #expect(sent[1].evidence.regionId == campus)
        #expect(sent[0].key != sent[1].key)
        #expect(await stack.notifier.checkedIn == ["grace"])

        // A second tap on a stale notification sends nothing.
        await stack.service.handleNotification(.checkIn(churchSlug: "grace", opensApp: true))
        #expect(await submitter.sent.count == 2)
    }

    @Test("confirmation: a yes given early is kept and used once the instant passes")
    func earlyYes() async {
        let submitter = ScriptedSubmitter()
        await submitter.set(answers: [.success(pendingUntil(journeyStart.addingTimeInterval(120), detectionId: "det-1")), .success(counted)])
        let stack = AttendanceStack.make(submitter: submitter)
        await stack.switchedOn()
        _ = await stack.coordinator.handleRegionEntered(regionId: campus)

        stack.clock.advance(by: 30)
        _ = await stack.service.confirmArrival(churchSlug: "grace")
        #expect(await submitter.phases() == ["detected"], "a predictably-refused confirm was sent")

        stack.clock.advance(by: 120)
        let phase = await stack.coordinator.resumePending()
        #expect(phase == .counted(occurrenceId: "occ-1", alreadyCounted: false))
    }

    @Test("Not now closes the arrival and nothing more is sent")
    func notNow() async {
        let submitter = ScriptedSubmitter()
        await submitter.set(answers: [.success(pendingUntil(journeyStart.addingTimeInterval(120)))])
        let stack = AttendanceStack.make(submitter: submitter)
        await stack.switchedOn()
        _ = await stack.coordinator.handleRegionEntered(regionId: campus)

        stack.clock.advance(by: 200)
        await stack.service.handleNotification(.notNow(churchSlug: "grace"))
        await stack.service.handleNotification(.checkIn(churchSlug: "grace", opensApp: false))

        #expect(await submitter.phases() == ["detected"])
        #expect(await stack.store.count() == 0)
    }

    @Test("someone already counted is not asked again after a relaunch")
    func alreadyCountedIsNotAsked() async {
        let submitter = ScriptedSubmitter()
        await submitter.set(countedStatus: true)
        let stack = AttendanceStack.make(submitter: submitter)
        await stack.switchedOn()

        let phase = await stack.coordinator.handleRegionEntered(regionId: campus)

        #expect(phase == .counted(occurrenceId: "occ-1", alreadyCounted: true))
        #expect(await submitter.sent.isEmpty, "a position was sent for a service already counted")
        #expect(await stack.notifier.scheduled.isEmpty)
    }

    @Test("an early arrival is held for the window rather than lost")
    func earlyArrival() async {
        let submitter = ScriptedSubmitter()
        await submitter.set(occurrenceId: nil)
        await submitter.set(answers: [.success(pendingUntil(journeyStart.addingTimeInterval(20 * 60 + 120), detectionId: "det-1"))])
        let stack = AttendanceStack.make(
            states: ["grace": .available(churchConfiguration("grace", windows: [window("occ-1", opensIn: 20 * 60)]))],
            submitter: submitter
        )
        await stack.switchedOn()

        let phase = await stack.coordinator.handleRegionEntered(regionId: campus)
        guard case .awaitingDwell = phase else {
            Issue.record("an early arrival was refused: \(phase)")
            return
        }
        // Asked once a dwell could have passed after check-in opens.
        #expect(await stack.notifier.scheduled["grace"] == journeyStart.addingTimeInterval(20 * 60 + 120))

        stack.clock.advance(by: 10 * 60)
        _ = await stack.coordinator.resumePending()
        #expect(await submitter.sent.isEmpty, "submitted before check-in opened")

        stack.clock.advance(by: 10 * 60 + 1)
        await submitter.set(occurrenceId: "occ-1")
        _ = await stack.coordinator.resumePending()
        #expect(await submitter.phases() == ["detected"])
    }

    @Test("no window soon enough is an ordinary no")
    func tooEarly() {
        let config = churchConfiguration("grace", windows: [window("later", opensIn: 3 * 60 * 60)])
        #expect(ArrivalPolicy.earlyArrival(in: config, now: journeyStart) == nil)
    }

    @Test("a refusal after a tap is answered; one nobody asked for is not")
    func refusalNotifications() async {
        let submitter = ScriptedSubmitter()
        await submitter.set(answers: [.success(pendingUntil(journeyStart.addingTimeInterval(60), detectionId: "det-1")), .success(rejected)])
        let stack = AttendanceStack.make(submitter: submitter)
        await stack.switchedOn()
        _ = await stack.coordinator.handleRegionEntered(regionId: campus)
        stack.clock.advance(by: 90)
        await stack.service.handleNotification(.checkIn(churchSlug: "grace", opensApp: false))
        #expect(await stack.notifier.notCheckedIn == ["grace"])

        let quiet = ScriptedSubmitter()
        await quiet.set(answers: [.success(rejected)])
        let other = AttendanceStack.make(submitter: quiet)
        await other.switchedOn()
        _ = await other.coordinator.handleRegionEntered(regionId: campus)
        #expect(await other.notifier.notCheckedIn.isEmpty, "someone was interrupted with a refusal they never asked about")
    }

    @Test("offline after a tap: queued under the same key, asked again, counted once")
    func offlineRetry() async {
        let submitter = ScriptedSubmitter()
        await submitter.set(answers: [
            .success(pendingUntil(journeyStart.addingTimeInterval(60), detectionId: "det-1")),
            .failure(APIError.offline),
            .success(counted),
        ])
        let stack = AttendanceStack.make(submitter: submitter)
        await stack.switchedOn()
        _ = await stack.coordinator.handleRegionEntered(regionId: campus)
        stack.clock.advance(by: 90)

        await stack.service.handleNotification(.checkIn(churchSlug: "grace", opensApp: false))
        let held = await stack.store.peek(partition("grace"))
        #expect(held?.queued?.kind == "confirm")
        #expect(held?.personConfirmedAt != nil)
        // The question again, as the retry opportunity iOS will not give.
        #expect(await stack.notifier.scheduled["grace"] != nil)

        stack.clock.advance(by: 60)
        let phase = await stack.coordinator.resumePending()

        #expect(phase == .counted(occurrenceId: "occ-1", alreadyCounted: false))
        let keys = await submitter.keys()
        #expect(keys.count == 3)
        #expect(keys[1] == keys[2], "the retry used a different key")
        #expect(await stack.store.count() == 0)
    }

    @Test("a confirmation whose response was lost reads the status instead of reporting a refusal")
    func lostResponse() async {
        let submitter = ScriptedSubmitter()
        await submitter.set(answers: [
            .success(pendingUntil(journeyStart.addingTimeInterval(60), detectionId: "det-1")),
            .success(rejected),
        ])
        let stack = AttendanceStack.make(submitter: submitter)
        await stack.switchedOn()
        _ = await stack.coordinator.handleRegionEntered(regionId: campus)
        stack.clock.advance(by: 90)

        // The first confirm counted, but its response never arrived; the retry
        // is refused `detection_already_used`. The status says counted.
        await submitter.set(countedStatus: true)
        await stack.service.handleNotification(.checkIn(churchSlug: "grace", opensApp: false))

        #expect(await stack.coordinator.currentPhase() == .counted(occurrenceId: "occ-1", alreadyCounted: true))
        #expect(await stack.notifier.checkedIn == ["grace"])
        #expect(await stack.notifier.notCheckedIn.isEmpty)
    }

    @Test("inside, when asked, is an arrival — once, not on every foreground")
    func insideState() async {
        let stack = AttendanceStack.make(
            states: ["grace": .available(churchConfiguration("grace", requiresConfirmation: false))]
        )
        await stack.switchedOn()

        await stack.coordinator.handleRegionState(regionId: campus, inside: true)
        #expect(await stack.store.count() == 1)
        let reads = await stack.submitter.occurrenceReads

        await stack.store.close(partition: partition("grace"))
        stack.clock.advance(by: 60)
        await stack.coordinator.handleRegionState(regionId: campus, inside: true)
        #expect(await stack.submitter.occurrenceReads == reads, "a second inside answer started a second flow")

        await stack.coordinator.handleRegionState(regionId: campus, inside: true)
        _ = await stack.coordinator.handleRegionEntered(regionId: campus)
        await stack.coordinator.handleRegionState(regionId: campus, inside: false)
        #expect(await stack.store.count() == 0, "outside did not abandon")
    }

    @Test("the campus entered is named when asking which service is open")
    func regionNamedOnOccurrence() async {
        let submitter = ScriptedSubmitter()
        await submitter.set(answers: [.success(pendingUntil(journeyStart.addingTimeInterval(120)))])
        let stack = AttendanceStack.make(submitter: submitter)
        await stack.switchedOn()

        _ = await stack.coordinator.handleRegionEntered(regionId: campus)

        #expect(await submitter.occurrenceRegions == [campus])
        #expect(await submitter.sent.first?.evidence.regionId == campus)
    }

    @Test("outside a check-in window no position is read, so none can be sent")
    func noFixOutsideWindow() async {
        let submitter = ScriptedSubmitter()
        await submitter.set(occurrenceId: nil)
        for requiresConfirmation in [true, false] {
            let stack = AttendanceStack.make(
                states: ["grace": .available(churchConfiguration("grace", requiresConfirmation: requiresConfirmation))],
                submitter: submitter
            )
            await stack.switchedOn()
            _ = await stack.coordinator.handleRegionEntered(regionId: campus)
            #expect(!(await stack.location.prompts.contains("oneShot")), "a fix was read with no window open")
            #expect(await submitter.sent.isEmpty)
        }
    }

    @Test("confirm presents the occurrence the server returned, not the one this device named")
    func confirmUsesReturnedOccurrence() async {
        let submitter = ScriptedSubmitter()
        let pendingAtOtherCampus = AttendanceResult(
            outcome: .pendingConfirmation, message: "m", occurrenceId: "occ-north", countedAt: nil,
            confirmationNotBefore: FaithFormInstant.format(journeyStart.addingTimeInterval(60)), detectionId: "det-n"
        )
        await submitter.set(answers: [.success(pendingAtOtherCampus), .success(counted)])
        let stack = AttendanceStack.make(submitter: submitter)
        await stack.switchedOn()

        _ = await stack.coordinator.handleRegionEntered(regionId: campus)
        stack.clock.advance(by: 90)
        await stack.service.handleNotification(.checkIn(churchSlug: "grace", opensApp: false))

        let sent = await submitter.sent
        #expect(sent.map(\.evidence.occurrenceId) == ["occ-1", "occ-north"])
        #expect(sent.last?.evidence.detectionId == "det-n")
        #expect(sent.last?.evidence.regionId == campus)
    }

    @Test("a yes given after the window closed sends nothing, and says so")
    func windowClosedBeforeConfirm() async {
        let submitter = ScriptedSubmitter()
        await submitter.set(answers: [.success(pendingUntil(journeyStart.addingTimeInterval(60), detectionId: "det-1"))])
        let stack = AttendanceStack.make(submitter: submitter)
        await stack.switchedOn()
        _ = await stack.coordinator.handleRegionEntered(regionId: campus)
        let fixesBefore = await stack.location.prompts.filter { $0 == "oneShot" }.count

        stack.clock.advance(by: 2 * 60 * 60 - 60)
        await submitter.set(occurrenceId: nil)
        await stack.service.handleNotification(.checkIn(churchSlug: "grace", opensApp: false))

        #expect(await submitter.phases() == ["detected"])
        #expect(await stack.location.prompts.filter { $0 == "oneShot" }.count == fixesBefore)
        #expect(await stack.store.count() == 0)
        #expect(await stack.notifier.notCheckedIn == ["grace"])
    }

    @Test("a queued submission is dropped, unsent, once its window has closed")
    func queuedAfterWindow() async {
        let submitter = ScriptedSubmitter()
        await submitter.set(answers: [.failure(APIError.offline)])
        let stack = AttendanceStack.make(submitter: submitter)
        await stack.switchedOn()
        _ = await stack.coordinator.handleRegionEntered(regionId: campus)
        #expect(await stack.store.peek(partition("grace"))?.queued != nil)

        await submitter.set(occurrenceId: nil)
        await submitter.set(answers: [.success(counted)])
        _ = await stack.coordinator.flushPending()

        #expect(await submitter.sent.count == 1, "a queued position was sent after the window closed")
        #expect(await stack.store.count() == 0)
    }

    @Test("occurrence errors: a church that no longer knows the person stops being watched; an inactive account stops everything")
    func occurrenceErrors() async {
        let states: [String: GeofenceConfigurationState] = [
            "grace": .available(churchConfiguration("grace")),
            "hope": .available(churchConfiguration("hope")),
        ]
        let left = ScriptedSubmitter()
        await left.set(occurrenceError: APIError(code: .notFound, message: "Church not found."))
        let one = AttendanceStack.make(states: states, submitter: left)
        await one.switchedOn([grace, hope])
        _ = await one.coordinator.handleRegionEntered(regionId: "faithform.campus.hope-main")
        #expect(await one.location.regions.map(\.identifier) == ["faithform.campus.grace-main"])
        #expect(await one.coordinator.currentSettings().enabled)

        let inactive = ScriptedSubmitter()
        await inactive.set(occurrenceError: APIError(code: .accountInactive, message: "Inactive."))
        let two = AttendanceStack.make(states: states, submitter: inactive)
        await two.switchedOn([grace, hope])
        _ = await two.coordinator.handleRegionEntered(regionId: "faithform.campus.hope-main")
        #expect(await two.location.regions.isEmpty)
        #expect(await two.coordinator.currentSettings().enabled == false)

        // Offline is neither.
        let offline = ScriptedSubmitter()
        await offline.set(occurrenceError: APIError.offline)
        let three = AttendanceStack.make(states: states, submitter: offline)
        await three.switchedOn([grace, hope])
        _ = await three.coordinator.handleRegionEntered(regionId: "faithform.campus.hope-main")
        #expect(await three.location.regions.count == 2)
    }

    @Test("a church's own refusal stops watching that church, not the other")
    func churchRefusalExcludesOnlyThatChurch() async {
        let submitter = ScriptedSubmitter()
        await submitter.set(answers: [.failure(APIError(code: .blocked, message: "no"))])
        let stack = AttendanceStack.make(
            states: [
                "grace": .available(churchConfiguration("grace")),
                "hope": .available(churchConfiguration("hope")),
            ],
            submitter: submitter
        )
        await stack.switchedOn([grace, hope])
        #expect(await stack.location.regions.count == 2)

        let phase = await stack.coordinator.handleRegionEntered(regionId: "faithform.campus.hope-main")

        #expect(phase == .refused(reason: .blocked))
        #expect(await stack.location.regions.map(\.identifier) == ["faithform.campus.grace-main"])
        #expect(await stack.coordinator.currentSettings().enabled)
    }

    @Test("consent withdrawn elsewhere stops every church")
    func accountWideRefusal() async {
        let stack = AttendanceStack.make(
            states: [
                "grace": .available(churchConfiguration("grace")),
                "hope": .available(churchConfiguration("hope")),
            ]
        )
        await stack.switchedOn([grace, hope])
        await stack.source.set("grace", .refused("consent_revoked"))
        await stack.source.set("hope", .refused("consent_revoked"))

        let phase = await stack.coordinator.handleRegionEntered(regionId: "faithform.campus.grace-main")

        #expect(phase == .refused(reason: .consentRevoked))
        #expect(await stack.location.regions.isEmpty)
        #expect(await stack.submitter.sent.isEmpty)
    }
}

// ---------------------------------------------------------------------------
// The service across launches and accounts
// ---------------------------------------------------------------------------

@Suite("Automatic check-in lifecycle")
struct ServiceLifecycleTests {
    private let stored = StoredAutomaticAttendance(
        account: AttendanceAccount(environment: "test", accountId: "acct-1", authorizationVersion: 7),
        settings: AutomaticAttendanceSettings(enabled: true, serverConsent: "granted", churches: [grace])
    )

    @Test("a launch with nothing stored removes any region left behind")
    func failsClosed() async {
        let location = FakeLocation(authorization: .authorizedAlways)
        await location.startMonitoring(MonitoredRegion(identifier: "faithform.campus.stray", latitude: 1, longitude: 1, radiusMeters: 100))
        let stack = AttendanceStack.make(location: location)

        await stack.service.start()

        #expect(await location.regions.isEmpty)
    }

    @Test("a background relaunch acts on what was stored, before any account loads")
    func relaunchActsWithoutBootstrap() async {
        let submitter = ScriptedSubmitter()
        await submitter.set(answers: [.success(pendingUntil(journeyStart.addingTimeInterval(120)))])
        let stack = AttendanceStack.make(submitter: submitter, settingsStore: MemorySettingsStore(stored))

        await stack.service.start()
        #expect(await stack.location.regions.count == 1)
        // And it asked where the device is, for someone already inside.
        #expect(await stack.location.stateRequests >= 1)

        await stack.service.handleRegion(identifier: "faithform.campus.grace-main", transition: .entered)
        #expect(await submitter.phases() == ["detected"])
    }

    @Test("consent withdrawn on another device switches this one off")
    func withdrawnElsewhere() async {
        let stack = AttendanceStack.make(settingsStore: MemorySettingsStore(stored))
        await stack.service.start()
        #expect(await stack.location.regions.count == 1)

        await stack.service.updateAccount(accountId: "acct-1", authorizationVersion: 8, serverConsent: "revoked", churches: [grace])

        #expect(await stack.location.regions.isEmpty)
        #expect(await stack.service.currentSettings().enabled == false)
        #expect(await stack.settingsStore.stored?.settings.enabled == false)
    }

    @Test("an account load older than the consent change is ignored")
    func staleLoad() async {
        let stack = AttendanceStack.make(settingsStore: MemorySettingsStore(stored))
        await stack.service.start()

        await stack.service.updateAccount(accountId: "acct-1", authorizationVersion: 6, serverConsent: "unset", churches: [grace])

        #expect(await stack.service.currentSettings().enabled)
        #expect(await stack.location.regions.count == 1)
    }

    @Test("a cached bootstrap cannot erase the stored choice before launch restoration")
    func staleLoadBeforeStart() async {
        let stack = AttendanceStack.make(settingsStore: MemorySettingsStore(stored))

        // This is the real app launch race: RootModel may adopt its cached
        // bootstrap before AppDependencies' startup task calls start(). The
        // cached profile predates the consent grant saved in the Keychain.
        await stack.service.updateAccount(
            accountId: "acct-1",
            authorizationVersion: 6,
            serverConsent: "unset",
            churches: [grace]
        )
        await stack.service.start()

        #expect(await stack.service.currentSettings().enabled)
        #expect(await stack.settingsStore.stored?.settings.enabled == true)
        #expect(await stack.location.regions.count == 1)
    }

    @Test("joining a church starts watching it")
    func joiningAChurch() async {
        let stack = AttendanceStack.make(
            states: ["grace": .available(churchConfiguration("grace")), "hope": .available(churchConfiguration("hope"))],
            settingsStore: MemorySettingsStore(stored)
        )
        await stack.service.start()
        await stack.service.updateAccount(accountId: "acct-1", authorizationVersion: 7, serverConsent: "granted", churches: [grace, hope])
        #expect(await stack.location.regions.count == 2)
    }

    @Test("signing out removes regions, arrivals, notifications and the stored choice")
    func signOut() async {
        let submitter = ScriptedSubmitter()
        await submitter.set(answers: [.success(pendingUntil(journeyStart.addingTimeInterval(120)))])
        let stack = AttendanceStack.make(submitter: submitter, settingsStore: MemorySettingsStore(stored))
        await stack.service.start()
        await stack.service.handleRegion(identifier: "faithform.campus.grace-main", transition: .entered)
        #expect(await stack.store.count() == 1)

        await stack.service.signedOut()

        #expect(await stack.location.regions.isEmpty)
        #expect(await stack.store.count() == 0)
        #expect(await stack.notifier.cancelAllCount >= 1)
        #expect(await stack.settingsStore.stored == nil)
        // And a region event arriving afterwards does nothing at all.
        await stack.service.handleRegion(identifier: "faithform.campus.grace-main", transition: .entered)
        #expect(await submitter.sent.count == 1)
    }

    @Test("a different person on the phone never inherits the previous one's watching")
    func accountSwitch() async {
        let stack = AttendanceStack.make(settingsStore: MemorySettingsStore(stored))
        await stack.service.start()
        #expect(await stack.location.regions.count == 1)

        await stack.service.updateAccount(accountId: "acct-2", authorizationVersion: 1, serverConsent: "granted", churches: [grace])

        #expect(await stack.location.regions.isEmpty)
        #expect(await stack.service.currentSettings().enabled == false)
    }

    @Test("what is stored holds no position, no region and no history")
    func storedShape() throws {
        let data = try JSONEncoder().encode(stored)
        let text = String(decoding: data, as: UTF8.self).lowercased()
        for forbidden in ["latitude", "longitude", "region", "accuracy", "occurrence", "detection"] {
            #expect(!text.contains(forbidden), "stored settings carry \(forbidden)")
        }
    }

    @Test("an attempt written by an earlier build still decodes")
    func olderAttemptDecodes() throws {
        let old = """
        {"attemptId":"abc","churchSlug":"grace","occurrenceId":"occ-1","openedAt":0,"expiresAt":7200,"detectionId":"det-1","confirmationNotBefore":120}
        """
        let attempt = try JSONDecoder().decode(LogicalAttempt.self, from: Data(old.utf8))
        #expect(attempt.mode == nil)
        // An earlier build only ever ran the confirmation flow, so it still
        // needs the person's yes.
        #expect(attempt.needsPersonConfirmation)
    }
}

// ---------------------------------------------------------------------------
// Notifications and the request body
// ---------------------------------------------------------------------------

@Suite("Attendance notifications and request")
struct NotificationAndRequestTests {
    private let payload = AttendanceNotificationContent.userInfo(churchSlug: "grace")

    @Test("a notification response becomes exactly one intent")
    func parsing() {
        typealias C = AttendanceNotificationContent
        #expect(C.action(actionIdentifier: C.checkInAction, categoryIdentifier: C.arrivalCategory, userInfo: payload) == .checkIn(churchSlug: "grace", opensApp: false))
        #expect(C.action(actionIdentifier: C.systemDefaultAction, categoryIdentifier: C.arrivalCategory, userInfo: payload) == .checkIn(churchSlug: "grace", opensApp: true))
        #expect(C.action(actionIdentifier: C.notNowAction, categoryIdentifier: C.arrivalCategory, userInfo: payload) == .notNow(churchSlug: "grace"))
        #expect(C.action(actionIdentifier: C.systemDefaultAction, categoryIdentifier: C.resultCategory, userInfo: payload) == .open(churchSlug: "grace"))
        // A swipe decides nothing, and nothing that is not ours is acted on.
        #expect(C.action(actionIdentifier: C.systemDismissAction, categoryIdentifier: C.arrivalCategory, userInfo: payload) == nil)
        #expect(C.action(actionIdentifier: C.checkInAction, categoryIdentifier: "someone.else", userInfo: payload) == nil)
        #expect(C.action(actionIdentifier: C.checkInAction, categoryIdentifier: C.arrivalCategory, userInfo: [:]) == nil)
        // The result notification has no button that could check anyone in.
        #expect(C.action(actionIdentifier: C.checkInAction, categoryIdentifier: C.resultCategory, userInfo: payload) == nil)
    }

    @Test("the payload names a church and nothing else")
    func payloadShape() {
        #expect(payload == ["faithform": ["attendanceChurch": "grace"]])
    }

    @Test("the question and the answer name the church")
    func copy() {
        #expect(AttendanceNotificationContent.arrivalTitle(churchName: "Grace Community") == "Are you at Grace Community?")
        #expect(AttendanceNotificationContent.arrivalBody == "Tap to check in.")
        #expect(AttendanceNotificationContent.checkedInTitle(churchName: "Grace Community") == "You're checked in at Grace Community")
        #expect(AttendanceNotificationContent.arrivalTitle(churchName: "  ") == "Are you at your church?")
    }

    @Test("a geofence attempt sends exactly the observation, and nothing about the person")
    func requestBody() throws {
        let detected = AttendanceEvidence.from(
            occurrenceId: "occ-1",
            phase: "detected",
            sample: LocationSample(latitude: 38.2527, longitude: -85.7585, horizontalAccuracyMeters: 12, capturedAt: journeyStart),
            dwellSeconds: 0,
            observedAt: journeyStart,
            attemptId: "a1b2",
            regionId: "faithform.campus.grace-main",
            configVersion: 7003
        )
        let json = try JSONSerialization.jsonObject(with: JSONEncoder.faithform.encode(GeofenceAttemptBody(detected))) as? [String: Any]
        let keys = Set(json?.keys.map { $0 } ?? [])
        #expect(keys == [
            "occurrenceId", "source", "phase", "observedAt", "accuracyMeters", "dwellSeconds",
            "latitude", "longitude", "attemptId", "regionId", "configVersion",
        ])
        #expect(json?["source"] as? String == "geofence")
        for forbidden in ["accountId", "memberId", "churchId", "churchSlug", "distance", "result", "mockLocationReported", "detectionId"] {
            #expect(json?[forbidden] == nil, "the request carries \(forbidden)")
        }

        // No fix: the coordinates are absent, not null, so the server bands it
        // unknown.
        let blind = AttendanceEvidence.from(occurrenceId: "occ-1", phase: "confirm", sample: nil, dwellSeconds: 130, observedAt: journeyStart, detectionId: "det-1")
        let blindJSON = try JSONSerialization.jsonObject(with: JSONEncoder.faithform.encode(GeofenceAttemptBody(blind))) as? [String: Any]
        #expect(blindJSON?["latitude"] == nil)
        #expect(blindJSON?["accuracyMeters"] == nil)
        #expect(blindJSON?["detectionId"] as? String == "det-1")
        #expect(blindJSON?["attemptId"] == nil)
    }

    @Test("a queued submission carries only the identity its own command reads")
    func queuedIdentity() {
        let queued = QueuedSubmission(kind: "confirm", observedAt: journeyStart, accuracyMeters: 10, dwellSeconds: 130, latitude: 1, longitude: 1)
        let evidence = queued.evidence(occurrenceId: "occ-1", attemptId: "a1", detectionId: "det-1", regionId: "r", configVersion: 1)
        #expect(evidence.detectionId == "det-1")
        #expect(evidence.attemptId == nil)
        let detected = QueuedSubmission(kind: "detected", observedAt: journeyStart, accuracyMeters: nil, dwellSeconds: 0, latitude: nil, longitude: nil)
            .evidence(occurrenceId: "occ-1", attemptId: "a1", detectionId: "det-1")
        #expect(detected.attemptId == "a1")
        #expect(detected.detectionId == nil)
    }
}

// ---------------------------------------------------------------------------
// The configuration route
// ---------------------------------------------------------------------------

private actor StaticTokens: TokenProviding {
    func validAccessToken() async throws -> String { "token" }
    func invalidate() async {}
}

@Suite("Attendance routes")
struct AttendanceRouteTests {
    private func envelope(_ data: String) -> Data {
        Data("""
        {"ok":true,"data":\(data),"meta":{"apiVersion":"1.0","apiMajor":1,"requestId":"r","minimumSupportedClientBuild":1}}
        """.utf8)
    }

    private func client(_ transport: StubTransport) -> APIClient {
        APIClient(
            configuration: APIClient.Configuration(
                environment: APIEnvironment(key: "test", baseURL: URL(string: "https://example.test")!),
                clientBuild: 1
            ),
            transport: transport,
            tokens: StaticTokens()
        )
    }

    private let configJSON = """
    {"configuration":{"churchSlug":"grace","regions":[{"regionId":"faithform.campus.a","campusName":"Main","latitude":38.25,"longitude":-85.75,"radiusMeters":150}],"windows":[],"sources":{"geofence":true,"qr":true,"manual":true},"requiresConfirmation":true,"minDwellSeconds":120,"maxLocationAccuracyM":100,"configVersion":7003,"expiresAt":"2027-01-15T08:15:00Z"},"refusalReason":null,"message":null}
    """

    @Test("a live configuration is served from memory, and a region event revalidates it")
    func configurationCache() async {
        let transport = StubTransport([
            .init(status: 200, body: envelope(configJSON), headers: ["ETag": "\"v1\""]),
            .init(status: 304, body: Data(), headers: ["ETag": "\"v1\""]),
        ])
        let source = APIGeofenceConfigurationSource(api: client(transport))
        let now = Date(timeIntervalSince1970: 1_800_000_000)

        guard case .available = await source.currentConfiguration(churchSlug: "grace", partition: partition("grace"), now: now, forceRefresh: false) else {
            Issue.record("no configuration")
            return
        }
        _ = await source.currentConfiguration(churchSlug: "grace", partition: partition("grace"), now: now, forceRefresh: false)
        #expect(await transport.requestCount() == 1)

        let forced = await source.currentConfiguration(churchSlug: "grace", partition: partition("grace"), now: now, forceRefresh: true)
        #expect(await transport.requestCount() == 2)
        #expect(await transport.header("If-None-Match", at: 1) == "\"v1\"")
        if case .available = forced {} else { Issue.record("a 304 lost the configuration") }
    }

    @Test("a refusal is remembered briefly, and never survives a forced refresh")
    func refusalCache() async {
        let refusal = #"{"configuration":null,"refusalReason":"no_people_link","message":"x"}"#
        let transport = StubTransport([
            .init(status: 200, body: envelope(refusal)),
            .init(status: 200, body: envelope(configJSON)),
        ])
        let source = APIGeofenceConfigurationSource(api: client(transport))
        let now = Date(timeIntervalSince1970: 1_800_000_000)

        #expect(await source.currentConfiguration(churchSlug: "hope", partition: partition("hope"), now: now, forceRefresh: false) == .refused("no_people_link"))
        #expect(await source.currentConfiguration(churchSlug: "hope", partition: partition("hope"), now: now.addingTimeInterval(60), forceRefresh: false) == .refused("no_people_link"))
        #expect(await transport.requestCount() == 1)

        if case .available = await source.currentConfiguration(churchSlug: "hope", partition: partition("hope"), now: now.addingTimeInterval(60), forceRefresh: true) {} else {
            Issue.record("a forced refresh returned the remembered refusal")
        }
    }

    @Test("offline with nothing live is unavailable, never a stale copy")
    func offline() async {
        let transport = StubTransport([])
        let source = APIGeofenceConfigurationSource(api: client(transport))
        #expect(await source.currentConfiguration(churchSlug: "grace", partition: partition("grace"), now: journeyStart, forceRefresh: true) == .unavailable)
    }

    @Test("the attempt goes to the attempt route with its idempotency key")
    func attemptRoute() async throws {
        let transport = StubTransport([
            .init(status: 200, body: envelope(#"{"outcome":"pending_confirmation","message":"m","occurrenceId":"occ-1","countedAt":null,"confirmationNotBefore":"2027-01-15T08:02:00Z","detectionId":"det-1"}"#)),
            .init(status: 200, body: envelope(#"{"occurrenceId":"occ-1","isCounted":true,"status":"active","source":"geofence","countedAt":"2027-01-15T08:03:00Z"}"#)),
        ])
        let submitter = APIAttendanceSubmitter(api: client(transport))
        let evidence = AttendanceEvidence.from(occurrenceId: "occ-1", phase: "detected", sample: nil, dwellSeconds: 0, observedAt: journeyStart, attemptId: "a1")

        let result = try await submitter.submit(evidence, idempotencyKey: "gf-key")

        #expect(result.detectionId == "det-1")
        #expect(await transport.header("Idempotency-Key", at: 0) == "gf-key")
        let request = await transport.received[0]
        #expect(request.url?.path == "/api/mobile/v1/attendance/attempt")
        #expect(await submitter.isCounted(occurrenceId: "occ-1") == true)
    }
}

// ---------------------------------------------------------------------------
// Arrival policy
// ---------------------------------------------------------------------------

@Suite("Arrival policy")
struct ArrivalPolicyTests {
    @Test("the church's requiresConfirmation decides who says yes")
    func mode() {
        #expect(ArrivalPolicy.mode(for: churchConfiguration("g", requiresConfirmation: true)) == .confirmation)
        #expect(ArrivalPolicy.mode(for: churchConfiguration("g", requiresConfirmation: false)) == .automatic)
    }

    @Test("windows: open, upcoming, and the next service to show")
    func windows() {
        let config = churchConfiguration("g", windows: [
            window("past", opensIn: -5 * 3600, closesIn: -3 * 3600),
            window("open", opensIn: -600, closesIn: 3600),
            window("next", opensIn: 3600, closesIn: 7200),
        ])
        #expect(ArrivalPolicy.openWindow(in: config, now: journeyStart)?.occurrenceId == "open")
        #expect(ArrivalPolicy.upcomingWindow(in: config, now: journeyStart)?.window.occurrenceId == "next")
        #expect(ArrivalPolicy.nextService(in: config, now: journeyStart)?.isOpen == true)
        #expect(ArrivalPolicy.priority(of: config, now: journeyStart) == 0)

        let later = churchConfiguration("g", windows: [window("next", opensIn: 3600)])
        #expect(ArrivalPolicy.nextService(in: later, now: journeyStart)?.isOpen == false)
        #expect(ArrivalPolicy.priority(of: later, now: journeyStart) == 3600)
        #expect(ArrivalPolicy.priority(of: churchConfiguration("g"), now: journeyStart) == .infinity)
    }

    @Test("an early automatic arrival waits for both the window and the dwell")
    func earlyAutomatic() {
        let soon = churchConfiguration("g", windows: [window("w", opensIn: 30)], requiresConfirmation: false, minDwellSeconds: 120)
        #expect(ArrivalPolicy.earlyArrival(in: soon, now: journeyStart)?.notBefore == journeyStart.addingTimeInterval(120))
        let later = churchConfiguration("g", windows: [window("w", opensIn: 1800)], requiresConfirmation: false, minDwellSeconds: 120)
        #expect(ArrivalPolicy.earlyArrival(in: later, now: journeyStart)?.notBefore == journeyStart.addingTimeInterval(1800))
    }

    @Test("a pending arrival offers Check in only when it is due and still needs a yes")
    func canConfirm() {
        let due = PendingArrival(churchSlug: "g", churchName: nil, occurrenceId: "o", mode: .confirmation, promptAt: journeyStart, needsPersonConfirmation: true, isQueued: false)
        #expect(due.canConfirm(now: journeyStart))
        #expect(!due.canConfirm(now: journeyStart.addingTimeInterval(-1)))
        let automatic = PendingArrival(churchSlug: "g", churchName: nil, occurrenceId: "o", mode: .automatic, promptAt: journeyStart, needsPersonConfirmation: false, isQueued: false)
        #expect(!automatic.canConfirm(now: journeyStart))
    }
}
