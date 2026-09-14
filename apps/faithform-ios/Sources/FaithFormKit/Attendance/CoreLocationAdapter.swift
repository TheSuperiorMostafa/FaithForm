#if canImport(CoreLocation)
import CoreLocation
import Foundation

/// The only file in FaithForm that touches Core Location.
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
    /// **FaithForm's own enum, not `CLAuthorizationStatus`.**
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
    /// Asks whether the device is inside a region now. The answer arrives on
    /// `locationManager(_:didDetermineState:for:)`; no position is read.
    func requestState(for region: CLRegion)
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
    public func requestState(for region: CLRegion) { manager.requestState(for: region) }
}

/// What the OS said about a region.
public enum RegionTransition: Equatable, Sendable {
    /// Crossed in.
    case entered
    /// Crossed out.
    case exited
    /// Asked, and the device is inside.
    case inside
    /// Asked, and the device is outside.
    case outside
}

public actor CoreLocationAdapter: NSObject, LocationAuthorizing, LocationSampling, RegionMonitoring {
    private let manager: any CoreLocationFacade
    private let bridge: Bridge

    /// Continuations awaiting an authorization change or a one-shot fix.
    /// Resumed exactly once and then cleared; a second callback finds nothing
    /// to resume rather than crashing on a double resume.
    private var authorizationWaiters: [CheckedContinuation<LocationAuthorization, Never>] = []
    private var locationWaiters: [CheckedContinuation<LocationSample?, Never>] = []

    /// Region events that arrived before anyone was listening.
    ///
    /// **Why this exists.** When iOS relaunches the app in the background for
    /// a boundary crossing, it delivers the event as soon as a delegate is set
    /// — which is here, during app launch, before the rest of the app has
    /// loaded the account and attached a handler. An event dropped in that gap
    /// is an arrival nobody ever hears about. Bounded, and emptied the moment a
    /// handler attaches.
    private var undelivered: [(String, RegionTransition)] = []
    private var onRegion: (@Sendable (String, RegionTransition) async -> Void)?
    private var onAuthorizationChange: (@Sendable (LocationAuthorization) async -> Void)?

    /// Attaches the delegate **synchronously**, on the thread that creates the
    /// adapter.
    ///
    /// It used to attach on the next actor hop. Core Location relaunches an app
    /// for a region event and hands the event to whatever delegate exists; the
    /// adapter is built in `App.init`, and doing the wiring inside the
    /// initializer is what makes "set up the delegate before launch finishes"
    /// true rather than likely.
    public init(facade: any CoreLocationFacade = SystemCoreLocationFacade()) {
        let bridge = Bridge()
        self.manager = facade
        self.bridge = bridge
        super.init()
        bridge.owner = self
        facade.setDelegate(bridge)
        // Region monitoring does not need a fine desired accuracy — the OS
        // decides how to satisfy the region — but the one-shot confirmation
        // fix does, because the server bands it.
        facade.setDesiredAccuracy(kCLLocationAccuracyNearestTenMeters)
    }

    /// Kept for tests written against the asynchronous attach. The initializer
    /// attaches now, so this only re-asserts the same wiring.
    public func attachNow() {
        bridge.owner = self
        manager.setDelegate(bridge)
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
            watchPrompt()
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
            watchPrompt()
            manager.requestAlwaysAuthorization()
        }
    }

    /// Resumes a request whose answer will never come as a callback.
    ///
    /// iOS shows the upgrade to Always **once**. Asked again, it shows nothing
    /// and — because the status did not change — calls no delegate method, so
    /// a request that only waited for the callback hung the opt-in flow on a
    /// spinner forever. "Keep Only While Using" is the same: no change, no
    /// callback.
    ///
    /// So the prompt's presentation is watched instead. If the app does not
    /// resign active shortly after the request, no prompt appeared; if it did,
    /// the answer is read once the app is active again. Either way the waiter
    /// resumes with whatever the status now is.
    private func watchPrompt() {
        #if canImport(UIKit) && os(iOS)
        PromptPresentationWatch.start { [weak self] in
            Task { await self?.resumeAuthorizationWaiters(allowUndetermined: true) }
        }
        #endif
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

    public func requestStateForMonitoredRegions() {
        for region in manager.monitoredRegions where region is CLCircularRegion {
            manager.requestState(for: region)
        }
    }

    // MARK: - Events

    /// Where region events are delivered, with the kind of transition. Set by
    /// the app layer; anything that arrived first is delivered now, in order.
    public func setRegionHandler(
        _ handler: @escaping @Sendable (String, RegionTransition) async -> Void
    ) async {
        onRegion = handler
        let backlog = undelivered
        undelivered = []
        for (identifier, transition) in backlog {
            await handler(identifier, transition)
        }
    }

    /// Entries and exits only, as a Boolean. State answers are not crossings,
    /// so they are not reported here.
    public func setRegionEventHandler(
        _ handler: @escaping @Sendable (String, Bool) async -> Void
    ) async {
        await setRegionHandler { identifier, transition in
            switch transition {
            case .entered: await handler(identifier, true)
            case .exited: await handler(identifier, false)
            case .inside, .outside: break
            }
        }
    }

    /// Told whenever the person changes the permission — in Settings, in a
    /// prompt, or by turning Precise Location off — so the screen and the
    /// monitored set follow without waiting for the next launch.
    public func setAuthorizationChangeHandler(
        _ handler: @escaping @Sendable (LocationAuthorization) async -> Void
    ) {
        onAuthorizationChange = handler
    }

    fileprivate func deliver(regionIdentifier: String, transition: RegionTransition) async {
        guard let onRegion else {
            if undelivered.count < 40 { undelivered.append((regionIdentifier, transition)) }
            return
        }
        await onRegion(regionIdentifier, transition)
    }

    fileprivate func authorizationDidChange() async {
        resumeAuthorizationWaiters(allowUndetermined: false)
        await onAuthorizationChange?(currentAuthorization())
    }

    /// `allowUndetermined` is false for the delegate callback: iOS reports the
    /// current status when a delegate is first set, and `notDetermined` then is
    /// not the answer to a prompt that is still on screen.
    fileprivate func resumeAuthorizationWaiters(allowUndetermined: Bool) {
        let status = currentAuthorization()
        guard allowUndetermined || status != .notDetermined else { return }
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
            Task { await owner.authorizationDidChange() }
        }

        // `CLRegion` is not `Sendable`, so the identifier is read here and the
        // framework object never crosses to the actor. That is the right shape
        // anyway: an identifier is all this feature needs, and letting a
        // Core Location object travel further would give later code access to
        // geometry it has no reason to see.
        func locationManager(_ manager: CLLocationManager, didEnterRegion region: CLRegion) {
            guard let owner else { return }
            let identifier = region.identifier
            Task { await owner.deliver(regionIdentifier: identifier, transition: .entered) }
        }

        func locationManager(_ manager: CLLocationManager, didExitRegion region: CLRegion) {
            guard let owner else { return }
            let identifier = region.identifier
            Task { await owner.deliver(regionIdentifier: identifier, transition: .exited) }
        }

        func locationManager(
            _ manager: CLLocationManager,
            didDetermineState state: CLRegionState,
            for region: CLRegion
        ) {
            guard let owner else { return }
            let identifier = region.identifier
            let transition: RegionTransition
            switch state {
            case .inside: transition = .inside
            case .outside: transition = .outside
            // Unknown says nothing, and acting on nothing would be a guess.
            case .unknown: return
            @unknown default: return
            }
            Task { await owner.deliver(regionIdentifier: identifier, transition: transition) }
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

#if canImport(UIKit) && os(iOS)
/// Watches whether a permission prompt actually appeared, and when it went.
///
/// Presentation only — it reads no status and decides nothing. The adapter
/// reads the status itself once this says the prompt is gone or never came.
final class PromptPresentationWatch: @unchecked Sendable {
    private let lock = NSLock()
    private var tokens: [NSObjectProtocol] = []
    private var resigned = false
    private var finished = false
    private let onSettled: @Sendable () -> Void

    private init(onSettled: @escaping @Sendable () -> Void) {
        self.onSettled = onSettled
    }

    /// How long to wait for a prompt to take the screen before concluding
    /// none will.
    static let presentationGrace: TimeInterval = 3
    /// How long after the app is active again to let the status callback land
    /// first, so the common case resumes from the callback itself.
    static let answerGrace: TimeInterval = 0.6

    /// `UIApplication`'s notification names, by value. The constants are
    /// main-actor isolated and this is observed from the adapter's own actor;
    /// the strings are the same ones UIKit posts.
    static let willResignActive = Notification.Name("UIApplicationWillResignActiveNotification")
    static let didBecomeActive = Notification.Name("UIApplicationDidBecomeActiveNotification")

    static func start(onSettled: @escaping @Sendable () -> Void) {
        let watch = PromptPresentationWatch(onSettled: onSettled)
        let center = NotificationCenter.default
        // Registered before the request is issued, so a prompt that appears
        // immediately cannot be missed.
        let resign = center.addObserver(
            forName: willResignActive, object: nil, queue: nil
        ) { _ in watch.markResigned() }
        let active = center.addObserver(
            forName: didBecomeActive, object: nil, queue: nil
        ) { _ in watch.becameActive() }
        watch.hold([resign, active])

        DispatchQueue.main.asyncAfter(deadline: .now() + presentationGrace) {
            watch.finishIfNeverPresented()
        }
    }

    private func hold(_ observers: [NSObjectProtocol]) {
        lock.lock(); tokens = observers; lock.unlock()
    }

    private func markResigned() {
        lock.lock(); resigned = true; lock.unlock()
    }

    private func becameActive() {
        lock.lock(); let wasResigned = resigned; lock.unlock()
        guard wasResigned else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.answerGrace) { self.finish() }
    }

    private func finishIfNeverPresented() {
        lock.lock(); let wasResigned = resigned; lock.unlock()
        if !wasResigned { finish() }
    }

    private func finish() {
        lock.lock()
        guard !finished else { lock.unlock(); return }
        finished = true
        let observers = tokens
        tokens = []
        lock.unlock()
        for token in observers { NotificationCenter.default.removeObserver(token) }
        onSettled()
    }
}
#endif

// MARK: - Discovery's one-shot provider

/// One foreground fix, for one nearby-churches query.
///
/// Lives here because this is the only file permitted to touch Core Location —
/// a rule a sweep enforces. It implements Prompt 5's `LocationProviding`, whose
/// interface cannot express a background or always-on request, so no caller
/// can accidentally make one. Nothing here shares state with the attendance
/// adapter above: discovery's manager asks When In Use at most, takes one fix,
/// and retains nothing.
@MainActor
public final class DiscoveryLocationProvider: NSObject, CLLocationManagerDelegate, LocationProviding {
    private let manager = CLLocationManager()
    private var authorizationContinuation: CheckedContinuation<LocationAuthorization, Never>?
    private var fixContinuation: CheckedContinuation<(latitude: Double, longitude: Double), Error>?

    override public init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
    }

    public nonisolated func authorizationStatus() async -> LocationAuthorization {
        await MainActor.run { Self.normalize(manager.authorizationStatus) }
    }

    public nonisolated func requestWhenInUseAuthorization() async -> LocationAuthorization {
        await withCheckedContinuation { continuation in
            Task { @MainActor in
                let current = Self.normalize(manager.authorizationStatus)
                guard current == .notDetermined else {
                    continuation.resume(returning: current)
                    return
                }
                authorizationContinuation = continuation
                manager.requestWhenInUseAuthorization()
            }
        }
    }

    public nonisolated func currentCoordinate() async throws -> (latitude: Double, longitude: Double) {
        try await withCheckedThrowingContinuation { continuation in
            Task { @MainActor in
                fixContinuation = continuation
                manager.requestLocation()
            }
        }
    }

    public nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        Task { @MainActor in
            guard let continuation = authorizationContinuation else { return }
            let normalized = Self.normalize(status)
            // The change that fires on delegate assignment reports
            // notDetermined; the one worth resuming for is the answer.
            guard normalized != .notDetermined else { return }
            authorizationContinuation = nil
            continuation.resume(returning: normalized)
        }
    }

    public nonisolated func locationManager(
        _ manager: CLLocationManager,
        didUpdateLocations locations: [CLLocation]
    ) {
        let coordinate = locations.last?.coordinate
        Task { @MainActor in
            guard let continuation = fixContinuation else { return }
            fixContinuation = nil
            if let coordinate {
                continuation.resume(returning: (coordinate.latitude, coordinate.longitude))
            } else {
                continuation.resume(throwing: CLError(.locationUnknown))
            }
        }
    }

    public nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor in
            guard let continuation = fixContinuation else { return }
            fixContinuation = nil
            continuation.resume(throwing: error)
        }
    }

    private static func normalize(_ status: CLAuthorizationStatus) -> LocationAuthorization {
        switch status {
        case .notDetermined: return .notDetermined
        case .authorizedWhenInUse: return .authorizedWhenInUse
        case .authorizedAlways: return .authorizedAlways
        case .denied: return .denied
        case .restricted: return .restricted
        @unknown default: return .unavailable
        }
    }
}
#endif
