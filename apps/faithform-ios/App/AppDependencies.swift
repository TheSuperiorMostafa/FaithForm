import Foundation
import UIKit
import UserNotifications
import FaithFormKit

/// The object graph, built once at launch.
///
/// No dependency-injection framework and no global accessor: everything is
/// constructed here, from the environment, and handed down. That is what makes
/// the environment a build-time fact rather than something a screen can reach
/// around and change.
@MainActor
final class AppDependencies {
    let environment: APIEnvironment
    let api: APIClient
    let cache: PartitionedCache
    let snapshots: AccountSnapshotStore
    let session: SessionManager
    let media: MediaClient
    let sermons: SermonClient
    let presentations: PresentationClient
    let giving: GivingClient
    /// The Keychain, under this app's one service. Everything that must
    /// survive a kill and vanish on sign-out lives here — the session, the PKCE
    /// verifier, resume positions and a pending gift — so sign-out's
    /// `deleteAll` sweeps all of it at once.
    let secureStore: SecureStoring
    let resumePositions: KeychainResumePositionStore
    /// The Apple Pay merchant ID this build is entitled to, or nil.
    ///
    /// Nil unless `FAITHFORM_ENABLE_APPLE_PAY` switched the entitlement on (see
    /// Base.xcconfig), and nil means every gift goes to Safari — see
    /// `givingRoute(...)`.
    let applePayMerchantID: String?
    let allowsDebugControls: Bool
    /// Creates sessions. Nil when this build has no identity provider
    /// configured — the sign-in screen still renders, and submitting explains
    /// what is missing instead of spinning.
    let auth: SessionAuthenticating?

    // MARK: Automatic check-in

    /// The one `CLLocationManager` automatic check-in uses, with its delegate
    /// set **here, during `App.init`**.
    ///
    /// When iOS relaunches the app in the background for a region crossing, it
    /// hands the event to whatever delegate exists as launch finishes. Building
    /// the adapter anywhere later — in a view, in the first account load —
    /// would be an arrival delivered to nobody. The adapter holds anything that
    /// arrives before the handler below is attached.
    let location: CoreLocationAdapter
    let attendanceConfiguration: APIGeofenceConfigurationSource
    let attendanceNotifier: SystemAttendanceNotifier
    let attendance: AutomaticAttendanceService
    let attendanceModel: AutomaticAttendanceModel
    let attendanceNotificationResponder: AttendanceNotificationResponder

    // MARK: Push

    /// Permission, the APNs token, and this install's row on the server.
    ///
    /// Built at launch but silent until someone enables it: `refreshStatus()`
    /// only reads, and the system prompt is reachable from one screen.
    let push: PushLifecycleModel

    init(
        environment: APIEnvironment,
        clientBuild: Int,
        allowsDebugControls: Bool,
        applePayMerchantID: String?,
        secureStore: SecureStoring,
        session: SessionManager,
        auth: SessionAuthenticating?
    ) {
        self.environment = environment
        self.allowsDebugControls = allowsDebugControls
        self.applePayMerchantID = applePayMerchantID.flatMap {
            let trimmed = $0.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? nil : trimmed
        }
        self.secureStore = secureStore
        self.session = session
        self.auth = auth

        self.api = APIClient(
            configuration: APIClient.Configuration(
                environment: environment,
                clientBuild: clientBuild
            ),
            transport: URLSessionTransport(),
            tokens: session
        )
        // Every partition this app builds starts with the environment key, so a
        // build pointed somewhere new cannot read the previous environment's
        // data. The cache itself is environment-agnostic; the *keys* are not.
        // Disk-backed so a killed process still paints last night's feed.
        let support = FileManager.default
            .urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("FaithForm", isDirectory: true)
        self.cache = PartitionedCache(
            directory: support.appendingPathComponent("projections", isDirectory: true)
        )
        self.snapshots = AccountSnapshotStore(
            directory: support.appendingPathComponent("snapshots", isDirectory: true)
        )
        self.media = MediaClient(api: api, cache: cache)
        self.sermons = SermonClient(api: api, cache: cache)
        self.presentations = PresentationClient(api: api, cache: cache)
        self.giving = GivingClient(api: api, cache: cache)
        self.resumePositions = KeychainResumePositionStore(store: secureStore)
        self.push = PushLifecycleModel(
            api: api,
            authorizer: SystemNotificationAuthorizer(),
            installId: InstallIdentity.current(environmentKey: environment.key),
            clientBuild: clientBuild,
            appVersion: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String,
            osVersion: UIDevice.current.systemVersion,
            locale: Locale.current.identifier
        )

        let location = CoreLocationAdapter()
        let configuration = APIGeofenceConfigurationSource(api: api)
        let notifier = SystemAttendanceNotifier()
        let reconciler = GeofenceReconciler(
            monitor: location,
            authorization: location,
            source: configuration
        )
        let coordinator = AutomaticAttendanceCoordinator(
            reconciler: reconciler,
            submitter: APIAttendanceSubmitter(api: api),
            sampler: location,
            // The Keychain, under the same service as the session, so sign-out's
            // `deleteAll` takes any unsent evidence with it.
            store: KeychainAttemptStore(secureStore: secureStore),
            authorization: location,
            notifier: notifier
        )
        let service = AutomaticAttendanceService(
            coordinator: coordinator,
            reconciler: reconciler,
            settingsStore: KeychainAutomaticAttendanceSettingsStore(secureStore: secureStore),
            environment: environment.key
        )
        let model = AutomaticAttendanceModel(
            service: service,
            authorizer: location,
            consent: APIAttendanceConsent(api: api),
            notifications: notifier,
            history: APIAttendanceHistory(api: api)
        )
        self.location = location
        self.attendanceConfiguration = configuration
        self.attendanceNotifier = notifier
        self.attendance = service
        self.attendanceModel = model
        // Set as the notification centre's delegate now, for the same reason
        // the location delegate is: a tap on "Check in" can launch the app.
        self.attendanceNotificationResponder = AttendanceNotificationResponder(service: service)
        UNUserNotificationCenter.current().delegate = attendanceNotificationResponder

        Task { [push] in
            // Reads the permission state, and takes any token APNs issued
            // during launch — for a phone that already enabled notifications,
            // registration happens without anyone being asked anything.
            await push.refreshStatus()
            await PushApplicationDelegate.tokens.onTokenChanged { token in
                await push.handleToken(token)
            }
            if NotificationPrompting.shouldRegisterForRemote(push.status) {
                await SystemNotificationAuthorizer().registerForRemoteNotifications()
            }
        }

        Task {
            // Order matters. What this device last knew is read first, then the
            // handler attaches and receives anything iOS delivered during launch,
            // and only then does anything touch the network.
            await service.prepare()
            await service.setChangeHandler { await model.refresh() }
            await location.setAuthorizationChangeHandler { _ in
                await service.permissionChanged()
            }
            await location.setRegionHandler { identifier, transition in
                let lease = await AttendanceExecutionLease()
                await service.handleRegion(identifier: identifier, transition: transition)
                await model.refreshHistory()
                await lease.end()
            }
            await service.start()
        }
    }

    /// Every church this account may be checked in at: the ones it can still
    /// read. A church with no confirmed People link refuses for itself and is
    /// simply not watched.
    nonisolated static func attendanceChurches(in bootstrap: Bootstrap) -> [AttendanceChurch] {
        bootstrap.relationships
            .filter { $0.canReadPublishedContent && $0.state != .blocked && $0.state != .left }
            .map { AttendanceChurch(slug: $0.churchSlug, name: $0.churchName) }
    }

    /// The session on disk, read synchronously so the first frame can skip the
    /// launch view when a returning visit already has a shell to show.
    func peekSession() -> StoredSession? {
        guard let data = try? secureStore.read(SessionManager.storageKey(environmentKey: environment.key))
        else { return nil }
        return SessionManager.session(fromStored: data, environmentKey: environment.key)
    }

    /// The registry for the capabilities the server currently reports.
    ///
    /// **Intersected with what this platform actually implements.** A server
    /// that turns on a capability iOS has no screen for must not produce a tab
    /// that opens nothing, and a screen this app has must not be reachable
    /// because it exists — the server still has to say so.
    func registry(for bootstrap: Bootstrap?) -> RouteRegistry {
        _ = bootstrap
        return RouteRegistry(implemented: Self.implementedDestinations)
    }

    /// The partition for the current account and church.
    ///
    /// Environment first, then account, then church, then authorization
    /// version — so a sign-out, a church switch, or a revoked relationship all
    /// change the key and none of them can read what came before.
    func partition(
        for bootstrap: Bootstrap?,
        accountId: String?,
        churchSlug: String? = nil
    ) -> CachePartition {
        guard let bootstrap else {
            return CachePartition.publicPartition(environment: environment.key)
        }
        return CachePartition(
            environment: environment.key,
            // The account is identified by the session, not by the bootstrap:
            // the profile deliberately carries no account id, so a cache key
            // cannot be reconstructed from a response somebody intercepted.
            accountId: accountId,
            churchSlug: churchSlug,
            authorizationVersion: bootstrap.profile.authorizationVersion
        )
    }

    /// Every destination with a real screen behind it on iOS.
    ///
    /// The rule this list exists to enforce: a destination is listed only once
    /// a screen actually opens behind it. `sermonArchive` was the long-standing
    /// exception — declared since Prompt 4 with nothing behind it — and is
    /// listed now because `SermonListView` and `SermonDetailView` exist and the
    /// server publishes the `sermons` capability. Anything still unbuilt stays
    /// out, so the registry resolves it to `.notImplemented` and nothing offers
    /// it.
    static let implementedDestinations: Set<Destination> = [
        .home,
        .account,
        .accountPrivacy,
        .churchDiscovery,
        .church(slug: ""),
        .announcements(churchSlug: ""),
        .watch(churchSlug: ""),
        .groups(churchSlug: ""),
        .give(churchSlug: ""),
        .checkIn(churchSlug: ""),
        .sermonArchive(churchSlug: ""),
    ]
}
