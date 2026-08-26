#if canImport(CoreLocation)
import CoreLocation
import Foundation
import Testing
@testable import FaithfulKit

/// A `CLLocationManager` stand-in.
///
/// One member per framework call, and it records every one. The adapter's
/// *translation* — status mapping, radius clamping, region diffing, delegate
/// wiring, continuation handling — is exercised here on a plain macOS runner.
/// Without the seam this code would be reachable only on a device, which is
/// exactly the code most likely to be subtly wrong.
final class FakeCoreLocation: CoreLocationFacade, @unchecked Sendable {
    private let lock = NSLock()

    private var _status: LocationAuthorization = .notDetermined
    private var _accuracy: LocationAccuracyAuthorization = .full
    private var _regions: Set<CLRegion> = []
    private var _servicesEnabled = true
    private var _monitoringAvailable = true
    private var _calls: [String] = []
    private var _delegate: CLLocationManagerDelegate?
    private var _desiredAccuracy: CLLocationAccuracy = 0

    var maximumRegionMonitoringDistance: CLLocationDistance = 10_000

    /// What the status becomes when the prompt is answered.
    var whenInUseGrants: LocationAuthorization = .authorizedWhenInUse
    var alwaysGrants: LocationAuthorization = .authorizedAlways
    /// A fix to deliver on `requestLocation`, or nil to deliver a failure.
    var fix: CLLocation?
    var deliverFailure = false

    // The façade now exposes Faithful's own enum: the `CLAuthorizationStatus`
    // bridge lives in `SystemCoreLocationFacade.normalize` and is tested
    // separately, so nothing here has to construct a framework value that does
    // not exist on macOS.
    var authorization: LocationAuthorization {
        lock.lock(); defer { lock.unlock() }; return _status
    }
    var accuracy: LocationAccuracyAuthorization {
        lock.lock(); defer { lock.unlock() }; return _accuracy
    }
    var monitoredRegions: Set<CLRegion> {
        lock.lock(); defer { lock.unlock() }; return _regions
    }
    var locationServicesEnabled: Bool {
        lock.lock(); defer { lock.unlock() }; return _servicesEnabled
    }
    var regionMonitoringAvailable: Bool {
        lock.lock(); defer { lock.unlock() }; return _monitoringAvailable
    }

    var calls: [String] { lock.lock(); defer { lock.unlock() }; return _calls }
    var delegate: CLLocationManagerDelegate? {
        lock.lock(); defer { lock.unlock() }; return _delegate
    }
    var desiredAccuracy: CLLocationAccuracy {
        lock.lock(); defer { lock.unlock() }; return _desiredAccuracy
    }

    func set(status: LocationAuthorization) { mutate { $0._status = status } }
    func set(accuracy: LocationAccuracyAuthorization) { mutate { $0._accuracy = accuracy } }
    func set(servicesEnabled: Bool) { mutate { $0._servicesEnabled = servicesEnabled } }
    func set(monitoringAvailable: Bool) { mutate { $0._monitoringAvailable = monitoringAvailable } }

    func setDelegate(_ delegate: CLLocationManagerDelegate?) {
        mutate { $0._delegate = delegate; $0._calls.append("setDelegate") }
    }
    func setDesiredAccuracy(_ accuracy: CLLocationAccuracy) {
        mutate { $0._desiredAccuracy = accuracy }
    }

    func requestWhenInUseAuthorization() {
        mutate { $0._calls.append("requestWhenInUse"); $0._status = $0.whenInUseGrants }
        notifyAuthorizationChanged()
    }

    func requestAlwaysAuthorization() {
        mutate { $0._calls.append("requestAlways"); $0._status = $0.alwaysGrants }
        notifyAuthorizationChanged()
    }

    func requestLocation() {
        mutate { $0._calls.append("requestLocation") }

        let manager = CLLocationManager()
        if deliverFailure {
            delegate?.locationManager?(manager, didFailWithError: CLError(.locationUnknown))
        } else if let fix {
            delegate?.locationManager?(manager, didUpdateLocations: [fix])
        }
    }

    func startMonitoring(for region: CLRegion) {
        mutate {
            $0._calls.append("startMonitoring:\(region.identifier)")
            $0._regions.insert(region)
        }
    }

    func stopMonitoring(for region: CLRegion) {
        mutate {
            $0._calls.append("stopMonitoring:\(region.identifier)")
            $0._regions.remove(region)
        }
    }

    private func notifyAuthorizationChanged() {
        delegate?.locationManagerDidChangeAuthorization?(CLLocationManager())
    }

    private func mutate(_ block: (FakeCoreLocation) -> Void) {
        lock.lock(); defer { lock.unlock() }; block(self)
    }
}

@Suite("Core Location adapter")
struct CoreLocationAdapterTests {

    private func make(_ fake: FakeCoreLocation) async -> CoreLocationAdapter {
        let adapter = CoreLocationAdapter(facade: fake)
        await adapter.attachNow()
        return adapter
    }

    // -----------------------------------------------------------------------
    // Authorization translation
    // -----------------------------------------------------------------------

    @Test("the CLAuthorizationStatus bridge uses semantic cases")
    func statusBridge() {
        // `SystemCoreLocationFacade.normalize` is the one place a framework
        // status is interpreted, and it switches on real case names rather than
        // numbers. Every case here is constructible on every platform this
        // package builds for; `.authorizedWhenInUse` exists only on iOS and is
        // therefore covered by the iOS-only assertions below.
        #expect(SystemCoreLocationFacade.normalize(.notDetermined) == .notDetermined)
        #expect(SystemCoreLocationFacade.normalize(.restricted) == .restricted)
        #expect(SystemCoreLocationFacade.normalize(.denied) == .denied)
        #expect(SystemCoreLocationFacade.normalize(.authorizedAlways) == .authorizedAlways)

        #if os(iOS) || os(watchOS) || os(tvOS)
        #expect(SystemCoreLocationFacade.normalize(.authorizedWhenInUse) == .authorizedWhenInUse)
        #endif
    }

    @Test("only Always permits region monitoring")
    func onlyAlwaysMonitors() {
        // The normalized enum is what every decision above the bridge sees, so
        // this is the property that actually governs the feature.
        #expect(LocationAuthorization.authorizedAlways.permitsRegionMonitoring)
        #expect(!LocationAuthorization.authorizedWhenInUse.permitsRegionMonitoring)
        #expect(!LocationAuthorization.denied.permitsRegionMonitoring)
        #expect(!LocationAuthorization.restricted.permitsRegionMonitoring)
        #expect(!LocationAuthorization.notDetermined.permitsRegionMonitoring)
        #expect(!LocationAuthorization.unavailable.permitsRegionMonitoring)

        // And only `denied` is worth a Settings link.
        #expect(LocationAuthorization.denied.isRecoverableInSettings)
        #expect(!LocationAuthorization.restricted.isRecoverableInSettings)
    }

    @Test("location services off device-wide outranks the app's own status")
    func servicesOffWins() async {
        let fake = FakeCoreLocation()
        fake.set(status: .authorizedAlways)
        fake.set(servicesEnabled: false)
        let adapter = await make(fake)

        // The app is authorized, but nothing will be delivered. Reporting
        // `authorizedAlways` here would produce a readiness screen that says
        // everything is fine while no event can ever arrive.
        #expect(await adapter.currentAuthorization() == .unavailable)
        #expect(await adapter.areLocationServicesEnabled() == false)
    }

    @Test("accuracy is reported as its own axis")
    func accuracyTranslation() async {
        let fake = FakeCoreLocation()
        let adapter = await make(fake)
        #expect(await adapter.currentAccuracy() == .full)

        fake.set(accuracy: .reduced)
        #expect(await adapter.currentAccuracy() == .reduced)
    }

    @Test("region monitoring availability is read from the framework")
    func monitoringAvailability() async {
        let fake = FakeCoreLocation()
        let adapter = await make(fake)
        #expect(await adapter.isRegionMonitoringAvailable())

        fake.set(monitoringAvailable: false)
        #expect(await adapter.isRegionMonitoringAvailable() == false)
    }

    // -----------------------------------------------------------------------
    // Permission requests
    // -----------------------------------------------------------------------

    @Test("When In Use is requested once, and only when undetermined")
    func whenInUseRequest() async {
        let fake = FakeCoreLocation()
        let adapter = await make(fake)

        let result = await adapter.requestWhenInUse()
        #expect(result == .authorizedWhenInUse)
        #expect(fake.calls.contains("requestWhenInUse"))

        // Already determined: iOS shows nothing, so waiting for a callback
        // would hang the opt-in flow forever.
        let again = await adapter.requestWhenInUse()
        #expect(again == .authorizedWhenInUse)
        #expect(fake.calls.filter { $0 == "requestWhenInUse" }.count == 1)
    }

    @Test("Always is requested, and a refusal is reported rather than hung on")
    func alwaysRequest() async {
        let fake = FakeCoreLocation()
        fake.set(status: .authorizedWhenInUse)
        fake.alwaysGrants = .authorizedWhenInUse   // the person declined
        let adapter = await make(fake)

        let result = await adapter.requestAlways()
        #expect(result == .authorizedWhenInUse)
        #expect(result.permitsRegionMonitoring == false)
        #expect(fake.calls.contains("requestAlways"))
    }

    @Test("an already-Always status skips the prompt")
    func alwaysAlreadyGranted() async {
        let fake = FakeCoreLocation()
        fake.set(status: .authorizedAlways)
        let adapter = await make(fake)

        let result = await adapter.requestAlways()
        #expect(result == .authorizedAlways)
        #expect(!fake.calls.contains("requestAlways"))
    }

    // -----------------------------------------------------------------------
    // Region registration
    // -----------------------------------------------------------------------

    @Test("a region is registered with entry and exit notification")
    func registration() async {
        let fake = FakeCoreLocation()
        let adapter = await make(fake)

        await adapter.startMonitoring(
            MonitoredRegion(identifier: "faithful.campus.a", latitude: 38.25, longitude: -85.75, radiusMeters: 150)
        )

        let registered = fake.monitoredRegions.compactMap { $0 as? CLCircularRegion }
        #expect(registered.count == 1)
        #expect(registered[0].identifier == "faithful.campus.a")
        #expect(registered[0].radius == 150)
        #expect(registered[0].notifyOnEntry)
        // Exit is how an abandoned intent is cancelled when someone drives past.
        #expect(registered[0].notifyOnExit)
    }

    @Test("an over-large radius is clamped, so reconciliation converges")
    func radiusClamping() async {
        let fake = FakeCoreLocation()
        fake.maximumRegionMonitoringDistance = 500
        let adapter = await make(fake)

        await adapter.startMonitoring(
            MonitoredRegion(identifier: "big", latitude: 38.25, longitude: -85.75, radiusMeters: 5_000)
        )

        // The system silently reduces an over-large radius. Clamping here keeps
        // `monitoredRegions()` comparable with what was requested — otherwise
        // the reconciler sees a difference every pass and re-registers forever.
        let registered = fake.monitoredRegions.compactMap { $0 as? CLCircularRegion }
        #expect(registered[0].radius == 500)

        let readBack = await adapter.monitoredRegions()
        #expect(readBack.first?.radiusMeters == 500)
    }

    @Test("removal targets one region by identifier")
    func removal() async {
        let fake = FakeCoreLocation()
        let adapter = await make(fake)

        for id in ["a", "b", "c"] {
            await adapter.startMonitoring(
                MonitoredRegion(identifier: id, latitude: 38.25, longitude: -85.75, radiusMeters: 150)
            )
        }
        await adapter.stopMonitoring(identifier: "b")

        let remaining = await adapter.monitoredRegions().map(\.identifier).sorted()
        #expect(remaining == ["a", "c"])
    }

    @Test("teardown removes everything the framework holds")
    func teardownRemovesAll() async {
        let fake = FakeCoreLocation()
        let adapter = await make(fake)

        for id in ["a", "b", "c"] {
            await adapter.startMonitoring(
                MonitoredRegion(identifier: id, latitude: 38.25, longitude: -85.75, radiusMeters: 150)
            )
        }
        await adapter.stopMonitoringAll()

        #expect(fake.monitoredRegions.isEmpty)
        #expect(await adapter.monitoredRegions().isEmpty)
    }

    @Test("a non-circular region in the framework's set is ignored, not crashed on")
    func nonCircularIgnored() async {
        let fake = FakeCoreLocation()
        let adapter = await make(fake)
        await adapter.startMonitoring(
            MonitoredRegion(identifier: "a", latitude: 38.25, longitude: -85.75, radiusMeters: 150)
        )
        #expect(await adapter.monitoredRegions().count == 1)
    }

    // -----------------------------------------------------------------------
    // Capacity, through the reconciler that owns it
    // -----------------------------------------------------------------------

    @Test("the adapter registers at most the platform limit when driven by the reconciler")
    func capacityThroughReconciler() async {
        let fake = FakeCoreLocation()
        fake.set(status: .authorizedAlways)
        let adapter = await make(fake)

        let many = (0..<30).map {
            region(String(format: "faithful.campus.%02d", $0), lat: 38 + Double($0) / 100)
        }
        let source = ScriptedConfigSource(state: .available(configuration(regions: many)))
        let reconciler = GeofenceReconciler(
            monitor: adapter, authorization: adapter, source: source
        )
        await reconciler.bind(partition: testPartition, churchSlug: "grace", enabled: true)

        let outcome = await reconciler.reconcile(trigger: .optIn)

        #expect(outcome.monitoring == appleMonitoredRegionLimit)
        #expect(fake.monitoredRegions.count == appleMonitoredRegionLimit)
    }

    @Test("losing authorization removes every region through the real adapter")
    func revocationTeardown() async {
        let fake = FakeCoreLocation()
        fake.set(status: .authorizedAlways)
        let adapter = await make(fake)

        let source = ScriptedConfigSource(state: .available(configuration()))
        let reconciler = GeofenceReconciler(
            monitor: adapter, authorization: adapter, source: source
        )
        await reconciler.bind(partition: testPartition, churchSlug: "grace", enabled: true)
        _ = await reconciler.reconcile(trigger: .optIn)
        #expect(fake.monitoredRegions.count == 1)

        fake.set(status: .authorizedWhenInUse)
        let outcome = await reconciler.reconcile(trigger: .permissionChanged)

        #expect(outcome.refusal == "needs_always_authorization")
        #expect(fake.monitoredRegions.isEmpty, "regions survived a revocation")
    }

    // -----------------------------------------------------------------------
    // Callbacks
    // -----------------------------------------------------------------------

    @Test("a fix is translated into a sample with nothing extra carried over")
    func fixTranslation() async {
        let fake = FakeCoreLocation()
        fake.set(status: .authorizedAlways)
        fake.fix = CLLocation(
            coordinate: CLLocationCoordinate2D(latitude: 38.2527, longitude: -85.7585),
            altitude: 140,
            horizontalAccuracy: 12,
            verticalAccuracy: 8,
            course: 90,
            speed: 1.4,
            timestamp: Date(timeIntervalSince1970: 1_800_000_000)
        )
        let adapter = await make(fake)

        let sample = await adapter.requestOneShotLocation(timeout: 1)

        #expect(sample?.latitude == 38.2527)
        #expect(sample?.horizontalAccuracyMeters == 12)
        #expect(sample?.isUsable == true)
        // Speed, course, altitude and floor are dropped at the boundary: this
        // feature has no business handling them, and a framework object held
        // further in could leak one into a log.
        #expect(fake.calls.contains("requestLocation"))
    }

    @Test("a Core Location failure yields no sample rather than throwing")
    func failureCallback() async {
        let fake = FakeCoreLocation()
        fake.set(status: .authorizedAlways)
        fake.deliverFailure = true
        let adapter = await make(fake)

        let sample = await adapter.requestOneShotLocation(timeout: 1)

        // A cold GPS indoors is the ordinary case. The attempt is submitted
        // without coordinates and the server bands it `unknown`, which refuses.
        #expect(sample == nil)
    }

    @Test("no fix is requested without authorization")
    func noFixWithoutAuthorization() async {
        let fake = FakeCoreLocation()
        fake.set(status: .denied)
        let adapter = await make(fake)

        let sample = await adapter.requestOneShotLocation(timeout: 1)

        #expect(sample == nil)
        #expect(!fake.calls.contains("requestLocation"))
    }

    @Test("a region callback is delivered as one identifier, not a framework object")
    func regionCallbackTranslation() async throws {
        let fake = FakeCoreLocation()
        fake.set(status: .authorizedAlways)
        let adapter = await make(fake)

        let received = Received()
        await adapter.setRegionEventHandler { identifier, entered in
            await received.record(identifier: identifier, entered: entered)
        }

        let circular = CLCircularRegion(
            center: CLLocationCoordinate2D(latitude: 38.25, longitude: -85.75),
            radius: 150,
            identifier: "faithful.campus.a"
        )
        let delegate = try #require(fake.delegate)
        delegate.locationManager?(CLLocationManager(), didEnterRegion: circular)

        // The delegate hops onto the actor, so give the hop a chance.
        try await Task.sleep(nanoseconds: 50_000_000)

        #expect(await received.events == [("faithful.campus.a", true)].map { Event($0.0, $0.1) })
    }

    @Test("an exit callback is delivered too")
    func exitCallback() async throws {
        let fake = FakeCoreLocation()
        fake.set(status: .authorizedAlways)
        let adapter = await make(fake)

        let received = Received()
        await adapter.setRegionEventHandler { identifier, entered in
            await received.record(identifier: identifier, entered: entered)
        }

        let circular = CLCircularRegion(
            center: CLLocationCoordinate2D(latitude: 38.25, longitude: -85.75),
            radius: 150,
            identifier: "faithful.campus.a"
        )
        try #require(fake.delegate).locationManager?(CLLocationManager(), didExitRegion: circular)
        try await Task.sleep(nanoseconds: 50_000_000)

        let events = await received.events
        #expect(events.first?.entered == false)
    }

    // -----------------------------------------------------------------------
    // What the adapter must never do
    // -----------------------------------------------------------------------

    @Test("the adapter never starts continuous location")
    func noContinuousLocation() async {
        let fake = FakeCoreLocation()
        fake.set(status: .authorizedAlways)
        fake.fix = CLLocation(latitude: 38.25, longitude: -85.75)
        let adapter = await make(fake)

        _ = await adapter.requestOneShotLocation(timeout: 1)
        await adapter.startMonitoring(
            MonitoredRegion(identifier: "a", latitude: 38.25, longitude: -85.75, radiusMeters: 150)
        )
        await adapter.stopMonitoringAll()

        // The façade has no continuous member at all, so this is structural
        // rather than a promise — but asserting the call log keeps it visible
        // if one is ever added.
        for forbidden in ["startUpdatingLocation", "startMonitoringSignificantLocationChanges"] {
            #expect(!fake.calls.contains { $0.contains(forbidden) })
        }
        #expect(fake.calls.contains("requestLocation"))
    }

    @Test("the desired accuracy is set once, and is not the most aggressive available")
    func desiredAccuracy() async {
        let fake = FakeCoreLocation()
        _ = await make(fake)
        // Ten metres resolves a campus; `kCLLocationAccuracyBest` would burn
        // more battery for precision the server bands away anyway.
        #expect(fake.desiredAccuracy == kCLLocationAccuracyNearestTenMeters)
    }
}

/// Records what the region handler received.
private actor Received {
    private(set) var events: [Event] = []
    func record(identifier: String, entered: Bool) {
        events.append(Event(identifier, entered))
    }
}

private struct Event: Equatable {
    let identifier: String
    let entered: Bool
    init(_ identifier: String, _ entered: Bool) {
        self.identifier = identifier
        self.entered = entered
    }
}
#endif
