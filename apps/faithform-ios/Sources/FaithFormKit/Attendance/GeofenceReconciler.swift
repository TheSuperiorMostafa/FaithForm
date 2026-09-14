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
    /// Asks the OS whether the device is inside each monitored region right
    /// now. The answer arrives as an ordinary region-state callback.
    ///
    /// This is how someone who turns the feature on while already sitting in
    /// church is noticed: iOS does not deliver an entry for a region the device
    /// was inside when monitoring began.
    func requestStateForMonitoredRegions()
}

/// Why a reconciliation ran. Recorded for the readiness screen and for tests;
/// never logged with any region or account detail attached.
public enum ReconcileTrigger: String, Equatable, Sendable {
    case optIn
    case launch
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
    /// Why nothing at all can be monitored, or nil when at least one church is
    /// being watched. With one church bound this is that church's refusal,
    /// exactly as it always was.
    public let refusal: String?
    /// Regions the server authorized that would not fit inside the OS limit.
    public let droppedForCapacity: [String]
    /// Per church: why *that* church is not being watched. A church the
    /// person merely follows refuses `no_people_link`, and that must not stop
    /// the church they actually belong to from being watched.
    public let churchRefusals: [String: String]

    public init(
        added: [String],
        removed: [String],
        updated: [String],
        monitoring: Int,
        refusal: String?,
        droppedForCapacity: [String],
        churchRefusals: [String: String] = [:]
    ) {
        self.added = added
        self.removed = removed
        self.updated = updated
        self.monitoring = monitoring
        self.refusal = refusal
        self.droppedForCapacity = droppedForCapacity
        self.churchRefusals = churchRefusals
    }

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
/// The server already caps its response at 20 per church, so for one church
/// this is belt and braces — but a person linked to more than one church can
/// be authorized for more than twenty campuses in total, and exceeding the OS
/// limit fails silently rather than loudly.
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
/// **Every church the account may be checked in at, not the one on screen.**
/// An earlier version was bound to the church selected in the app, so browsing
/// a church you follow tore down the regions of the church you attend — the
/// person who looked at another church's sermons on Saturday was not checked
/// in on Sunday. Consent is account-wide on the server, so monitoring is too:
/// each bound church is asked for its own configuration, a church that refuses
/// is simply not watched, and the rest are unaffected.
///
/// **Idempotent by construction.** Reconciliation compares desired against
/// actual and issues only the difference, so calling it ten times in a row
/// costs nine no-ops. That matters because the triggers genuinely do overlap —
/// foregrounding after a church switch fires two.
///
/// **Fails closed.** Every device refusal, every authorization loss and every
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

    /// The account identity everything is scoped to. Its church component is
    /// ignored: churches are `churchSlugs`.
    private var partition: CachePartition?
    private var churchSlugs: [String] = []
    private var lastOutcome: ReconcileOutcome = .idle
    private var enabled = false

    /// The last configuration each church made available, in memory only. Lets
    /// an offline reconciliation keep a working church's regions, and lets the
    /// evidence flow read a church's policy without another request.
    private var configurations: [String: GeofenceConfiguration] = [:]
    /// Which church each monitored region belongs to.
    private var regionOwners: [String: String] = [:]

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
    public func boundChurches() -> [String] { churchSlugs }

    /// The configuration a church last made available, if any.
    public func configuration(forChurch slug: String) -> GeofenceConfiguration? {
        configurations[slug]
    }

    /// Which bound church a region belongs to.
    ///
    /// With a single church bound, that church — a region the reconciler has
    /// not seen yet (a relaunch before the first reconciliation) can only be
    /// its.
    public func churchSlug(forRegion regionId: String) -> String? {
        if let owner = regionOwners[regionId], churchSlugs.contains(owner) { return owner }
        for slug in churchSlugs where configurations[slug]?.regions.contains(where: { $0.regionId == regionId }) == true {
            return slug
        }
        return churchSlugs.count == 1 ? churchSlugs.first : nil
    }

    /// Single-church binding, as every caller before multi-church used it.
    public func bind(partition: CachePartition, churchSlug: String?, enabled: Bool) async {
        await bind(partition: partition, churchSlugs: churchSlug.map { [$0] } ?? [], enabled: enabled)
    }

    /// Binds the reconciler to an account and the churches it may be checked
    /// in at.
    ///
    /// A change of environment, account or authorization version is a
    /// different identity, and everything monitored under the previous one is
    /// removed before anything new is registered. A change to the set of
    /// churches removes only the regions of churches that left it — joining a
    /// second church must not reset the OS's state for the first one's regions.
    public func bind(partition: CachePartition, churchSlugs: [String], enabled: Bool) async {
        let slugs = Array(Set(churchSlugs)).sorted()

        if let previous = self.partition, Self.identity(previous) != Self.identity(partition) {
            // Never carry regions across an identity boundary. A region left
            // monitoring for an account that signed out would wake the app and
            // start an evidence flow it has no authority to complete.
            await monitor.stopMonitoringAll()
            lastOutcome = .idle
            configurations = [:]
            regionOwners = [:]
        } else if slugs != self.churchSlugs {
            let departed = Set(self.churchSlugs).subtracting(slugs)
            for (regionId, owner) in regionOwners.sorted(by: { $0.key < $1.key })
            where departed.contains(owner) {
                // A church that was left. Removed before any new configuration
                // arrives, so there is no moment in which it is still watched.
                await monitor.stopMonitoring(identifier: regionId)
                regionOwners[regionId] = nil
            }
            for slug in departed { configurations[slug] = nil }
        }

        self.partition = partition
        self.churchSlugs = slugs
        self.enabled = enabled
    }

    /// Removes everything, unconditionally.
    ///
    /// Called on logout, being blocked, consent withdrawal, and turning the
    /// feature off. All are the same action from the device's point of view:
    /// this app is no longer authorized to watch for this person.
    @discardableResult
    public func teardown() async -> ReconcileOutcome {
        let existing = await monitor.monitoredRegions().map(\.identifier).sorted()
        await monitor.stopMonitoringAll()
        enabled = false
        regionOwners = [:]
        lastOutcome = ReconcileOutcome(
            added: [], removed: existing, updated: [], monitoring: 0,
            refusal: "disabled", droppedForCapacity: []
        )
        return lastOutcome
    }

    /// Stops watching one church after it refused this account, leaving every
    /// other church alone. The next reconciliation asks that church again, so
    /// this is never permanent: the server stays the authority on whether it
    /// may be watched.
    @discardableResult
    public func exclude(churchSlug slug: String) async -> ReconcileOutcome {
        guard churchSlugs.count > 1 else { return await teardown() }
        var removed: [String] = []
        for (regionId, owner) in regionOwners where owner == slug {
            await monitor.stopMonitoring(identifier: regionId)
            regionOwners[regionId] = nil
            removed.append(regionId)
        }
        configurations[slug] = nil
        lastOutcome = ReconcileOutcome(
            added: [], removed: removed.sorted(), updated: [],
            monitoring: await monitor.monitoredRegions().count,
            refusal: lastOutcome.refusal,
            droppedForCapacity: lastOutcome.droppedForCapacity,
            churchRefusals: lastOutcome.churchRefusals
        )
        return lastOutcome
    }

    /// Asks each church for its configuration without touching the OS.
    ///
    /// No device gate and no registration: this runs before any location
    /// permission exists, to learn whether asking for one is worth it.
    public func preflight(
        partition: CachePartition,
        churchSlugs: [String]
    ) async -> [String: GeofenceConfigurationState] {
        var states: [String: GeofenceConfigurationState] = [:]
        for slug in Array(Set(churchSlugs)).sorted() {
            let state = await source.currentConfiguration(
                churchSlug: slug,
                partition: Self.scoped(partition, to: slug),
                now: now(),
                forceRefresh: true
            )
            states[slug] = state
            if case .available(let configuration) = state { configurations[slug] = configuration }
        }
        return states
    }

    /// Asks the OS where the device is relative to every monitored region.
    /// Answers arrive as region-state callbacks; nothing here reads a position.
    public func determineRegionStates() async {
        guard enabled else { return }
        await monitor.requestStateForMonitoredRegions()
    }

    /// Brings the OS's monitored set in line with what the server authorizes.
    ///
    /// `forceChurch` limits a region event's forced refresh to the church the
    /// region belongs to; nil forces every church, which is what a single-church
    /// binding always did.
    @discardableResult
    public func reconcile(trigger: ReconcileTrigger, forceChurch: String? = nil) async -> ReconcileOutcome {
        guard trigger != .teardown else { return await teardown() }

        // Not enabled, signed out, or no church to be checked in at: monitor
        // nothing.
        guard enabled, let partition, !churchSlugs.isEmpty else {
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

        var available: [String: GeofenceConfiguration] = [:]
        var refusals: [String: String] = [:]
        var unreachable: [String] = []

        for slug in churchSlugs {
            // A region event may arrive while the cached configuration is
            // expired. That is allowed to wake us, but it is never authority:
            // the source refreshes rather than returning the stale copy.
            let force = trigger == .regionEvent && (forceChurch == nil || forceChurch == slug)
            let state = await source.currentConfiguration(
                churchSlug: slug,
                partition: Self.scoped(partition, to: slug),
                now: now(),
                forceRefresh: force
            )
            switch state {
            case .available(let configuration): available[slug] = configuration
            case .refused(let reason): refusals[slug] = reason
            case .unavailable: unreachable.append(slug)
            }
        }

        for (slug, configuration) in available { configurations[slug] = configuration }
        for slug in refusals.keys { configurations[slug] = nil }

        if available.isEmpty {
            if !unreachable.isEmpty {
                // Offline with nothing newly usable. Leave whatever is already
                // registered alone rather than tearing down a working setup on
                // one failed request — but change nothing and report it.
                lastOutcome = ReconcileOutcome(
                    added: [], removed: [], updated: [],
                    monitoring: await monitor.monitoredRegions().count,
                    refusal: "configuration_unavailable", droppedForCapacity: [],
                    churchRefusals: refusals
                )
                return lastOutcome
            }
            // Every church refused. Nothing may be watched.
            let first = churchSlugs.compactMap { refusals[$0] }.first ?? "disabled"
            return await stopWith(refusal: first, churchRefusals: refusals)
        }

        // A church that could not be reached keeps what it last had, so a
        // partial outage does not quietly stop watching it.
        var usable = available
        for slug in unreachable {
            if let remembered = configurations[slug] { usable[slug] = remembered }
        }
        let keepUnowned = unreachable.contains { configurations[$0] == nil }

        return await apply(
            usable.values.sorted { $0.churchSlug < $1.churchSlug },
            ownerOf: usable.mapValues { $0 },
            keepUnowned: keepUnowned,
            churchRefusals: refusals
        )
    }

    private func stopWith(refusal: String, churchRefusals: [String: String] = [:]) async -> ReconcileOutcome {
        let existing = await monitor.monitoredRegions().map(\.identifier).sorted()
        await monitor.stopMonitoringAll()
        regionOwners = [:]
        lastOutcome = ReconcileOutcome(
            added: [], removed: existing, updated: [], monitoring: 0,
            refusal: refusal, droppedForCapacity: [],
            churchRefusals: churchRefusals
        )
        return lastOutcome
    }

    private func apply(
        _ usable: [GeofenceConfiguration],
        ownerOf byChurch: [String: GeofenceConfiguration],
        keepUnowned: Bool,
        churchRefusals: [String: String]
    ) async -> ReconcileOutcome {
        let desired = Self.selectRegions(from: usable, now: now())
        let desiredIds = Set(desired.map(\.identifier))
        let dropped = usable
            .flatMap { $0.regions.map(\.regionId) }
            .filter { !desiredIds.contains($0) }

        var owners: [String: String] = [:]
        for (slug, configuration) in byChurch {
            for region in configuration.regions where desiredIds.contains(region.regionId) {
                owners[region.regionId] = slug
            }
        }
        let knownIds = Set(usable.flatMap { $0.regions.map(\.regionId) })

        let actual = await monitor.monitoredRegions()
        let actualById = Dictionary(actual.map { ($0.identifier, $0) }, uniquingKeysWith: { first, _ in first })
        let desiredById = Dictionary(desired.map { ($0.identifier, $0) }, uniquingKeysWith: { first, _ in first })

        var added: [String] = []
        var updated: [String] = []
        var removed: [String] = []

        // Anything the OS holds that the server no longer authorizes — except,
        // while some church is unreachable and unremembered, a region nobody
        // can place, which may be that church's.
        for identifier in actualById.keys.sorted() where desiredById[identifier] == nil {
            if keepUnowned && !knownIds.contains(identifier) && regionOwners[identifier] == nil { continue }
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

        regionOwners = owners
        lastOutcome = ReconcileOutcome(
            added: added.sorted(),
            removed: removed.sorted(),
            updated: updated.sorted(),
            monitoring: desired.count,
            refusal: nil,
            droppedForCapacity: dropped.sorted(),
            churchRefusals: churchRefusals
        )
        return lastOutcome
    }

    /// Which regions to monitor from one church's configuration.
    public static func selectRegions(from configuration: GeofenceConfiguration) -> [MonitoredRegion] {
        selectRegions(from: [configuration], now: Date())
    }

    /// Which regions to monitor when the server authorizes more than the OS
    /// permits.
    ///
    /// **Soonest service first, then region id.** A church with check-in open
    /// now outranks one whose next service is on Sunday, which outranks one
    /// with nothing scheduled this week; within a church — whose windows are
    /// shared by all its campuses — the order is the campus uuid.
    ///
    /// **Deliberately not nearest.** Distance would need a position read
    /// outside any attendance event, which is location use the feature does not
    /// otherwise need, and it would make the set depend on where the person is
    /// standing — two devices would monitor different regions and neither would
    /// be reproducible from a bug report. The service schedule is the server's,
    /// identical on every device at a given moment.
    ///
    /// Invalid geometry is dropped rather than clamped: a region the OS would
    /// reject or silently resize is worse than one region fewer.
    public static func selectRegions(
        from configurations: [GeofenceConfiguration],
        now: Date
    ) -> [MonitoredRegion] {
        struct Candidate {
            let priority: TimeInterval
            let region: GeofenceRegion
        }

        var candidates: [Candidate] = []
        for configuration in configurations {
            let priority = ArrivalPolicy.priority(of: configuration, now: now)
            for region in configuration.regions {
                let valid = abs(region.latitude) <= 90
                    && abs(region.longitude) <= 180
                    && region.radiusMeters > 0
                if valid { candidates.append(Candidate(priority: priority, region: region)) }
            }
        }

        candidates.sort { lhs, rhs in
            if lhs.priority != rhs.priority { return lhs.priority < rhs.priority }
            return lhs.region.regionId < rhs.region.regionId
        }

        var seen = Set<String>()
        var selected: [MonitoredRegion] = []
        for candidate in candidates where selected.count < appleMonitoredRegionLimit {
            guard seen.insert(candidate.region.regionId).inserted else { continue }
            selected.append(
                MonitoredRegion(
                    identifier: candidate.region.regionId,
                    latitude: candidate.region.latitude,
                    longitude: candidate.region.longitude,
                    radiusMeters: Double(candidate.region.radiusMeters)
                )
            )
        }
        return selected
    }

    /// Environment, account and authorization version — the parts of a
    /// partition that make it a different person.
    static func identity(_ partition: CachePartition) -> String {
        [partition.environment, partition.accountId ?? "anonymous", String(partition.authorizationVersion)]
            .joined(separator: "|")
    }

    static func scoped(_ partition: CachePartition, to slug: String) -> CachePartition {
        CachePartition(
            environment: partition.environment,
            accountId: partition.accountId,
            churchSlug: slug,
            authorizationVersion: partition.authorizationVersion
        )
    }
}

/// What the configuration source could produce.
public enum GeofenceConfigurationState: Sendable, Equatable {
    case available(GeofenceConfiguration)
    /// The server declined — no consent, no People link, wrong church, feature
    /// off. The client removes that church's regions and explains.
    case refused(String)
    /// Offline or erroring, with nothing valid cached.
    case unavailable
}
