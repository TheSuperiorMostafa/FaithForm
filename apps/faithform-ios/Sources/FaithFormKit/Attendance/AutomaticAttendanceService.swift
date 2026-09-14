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

    public init(
        settings: AutomaticAttendanceSettings,
        isSignedIn: Bool,
        outcome: ReconcileOutcome,
        pending: [PendingArrival]
    ) {
        self.settings = settings
        self.isSignedIn = isSignedIn
        self.outcome = outcome
        self.pending = pending
    }
}

/// Whether any church could use automatic check-in, asked before a single
/// location prompt is raised.
public enum AttendanceEligibility: Equatable, Sendable {
    /// At least one church offers it to this account.
    case available
    /// None does. The reason is the first church's.
    case refused(String)
    /// It could not be found out. Setup continues rather than giving up on a
    /// dropped connection.
    case unknown
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
        }
        await changed()
    }

    /// The app came to the foreground.
    public func foreground() async {
        guard settings.enabled, account != nil else { return }
        await coordinator.reconcile(trigger: .foreground)
        await coordinator.determineRegionStates()
        await coordinator.resumePending()
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
        guard let account, !settings.churches.isEmpty else { return .refused("not_enrolled") }
        let states = await reconciler.preflight(
            partition: account.partition,
            churchSlugs: settings.churches.map(\.slug)
        )
        if states.values.contains(where: { if case .available = $0 { return true } else { return false } }) {
            return .available
        }
        if states.values.contains(.unavailable) { return .unknown }
        let first = settings.churches.map(\.slug).sorted().compactMap { slug -> String? in
            if case .refused(let reason) = states[slug] { return reason }
            return nil
        }.first
        return .refused(first ?? "not_enrolled")
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
            pending: settings.enabled ? await coordinator.pendingArrivals() : []
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
