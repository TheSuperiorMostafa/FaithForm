import Foundation

/// Scanning a check-in code, with every decision out of the camera's way.
///
/// The framework part of a scanner is small: open a session, receive strings,
/// stop. Everything that could be *wrong* is here instead, in plain Swift with
/// no `AVFoundation` import, so it can be exercised on any machine — the
/// permission sequence, what counts as a plausible payload, when a duplicate
/// read is the same code arriving twice, and what the person is told.
///
/// The camera adapter is `AVFoundationScanner`, and it makes no decisions.

// MARK: - Permission

/// The camera permission, as this feature needs to reason about it.
///
/// Faithful's own enum rather than `AVAuthorizationStatus`, for the reason
/// Prompt 7 established for Core Location: nothing above the adapter should
/// depend on a framework type, and the framework type is unconstructible on a
/// test runner.
public enum CameraAuthorization: String, Equatable, Sendable {
    /// **Never been asked.** This is the state the app must be in until the
    /// person taps "Scan". It is not an error and it is not a prompt.
    case notDetermined
    case denied
    case restricted
    case authorized

    public var canScan: Bool { self == .authorized }

    /// Whether asking would actually produce a prompt. iOS shows the camera
    /// alert exactly once; after that, only Settings can change the answer, and
    /// telling someone to "allow camera access" when no prompt will appear is
    /// worse than telling them nothing.
    public var promptWouldAppear: Bool { self == .notDetermined }
}

/// The camera, reduced to what scanning needs.
///
/// **What is deliberately absent:** any photo-library member, any capture-to-
/// disk member, and anything that returns an image. A QR scan needs a string
/// and nothing else, so the protocol cannot express saving a frame — which is
/// a stronger guarantee than a rule saying not to.
public protocol QrScanningFacade: Actor {
    func currentAuthorization() -> CameraAuthorization

    /// Raises the camera prompt.
    ///
    /// **Only ever called from an explicit "Scan" action.** Never at launch,
    /// during onboarding, while browsing a feed, or when enabling automatic
    /// attendance — `CheckInScanCoordinator` is the only caller and it is only
    /// reachable from that button.
    func requestAccess() async -> CameraAuthorization

    /// Starts delivering decoded strings. Idempotent.
    func start(onCode: @Sendable @escaping (String) -> Void) async throws

    /// Stops the session and releases the camera.
    func stop() async

    /// Whether this device has a usable camera at all. False in a simulator and
    /// on hardware with none — distinct from being denied, and a different
    /// message.
    func isAvailable() -> Bool
}

// MARK: - What a scanned string may be

/// What the scanner made of a decoded string.
public enum ScannedPayload: Equatable, Sendable {
    /// A Faithful check-in capability. **Opaque** — the client cannot read it,
    /// and the shape check below is a cheap filter, not a validation.
    case checkInToken(String)
    /// Something else entirely: a Wi-Fi code, a URL, a business card.
    case unrecognised
}

public enum ScannedPayloadReader {
    /// The wire format's prefix. Matching it lets the scanner ignore the poster
    /// beside the screen without a round trip, and *nothing more* — the token is
    /// signed, and only the server can say whether it is real.
    public static let tokenPrefix = "FF1."

    /// Matches `MAX_TOKEN_LENGTH` on the server. A longer string is refused
    /// there, so sending one would spend an attempt from the person's budget to
    /// learn what is already known here.
    public static let maximumLength = 1024

    public static func read(_ raw: String) -> ScannedPayload {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count <= maximumLength, trimmed.hasPrefix(tokenPrefix) else {
            return .unrecognised
        }
        // Four dot-separated parts, none empty. The signature is what actually
        // decides; this only avoids a pointless request.
        let parts = trimmed.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 4, !parts.contains(where: { $0.isEmpty }) else {
            return .unrecognised
        }
        return .checkInToken(trimmed)
    }
}

// MARK: - The typed fallback

/// The short code, mirrored from the server.
///
/// Duplicated deliberately rather than fetched: this is used to shape the
/// keyboard and to stop a hopeless request before it is sent, and a client that
/// had to ask the server what a code looks like could not do either offline.
/// The server normalises and validates again; this is convenience, never
/// authority. `tests/security/checkin-authority.test.ts` asserts the two
/// alphabets have not drifted apart.
public enum ShortCodeEntry {
    public static let alphabet = "BCDFGHJKLMNPQRTVWXY3479"
    public static let length = 7

    /// Folds case and drops separators. **Substitutes nothing** — every
    /// character a substitution table would map is already absent from the
    /// alphabet, so mapping one could only turn a typo into a different valid
    /// code and check someone into a service they did not choose.
    public static func normalise(_ input: String) -> String {
        String(input.uppercased().filter { alphabet.contains($0) }).prefix(length).description
    }

    public static func isComplete(_ input: String) -> Bool {
        normalise(input).count == length
    }
}

// MARK: - The scan session

/// What the person sees while scanning.
public enum ScanPhase: Equatable, Sendable {
    /// Before "Scan" is tapped. **The camera is not running and has not been
    /// asked for.**
    case idle
    /// The permission prompt is on screen.
    case requestingPermission
    case scanning
    /// A code was read and is with the server. The camera is already stopped.
    case submitting
    /// The server answered. `counted` is the only success.
    case finished(ScanOutcome)
    case blocked(ScanBlock)
}

public enum ScanOutcome: Equatable, Sendable {
    case counted(message: String)
    case alreadyCounted(message: String)
    case refused(message: String)

    /// **The only place a scan may be called a success.**
    ///
    /// Derived from the server's `outcome`, never from having read a code.
    /// A phone that scanned a perfectly valid code and lost the network has not
    /// checked anyone in, and saying otherwise would be a lie that a person
    /// only discovers when the church's report disagrees with them.
    public var isSuccess: Bool {
        switch self {
        case .counted, .alreadyCounted: return true
        case .refused: return false
        }
    }
}

public enum ScanBlock: String, Equatable, Sendable {
    case cameraDenied
    case cameraRestricted
    case cameraUnavailable
    case offline
}

/// Whether a decoded string should be acted on.
///
/// A metadata output fires continuously — the same code arrives many times a
/// second while it is in frame, and a rotating display puts a *new* code up
/// every thirty seconds. Without this, one glance at a projector would spend a
/// person's whole attempt budget in under a second.
public struct ScanDebounce: Equatable, Sendable {
    /// How long the same string is ignored after being acted on.
    public static let repeatWindow: TimeInterval = 10

    private var lastCode: String?
    private var lastAt: Date?

    public init() {}

    public func shouldSubmit(_ code: String, at now: Date) -> Bool {
        guard let lastCode, let lastAt, lastCode == code else { return true }
        return now.timeIntervalSince(lastAt) >= Self.repeatWindow
    }

    public func recording(_ code: String, at now: Date) -> ScanDebounce {
        var next = self
        next.lastCode = code
        next.lastAt = now
        return next
    }
}

/// A fresh identity for one scan.
///
/// **Random, every time.** Prompt 7 learned this the expensive way on the
/// geofence path: an idempotency key derived from stable inputs made a single
/// early refusal permanent for the rest of the service, because every
/// subsequent attempt replayed the refusal instead of being judged. A person who
/// scans, is refused, fixes the problem and scans again must get a *new*
/// verdict — so a new tap is a new identity.
public enum ScanAttemptIdentity {
    public static func make() -> String {
        // 16 random bytes, hex. Not derived from the token, the occurrence, or
        // the account — deriving from any of those is what caused the bug.
        var bytes = [UInt8](repeating: 0, count: 16)
        for index in bytes.indices { bytes[index] = UInt8.random(in: 0...255) }
        return "scan-" + bytes.map { String(format: "%02x", $0) }.joined()
    }

    public static func idempotencyKey(for attemptId: String) -> String {
        // The attempt id *is* the key. A retry of the same submission reuses it
        // and finds the first attempt; a new tap generates a new one.
        "qr-" + attemptId
    }
}
