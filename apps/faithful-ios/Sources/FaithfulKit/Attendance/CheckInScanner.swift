import Foundation

/// Submits a scanned or typed check-in code.
///
/// Separate from `AttendanceSubmitting` because the two carry different things:
/// a geofence attempt carries a position and a dwell, a scan carries a code and
/// nothing else. Folding them together would mean a scan path that *could*
/// send coordinates, and the cheapest way to guarantee it never does is for the
/// type not to have the field.
public protocol CheckInCodeSubmitting: Actor {
    func submit(
        _ submission: CheckInSubmission,
        idempotencyKey: String
    ) async throws -> AttendanceResult
}

/// One check-in attempt from a code.
///
/// Notice the absence: no occurrence, no church, no member, no position, no
/// device identifier. **The occurrence comes out of the code, server-side.** A
/// scanner has no idea which service it is looking at and must not be allowed to
/// claim one — otherwise scanning the 9 a.m. code and naming the 11 a.m. service
/// would be a request the server had to think about.
public struct CheckInSubmission: Equatable, Sendable {
    /// Exactly one of these is set.
    public let qrToken: String?
    public let shortCode: String?
    /// A fresh random identity for this scan. Recorded, never authority.
    public let scanAttemptId: String

    public init(qrToken: String?, shortCode: String?, scanAttemptId: String) {
        self.qrToken = qrToken
        self.shortCode = shortCode
        self.scanAttemptId = scanAttemptId
    }

    public static func scanned(_ token: String, attemptId: String) -> CheckInSubmission {
        CheckInSubmission(qrToken: token, shortCode: nil, scanAttemptId: attemptId)
    }

    public static func typed(_ code: String, attemptId: String) -> CheckInSubmission {
        CheckInSubmission(qrToken: nil, shortCode: code, scanAttemptId: attemptId)
    }
}

/// Drives one scan from the button to the server's verdict.
///
/// ## The permission rule, and where it is enforced
///
/// The camera is asked for in exactly one place: `beginScanning()`, which is
/// reachable only from an explicit "Scan" action. It is not asked for at launch,
/// during onboarding, while browsing churches or a feed, or when enabling
/// automatic attendance. Nothing else in this package holds a `QrScanningFacade`,
/// and `tests/security/checkin-privacy.test.ts` sweeps the native sources to
/// keep it that way.
///
/// ## What happens to a frame
///
/// Nothing. `QrScanningFacade` cannot return an image — it hands back decoded
/// strings — so there is no buffer to write, no file to leave behind, and no
/// photo-library permission to ask for. The session stops the instant a usable
/// code is read, before the request is even sent.
///
/// ## Single-flight
///
/// The in-flight flag is claimed **before** any suspension point. A metadata
/// output can fire several times in one frame interval, and a check that ran
/// after an `await` would let all of them through — the same TOCTOU that made
/// eight concurrent geofence submissions in Prompt 7.
public actor CheckInScanCoordinator {
    private let camera: QrScanningFacade
    private let submitter: CheckInCodeSubmitting
    private let now: @Sendable () -> Date

    private var phase: ScanPhase = .idle
    private var debounce = ScanDebounce()
    private var submitting = false

    public init(
        camera: QrScanningFacade,
        submitter: CheckInCodeSubmitting,
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.camera = camera
        self.submitter = submitter
        self.now = now
    }

    public func currentPhase() -> ScanPhase { phase }

    /// Where the camera prompt lives.
    ///
    /// The order matters. Availability first, because telling someone to grant
    /// access on a device with no camera is a dead end. Then the *current*
    /// authorization, because a denied one produces no prompt and the person
    /// needs Settings rather than a button that appears to do nothing. Only then
    /// is access requested.
    public func beginScanning() async -> ScanPhase {
        guard await camera.isAvailable() else {
            phase = .blocked(.cameraUnavailable)
            return phase
        }

        var authorization = await camera.currentAuthorization()

        if authorization == .notDetermined {
            phase = .requestingPermission
            authorization = await camera.requestAccess()
        }

        switch authorization {
        case .authorized:
            break
        case .denied:
            phase = .blocked(.cameraDenied)
            return phase
        case .restricted:
            phase = .blocked(.cameraRestricted)
            return phase
        case .notDetermined:
            // Asked and got no answer — the sheet was dismissed by something
            // other than a choice. Nothing to report and nothing to start.
            phase = .idle
            return phase
        }

        do {
            try await camera.start { [weak self] code in
                guard let self else { return }
                Task { await self.handleScanned(code) }
            }
            phase = .scanning
        } catch {
            phase = .blocked(.cameraUnavailable)
        }
        return phase
    }

    /// Stops the camera. Called when the screen goes away, and on every outcome.
    public func stopScanning() async {
        await camera.stop()
        if case .scanning = phase { phase = .idle }
    }

    /// A decoded string arrived.
    ///
    /// Most of them are noise: the same code re-read many times a second, or
    /// something that is not a Faithful code at all. Both are ignored silently —
    /// a scanner that complained about every poster in frame would be unusable.
    public func handleScanned(_ raw: String) async {
        guard case .scanning = phase else { return }

        guard case .checkInToken(let token) = ScannedPayloadReader.read(raw) else { return }
        guard debounce.shouldSubmit(token, at: now()) else { return }
        debounce = debounce.recording(token, at: now())

        await submit(.scanned(token, attemptId: ScanAttemptIdentity.make()))
    }

    /// Someone typed the code instead.
    ///
    /// Deliberately available whether or not the camera was ever started: a
    /// person who denied camera access, or whose camera is broken, reaches this
    /// without being asked for a permission they are not going to grant.
    public func submitTypedCode(_ input: String) async -> ScanPhase {
        let normalised = ShortCodeEntry.normalise(input)
        guard ShortCodeEntry.isComplete(normalised) else { return phase }
        await submit(.typed(normalised, attemptId: ScanAttemptIdentity.make()))
        return phase
    }

    private func submit(_ submission: CheckInSubmission) async {
        // **Claimed before any `await`.** Two codes arriving in the same frame
        // interval must produce one request.
        guard !submitting else { return }
        submitting = true
        defer { submitting = false }

        phase = .submitting
        // The camera is released before the request, not after it. A scan that
        // takes four seconds on a bad connection should not hold the camera
        // open for four seconds.
        await camera.stop()

        do {
            let result = try await submitter.submit(
                submission,
                idempotencyKey: ScanAttemptIdentity.idempotencyKey(for: submission.scanAttemptId)
            )
            phase = .finished(Self.outcome(for: result))
        } catch let error as APIError where error.code == .unavailable {
            // **Not a refusal, and emphatically not a success.** Nothing was
            // decided, so the person is told to try again rather than shown a
            // tick they will discover was wrong when the church's report
            // disagrees with them.
            phase = .blocked(.offline)
        } catch let error as APIError {
            phase = .finished(.refused(message: error.message))
        } catch {
            phase = .blocked(.offline)
        }
    }

    /// Maps the server's verdict onto what the person is shown.
    ///
    /// **`counted` and `already_counted` are the only successes**, and both come
    /// from the server. There is no branch here that reaches a success from
    /// anything the device observed.
    static func outcome(for result: AttendanceResult) -> ScanOutcome {
        switch result.outcome {
        case .counted:
            return .counted(message: result.message)
        case .alreadyCounted:
            return .alreadyCounted(message: result.message)
        case .pendingConfirmation, .rejected, .reversed:
            // A QR check-in never pends — there is no dwell to wait out — so
            // reaching here means the server refused, whatever it called it.
            return .refused(message: result.message)
        case .unknown:
            // An outcome added after this build shipped. **Refused**, not
            // assumed successful: a client that treats what it does not
            // understand as a check-in will one day show a tick for an outcome
            // the server invented to mean the opposite.
            return .refused(message: result.message)
        }
    }
}
