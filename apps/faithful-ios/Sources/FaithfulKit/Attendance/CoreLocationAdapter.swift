#if canImport(CoreLocation)
import CoreLocation
import Foundation

/// The only file in Faithful that touches Core Location.
///
/// **It contains no decisions.** Every rule about when to ask, what to monitor,
/// and what an event means lives in `GeofenceReconciler` and
/// `AutomaticAttendanceCoordinator`, which are plain actors with no framework
/// dependency and are therefore testable on a machine with no device, no
/// simulator, and no movement. This file only translates.
///
/// **What is deliberately absent:** `startUpdatingLocation`,
/// `allowsBackgroundLocationUpdates`, `startMonitoringSignificantLocationChanges`,
/// and `pausesLocationUpdatesAutomatically`. Automatic attendance needs the OS
/// to tell us about one boundary and then give us one fix. Continuous tracking
/// would be a far larger privacy claim for no additional capability, and a
/// forbidden-symbol sweep asserts none of them appears anywhere in the app.
/// The exact slice of `CLLocationManager` this feature uses.
///
/// **Why a façade rather than the class directly.** `CLLocationManager` cannot
/// be constructed usefully on a test runner: `authorizationStatus` reflects the
/// host machine, `startMonitoring` needs a real Location Services daemon, and
/// `requestAlwaysAuthorization` does nothing without a UI. Without a seam, the
/// adapter's *translation* — status mapping, radius clamping, region diffing,
/// continuation handling — would be reachable only on a device, which is
/// exactly the code most likely to be subtly wrong.
///
/// The protocol is deliberately as thin as the framework allows: every member
/// corresponds to one `CLLocationManager` call, so the production
/// implementation below has nothing in it that could be wrong on its own.
public protocol CoreLocationFacade: AnyObject, Sendable {
    /// **Faithful's own enum, not `CLAuthorizationStatus`.**
    ///
    /// The bridge from the framework type lives in
    /// `SystemCoreLocationFacade.normalize`, where it can use the real case
    /// names under `#if os(iOS)`. Everything above this line — the adapter, the
    /// reconciler, the coordinator, the screen model — sees only the normalized
    /// value, so no decision anywhere depends on a framework numeric.
    ///
    /// An earlier version switched on `CLAuthorizationStatus.rawValue` in
    /// production purely so macOS tests could construct
    /// `.authorizedWhenInUse`. That put an undocumented numeric contract on the
    /// authorization path to make a test convenient, which is the wrong way
    /// round: the seam should move, not the production semantics.
    var authorization: LocationAuthorization { get }
    var accuracy: LocationAccuracyAuthorization { get }
    var monitoredRegions: Set<CLRegion> { get }
    var maximumRegionMonitoringDistance: CLLocationDistance { get }

    var locationServicesEnabled: Bool { get }
    var regionMonitoringAvailable: Bool { get }

    func setDelegate(_ delegate: CLLocationManagerDelegate?)
    func setDesiredAccuracy(_ accuracy: CLLocationAccuracy)

    func requestWhenInUseAuthorization()
    func requestAlwaysAuthorization()
    func requestLocation()

    func startMonitoring(for region: CLRegion)
    func stopMonitoring(for region: CLRegion)
}

/// The production façade. One line per call, and no decisions.
public final class SystemCoreLocationFacade: CoreLocationFacade, @unchecked Sendable {
    private let manager = CLLocationManager()

    public init() {}

    public var authorization: LocationAuthorization { Self.normalize(manager.authorizationStatus) }

    public var accuracy: LocationAccuracyAuthorization {
        manager.accuracyAuthorization == .fullAccuracy ? .full : .reduced
    }

    /// The one place a `CLAuthorizationStatus` is interpreted.
    ///
    /// Semantic cases, not raw values. `.authorizedWhenInUse` exists only on
    /// iOS/watchOS/tvOS and `.authorized` only on macOS, so the two are
    /// compiled separately — which is honest about the platforms rather than
    /// papering over them with a number.
    ///
    /// `@unknown default` fails closed: a status this build does not recognise
    /// is not a grant.
    static func normalize(_ status: CLAuthorizationStatus) -> LocationAuthorization {
        switch status {
        case .notDetermined: return .notDetermined
        case .restricted: return .restricted
        case .denied: return .denied
        case .authorizedAlways: return .authorizedAlways
        #if os(iOS) || os(watchOS) || os(tvOS)
        case .authorizedWhenInUse: return .authorizedWhenInUse
        #endif
        @unknown default: return .denied
        }
    }
    public var monitoredRegions: Set<CLRegion> { manager.monitoredRegions }
    public var maximumRegionMonitoringDistance: CLLocationDistance {
        manager.maximumRegionMonitoringDistance
    }

    public var locationServicesEnabled: Bool { CLLocationManager.locationServicesEnabled() }
    public var regionMonitoringAvailable: Bool {
        CLLocationManager.isMonitoringAvailable(for: CLCircularRegion.self)
    }

    public func setDelegate(_ delegate: CLLocationManagerDelegate?) { manager.delegate = delegate }
    public func setDesiredAccuracy(_ accuracy: CLLocationAccuracy) {
        manager.desiredAccuracy = accuracy
    }

    public func requestWhenInUseAuthorization() { manager.requestWhenInUseAuthorization() }
    public func requestAlwaysAuthorization() { manager.requestAlwaysAuthorization() }
    public func requestLocation() { manager.requestLocation() }

    public func startMonitoring(for region: CLRegion) { manager.startMonitoring(for: region) }
    public func stopMonitoring(for region: CLRegion) { manager.stopMonitoring(for: region) }
}

public actor CoreLocationAdapter: NSObject, LocationAuthorizing, LocationSampling, RegionMonitoring {
    private let manager: any CoreLocationFacade
    private let bridge: Bridge

    /// Continuations awaiting an authorization change or a one-shot fix.
    /// Resumed exactly once and then cleared; a second callback finds nothing
    /// to resume rather than crashing on a double resume.
    private var authorizationWaiters: [CheckedContinuation<LocationAuthorization, Never>] = []
    private var locationWaiters: [CheckedContinuation<LocationSample?, Never>] = []

    public init(facade: any CoreLocationFacade = SystemCoreLocationFacade()) {
        self.manager = facade
        self.bridge = Bridge()
        super.init()
        Task { await self.attach() }
    }

    /// Attaches synchronously, for a test that needs the delegate wired before
    /// the first callback rather than on the next actor hop.
    public func attachNow() { attach() }

    private func attach() {
        bridge.owner = self
        manager.setDelegate(bridge)
        // Region monitoring does not need a fine desired accuracy — the OS
        // decides how to satisfy the region — but the one-shot confirmation
        // fix does, because the server bands it.
        manager.setDesiredAccuracy(kCLLocationAccuracyNearestTenMeters)
    }

    // MARK: - LocationAuthorizing

    /// Location services being off device-wide outranks the app's own grant:
    /// the app may be authorized and still receive nothing, and reporting
    /// `authorizedAlways` there would produce a readiness screen saying all is
    /// well while no event can arrive.
    public func currentAuthorization() -> LocationAuthorization {
        guard manager.locationServicesEnabled else { return .unavailable }
        return manager.authorization
    }

    public func currentAccuracy() -> LocationAccuracyAuthorization { manager.accuracy }

    public func areLocationServicesEnabled() -> Bool { manager.locationServicesEnabled }

    public func isRegionMonitoringAvailable() -> Bool { manager.regionMonitoringAvailable }

    /// Raises the When In Use prompt and waits for the answer.
    ///
    /// If the status is already determined, returns immediately: iOS shows the
    /// prompt only once, and a caller that waited forever for a callback that
    /// will never come would hang the opt-in flow.
    public func requestWhenInUse() async -> LocationAuthorization {
        let current = currentAuthorization()
        guard current == .notDetermined else { return current }

        return await withCheckedContinuation { continuation in
            authorizationWaiters.append(continuation)
            manager.requestWhenInUseAuthorization()
        }
    }

    /// Raises the Always prompt.
    ///
    /// Only meaningful after When In Use has been granted — iOS escalates from
    /// there — and the caller establishes that first. Already-Always returns
    /// immediately.
    public func requestAlways() async -> LocationAuthorization {
        let current = currentAuthorization()
        guard current != .authorizedAlways else { return current }

        return await withCheckedContinuation { continuation in
            authorizationWaiters.append(continuation)
            manager.requestAlwaysAuthorization()
        }
    }

    // MARK: - LocationSampling

    /// One fix, then stop.
    ///
    /// `requestLocation()` rather than `startUpdatingLocation()`: it delivers a
    /// single reading and stops on its own, so there is no state to forget to
    /// tear down and no possibility of leaving the GPS running.
    public func requestOneShotLocation(timeout: TimeInterval) async -> LocationSample? {
        guard currentAuthorization().hasAnyAccess else { return nil }

        return await withCheckedContinuation { continuation in
            locationWaiters.append(continuation)
            manager.requestLocation()

            // Core Location can simply never call back — a cold GPS indoors is
            // the ordinary case, not a rare one. The caller submits without
            // coordinates and the server bands it `unknown`, which fails closed.
            Task { [weak self] in
                try? await Task.sleep(nanoseconds: UInt64(timeout * 1_000_000_000))
                await self?.resumeLocationWaiters(with: nil)
            }
        }
    }

    // MARK: - RegionMonitoring

    public func monitoredRegions() -> Set<MonitoredRegion> {
        Set(
            manager.monitoredRegions.compactMap { region in
                guard let circular = region as? CLCircularRegion else { return nil }
                return MonitoredRegion(
                    identifier: circular.identifier,
                    latitude: circular.center.latitude,
                    longitude: circular.center.longitude,
                    radiusMeters: circular.radius
                )
            }
        )
    }

    public func startMonitoring(_ region: MonitoredRegion) {
        // Clamped to what this device will actually accept. A radius beyond
        // `maximumRegionMonitoringDistance` is silently reduced by the system,
        // so doing it here keeps `monitoredRegions()` comparable with what was
        // requested — otherwise reconciliation would see a difference every
        // time and re-register forever.
        let radius = min(region.radiusMeters, manager.maximumRegionMonitoringDistance)

        let circular = CLCircularRegion(
            center: CLLocationCoordinate2D(
                latitude: region.latitude,
                longitude: region.longitude
            ),
            radius: radius,
            identifier: region.identifier
        )
        circular.notifyOnEntry = true
        // Exit matters: it is how an abandoned intent is cancelled when someone
        // drives past rather than arriving.
        circular.notifyOnExit = true

        manager.startMonitoring(for: circular)
    }

    public func stopMonitoring(identifier: String) {
        for region in manager.monitoredRegions where region.identifier == identifier {
            manager.stopMonitoring(for: region)
        }
    }

    public func stopMonitoringAll() {
        for region in manager.monitoredRegions {
            manager.stopMonitoring(for: region)
        }
    }

    // MARK: - Events

    /// Where region events are delivered. Set by the app layer.
    private var onRegionEvent: (@Sendable (String, Bool) async -> Void)?

    public func setRegionEventHandler(_ handler: @escaping @Sendable (String, Bool) async -> Void) {
        onRegionEvent = handler
    }

    fileprivate func deliver(regionIdentifier: String, entered: Bool) async {
        await onRegionEvent?(regionIdentifier, entered)
    }

    fileprivate func resumeAuthorizationWaiters() {
        let status = currentAuthorization()
        let waiting = authorizationWaiters
        authorizationWaiters = []
        for continuation in waiting { continuation.resume(returning: status) }
    }

    fileprivate func resumeLocationWaiters(with sample: LocationSample?) {
        let waiting = locationWaiters
        locationWaiters = []
        for continuation in waiting { continuation.resume(returning: sample) }
    }

    /// `CLLocationManagerDelegate` cannot be an actor, so the callbacks land
    /// here and hop straight onto the adapter.
    private final class Bridge: NSObject, CLLocationManagerDelegate, @unchecked Sendable {
        weak var owner: CoreLocationAdapter?

        func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
            guard let owner else { return }
            Task { await owner.resumeAuthorizationWaiters() }
        }

        // `CLRegion` is not `Sendable`, so the identifier is read here and the
        // framework object never crosses to the actor. That is the right shape
        // anyway: an identifier is all this feature needs, and letting a
        // Core Location object travel further would give later code access to
        // geometry it has no reason to see.
        func locationManager(_ manager: CLLocationManager, didEnterRegion region: CLRegion) {
            guard let owner else { return }
            let identifier = region.identifier
            Task { await owner.deliver(regionIdentifier: identifier, entered: true) }
        }

        func locationManager(_ manager: CLLocationManager, didExitRegion region: CLRegion) {
            guard let owner else { return }
            let identifier = region.identifier
            Task { await owner.deliver(regionIdentifier: identifier, entered: false) }
        }

        func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
            guard let owner, let location = locations.last else { return }
            let sample = LocationSample(
                latitude: location.coordinate.latitude,
                longitude: location.coordinate.longitude,
                horizontalAccuracyMeters: location.horizontalAccuracy,
                capturedAt: location.timestamp
            )
            Task { await owner.resumeLocationWaiters(with: sample) }
        }

        func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
            guard let owner else { return }
            // Never logged: a Core Location error can carry a region identifier,
            // and a region identifier plus a failure is a location fact.
            Task { await owner.resumeLocationWaiters(with: nil) }
        }

        func locationManager(
            _ manager: CLLocationManager,
            monitoringDidFailFor region: CLRegion?,
            withError error: Error
        ) {
            // Deliberately silent. The next reconciliation re-derives the whole
            // desired set anyway, so a failed registration self-heals without a
            // bespoke recovery path here.
        }
    }
}
#endif
