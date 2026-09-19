import Foundation
import Observation

/// Where the automatic-attendance opt-in currently stands.
///
/// **Progressive by construction.** Each setup step is only reachable from the
/// one before, and every operating-system prompt sits behind an education step
/// that is a real state rather than a flag someone could forget to check.
///
/// This is why nothing here can prompt at launch: the model starts at
/// `.notStarted`, and only an explicit action moves it.
///
/// The order is the one the owner set and iOS requires: what it is → the
/// person's consent, recorded on the server → When In Use → Always →
/// notifications. Consent comes first so that, before a single prompt, the
/// app can ask whether any of the person's churches offers this at all.
public enum AutomaticAttendanceStep: Equatable, Sendable {
    /// Off, and nothing has been requested.
    case notStarted
    /// What automatic check-in is and what it does with location.
    case introduction
    /// Recording the person's consent, and asking whether a church offers it.
    case requestingConsent
    /// Why the app needs location, shown before the When In Use prompt.
    case foregroundEducation
    /// Why it needs Always, shown before the second prompt.
    case backgroundEducation
    /// Why it sends notifications, shown before that prompt.
    case notificationEducation
    /// On and watching.
    case ready
    /// A state the person can act on — or, where they cannot, an explanation.
    case blocked(AutomaticAttendanceBlocker)

    /// Whether this is part of the setup flow rather than a status.
    public var isSetup: Bool {
        switch self {
        case .introduction, .requestingConsent, .foregroundEducation,
             .backgroundEducation, .notificationEducation:
            return true
        default:
            return false
        }
    }
}

/// Why automatic attendance is not currently working.
///
/// Each maps to different copy and a different action, which is the reason they
/// are distinct cases rather than one `failed(String)`. Telling someone to open
/// Settings when the real problem is that their church has not enabled the
/// feature would waste their time.
public enum AutomaticAttendanceBlocker: String, Equatable, Sendable, CaseIterable {
    /// The OS prompt was declined. Recoverable in Settings.
    case locationDenied
    /// Parental controls or an MDM profile. **Not** recoverable by this person.
    case locationRestricted
    /// Location services are off device-wide, for every app.
    case locationServicesOff
    /// When In Use granted, Always not. The feature cannot work.
    case needsAlwaysAuthorization
    /// Approximate location granted. Cannot resolve a campus-sized region.
    case reducedAccuracy
    /// This device cannot monitor regions.
    case monitoringUnavailable
    /// The church has not confirmed who this person is.
    case noPeopleLink
    /// Server consent is absent or withdrawn.
    case consentMissing
    /// The church has automatic attendance switched off.
    case churchDisabled
    /// The church has no campus with a position set.
    case noCampus
    /// Offline, or the configuration could not be fetched.
    case unavailable
    /// Turned on, but location was never asked for on this device — Settings
    /// was reset, or setup was left part-way. The next step is setup, not
    /// Settings.
    case locationNotRequested

    public var isRecoverableInSettings: Bool {
        switch self {
        case .locationDenied, .needsAlwaysAuthorization, .reducedAccuracy, .locationServicesOff:
            return true
        default:
            return false
        }
    }

    /// Whether finishing the in-app setup is the way forward.
    public var isRecoverableInSetup: Bool { self == .locationNotRequested }

    /// A server refusal, or a reconciler reason, in this vocabulary.
    public static func from(refusal: String) -> AutomaticAttendanceBlocker {
        switch refusal {
        case "no_people_link": return .noPeopleLink
        case "consent_required", "consent_revoked", "disabled": return .consentMissing
        case "geofence_disabled": return .churchDisabled
        case "no_campus_configured": return .noCampus
        case "location_unavailable", "monitoring_unavailable": return .monitoringUnavailable
        case "needs_always_authorization": return .needsAlwaysAuthorization
        case "needs_full_accuracy": return .reducedAccuracy
        case "not_enrolled", "blocked", "wrong_church": return .churchDisabled
        default: return .unavailable
        }
    }

    /// What the OS permission alone says, before anything else is considered.
    public static func from(
        authorization: LocationAuthorization,
        accuracy: LocationAccuracyAuthorization
    ) -> AutomaticAttendanceBlocker? {
        switch authorization {
        case .unavailable: return .locationServicesOff
        case .restricted: return .locationRestricted
        case .denied: return .locationDenied
        case .notDetermined: return .locationNotRequested
        case .authorizedWhenInUse: return .needsAlwaysAuthorization
        case .authorizedAlways: return accuracy == .full ? nil : .reducedAccuracy
        }
    }
}

/// The screen model for automatic attendance.
///
/// Holds no Core Location type and receives no provider callback: it is driven
/// by `AutomaticAttendanceService`, so every state below can be produced in a
/// test without a device.
@Observable
@MainActor
public final class AutomaticAttendanceModel {
    public private(set) var step: AutomaticAttendanceStep = .notStarted
    public private(set) var authorization: LocationAuthorization = .notDetermined
    public private(set) var accuracy: LocationAccuracyAuthorization = .full
    public private(set) var notificationStatus: NotificationAuthorization = .notDetermined
    public private(set) var isEnabled = false
    public private(set) var monitoredRegionCount = 0
    public private(set) var isWorking = false

    /// The churches being watched, by name.
    public private(set) var watchedChurchNames: [String] = []
    /// The church the screen is showing.
    public private(set) var selectedChurch: AttendanceChurch?
    /// Why the selected church is not being watched while others are.
    public private(set) var selectedChurchBlocker: AutomaticAttendanceBlocker?
    /// The church a blocked setup is about. Named on screen, because a person
    /// can belong to several churches and the refusal is one church's.
    public private(set) var blockedChurchName: String?
    /// The selected church's next service, from its configuration.
    public private(set) var nextService: UpcomingService?
    /// The last automatic check-in at the selected church, from the server's
    /// own attendance history. Never a local guess.
    public private(set) var lastCheckIn: RecentCheckIn?
    /// An arrival still waiting on a verdict — the selected church's first.
    public private(set) var pending: PendingArrival?

    public struct RecentCheckIn: Equatable, Sendable {
        public let occurrenceLabel: String
        public let countedAt: Date
        public let wasAlreadyCounted: Bool

        public init(occurrenceLabel: String, countedAt: Date, wasAlreadyCounted: Bool) {
            self.occurrenceLabel = occurrenceLabel
            self.countedAt = countedAt
            self.wasAlreadyCounted = wasAlreadyCounted
        }
    }

    public struct UpcomingService: Equatable, Sendable {
        public let label: String
        public let startsAt: Date?
        public let checkinOpensAt: Date?
        public let isOpen: Bool

        public init(label: String, startsAt: Date?, checkinOpensAt: Date?, isOpen: Bool) {
            self.label = label
            self.startsAt = startsAt
            self.checkinOpensAt = checkinOpensAt
            self.isOpen = isOpen
        }
    }

    /// Records consent server-side. Separate from the OS permission on purpose.
    public protocol ConsentWriting: Actor {
        func setAutoAttendanceConsent(_ value: String) async throws -> AttendanceConsentOutcome
    }

    private let service: AutomaticAttendanceService
    private let authorizer: any LocationAuthorizing
    private let consent: any ConsentWriting
    private let notifications: (any AttendanceNotifying)?
    private let history: (any AttendanceHistoryReading)?
    private let now: @Sendable () -> Date

    public init(
        service: AutomaticAttendanceService,
        authorizer: any LocationAuthorizing,
        consent: any ConsentWriting,
        notifications: (any AttendanceNotifying)? = nil,
        history: (any AttendanceHistoryReading)? = nil,
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.service = service
        self.authorizer = authorizer
        self.consent = consent
        self.notifications = notifications
        self.history = history
        self.now = now
    }

    // MARK: - Reading

    /// Reads current state without requesting anything.
    ///
    /// Safe to call on appear, on foreground, and after returning from
    /// Settings. It raises no prompt — that is the whole point, and it is what
    /// lets the status screen be shown anywhere.
    public func refresh() async {
        authorization = await authorizer.currentAuthorization()
        accuracy = await authorizer.currentAccuracy()
        if let notifications {
            notificationStatus = await notifications.authorizationStatus()
        }

        let snapshot = await service.snapshot()
        isEnabled = snapshot.settings.enabled
        monitoredRegionCount = snapshot.settings.enabled ? snapshot.outcome.monitoring : 0

        let refusals = snapshot.outcome.churchRefusals
        watchedChurchNames = snapshot.settings.enabled && snapshot.outcome.monitoring > 0
            ? snapshot.settings.churches
                .filter { refusals[$0.slug] == nil }
                .compactMap { $0.name?.isEmpty == false ? $0.name : nil }
            : []

        if let selected = selectedChurch {
            selectedChurchBlocker = snapshot.settings.enabled
                ? refusals[selected.slug].map(AutomaticAttendanceBlocker.from(refusal:))
                : nil
            pending = snapshot.pending.first { $0.churchSlug == selected.slug } ?? snapshot.pending.first
            nextService = await upcomingService(for: selected.slug)
        } else {
            selectedChurchBlocker = nil
            pending = snapshot.pending.first
            nextService = nil
        }

        // A step the person is in the middle of is theirs; only a status is
        // recomputed underneath them.
        guard !step.isSetup else { return }
        step = Self.resolveStep(
            settings: snapshot.settings,
            outcome: snapshot.outcome,
            authorization: authorization,
            accuracy: accuracy,
            previous: step
        )
        // The name belongs to the refusal it came with; once the screen has
        // moved on to another state, it no longer describes anything.
        if case .blocked = step {} else { blockedChurchName = nil }
    }

    /// The church the screen is about. Changes what "next service", "last
    /// check-in" and the per-church explanation refer to — never what is
    /// monitored.
    public func select(church: AttendanceChurch?) async {
        guard church != selectedChurch else { return }
        selectedChurch = church
        lastCheckIn = nil
        await refresh()
        await refreshHistory()
    }

    /// Reads the selected church's last automatic check-in from the server.
    public func refreshHistory() async {
        guard let history, let church = selectedChurch else {
            lastCheckIn = nil
            return
        }
        guard let items = try? await history.history(churchSlug: church.slug, limit: 20) else { return }
        lastCheckIn = Self.lastAutomatic(in: items)
    }

    // MARK: - Setup

    /// The person tapped "Turn on automatic check-in". Shows the explanation.
    /// **Does not prompt.**
    public func begin() {
        blockedChurchName = nil
        step = .introduction
    }

    /// They read what it does and continued: consent is recorded, then the
    /// churches are asked whether they offer it, and only then — if one does
    /// — does any permission prompt come near.
    public func acceptIntroduction() async {
        isWorking = true
        defer { isWorking = false }
        step = .requestingConsent

        do {
            let outcome = try await consent.setAutoAttendanceConsent("granted")
            guard outcome.state == "granted" else {
                step = .blocked(.consentMissing)
                return
            }
            await service.consentGranted(authorizationVersion: outcome.authorizationVersion)
        } catch {
            step = .blocked(.unavailable)
            return
        }

        authorization = await authorizer.currentAuthorization()
        // The church on screen answers first: its refusal is the one the
        // person is asking about.
        let report = await service.eligibilityReport(preferring: selectedChurch?.slug)
        switch report.eligibility {
        case .refused(let reason):
            // No church can use it. Consent that nothing can act on is
            // withdrawn again, and the person is told why — and by which
            // church — without a single location prompt having been raised.
            let withdrawn = try? await consent.setAutoAttendanceConsent("revoked")
            await service.consentWithdrawn(authorizationVersion: withdrawn?.authorizationVersion)
            await refresh()
            blockedChurchName = report.church?.name
            step = .blocked(AutomaticAttendanceBlocker.from(refusal: reason))
        case .available, .unknown:
            blockedChurchName = nil
            await advanceFromPermission()
        }
    }

    /// Kept for callers that step through the old order; the introduction is
    /// accepted here.
    public func continueToForegroundEducation() async {
        await acceptIntroduction()
    }

    /// They read the foreground explanation and agreed. The first point at
    /// which any OS prompt is raised.
    public func requestForegroundPermission() async {
        isWorking = true
        defer { isWorking = false }

        authorization = await authorizer.requestWhenInUse()

        switch authorization {
        case .authorizedWhenInUse, .authorizedAlways:
            // Never chain straight into the Always prompt. iOS shows it once,
            // and spending it before the person knows what it is for is how an
            // app gets permanently denied.
            step = .backgroundEducation
        case .notDetermined:
            step = .foregroundEducation
        case .denied, .restricted, .unavailable:
            // The person chose to turn it on and the device said no. It stays
            // on, blocked, with the way forward — Settings where Settings can
            // help, and "Turn off" either way.
            await finish()
        }
    }

    /// They read the Always explanation and agreed.
    public func requestBackgroundPermission() async {
        isWorking = true
        defer { isWorking = false }

        authorization = await authorizer.requestAlways()
        accuracy = await authorizer.currentAccuracy()

        guard authorization.permitsRegionMonitoring, accuracy == .full else {
            await finish()
            return
        }
        // Watching starts now, before notifications are even mentioned: the
        // permission it needs has been given, and a person who stops at the
        // next screen has still turned this on.
        monitoredRegionCount = await service.enable().monitoring
        await advanceToNotifications()
    }

    /// They read why notifications are sent, and agreed.
    public func requestNotificationPermission() async {
        isWorking = true
        defer { isWorking = false }
        if let notifications {
            notificationStatus = await notifications.requestAuthorization()
        }
        await finish()
    }

    /// "Not now", from whichever setup screen it was tapped on.
    ///
    /// Before any prompt it simply closes. After consent it withdraws the
    /// consent again — the person declined, and consent nothing uses is not
    /// kept. On the notification screen it only skips notifications: the
    /// location permission has already been given.
    public func notNow() async {
        switch step {
        case .introduction:
            step = .notStarted
        case .notificationEducation:
            isWorking = true
            defer { isWorking = false }
            await finish()
        case .foregroundEducation, .backgroundEducation:
            await disable()
        default:
            break
        }
    }

    /// Continues a setup that was left part-way.
    public func resumeSetup() async {
        authorization = await authorizer.currentAuthorization()
        await advanceFromPermission()
    }

    /// The person turned it off.
    ///
    /// Removes every region, cancels in-flight work, purges unsent evidence and
    /// withdraws every notification — then withdraws server consent. The local
    /// teardown comes first: whatever happens to the network call, this device
    /// stops watching.
    public func disable() async {
        isWorking = true
        defer { isWorking = false }

        await service.disable()
        monitoredRegionCount = 0
        pending = nil

        let withdrawn = try? await consent.setAutoAttendanceConsent("revoked")
        await service.consentWithdrawn(authorizationVersion: withdrawn?.authorizationVersion)
        step = .notStarted
        await refresh()
    }

    /// The in-app "Check in" button — the same yes as tapping the notification.
    public func confirmCheckIn() async {
        guard let pending else { return }
        isWorking = true
        defer { isWorking = false }
        let phase = await service.confirmArrival(churchSlug: pending.churchSlug)
        await refresh()
        if phase.isSuccess { await refreshHistory() }
    }

    /// While this screen is open and an arrival becomes due within a few
    /// minutes, wait for it here: an app on screen has execution time of its
    /// own, and spending it saves the person a second tap.
    ///
    /// Cancelled with the view that runs it. Never used for a closed app.
    public func holdOpenUntilDue(maximumWait: TimeInterval = 5 * 60) async {
        guard let pending, let promptAt = pending.promptAt else { return }
        let wait = promptAt.timeIntervalSince(now())
        guard wait > 0, wait <= maximumWait else { return }
        try? await Task.sleep(nanoseconds: UInt64((wait + 1) * 1_000_000_000))
        guard !Task.isCancelled else { return }
        let phase = await service.resume()
        await refresh()
        if phase.isSuccess { await refreshHistory() }
    }

    // MARK: - Steps

    private func advanceFromPermission() async {
        accuracy = await authorizer.currentAccuracy()
        switch authorization {
        case .notDetermined:
            step = .foregroundEducation
        case .authorizedWhenInUse:
            step = .backgroundEducation
        case .authorizedAlways:
            if accuracy == .full {
                await advanceToNotifications()
            } else {
                await finish()
            }
        case .denied, .restricted, .unavailable:
            await finish()
        }
    }

    private func advanceToNotifications() async {
        if let notifications {
            notificationStatus = await notifications.authorizationStatus()
            if notificationStatus == .notDetermined {
                step = .notificationEducation
                return
            }
        }
        await finish()
    }

    /// Consent is recorded and the permissions are whatever the person chose.
    /// Turns the feature on and shows where it stands.
    private func finish() async {
        let outcome = await service.enable()
        monitoredRegionCount = outcome.monitoring
        step = .ready
        let snapshot = await service.snapshot()
        authorization = await authorizer.currentAuthorization()
        accuracy = await authorizer.currentAccuracy()
        step = Self.resolveStep(
            settings: snapshot.settings,
            outcome: outcome,
            authorization: authorization,
            accuracy: accuracy,
            previous: .ready
        )
        await refresh()
    }

    /// Every status the screen can be in, from the facts alone.
    ///
    /// The device's permission outranks the server's configuration, because
    /// there is no point explaining a church's settings to someone whose phone
    /// cannot deliver an event at all.
    nonisolated public static func resolveStep(
        settings: AutomaticAttendanceSettings,
        outcome: ReconcileOutcome,
        authorization: LocationAuthorization,
        accuracy: LocationAccuracyAuthorization,
        previous: AutomaticAttendanceStep = .notStarted
    ) -> AutomaticAttendanceStep {
        guard settings.enabled else {
            // Off. A refusal shown after setup found no church that offers it
            // stays on screen until the person moves on.
            if case .blocked(let blocker) = previous,
               [.noPeopleLink, .churchDisabled, .noCampus, .consentMissing, .unavailable].contains(blocker) {
                return previous
            }
            return .notStarted
        }

        if let blocker = AutomaticAttendanceBlocker.from(authorization: authorization, accuracy: accuracy) {
            return .blocked(blocker)
        }
        if settings.serverConsent != "granted" { return .blocked(.consentMissing) }

        switch outcome.refusal {
        case nil:
            return .ready
        case "configuration_unavailable":
            // Offline. What was already registered is still watching, so this
            // is only worth mentioning when nothing is.
            return outcome.monitoring > 0 ? .ready : .blocked(.unavailable)
        case "disabled":
            // Nothing reconciled yet this launch.
            return .ready
        case .some(let refusal):
            return .blocked(AutomaticAttendanceBlocker.from(refusal: refusal))
        }
    }

    /// The most recent automatic, still-standing check-in.
    nonisolated public static func lastAutomatic(in items: [AttendanceHistoryItem]) -> RecentCheckIn? {
        items
            .filter { $0.source == .geofence && $0.status == "active" }
            .compactMap { item -> RecentCheckIn? in
                guard let countedAt = FaithFormInstant.parse(item.countedAt) else { return nil }
                return RecentCheckIn(occurrenceLabel: item.label, countedAt: countedAt, wasAlreadyCounted: false)
            }
            .max { $0.countedAt < $1.countedAt }
    }

    private func upcomingService(for slug: String) async -> UpcomingService? {
        guard let configuration = await service.configuration(forChurch: slug),
              let next = ArrivalPolicy.nextService(in: configuration, now: now())
        else { return nil }
        return UpcomingService(
            label: next.window.label,
            startsAt: FaithFormInstant.parse(next.window.startsAt),
            checkinOpensAt: FaithFormInstant.parse(next.window.checkinOpensAt),
            isOpen: next.isOpen
        )
    }
}
