import Foundation
import Observation

/// Where the onboarding flow currently is. Each case is a real state the
/// contract can produce — none of them renders invented content.
public enum DiscoveryPhase: Equatable, Sendable {
    case idle
    case searching
    case results([DiscoveredChurch], usedLocation: Bool)
    case empty
    case offline
    case failed(String)
}

/// How the person answered the location prompt.
///
/// `unavailable` is distinct from `denied`: a device with location services off
/// system-wide was never asked. `restricted` is distinct again — parental
/// controls or an MDM profile mean the person *cannot* grant it, so offering a
/// Settings link would be a dead end.
///
/// `authorizedAlways` was added for Prompt 7. Discovery only ever needs When In
/// Use and must never ask for more, but automatic attendance genuinely requires
/// Always — Core Location will not deliver a region event to a backgrounded or
/// terminated app without it. One enum covers both features because there is
/// one underlying `CLAuthorizationStatus`; having two would let them disagree.
public enum LocationAuthorization: Equatable, Sendable {
    case notDetermined
    case authorizedWhenInUse
    case authorizedAlways
    case denied
    case restricted
    case unavailable
}

extension LocationAuthorization {
    /// Whether any location may be read right now.
    public var hasAnyAccess: Bool {
        self == .authorizedWhenInUse || self == .authorizedAlways
    }

    /// Whether the OS will deliver region events with the app backgrounded or
    /// not running. Apple requires Always; When In Use silently delivers
    /// nothing, which would be a feature that appears to work and never fires.
    public var permitsRegionMonitoring: Bool { self == .authorizedAlways }

    /// Whether a Settings deep link is worth offering. `restricted` is not the
    /// person's decision to reverse, and `unavailable` is a device-wide switch.
    public var isRecoverableInSettings: Bool { self == .denied }
}

/// Supplies a single foreground fix. Abstracted so every test runs without
/// CoreLocation and without a device.
public protocol LocationProviding: Sendable {
    func authorizationStatus() async -> LocationAuthorization
    /// Requests foreground permission. Never background, never always-on.
    func requestWhenInUseAuthorization() async -> LocationAuthorization
    /// One fix, for one query. Nothing is retained.
    func currentCoordinate() async throws -> (latitude: Double, longitude: Double)
}

@Observable
@MainActor
public final class DiscoveryModel {
    public private(set) var phase: DiscoveryPhase = .idle
    public private(set) var locationAuthorization: LocationAuthorization = .notDetermined
    /// True once the person has seen why location is being asked for. The OS
    /// prompt is never raised before this.
    public private(set) var hasSeenLocationEducation = false

    public var query: String = ""

    private let api: APIClient
    private let location: LocationProviding

    public init(api: APIClient, location: LocationProviding) {
        self.api = api
        self.location = location
    }

    /// Manual search. Deliberately requires no location permission at all —
    /// someone who declines location must still be able to find their church.
    public func search() async {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        phase = .searching

        do {
            let response = try await api.send(
                "api/mobile/v1/churches/search",
                query: trimmed.isEmpty ? [:] : ["q": trimmed],
                authenticated: false,
                as: DiscoveryPage.self
            )
            let items = response.value?.items ?? []
            phase = items.isEmpty ? .empty : .results(items, usedLocation: false)
        } catch let error as APIError {
            phase = error.retryable ? .offline : .failed(error.displayMessage)
        } catch {
            phase = .offline
        }
    }

    /// Shows the education screen. The OS prompt comes only after an explicit
    /// tap on it — never at launch, and never as a side effect of opening
    /// discovery.
    public func beginNearbyFlow() async {
        hasSeenLocationEducation = true
        locationAuthorization = await location.authorizationStatus()
    }

    /// Called from the education screen's affirmative action.
    public func confirmNearby() async {
        let status = await location.requestWhenInUseAuthorization()
        locationAuthorization = status

        guard status == .authorizedWhenInUse else {
            // Declining is a first-class outcome, not a dead end: fall back to
            // whatever manual search would have produced.
            await search()
            return
        }

        phase = .searching
        do {
            let fix = try await location.currentCoordinate()
            let body = NearbyRequest(
                latitude: fix.latitude,
                longitude: fix.longitude,
                radiusKm: 40,
                limit: 20
            )
            let response = try await api.send(
                "api/mobile/v1/churches/nearby",
                method: .post,
                body: body,
                authenticated: false,
                as: DiscoveryPage.self
            )
            let items = response.value?.items ?? []
            phase = items.isEmpty ? .empty : .results(items, usedLocation: true)
        } catch let error as APIError {
            phase = error.retryable ? .offline : .failed(error.displayMessage)
        } catch {
            phase = .offline
        }
    }

    /// The coordinate leaves in a request body and is never stored on the
    /// device, never written to a log, and never sent a second time.
    struct NearbyRequest: Encodable, Sendable {
        let latitude: Double
        let longitude: Double
        let radiusKm: Double
        let limit: Int
    }
}
