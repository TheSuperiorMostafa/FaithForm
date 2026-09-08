import Foundation
import Observation

/// Where the automatic-attendance opt-in currently stands.
///
/// **Progressive by construction.** The cases are ordered, and each one is only
/// reachable from the one before. There is no path from `introduction` to a
/// permission prompt, because the education steps sit between them as real
/// states rather than as a flag someone could forget to check.
///
/// This is why nothing here can prompt at launch: the model starts at
/// `.notStarted`, and only an explicit action moves it.
public enum AutomaticAttendanceStep: Equatable, Sendable {
    /// The feature has never been offered. Nothing has been requested.
    case notStarted
    /// What automatic attendance is and what it does with location.
    case introduction
    /// Why the app needs foreground location, shown before the OS prompt.
    case foregroundEducation
    /// Why it needs Always, shown before the second OS prompt.
    case backgroundEducation
    /// Waiting on the server to record consent.
    case requestingConsent
    /// Everything is in place.
    case ready
    /// A state the person can act on.
    case blocked(AutomaticAttendanceBlocker)
}

/// Why automatic attendance is not currently working.
///
/// Each maps to different copy and a different action, which is the reason they
/// are distinct cases rather than one `failed(String)`. Telling someone to open
/// Settings when the real problem is that their church has not enabled the
/// feature would waste their time.
public enum AutomaticAttendanceBlocker: String, Equatable, Sendable, CaseIterable {
    /// The OS prompt was declined. Recoverable in Settings.
    case locationDenied
    /// Parental controls or an MDM profile. **Not** recoverable by this person.
    case locationRestricted
    /// Location services are off device-wide, for every app.
    case locationServicesOff
    /// When In Use granted, Always not. The feature cannot work.
    case needsAlwaysAuthorization
    /// Approximate location granted. Cannot resolve a campus-sized region.
    case reducedAccuracy
    /// This device cannot monitor regions.
    case monitoringUnavailable
    /// The church has not confirmed who this person is.
    case noPeopleLink
    /// Server consent is absent or withdrawn.
    case consentMissing
    /// The church has automatic attendance switched off.
    case churchDisabled
    /// The church has no campus with a position set.
    case noCampus
    /// Offline, or the configuration could not be fetched.
    case unavailable

    public var isRecoverableInSettings: Bool {
        switch self {
        case .locationDenied, .needsAlwaysAuthorization, .reducedAccuracy, .locationServicesOff:
            return true
        default:
            return false
        }
    }
}

/// The screen model for automatic attendance.
///
/// Holds no Core Location type and receives no provider callback: it is driven
/// entirely by the coordinator and the reconciler, so every state below can be
/// produced in a test without a device.
@Observable
@MainActor
public final class AutomaticAttendanceModel {
    public private(set) var step: AutomaticAttendanceStep = .notStarted
    public private(set) var authorization: LocationAuthorization = .notDetermined
    public private(set) var accuracy: LocationAccuracyAuthorization = .full
    public private(set) var monitoredRegionCount = 0
    public private(set) var isWorking = false

    /// The most recent server verdict, if there is one to show. Never a local
    /// guess — this is populated only from a real result.
    public private(set) var lastResult: RecentCheckIn?

    public struct RecentCheckIn: Equatable, Sendable {
        public let occurrenceLabel: String
        public let countedAt: Date
        public let wasAlreadyCounted: Bool
    }

    private let coordinator: AutomaticAttendanceCoordinator
    private let authorizer: any LocationAuthorizing
    private let consent: any ConsentWriting

    /// Records consent server-side. Separate from the OS permission on purpose.
    public protocol ConsentWriting: Actor {
        func setAutoAttendanceConsent(_ value: String) async throws -> String
    }

    public init(
        coordinator: AutomaticAttendanceCoordinator,
        authorizer: any LocationAuthorizing,
        consent: any ConsentWriting
    ) {
        self.coordinator = coordinator
        self.authorizer = authorizer
        self.consent = consent
    }

    /// Reads current state without requesting anything.
    ///
    /// Safe to call on appear, on foreground, and after returning from
    /// Settings. It raises no prompt — that is the whole point, and it is what
    /// lets the readiness screen be shown anywhere.
    public func refresh() async {
        authorization = await authorizer.currentAuthorization()
        accuracy = await authorizer.currentAccuracy()

        let settings = await coordinator.currentSettings()
        guard settings.enabled else {
            if case .blocked = step {} else { step = .notStarted }
            return
        }

        step = resolveStep(settings: settings)
    }

    /// The person tapped "Set up automatic attendance".
    ///
    /// Shows the explanation. **Does not prompt.**
    public func begin() {
        step = .introduction
    }

    /// They read the introduction and continued.
    public func continueToForegroundEducation() {
        step = .foregroundEducation
    }

    /// They read the foreground explanation and agreed.
    ///
    /// This is the first point at which any OS prompt is raised, and it is
    /// three deliberate taps after opening the app.
    public func requestForegroundPermission() async {
        isWorking = true
        defer { isWorking = false }

        authorization = await authorizer.requestWhenInUse()

        switch authorization {
        case .authorizedWhenInUse, .authorizedAlways:
            // Never chain straight into the Always prompt. iOS shows it once,
            // and spending it before the person knows what it is for is how an
            // app gets permanently denied.
            step = .backgroundEducation
        case .denied:
            step = .blocked(.locationDenied)
        case .restricted:
            step = .blocked(.locationRestricted)
        case .unavailable:
            step = .blocked(.locationServicesOff)
        case .notDetermined:
            step = .foregroundEducation
        }
    }

    /// They read the Always explanation and agreed.
    public func requestBackgroundPermission() async {
        isWorking = true
        defer { isWorking = false }

        authorization = await authorizer.requestAlways()
        accuracy = await authorizer.currentAccuracy()

        guard authorization.permitsRegionMonitoring else {
            step = .blocked(
                authorization == .denied ? .locationDenied : .needsAlwaysAuthorization
            )
            return
        }
        guard accuracy == .full else {
            step = .blocked(.reducedAccuracy)
            return
        }

        await grantConsentAndStart()
    }

    /// Records server consent, then reconciles.
    ///
    /// Consent is written **before** any region is registered. Monitoring
    /// someone's location while the server would refuse every attempt would be
    /// collecting location for nothing.
    private func grantConsentAndStart() async {
        step = .requestingConsent
        do {
            let state = try await consent.setAutoAttendanceConsent("granted")
            guard state == "granted" else {
                step = .blocked(.consentMissing)
                return
            }
        } catch {
            step = .blocked(.unavailable)
            return
        }

        var settings = await coordinator.currentSettings()
        settings.enabled = true
        settings.serverConsent = "granted"

        let outcome = await coordinator.enable(settings: settings)
        monitoredRegionCount = outcome.monitoring
        step = resolveStep(settings: settings, outcome: outcome)
    }

    /// The person turned it off.
    ///
    /// Withdraws server consent, removes every region, cancels in-flight work
    /// and purges unsent evidence. Consent is withdrawn even if the network
    /// call fails locally — the device stops regardless, and the server state
    /// is reconciled on the next successful request.
    public func disable() async {
        isWorking = true
        defer { isWorking = false }

        // Local teardown first: whatever happens to the network call, this
        // device stops watching.
        await coordinator.disable()
        monitoredRegionCount = 0
        lastResult = nil

        _ = try? await consent.setAutoAttendanceConsent("revoked")
        step = .notStarted
    }

    private func resolveStep(
        settings: AutomaticAttendanceSettings,
        outcome: ReconcileOutcome? = nil
    ) -> AutomaticAttendanceStep {
        if authorization == .unavailable { return .blocked(.locationServicesOff) }
        if authorization == .restricted { return .blocked(.locationRestricted) }
        if authorization == .denied { return .blocked(.locationDenied) }
        if !authorization.permitsRegionMonitoring { return .blocked(.needsAlwaysAuthorization) }
        if accuracy != .full { return .blocked(.reducedAccuracy) }
        if settings.serverConsent != "granted" { return .blocked(.consentMissing) }

        switch outcome?.refusal {
        case "no_people_link": return .blocked(.noPeopleLink)
        case "consent_required", "consent_revoked": return .blocked(.consentMissing)
        case "geofence_disabled": return .blocked(.churchDisabled)
        case "no_campus_configured": return .blocked(.noCampus)
        case "location_unavailable", "monitoring_unavailable":
            return .blocked(.monitoringUnavailable)
        case "configuration_unavailable": return .blocked(.unavailable)
        case "needs_always_authorization": return .blocked(.needsAlwaysAuthorization)
        case "needs_full_accuracy": return .blocked(.reducedAccuracy)
        case .some: return .blocked(.unavailable)
        case nil: return .ready
        }
    }

    /// Records a server verdict for display. Only ever called with a real one.
    public func recordResult(occurrenceLabel: String, countedAt: Date, alreadyCounted: Bool) {
        lastResult = RecentCheckIn(
            occurrenceLabel: occurrenceLabel,
            countedAt: countedAt,
            wasAlreadyCounted: alreadyCounted
        )
    }
}
