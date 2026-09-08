import Foundation

// `LocationAuthorization` itself lives in `Features/DiscoveryModel.swift`,
// where Prompt 5 introduced it for church discovery. Prompt 7 extended it with
// `.authorizedAlways` and the region-monitoring helpers rather than declaring a
// second, rival enum for the same `CLAuthorizationStatus`.

/// Whether the person granted full or reduced precision.
///
/// iOS 14 introduced approximate location, which is roughly a few kilometres.
/// A church campus radius is 100–300 m, so a reduced-accuracy fix cannot decide
/// presence — and Core Location will not deliver useful region events from one
/// either. Treated as its own state rather than folded into "denied" because
/// the recovery is different: a temporary full-accuracy request, not Settings.
public enum LocationAccuracyAuthorization: String, Equatable, Sendable {
    case full
    case reduced
}

/// The subset of `CLLocationManager` this feature needs.
///
/// Everything Core Location does for us is behind this protocol so the reconciler
/// and the evidence machine can be exercised without a device, a simulator, or
/// any actual movement. The concrete adapter is the only file that imports
/// Core Location, and it contains no decisions.
public protocol LocationAuthorizing: Actor {
    func currentAuthorization() -> LocationAuthorization
    func currentAccuracy() -> LocationAccuracyAuthorization

    /// Raises the When In Use prompt. Never called before the person has opted
    /// into automatic attendance and read the explanation.
    func requestWhenInUse() async -> LocationAuthorization

    /// Raises the Always prompt.
    ///
    /// iOS only shows this meaningfully once, and only after When In Use has
    /// been granted, so the caller must have established that first.
    func requestAlways() async -> LocationAuthorization

    /// Whether this device can monitor regions at all. False on hardware
    /// without the capability and when location services are switched off
    /// device-wide, which is distinct from this app being denied.
    func isRegionMonitoringAvailable() -> Bool

    /// Location services enabled device-wide. Separate from authorization: one
    /// person turning it off in Settings affects every app.
    func areLocationServicesEnabled() -> Bool
}

/// One position reading, reduced to what the server is allowed to receive.
///
/// Deliberately not a `CLLocation`: that carries speed, course, altitude,
/// floor and timestamps this feature has no business handling, and holding the
/// framework type would let one of them reach a log or a cache by accident.
public struct LocationSample: Equatable, Sendable {
    public let latitude: Double
    public let longitude: Double
    public let horizontalAccuracyMeters: Double
    public let capturedAt: Date

    public init(
        latitude: Double,
        longitude: Double,
        horizontalAccuracyMeters: Double,
        capturedAt: Date
    ) {
        self.latitude = latitude
        self.longitude = longitude
        self.horizontalAccuracyMeters = horizontalAccuracyMeters
        self.capturedAt = capturedAt
    }

    /// A reading Core Location could not produce. `horizontalAccuracy` is
    /// negative when the fix is invalid, which is easy to miss.
    public var isUsable: Bool {
        horizontalAccuracyMeters > 0
            && horizontalAccuracyMeters.isFinite
            && abs(latitude) <= 90
            && abs(longitude) <= 180
    }
}

/// A single fresh fix, on demand.
///
/// **Deliberately one shot.** There is no `startUpdatingLocation` anywhere in
/// this feature: continuous background location is both unnecessary — the OS
/// already did the monitoring — and a far larger privacy claim than automatic
/// attendance needs. A test asserts the continuous APIs appear nowhere.
public protocol LocationSampling: Actor {
    /// Returns nil rather than throwing when no usable fix arrives in time; the
    /// caller submits without coordinates and the server bands it `unknown`,
    /// which fails closed.
    func requestOneShotLocation(timeout: TimeInterval) async -> LocationSample?
}
