import Foundation
import Observation

/// The check-in scanner screen.
///
/// **The camera is not touched until `startScanning()` runs**, and nothing
/// calls that except the "Scan the code" button. The screen's initial state is
/// `.idle`, `onAppear` does not change it, and the typed fallback is reachable
/// from that same idle state — so a person who never wants to grant camera
/// access can check in without ever seeing a prompt.
///
/// That is a property of the structure rather than a rule to remember: this
/// model is the only thing that holds a `CheckInScanCoordinator`, and the
/// coordinator is the only thing that holds a `QrScanningFacade`.
@MainActor
@Observable
public final class CheckInScannerModel {
    public private(set) var phase: ScanPhase = .idle
    /// What the person has typed so far, normalised as they type.
    public var typedCode: String = "" {
        didSet {
            let normalised = ShortCodeEntry.normalise(typedCode)
            if normalised != typedCode { typedCode = normalised }
        }
    }

    private let coordinator: CheckInScanCoordinator

    public init(coordinator: CheckInScanCoordinator) {
        self.coordinator = coordinator
    }

    public var canSubmitTypedCode: Bool { ShortCodeEntry.isComplete(typedCode) }

    /// Whether the typed field is worth showing.
    ///
    /// **Always.** It is not a fallback that appears once something has failed:
    /// a person who cannot use a camera should not have to fail first to find
    /// the way that works for them.
    public var showsTypedEntry: Bool { true }

    /// The only path to a camera prompt.
    public func startScanning() async {
        phase = await coordinator.beginScanning()
    }

    public func stopScanning() async {
        await coordinator.stopScanning()
        phase = await coordinator.currentPhase()
    }

    public func submitTypedCode() async {
        guard canSubmitTypedCode else { return }
        phase = await coordinator.submitTypedCode(typedCode)
        if case .finished(let outcome) = phase, outcome.isSuccess {
            // A spent code is cleared from the field. Leaving it on screen
            // invites a second attempt that can only be refused.
            typedCode = ""
        }
    }

    /// Refreshes from the coordinator after a scan completes in the background.
    public func refresh() async {
        phase = await coordinator.currentPhase()
    }

    public func reset() async {
        await coordinator.stopScanning()
        typedCode = ""
        phase = await coordinator.currentPhase()
    }

    // MARK: - What the screen says

    public var blockTitle: String? {
        guard case .blocked(let block) = phase else { return nil }
        switch block {
        case .cameraDenied: return L.checkinScanCameraDeniedTitle
        case .cameraRestricted: return L.checkinScanCameraRestrictedTitle
        case .cameraUnavailable: return L.checkinScanCameraUnavailableTitle
        case .offline: return L.checkinScanOfflineTitle
        }
    }

    public var blockBody: String? {
        guard case .blocked(let block) = phase else { return nil }
        switch block {
        case .cameraDenied: return L.checkinScanCameraDeniedBody
        case .cameraRestricted: return L.checkinScanCameraRestrictedBody
        case .cameraUnavailable: return L.checkinScanCameraUnavailableBody
        case .offline: return L.checkinScanOfflineBody
        }
    }

    /// Settings is offered only where it would help.
    ///
    /// A restricted camera is a device policy the person cannot change, and an
    /// absent one is hardware. Sending either of them to Settings would be a
    /// button that does nothing.
    public var offersSettings: Bool {
        if case .blocked(.cameraDenied) = phase { return true }
        return false
    }

    /// The result line. **Only ever derived from the server's own outcome.**
    public var resultMessage: String? {
        guard case .finished(let outcome) = phase else { return nil }
        switch outcome {
        case .counted(let message), .alreadyCounted(let message), .refused(let message):
            return message
        }
    }

    /// Sets the phase directly. **Tests only**, and named so.
    ///
    /// Exists so every block state's copy can be asserted without contriving
    /// four different device failures; production code has no reason to call it
    /// and nothing does.
    func setPhaseForTesting(_ value: ScanPhase) { phase = value }

    public var resultIsSuccess: Bool {
        guard case .finished(let outcome) = phase else { return false }
        return outcome.isSuccess
    }
}
