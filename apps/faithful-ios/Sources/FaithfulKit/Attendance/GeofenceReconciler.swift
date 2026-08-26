import Foundation

/// A region as the operating system holds it.
public struct MonitoredRegion: Hashable, Sendable {
    public let identifier: String
    public let latitude: Double
    public let longitude: Double
    public let radiusMeters: Double

    public init(identifier: String, latitude: Double, longitude: Double, radiusMeters: Double) {
        self.identifier = identifier
        self.latitude = latitude
        self.longitude = longitude
        self.radiusMeters = radiusMeters
    }
}

/// The region-monitoring surface, abstracted from `CLLocationManager`.
public protocol RegionMonitoring: Actor {
    func monitoredRegions() -> Set<MonitoredRegion>
    func startMonitoring(_ region: MonitoredRegion)
    func stopMonitoring(identifier: String)
    func stopMonitoringAll()
}

/// Why a reconciliation ran. Recorded for the readiness screen and for tests;
/// never logged with any region or account detail attached.
public enum ReconcileTrigger: String, Equatable, Sendable {
    case optIn
    case foreground
    case churchChanged
    case accountChanged
    case authorizationVersionChanged
    case permissionChanged
    case configurationRefreshed
    case windowBoundary
    case regionEvent
    case teardown
}

/// What a reconciliation did.
public struct ReconcileOutcome: Equatable, Sendable {
    public let added: [String]
    public let removed: [String]
    public let updated: [String]
    public let monitoring: Int
    public let refusal: String?
    /// Regions the server authorized that would not fit inside the OS limit.
    public let droppedForCapacity: [String]

    public var changedAnything: Bool {
        !added.isEmpty || !removed.isEmpty || !updated.isEmpty
    }

    public static let idle = ReconcileOutcome(
        added: [], removed: [], updated: [], monitoring: 0,
        refusal: nil, droppedForCapacity: []
    )
}

/// Apple limits an app to 20 simultaneously monitored regions.
///
/// > "Core Location limits to 20 the number of regions that may be
/// > simultaneously monitored by a single app."
/// > — Apple, *Region Monitoring and iBeacon*
///
/// The server already caps its response at 20, so this is belt and braces
/// rather than the primary bound — but the client must not depend on a server
/// promise to stay inside an OS limit, because exceeding it fails silently
/// rather than loudly.
public let appleMonitoredRegionLimit = 20

/// The single owner of what this device is monitoring.
///
/// **Why one owner.** Region registration that is scattered across a view, an
/// app delegate and a notification handler cannot be reasoned about: two of
/// them race on launch, none of them knows what the third did, and the set the
/// OS actually holds drifts from anything intended. Everything that could
/// change the desired set calls `reconcile(trigger:)` here, and this is the only
/// type that talks to `RegionMonitoring`.
///
/// **Idempotent by construction.** Reconciliation compares desired against
/// actual and issues only the difference, so calling it ten times in a row
/// costs nine no-ops. That matters because the triggers genuinely do overlap —
/// foregrounding after a church switch fires two.
///
/// **Fails closed.** Every refusal path, every authorization loss and every
/// teardown reason ends in `stopMonitoringAll()`. There is no branch that
/// leaves a region registered because something was unclear.
public actor GeofenceReconciler {
    /// Where a configuration comes from. Injected so the reconciler can be
    /// tested against scripted responses including 304s and expiries.
    public protocol ConfigurationSource: Actor {
        /// Returns the configuration to use now, refreshing if the cached one
        /// is absent or expired. Never returns an expired configuration.
        func currentConfiguration(
            churchSlug: String,
            partition: CachePartition,
            now: Date,
            forceRefresh: Bool
        ) async -> GeofenceConfigurationState
    }

    private let monitor: any RegionMonitoring
    private let authorization: any LocationAuthorizing
    private let source: any ConfigurationSource
    private let now: @Sendable () -> Date

    /// The identity everything is scoped to. Nil when signed out.
    private var partition: CachePartition?
    private var churchSlug: String?
    private var lastOutcome: ReconcileOutcome = .idle
    private var enabled = false

    public init(
        monitor: any RegionMonitoring,
        authorization: any LocationAuthorizing,
        source: any ConfigurationSource,
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.monitor = monitor
        self.authorization = authorization
        self.source = source
        self.now = now
    }

    public func currentOutcome() -> ReconcileOutcome { lastOutcome }
    public func isEnabled() -> Bool { enabled }

    /// Binds the reconciler to an identity. A change to any component of the
    /// partition — environment, account, church, authorization version — is a
    /// different identity, and everything monitored under the previous one is
    /// removed before anything new is registered.
    public func bind(partition: CachePartition, churchSlug: String?, enabled: Bool) async {
        let identityChanged =
            self.partition?.storageKey != partition.storageKey || self.churchSlug != churchSlug

        if identityChanged {
            // Never carry regions across an identity boundary. A region left
            // monitoring for a church the person left would wake the app and
            // start an evidence flow it has no authority to complete.
            await monitor.stopMonitoringAll()
            lastOutcome = .idle
        }

        self.partition = partition
        self.churchSlug = churchSlug
        self.enabled = enabled
    }

    /// Removes everything, unconditionally.
    ///
    /// Called on logout, leaving a church, being blocked, People-link
    /// revocation, consent withdrawal, and turning the feature off. All six are
    /// the same action from the device's point of view: this app is no longer
    /// authorized to watch for this person at this church.
    @discardableResult
    public func teardown() async -> ReconcileOutcome {
        let existing = await monitor.monitoredRegions().map(\.identifier).sorted()
        await monitor.stopMonitoringAll()
        enabled = false
        lastOutcome = ReconcileOutcome(
            added: [], removed: existing, updated: [], monitoring: 0,
            refusal: "disabled", droppedForCapacity: []
        )
        return lastOutcome
    }

    /// Brings the OS's monitored set in line with what the server authorizes.
    @discardableResult
    public func reconcile(trigger: ReconcileTrigger) async -> ReconcileOutcome {
        guard trigger != .teardown else { return await teardown() }

        // Not enabled, signed out, or no church selected: monitor nothing.
        guard enabled, let partition, let churchSlug else {
            return await teardown()
        }

        // The OS gates before the server does, because there is no point asking
        // for a configuration we could not act on.
        guard await authorization.areLocationServicesEnabled(),
              await authorization.isRegionMonitoringAvailable()
        else {
            return await stopWith(refusal: "location_unavailable")
        }

        // Always is required for region monitoring. When In Use is a real,
        // common state, and it silently delivers nothing — so it is a refusal
        // the readiness screen can explain rather than a quiet failure.
        guard await authorization.currentAuthorization().permitsRegionMonitoring else {
            return await stopWith(refusal: "needs_always_authorization")
        }

        // Reduced accuracy cannot resolve a campus-sized region.
        guard await authorization.currentAccuracy() == .full else {
            return await stopWith(refusal: "needs_full_accuracy")
        }

        // A region event may arrive while the cached configuration is expired.
        // That is allowed to wake us, but it is never authority: the source
        // refreshes rather than returning the stale copy.
        let state = await source.currentConfiguration(
            churchSlug: churchSlug,
            partition: partition,
            now: now(),
            forceRefresh: trigger == .regionEvent
        )

        switch state {
        case .refused(let reason):
            return await stopWith(refusal: reason)
        case .unavailable:
            // Offline with nothing usable cached. Leave whatever is already
            // registered alone rather than tearing down a working setup on one
            // failed request — but change nothing and report it.
            lastOutcome = ReconcileOutcome(
                added: [], removed: [], updated: [],
                monitoring: await monitor.monitoredRegions().count,
                refusal: "configuration_unavailable", droppedForCapacity: []
            )
            return lastOutcome
        case .available(let configuration):
            return await apply(configuration)
        }
    }

    private func stopWith(refusal: String) async -> ReconcileOutcome {
        let existing = await monitor.monitoredRegions().map(\.identifier).sorted()
        await monitor.stopMonitoringAll()
        lastOutcome = ReconcileOutcome(
            added: [], removed: existing, updated: [], monitoring: 0,
            refusal: refusal, droppedForCapacity: []
        )
        return lastOutcome
    }

    private func apply(_ configuration: GeofenceConfiguration) async -> ReconcileOutcome {
        let desired = Self.selectRegions(from: configuration)
        let dropped = configuration.regions
            .map(\.regionId)
            .filter { id in !desired.contains { $0.identifier == id } }

        let actual = await monitor.monitoredRegions()
        let actualById = Dictionary(uniqueKeysWithValues: actual.map { ($0.identifier, $0) })
        let desiredById = Dictionary(uniqueKeysWithValues: desired.map { ($0.identifier, $0) })

        var added: [String] = []
        var updated: [String] = []
        var removed: [String] = []

        // Anything the OS holds that the server no longer authorizes.
        for identifier in actualById.keys where desiredById[identifier] == nil {
            await monitor.stopMonitoring(identifier: identifier)
            removed.append(identifier)
        }

        for region in desired {
            guard let existing = actualById[region.identifier] else {
                await monitor.startMonitoring(region)
                added.append(region.identifier)
                continue
            }
            // A moved or resized campus is a re-registration, not a no-op. An
            // identical one is left entirely alone, which is what keeps this
            // idempotent — re-registering would reset the OS's state for it.
            if existing != region {
                await monitor.stopMonitoring(identifier: region.identifier)
                await monitor.startMonitoring(region)
                updated.append(region.identifier)
            }
        }

        lastOutcome = ReconcileOutcome(
            added: added.sorted(),
            removed: removed.sorted(),
            updated: updated.sorted(),
            monitoring: desired.count,
            refusal: nil,
            droppedForCapacity: dropped.sorted()
        )
        return lastOutcome
    }

    /// Which regions to monitor when the server authorizes more than the OS
    /// permits.
    ///
    /// **Deterministic, and deliberately not distance-based.** Sorting by
    /// proximity would mean the set changes as the person moves, so two devices
    /// in different places would monitor different regions and neither would be
    /// reproducible in a test or a bug report. Sorting by region id is stable,
    /// identical everywhere, and — because the id is the campus uuid — carries
    /// no ordering the server did not already choose.
    ///
    /// Invalid geometry is dropped rather than clamped: a region the OS would
    /// reject or silently resize is worse than one region fewer.
    public static func selectRegions(from configuration: GeofenceConfiguration) -> [MonitoredRegion] {
        configuration.regions
            .filter { region in
                abs(region.latitude) <= 90
                    && abs(region.longitude) <= 180
                    && region.radiusMeters > 0
            }
            .sorted { $0.regionId < $1.regionId }
            .prefix(appleMonitoredRegionLimit)
            .map {
                MonitoredRegion(
                    identifier: $0.regionId,
                    latitude: $0.latitude,
                    longitude: $0.longitude,
                    radiusMeters: Double($0.radiusMeters)
                )
            }
    }
}

/// What the configuration source could produce.
public enum GeofenceConfigurationState: Sendable, Equatable {
    case available(GeofenceConfiguration)
    /// The server declined — no consent, no People link, wrong church, feature
    /// off. The client removes its regions and explains.
    case refused(String)
    /// Offline or erroring, with nothing valid cached.
    case unavailable
}

