import Foundation

/// Who automatic check-in is running for, as this device last knew.
public struct AttendanceAccount: Codable, Equatable, Sendable {
    public let environment: String
    public let accountId: String
    public let authorizationVersion: Int

    public init(environment: String, accountId: String, authorizationVersion: Int) {
        self.environment = environment
        self.accountId = accountId
        self.authorizationVersion = authorizationVersion
    }

    /// The partition everything is scoped to. Its church is filled in per
    /// church by the coordinator.
    var partition: CachePartition {
        CachePartition(
            environment: environment,
            accountId: accountId,
            churchSlug: nil,
            authorizationVersion: authorizationVersion
        )
    }
}

/// What survives a relaunch: whose it is, and the person's choice.
///
/// **Why it is stored at all.** iOS relaunches the app in the background for a
/// region event with no screen and no network call made yet. Without the
/// account and the list of churches on disk, that relaunch could not act — and
/// a relaunch that cannot act is an arrival lost. It holds no position, no
/// region and no history.
public struct StoredAutomaticAttendance: Codable, Equatable, Sendable {
    public var account: AttendanceAccount
    public var settings: AutomaticAttendanceSettings

    public init(account: AttendanceAccount, settings: AutomaticAttendanceSettings) {
        self.account = account
        self.settings = settings
    }
}

public protocol AutomaticAttendanceSettingsStoring: Actor {
    func load(environment: String) async -> StoredAutomaticAttendance?
    func save(_ stored: StoredAutomaticAttendance) async
    func clear(environment: String) async
}

/// The settings, in the Keychain beside the session.
///
/// Sign-out's `deleteAll` sweeps it with everything else, and
/// `AfterFirstUnlockThisDeviceOnly` makes it readable on a background relaunch
/// of a locked phone — which is exactly when a region event arrives.
public actor KeychainAutomaticAttendanceSettingsStore: AutomaticAttendanceSettingsStoring {
    private let secureStore: any SecureStoring
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    public init(secureStore: any SecureStoring) {
        self.secureStore = secureStore
    }

    private func key(_ environment: String) -> String {
        "faithform.attendance.settings.\(environment)"
    }

    public func load(environment: String) async -> StoredAutomaticAttendance? {
        guard let data = (try? secureStore.read(key(environment))) ?? nil else { return nil }
        return try? decoder.decode(StoredAutomaticAttendance.self, from: data)
    }

    public func save(_ stored: StoredAutomaticAttendance) async {
        guard let data = try? encoder.encode(stored) else { return }
        try? secureStore.write(data, for: key(stored.account.environment))
    }

    public func clear(environment: String) async {
        try? secureStore.delete(key(environment))
    }
}

/// Everything the status screen shows, read in one go.
public struct AutomaticAttendanceSnapshot: Equatable, Sendable {
    public let settings: AutomaticAttendanceSettings
    public let isSignedIn: Bool
    public let outcome: ReconcileOutcome
    public let pending: [PendingArrival]
    public let activity: EvidencePhase
    public let activityChurchSlug: String?

    public init(
        settings: AutomaticAttendanceSettings,
        isSignedIn: Bool,
        outcome: ReconcileOutcome,
        pending: [PendingArrival],
        activity: EvidencePhase = .idle,
        activityChurchSlug: String? = nil
    ) {
        self.settings = settings
        self.isSignedIn = isSignedIn
        self.outcome = outcome
        self.pending = pending
        self.activity = activity
        self.activityChurchSlug = activityChurchSlug
    }
}

/// Whether any church could use automatic check-in, asked before a single
/// location prompt is raised.
public enum AttendanceEligibility: Equatable, Sendable {
    /// At least one church offers it to this account.
    case available
    /// None does. The reason is one church's — see `AttendanceEligibilityReport`
    /// for which.
    case refused(String)
    /// It could not be found out. Setup continues rather than giving up on a
    /// dropped connection.
    case unknown
}

/// Eligibility, and the church a refusal came from.
///
/// A person can belong to several churches and each answers for itself, so a
/// refusal on its own ("your church has not added a location") was ambiguous —
/// and was routinely about the wrong one.
public struct AttendanceEligibilityReport: Equatable, Sendable {
    public let eligibility: AttendanceEligibility
    /// The church whose answer `eligibility` is. Nil unless it is a refusal.
    public let church: AttendanceChurch?

    public init(eligibility: AttendanceEligibility, church: AttendanceChurch? = nil) {
        self.eligibility = eligibility
        self.church = church
    }
}

/// The app's one way into automatic check-in.
///
/// Every lifecycle moment — launch, a background relaunch for a region event,
/// foreground, a loaded account, a church joined or left, a permission changed
/// in Settings, a tap on a notification, sign-out — calls one method here.
/// It persists the person's choice, binds the coordinator to the right account
/// and churches, and funnels everything else to it.
///
/// Holds no framework type, so every branch runs in `swift test`.
public actor AutomaticAttendanceService {
    private let coordinator: AutomaticAttendanceCoordinator
    private let reconciler: GeofenceReconciler
    private let settingsStore: any AutomaticAttendanceSettingsStoring
    private let environment: String

    private var account: AttendanceAccount?
    private var settings = AutomaticAttendanceSettings()
    private var started = false
    private var prepared = false
    private var foregroundTicks = 0
    private var onChange: (@Sendable () async -> Void)?

    public init(
        coordinator: AutomaticAttendanceCoordinator,
        reconciler: GeofenceReconciler,
        settingsStore: any AutomaticAttendanceSettingsStoring,
        environment: String
    ) {
        self.coordinator = coordinator
        self.reconciler = reconciler
        self.settingsStore = settingsStore
        self.environment = environment
    }

    /// Told after anything the status screen shows may have changed.
    public func setChangeHandler(_ handler: @escaping @Sendable () async -> Void) {
        onChange = handler
    }

    public func currentSettings() -> AutomaticAttendanceSettings { settings }

    // MARK: - Lifecycle

    /// Launch, including a background relaunch for a region event.
    ///
    /// Acts on what this device last knew, before any account has loaded. With
    /// nothing stored — never turned on, or signed out — every monitored region
    /// is removed: failing closed, so a region left behind by a crash cannot
    /// wake an app that has no business acting on it.
    public func start() async {
        guard !started else { return }
        started = true
        await prepare()

        guard account != nil else {
            await coordinator.reconcile(trigger: .teardown)
            return
        }
        guard settings.enabled else {
            await coordinator.reconcile(trigger: .teardown)
            return
        }
        await coordinator.reconcile(trigger: .launch)
        await coordinator.determineRegionStates()
        await coordinator.resumePending()
        await changed()
    }

    /// Reads what this device last knew and binds to it — nothing more, and no
    /// network. The app calls this before it attaches the region handler, so a
    /// region event that relaunched the app is judged against the stored choice
    /// rather than against "off".
    public func prepare() async {
        guard !prepared else { return }
        prepared = true
        guard account == nil, let stored = await settingsStore.load(environment: environment) else { return }
        account = stored.account
        settings = stored.settings
        await bindCoordinator()
    }

    /// After every account load: who is signed in, the churches they have a
    /// relationship with, and what the server says about consent.
    public func updateAccount(
        accountId: String,
        authorizationVersion: Int,
        serverConsent: String,
        churches: [AttendanceChurch]
    ) async {
        // RootModel can publish a cached bootstrap immediately while the app's
        // launch task is still restoring this service from the Keychain. Make
        // the ordering deterministic here, at the actor boundary: otherwise
        // that cached (and commonly older) bootstrap can create an account
        // from the default `enabled = false` settings before `prepare()` runs.
        // `prepare()` would then see an account and skip the stored enabled
        // choice, making automatic check-in appear to turn itself off after a
        // relaunch. It is idempotent, so every account update can safely make
        // restoration its first operation.
        await prepare()

        if let account, account.accountId != accountId {
            // A different person on this phone. Nothing of the previous one's
            // may keep running.
            await coordinator.disable()
            settings = AutomaticAttendanceSettings()
        }

        if let account, account.accountId == accountId, authorizationVersion < account.authorizationVersion {
            // An account load that started before a consent change finished
            // after it. Its consent and version are older than what this device
            // already holds from the server, and acting on them would switch
            // off what the person just switched on.
            return
        }

        let previousChurches = Set(settings.churches.map(\.slug))
        let versionChanged = account?.authorizationVersion != authorizationVersion

        account = AttendanceAccount(
            environment: environment,
            accountId: accountId,
            authorizationVersion: authorizationVersion
        )
        settings.churches = Self.unique(churches)
        settings.serverConsent = serverConsent

        if settings.enabled, serverConsent != "granted" {
            // Withdrawn somewhere else — the website, another phone. This
            // device stops too, rather than watching for attempts the server
            // will refuse.
            await bindCoordinator()
            await coordinator.disable()
            settings.enabled = false
        }

        await persist()
        await bindCoordinator()

        if settings.enabled {
            let trigger: ReconcileTrigger
            if versionChanged {
                trigger = .authorizationVersionChanged
            } else if previousChurches != Set(settings.churches.map(\.slug)) {
                trigger = .churchChanged
            } else {
                trigger = .accountChanged
            }
            await coordinator.reconcile(trigger: trigger)
            await coordinator.determineRegionStates()
            await coordinator.resumePending()
        }
        await changed()
    }

    /// The app came to the foreground.
    public func foreground() async {
        foregroundTicks = 0
        guard settings.enabled, account != nil else { return }
        await coordinator.reconcile(trigger: .foreground)
        await coordinator.determineRegionStates()
        await coordinator.resumePending()
        await changed()
    }

    /// Work due while any app screen is visible, including Home. The caller
    /// owns cancellation when the scene backgrounds; this is not a background timer.
    public func foregroundTick() async {
        guard settings.enabled, account != nil else { return }
        await coordinator.resumePending()
        foregroundTicks += 1
        if foregroundTicks >= 6 {
            foregroundTicks = 0
            switch await coordinator.currentPhase() {
            case .idle, .refused, .retrying, .holding:
                // Recover even when the first network/GPS failure happened
                // before there was an attempt to persist and resume.
                await coordinator.reconcile(trigger: .windowBoundary)
                await coordinator.determineRegionStates()
            default: break
            }
        }
        await changed()
    }

    /// The location permission changed, in a prompt or in Settings.
    public func permissionChanged() async {
        guard settings.enabled, account != nil else {
            await changed()
            return
        }
        await coordinator.reconcile(trigger: .permissionChanged)
        await coordinator.determineRegionStates()
        await changed()
    }

    /// Signed out, or the account was deleted. Everything goes: the regions,
    /// any arrival, every notification, and the stored choice.
    public func signedOut() async {
        await coordinator.disable()
        settings = AutomaticAttendanceSettings()
        account = nil
        await settingsStore.clear(environment: environment)
        await changed()
    }

    // MARK: - Events

    public func handleRegion(identifier: String, transition: RegionTransition) async {
        guard settings.enabled, account != nil else { return }
        switch transition {
        case .entered: _ = await coordinator.handleRegionEntered(regionId: identifier)
        case .exited: await coordinator.handleRegionExited(regionId: identifier)
        case .inside: await coordinator.handleRegionState(regionId: identifier, inside: true)
        case .outside: await coordinator.handleRegionState(regionId: identifier, inside: false)
        }
        await changed()
    }

    public func handleNotification(_ action: AttendanceNotificationAction) async {
        guard settings.enabled, account != nil else { return }
        switch action {
        case .checkIn(let church, _):
            _ = await coordinator.resumePending(confirmedBy: church)
        case .notNow(let church):
            await coordinator.declineArrival(churchSlug: church)
        case .open:
            break
        }
        await changed()
    }

    // MARK: - The person's choices

    /// Server consent was granted. Consent bumps the authorization version, so
    /// the account is re-keyed to the version the server returned.
    public func consentGranted(authorizationVersion: Int?) async {
        rekey(authorizationVersion)
        settings.serverConsent = "granted"
        await persist()
        await bindCoordinator()
    }

    /// Asks every church, without registering anything and without any
    /// location permission, whether automatic check-in is available to this
    /// account. Used between consent and the first prompt, so nobody is asked
    /// for their location all the time by a church that could not use it.
    public func eligibility() async -> AttendanceEligibility {
        await eligibilityReport(preferring: nil).eligibility
    }

    /// Whether any church offers automatic check-in to this account, and when
    /// none does, which church's answer to show.
    ///
    /// Every church the account can read is asked, and one that offers it is
    /// enough. When all of them refuse, the answer shown is the preferred
    /// church's — the one on screen — if it refused, and otherwise the first by
    /// web address. The first by address alone told people *their* church had
    /// "no location" when the church without one was a test church or one they
    /// merely followed.
    public func eligibilityReport(preferring churchSlug: String?) async -> AttendanceEligibilityReport {
        guard let account, !settings.churches.isEmpty else {
            return AttendanceEligibilityReport(eligibility: .refused("not_enrolled"))
        }
        let states = await reconciler.preflight(
            partition: account.partition,
            churchSlugs: settings.churches.map(\.slug)
        )
        if states.values.contains(where: { if case .available = $0 { return true } else { return false } }) {
            return AttendanceEligibilityReport(eligibility: .available)
        }
        if states.values.contains(.unavailable) {
            return AttendanceEligibilityReport(eligibility: .unknown)
        }

        let byAddress = settings.churches.sorted { $0.slug < $1.slug }
        let ordered = byAddress.filter { $0.slug == churchSlug } + byAddress.filter { $0.slug != churchSlug }
        for church in ordered {
            if case .refused(let reason) = states[church.slug] {
                return AttendanceEligibilityReport(eligibility: .refused(reason), church: church)
            }
        }
        return AttendanceEligibilityReport(eligibility: .refused("not_enrolled"))
    }

    /// Turns automatic check-in on on this device. Consent must already be
    /// granted; the OS permission may or may not be — the status screen says
    /// which.
    @discardableResult
    public func enable() async -> ReconcileOutcome {
        guard account != nil else { return .idle }
        settings.enabled = true
        await persist()
        await bindCoordinator()
        let outcome = await coordinator.enable(settings: settings)
        await changed()
        return outcome
    }

    /// Turns it off on this device: regions, arrivals and notifications, before
    /// anything is asked of the network.
    public func disable() async {
        await coordinator.disable()
        settings.enabled = false
        await persist()
        await changed()
    }

    /// Records the version a consent withdrawal returned.
    public func consentWithdrawn(authorizationVersion: Int?) async {
        rekey(authorizationVersion)
        settings.serverConsent = "revoked"
        settings.enabled = false
        await persist()
        await bindCoordinator()
        await changed()
    }

    /// The in-app "Check in" button.
    @discardableResult
    public func confirmArrival(churchSlug: String) async -> EvidencePhase {
        let phase = await coordinator.resumePending(confirmedBy: churchSlug)
        await changed()
        return phase
    }

    /// The person said they are not there. Closes the arrival and cancels its
    /// scheduled question, so nothing buzzes about a place they have left.
    public func declineArrival(churchSlug: String) async {
        await coordinator.declineArrival(churchSlug: churchSlug)
        await changed()
    }

    /// Any opportunity the app itself has, such as the screen staying open
    /// until a confirmation is due.
    @discardableResult
    public func resume() async -> EvidencePhase {
        let phase = await coordinator.resumePending()
        await changed()
        return phase
    }

    // MARK: - Reading

    public func snapshot() async -> AutomaticAttendanceSnapshot {
        AutomaticAttendanceSnapshot(
            settings: settings,
            isSignedIn: account != nil,
            outcome: await coordinator.lastReconcileOutcome(),
            pending: settings.enabled ? await coordinator.pendingArrivals() : [],
            activity: await coordinator.currentPhase(),
            activityChurchSlug: await coordinator.currentActivityChurch()
        )
    }

    public func configuration(forChurch slug: String) async -> GeofenceConfiguration? {
        await coordinator.configuration(forChurch: slug)
    }

    // MARK: -

    private func rekey(_ authorizationVersion: Int?) {
        guard let authorizationVersion, let current = account else { return }
        account = AttendanceAccount(
            environment: current.environment,
            accountId: current.accountId,
            authorizationVersion: authorizationVersion
        )
    }

    private func bindCoordinator() async {
        guard let account else { return }
        await coordinator.bind(
            partition: account.partition,
            accountId: account.accountId,
            settings: settings
        )
    }

    private func persist() async {
        guard let account else { return }
        await settingsStore.save(StoredAutomaticAttendance(account: account, settings: settings))
    }

    private func changed() async {
        await onChange?()
    }

    private static func unique(_ churches: [AttendanceChurch]) -> [AttendanceChurch] {
        var seen = Set<String>()
        return churches.filter { seen.insert($0.slug).inserted }
    }
}
