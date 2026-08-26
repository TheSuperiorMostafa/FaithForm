import Foundation
import Testing
@testable import FaithfulKit

// ---------------------------------------------------------------------------
// Doubles
// ---------------------------------------------------------------------------

/// A camera stand-in that records every prompt it was asked to raise.
///
/// The point of the abstraction: "Faithful never asks for the camera until you
/// tap Scan" becomes an assertion on a list rather than something a reviewer has
/// to take on trust.
actor FakeCamera: QrScanningFacade {
    var authorization: CameraAuthorization
    var available: Bool
    var startThrows: Error?

    /// Every permission request, in order. **The heart of the prompt rule.**
    private(set) var prompts: [String] = []
    private(set) var startCount = 0
    private(set) var stopCount = 0

    private var handler: (@Sendable (String) -> Void)?

    init(
        authorization: CameraAuthorization = .notDetermined,
        available: Bool = true,
        startThrows: Error? = nil
    ) {
        self.authorization = authorization
        self.available = available
        self.startThrows = startThrows
    }

    /// What the OS prompt will answer, when it is finally raised.
    var grantOnRequest: CameraAuthorization = .authorized

    func currentAuthorization() -> CameraAuthorization { authorization }

    func requestAccess() async -> CameraAuthorization {
        prompts.append("camera")
        authorization = grantOnRequest
        return authorization
    }

    func start(onCode: @Sendable @escaping (String) -> Void) async throws {
        if let startThrows { throw startThrows }
        startCount += 1
        handler = onCode
    }

    func stop() async {
        stopCount += 1
        handler = nil
    }

    func isAvailable() -> Bool { available }

    /// Simulates the metadata output firing.
    func emit(_ code: String) {
        handler?(code)
    }

    var isRunning: Bool { handler != nil }
}

actor FakeCodeSubmitter: CheckInCodeSubmitting {
    var result: AttendanceResult
    var error: Error?

    private(set) var submissions: [CheckInSubmission] = []
    private(set) var keys: [String] = []

    init(
        result: AttendanceResult = AttendanceResult(
            outcome: .counted, message: "You're checked in."
        ),
        error: Error? = nil
    ) {
        self.result = result
        self.error = error
    }

    func submit(
        _ submission: CheckInSubmission,
        idempotencyKey: String
    ) async throws -> AttendanceResult {
        submissions.append(submission)
        keys.append(idempotencyKey)
        if let error { throw error }
        return result
    }
}

private func makeCoordinator(
    camera: FakeCamera,
    submitter: FakeCodeSubmitter,
    now: @escaping @Sendable () -> Date = { Date(timeIntervalSince1970: 1_800_000_000) }
) -> CheckInScanCoordinator {
    CheckInScanCoordinator(camera: camera, submitter: submitter, now: now)
}

private let validToken = "FF1.abc12345.eyJ0IjoiY2hlY2tpbi5xciJ9.c2lnbmF0dXJl"

// ---------------------------------------------------------------------------
// The permission rule
// ---------------------------------------------------------------------------

@Suite("Camera permission is asked for once, and only from Scan")
struct CameraPermissionTests {

    @Test("constructing the coordinator prompts for nothing")
    func constructionIsSilent() async {
        let camera = FakeCamera()
        _ = makeCoordinator(camera: camera, submitter: FakeCodeSubmitter())

        // Not a formality. This is the whole "never at launch, never during
        // onboarding, never while browsing a feed" requirement: nothing but an
        // explicit action can reach `requestAccess`, and construction is not an
        // action.
        #expect(await camera.prompts.isEmpty)
        #expect(await camera.startCount == 0)
    }

    @Test("the typed fallback never touches the camera")
    func typedEntryNeverPrompts() async {
        let camera = FakeCamera()
        let submitter = FakeCodeSubmitter()
        let coordinator = makeCoordinator(camera: camera, submitter: submitter)

        _ = await coordinator.submitTypedCode("BCD4G7J")

        // Someone who will never grant camera access must be able to check in
        // without ever being asked. If typing raised a prompt, "enter the code
        // instead" would be a lie.
        #expect(await camera.prompts.isEmpty)
        #expect(await submitter.submissions.count == 1)
        #expect(await submitter.submissions[0].shortCode == "BCD4G7J")
    }

    @Test("Scan raises exactly one prompt and then starts")
    func scanPromptsOnce() async {
        let camera = FakeCamera(authorization: .notDetermined)
        let coordinator = makeCoordinator(camera: camera, submitter: FakeCodeSubmitter())

        let phase = await coordinator.beginScanning()

        #expect(await camera.prompts == ["camera"])
        #expect(await camera.startCount == 1)
        #expect(phase == .scanning)
    }

    @Test("an already-granted camera is not asked again")
    func grantedIsNotReprompted() async {
        let camera = FakeCamera(authorization: .authorized)
        let coordinator = makeCoordinator(camera: camera, submitter: FakeCodeSubmitter())

        _ = await coordinator.beginScanning()

        #expect(await camera.prompts.isEmpty)
        #expect(await camera.startCount == 1)
    }

    @Test("a denied camera is not asked again either")
    func deniedIsNotReprompted() async {
        let camera = FakeCamera(authorization: .denied)
        let coordinator = makeCoordinator(camera: camera, submitter: FakeCodeSubmitter())

        let phase = await coordinator.beginScanning()

        // iOS shows the camera alert once. Asking again produces nothing, so
        // the person is told to use Settings instead of tapping a button that
        // silently does nothing.
        #expect(await camera.prompts.isEmpty)
        #expect(phase == .blocked(.cameraDenied))
        #expect(await camera.startCount == 0)
    }

    @Test("a restricted camera is a different answer from a denied one")
    func restrictedIsDistinct() async {
        let camera = FakeCamera(authorization: .restricted)
        let coordinator = makeCoordinator(camera: camera, submitter: FakeCodeSubmitter())

        // Parental controls or an MDM profile. Sending this person to Settings
        // would waste their time — they cannot change it.
        #expect(await coordinator.beginScanning() == .blocked(.cameraRestricted))
    }

    @Test("availability is checked before permission")
    func availabilityFirst() async {
        let camera = FakeCamera(authorization: .notDetermined, available: false)
        let coordinator = makeCoordinator(camera: camera, submitter: FakeCodeSubmitter())

        let phase = await coordinator.beginScanning()

        #expect(phase == .blocked(.cameraUnavailable))
        // Asking for a camera that does not exist would raise a prompt whose
        // answer changes nothing.
        #expect(await camera.prompts.isEmpty)
    }

    @Test("a dismissed prompt leaves the screen idle, not blocked")
    func dismissedPromptIsIdle() async {
        let camera = FakeCamera(authorization: .notDetermined)
        await camera.setGrant(.notDetermined)
        let coordinator = makeCoordinator(camera: camera, submitter: FakeCodeSubmitter())

        let phase = await coordinator.beginScanning()

        // Nothing was denied and nothing was granted. Showing "camera denied"
        // here would be wrong, and would send the person to Settings to change
        // a setting they never made.
        #expect(phase == .idle)
        #expect(await camera.startCount == 0)
    }

    @Test("a camera that fails to start reports unavailable, not denied")
    func startFailureIsUnavailable() async {
        let camera = FakeCamera(
            authorization: .authorized,
            startThrows: AVScannerTestError.broken
        )
        let coordinator = makeCoordinator(camera: camera, submitter: FakeCodeSubmitter())

        #expect(await coordinator.beginScanning() == .blocked(.cameraUnavailable))
    }
}

enum AVScannerTestError: Error { case broken }

extension FakeCamera {
    func setGrant(_ value: CameraAuthorization) { grantOnRequest = value }
}

// ---------------------------------------------------------------------------
// What a scanned string means
// ---------------------------------------------------------------------------

@Suite("Payload reading")
struct PayloadReadingTests {

    @Test("a Faithful token is recognised")
    func recognisesToken() {
        #expect(ScannedPayloadReader.read(validToken) == .checkInToken(validToken))
    }

    @Test("surrounding whitespace is tolerated")
    func trimsWhitespace() {
        #expect(ScannedPayloadReader.read("  \(validToken)\n") == .checkInToken(validToken))
    }

    @Test("anything else is ignored silently")
    func ignoresEverythingElse() {
        for other in [
            "https://example.org",
            "WIFI:S:Church;T:WPA;P:hunter2;;",
            "BEGIN:VCARD\nEND:VCARD",
            "",
            "FF1",
            "FF1.only.three",
            "FF1..empty.part",
            "FF2.a.b.c",
        ] {
            #expect(ScannedPayloadReader.read(other) == .unrecognised, "\(other)")
        }
    }

    @Test("an oversized payload is refused before it is sent")
    func refusesOversized() {
        let huge = "FF1.a.\(String(repeating: "x", count: 2000)).b"
        // The server refuses anything past `MAX_TOKEN_LENGTH`, so sending this
        // would spend one of the person's attempts to learn what is already
        // known here.
        #expect(ScannedPayloadReader.read(huge) == .unrecognised)
    }
}

// ---------------------------------------------------------------------------
// Debounce
// ---------------------------------------------------------------------------

@Suite("Repeated reads")
struct ScanDebounceTests {

    @Test("the same code in frame is acted on once")
    func sameCodeOnce() async {
        let camera = FakeCamera(authorization: .authorized)
        let submitter = FakeCodeSubmitter()
        let coordinator = makeCoordinator(camera: camera, submitter: submitter)
        _ = await coordinator.beginScanning()

        // A metadata output fires many times a second while a code is in view.
        for _ in 0..<25 {
            await coordinator.handleScanned(validToken)
        }

        #expect(await submitter.submissions.count == 1)
    }

    @Test("a different code is acted on immediately")
    func differentCodeIsNew() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        var debounce = ScanDebounce()
        #expect(debounce.shouldSubmit("a", at: now))
        debounce = debounce.recording("a", at: now)

        #expect(!debounce.shouldSubmit("a", at: now))
        // The display rotated. That is a genuinely new code and refusing it
        // would make the person wait out a window for nothing.
        #expect(debounce.shouldSubmit("b", at: now))
    }

    @Test("the same code becomes actionable again after the window")
    func sameCodeAfterWindow() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        var debounce = ScanDebounce()
        debounce = debounce.recording("a", at: now)

        #expect(!debounce.shouldSubmit("a", at: now.addingTimeInterval(5)))
        #expect(debounce.shouldSubmit("a", at: now.addingTimeInterval(ScanDebounce.repeatWindow)))
    }

    @Test("unrecognised codes never reach the server")
    func noiseIsNotSubmitted() async {
        let camera = FakeCamera(authorization: .authorized)
        let submitter = FakeCodeSubmitter()
        let coordinator = makeCoordinator(camera: camera, submitter: submitter)
        _ = await coordinator.beginScanning()

        await coordinator.handleScanned("https://example.org")
        await coordinator.handleScanned("WIFI:S:x;;")

        // A scanner that complained about every poster in frame would be
        // unusable, and each complaint would cost a rate-limit token.
        #expect(await submitter.submissions.isEmpty)
    }

    @Test("a code arriving before Scan is ignored")
    func ignoresCodesWhenNotScanning() async {
        let submitter = FakeCodeSubmitter()
        let coordinator = makeCoordinator(camera: FakeCamera(), submitter: submitter)

        await coordinator.handleScanned(validToken)

        #expect(await submitter.submissions.isEmpty)
    }
}

// ---------------------------------------------------------------------------
// Attempt identity
// ---------------------------------------------------------------------------

@Suite("Every scan is its own attempt")
struct ScanIdentityTests {

    @Test("two scans never share an identity")
    func identitiesAreDistinct() {
        var seen = Set<String>()
        for _ in 0..<500 { seen.insert(ScanAttemptIdentity.make()) }
        #expect(seen.count == 500)
    }

    @Test("the key is derived from the attempt, not from the code")
    func keyFollowsTheAttempt() {
        let first = ScanAttemptIdentity.make()
        let second = ScanAttemptIdentity.make()

        // **The Prompt 7 lesson, applied.** A key derived from stable inputs —
        // the account, the occurrence, the token — made one early refusal
        // permanent for the rest of the service, because every later attempt
        // replayed it. A person who is refused, fixes the problem, and scans
        // again must get a fresh verdict.
        #expect(ScanAttemptIdentity.idempotencyKey(for: first)
                != ScanAttemptIdentity.idempotencyKey(for: second))
        #expect(ScanAttemptIdentity.idempotencyKey(for: first)
                == ScanAttemptIdentity.idempotencyKey(for: first))
    }

    @Test("a refused scan does not poison the next one")
    func refusalIsNotSticky() async {
        let camera = FakeCamera(authorization: .authorized)
        let submitter = FakeCodeSubmitter(
            result: AttendanceResult(outcome: .rejected, message: "That code has expired.")
        )
        let coordinator = makeCoordinator(camera: camera, submitter: submitter)

        _ = await coordinator.beginScanning()
        await coordinator.handleScanned(validToken)

        await submitter.setResult(
            AttendanceResult(outcome: .counted, message: "You're checked in.")
        )
        _ = await coordinator.beginScanning()
        await coordinator.handleScanned("FF1.abc12345.b3RoZXI.c2ln")

        let keys = await submitter.keys
        #expect(keys.count == 2)
        #expect(keys[0] != keys[1], "the second attempt replayed the first refusal")
    }
}

extension FakeCodeSubmitter {
    func setResult(_ value: AttendanceResult) { result = value }
    func setError(_ value: Error?) { error = value }
}

// ---------------------------------------------------------------------------
// Never count locally
// ---------------------------------------------------------------------------

@Suite("Only the server may say someone was counted")
struct ScanOutcomeTests {

    @Test("counted and already-counted are the only successes")
    func onlyServerSuccesses() {
        #expect(CheckInScanCoordinator.outcome(
            for: AttendanceResult(outcome: .counted, message: "in")
        ).isSuccess)
        #expect(CheckInScanCoordinator.outcome(
            for: AttendanceResult(outcome: .alreadyCounted, message: "already")
        ).isSuccess)

        for refused in [AttendanceOutcome.rejected, .reversed, .pendingConfirmation] {
            #expect(!CheckInScanCoordinator.outcome(
                for: AttendanceResult(outcome: refused, message: "no")
            ).isSuccess, "\(refused)")
        }
    }

    @Test("an outcome this build does not know is refused, never assumed")
    func unknownOutcomeIsRefused() {
        let future = AttendanceResult(outcome: .unknown("counted_provisionally"), message: "?")
        // A client that treats what it does not understand as a check-in will
        // one day show a tick for an outcome the server invented to mean the
        // opposite.
        #expect(!CheckInScanCoordinator.outcome(for: future).isSuccess)
    }

    @Test("a network failure is not a check-in")
    func offlineIsNotSuccess() async {
        let camera = FakeCamera(authorization: .authorized)
        let submitter = FakeCodeSubmitter(
            error: APIError(code: .unavailable, message: "no network")
        )
        let coordinator = makeCoordinator(camera: camera, submitter: submitter)

        _ = await coordinator.beginScanning()
        await coordinator.handleScanned(validToken)

        // **The rule that matters most here.** A phone that read a perfectly
        // valid code and lost the network has checked nobody in, and a tick
        // would be a lie the person only discovers when the church's report
        // disagrees with them.
        #expect(await coordinator.currentPhase() == .blocked(.offline))
    }

    @Test("a server refusal shows the server's own message")
    func refusalUsesServerMessage() async {
        let camera = FakeCamera(authorization: .authorized)
        let submitter = FakeCodeSubmitter(
            result: AttendanceResult(
                outcome: .rejected,
                message: "Your church needs to confirm who you are first."
            )
        )
        let coordinator = makeCoordinator(camera: camera, submitter: submitter)

        _ = await coordinator.beginScanning()
        await coordinator.handleScanned(validToken)

        #expect(await coordinator.currentPhase() == .finished(
            .refused(message: "Your church needs to confirm who you are first.")
        ))
    }
}

// ---------------------------------------------------------------------------
// The camera is released
// ---------------------------------------------------------------------------

@Suite("Camera lifetime")
struct CameraLifetimeTests {

    @Test("the camera stops before the request is sent, not after")
    func stopsBeforeSubmitting() async {
        let camera = FakeCamera(authorization: .authorized)
        let submitter = FakeCodeSubmitter()
        let coordinator = makeCoordinator(camera: camera, submitter: submitter)

        _ = await coordinator.beginScanning()
        #expect(await camera.isRunning)

        await coordinator.handleScanned(validToken)

        // A four-second request on a bad connection must not hold the camera
        // open for four seconds — the indicator is on and nothing is scanning.
        #expect(await camera.stopCount >= 1)
        #expect(!(await camera.isRunning))
    }

    @Test("leaving the screen releases the camera")
    func stopReleasesCamera() async {
        let camera = FakeCamera(authorization: .authorized)
        let coordinator = makeCoordinator(camera: camera, submitter: FakeCodeSubmitter())

        _ = await coordinator.beginScanning()
        await coordinator.stopScanning()

        #expect(await camera.stopCount == 1)
        #expect(await coordinator.currentPhase() == .idle)
    }

    @Test("two codes in one frame interval produce one request")
    func singleFlight() async {
        let camera = FakeCamera(authorization: .authorized)
        let submitter = FakeCodeSubmitter()
        let coordinator = makeCoordinator(camera: camera, submitter: submitter)
        _ = await coordinator.beginScanning()

        // Two *different* codes, so the debounce does not mask the guard.
        async let first: Void = coordinator.handleScanned(validToken)
        async let second: Void = coordinator.handleScanned("FF1.abc12345.b3RoZXI.c2ln")
        _ = await (first, second)

        #expect(await submitter.submissions.count == 1)
    }
}

// ---------------------------------------------------------------------------
// The typed code
// ---------------------------------------------------------------------------

@Suite("Typed short codes")
struct ShortCodeEntryTests {

    @Test("the alphabet matches the server's")
    func alphabetMatchesServer() {
        // Drift here would let a client refuse a code the server would have
        // accepted, which reads to the person as a broken code rather than a
        // broken app. `tests/security/checkin-authority.test.ts` asserts the
        // same equality from the other side.
        #expect(ShortCodeEntry.alphabet == "BCDFGHJKLMNPQRTVWXY3479")
        #expect(ShortCodeEntry.length == 7)
        for confusable in ["0", "O", "1", "I", "2", "Z", "5", "S", "6", "8", "U"] {
            #expect(!ShortCodeEntry.alphabet.contains(confusable), "\(confusable) is confusable and must not be in the alphabet")
        }
    }

    @Test("case and separators are forgiven")
    func normalisesInput() {
        #expect(ShortCodeEntry.normalise("bcd-4g7j") == "BCD4G7J")
        #expect(ShortCodeEntry.normalise(" BCD 4G7J ") == "BCD4G7J")
        #expect(ShortCodeEntry.isComplete("bcd-4g7j"))
    }

    @Test("nothing is substituted")
    func noSubstitutions() {
        // Every character a substitution table would map is already absent from
        // the alphabet, so mapping one could only turn a typo into a *different
        // valid code* — checking someone into a service they did not choose.
        #expect(ShortCodeEntry.normalise("OOOOOOO").isEmpty)
        #expect(!ShortCodeEntry.isComplete("OOOOOOO"))
        #expect(!ShortCodeEntry.isComplete("SSSSSSS"))
    }

    @Test("an incomplete code is never sent")
    func incompleteIsNotSent() async {
        let submitter = FakeCodeSubmitter()
        let coordinator = makeCoordinator(camera: FakeCamera(), submitter: submitter)

        _ = await coordinator.submitTypedCode("BCD")
        _ = await coordinator.submitTypedCode("")
        _ = await coordinator.submitTypedCode("OOOOOOO")

        // Each of these would be refused server-side, and each refusal would
        // spend one of the person's ten attempts.
        #expect(await submitter.submissions.isEmpty)
    }

    @Test("a typed code carries no token, and a scan carries no code")
    func submissionsAreExclusive() async {
        let submitter = FakeCodeSubmitter()
        let coordinator = makeCoordinator(camera: FakeCamera(authorization: .authorized), submitter: submitter)

        _ = await coordinator.submitTypedCode("BCD4G7J")
        let typed = await submitter.submissions[0]
        #expect(typed.shortCode == "BCD4G7J")
        #expect(typed.qrToken == nil)

        _ = await coordinator.beginScanning()
        await coordinator.handleScanned(validToken)
        let scanned = await submitter.submissions[1]
        #expect(scanned.qrToken == validToken)
        #expect(scanned.shortCode == nil)
    }
}

// ---------------------------------------------------------------------------
// The screen model
// ---------------------------------------------------------------------------

@MainActor
@Suite("The scanner screen")
struct CheckInScannerModelTests {

    @Test("the screen starts idle and asks for nothing")
    func startsIdle() async {
        let camera = FakeCamera()
        let model = CheckInScannerModel(
            coordinator: makeCoordinator(camera: camera, submitter: FakeCodeSubmitter())
        )

        #expect(model.phase == .idle)
        #expect(await camera.prompts.isEmpty)
        // The typed field is there from the start, not after a failure.
        #expect(model.showsTypedEntry)
    }

    @Test("typing is normalised as it goes")
    func normalisesWhileTyping() {
        let model = CheckInScannerModel(
            coordinator: makeCoordinator(camera: FakeCamera(), submitter: FakeCodeSubmitter())
        )

        model.typedCode = "bcd-4g7j"
        #expect(model.typedCode == "BCD4G7J")
        #expect(model.canSubmitTypedCode)

        model.typedCode = "bcd"
        #expect(!model.canSubmitTypedCode)
    }

    @Test("the field never grows past a code")
    func boundsLength() {
        let model = CheckInScannerModel(
            coordinator: makeCoordinator(camera: FakeCamera(), submitter: FakeCodeSubmitter())
        )
        model.typedCode = "BCDFGHJKLMNPQRTVWXY3479"
        #expect(model.typedCode.count == ShortCodeEntry.length)
    }

    @Test("Settings is offered only where it would help")
    func settingsOnlyWhenUseful() async {
        for (authorization, expected) in [
            (CameraAuthorization.denied, true),
            (.restricted, false),
        ] {
            let model = CheckInScannerModel(
                coordinator: makeCoordinator(
                    camera: FakeCamera(authorization: authorization),
                    submitter: FakeCodeSubmitter()
                )
            )
            await model.startScanning()
            #expect(model.offersSettings == expected, "\(authorization)")
            #expect(model.blockTitle != nil)
            #expect(model.blockBody != nil)
        }
    }

    @Test("a successful typed code clears the field")
    func clearsAfterSuccess() async {
        let model = CheckInScannerModel(
            coordinator: makeCoordinator(camera: FakeCamera(), submitter: FakeCodeSubmitter())
        )
        model.typedCode = "BCD4G7J"
        await model.submitTypedCode()

        // A spent code left on screen invites a second attempt that can only be
        // refused.
        #expect(model.typedCode.isEmpty)
        #expect(model.resultIsSuccess)
    }

    @Test("a refused code is not treated as success")
    func refusalIsNotSuccess() async {
        let submitter = FakeCodeSubmitter(
            result: AttendanceResult(outcome: .rejected, message: "That code didn't work.")
        )
        let model = CheckInScannerModel(
            coordinator: makeCoordinator(camera: FakeCamera(), submitter: submitter)
        )
        model.typedCode = "BCD4G7J"
        await model.submitTypedCode()

        #expect(!model.resultIsSuccess)
        #expect(model.resultMessage == "That code didn't work.")
        // The code stays so the person can see what they typed and correct it.
        #expect(model.typedCode == "BCD4G7J")
    }

    @Test("every block state has something to say")
    func everyBlockHasCopy() async {
        for block in [ScanBlock.cameraDenied, .cameraRestricted, .cameraUnavailable, .offline] {
            let model = CheckInScannerModel(
                coordinator: makeCoordinator(camera: FakeCamera(), submitter: FakeCodeSubmitter())
            )
            model.applyForTesting(.blocked(block))
            #expect(model.blockTitle?.isEmpty == false, "\(block)")
            #expect(model.blockBody?.isEmpty == false, "\(block)")
        }
    }
}

@MainActor
extension CheckInScannerModel {
    /// Sets a phase directly, so every block's copy can be asserted without
    /// contriving four different failures.
    func applyForTesting(_ phase: ScanPhase) {
        setPhaseForTesting(phase)
    }
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

@Suite("The check-in route")
struct CheckInRoutingTests {

    @Test("the deep link parses to a check-in destination")
    func parsesCheckInLink() {
        let url = URL(string: "faithful://church/grace-chapel/check-in")!
        #expect(DeepLinkParser.parse(url) == .checkIn(churchSlug: "grace-chapel"))
    }

    @Test("arriving by link starts no camera")
    func linkStartsNothing() async {
        // **A link must never be able to raise a camera prompt.** Whoever sent
        // it would be the one triggering the permission request, which is the
        // exact shape this app refuses everywhere else.
        let camera = FakeCamera()
        let model = await CheckInScannerModel(
            coordinator: makeCoordinator(camera: camera, submitter: FakeCodeSubmitter())
        )

        _ = DeepLinkParser.parse(URL(string: "faithful://church/grace-chapel/check-in")!)

        #expect(await camera.prompts.isEmpty)
        #expect(await camera.startCount == 0)
        #expect(await model.phase == .idle)
    }

    @Test("check-in needs a signed-in account and the attendance capability")
    func requiresAccountAndCapability() {
        let destination = Destination.checkIn(churchSlug: "grace-chapel")
        // A code identifies a service. The *person* comes from the session, so
        // an anonymous caller has nothing for the server to count.
        #expect(destination.requiresAuthentication)
        #expect(destination.requiredCapability == "attendance")
        #expect(destination.churchSlug == "grace-chapel")
    }

    @Test("a malformed check-in link fails closed")
    func malformedLinkFailsClosed() {
        // A link is untrusted input that arrives before the app has decided
        // anything about the person holding it.
        for bad in [
            "faithful://church/GRACE/check-in",
            "faithful://check-in",
            "faithful://church/grace-chapel/check-in/extra",
            "https://church/grace-chapel/check-in",
        ] {
            #expect(DeepLinkParser.parse(URL(string: bad)!) == nil, "\(bad)")
        }
    }

    @Test("empty path segments collapse, identically to Android")
    func emptySegmentsCollapse() {
        // Documented rather than asserted-away. Swift's `split` omits empty
        // subsequences by default and Kotlin's parser filters them, so
        // `faithful://church//check-in` reads `check-in` as the slug on both
        // platforms. It reaches no camera and no check-in: the worst case is a
        // "church not found" screen.
        #expect(
            DeepLinkParser.parse(URL(string: "faithful://church//check-in")!)
                == .church(slug: "check-in")
        )
    }

    @Test("an unimplemented route is refused rather than half-opened")
    func unimplementedIsRefused() {
        let registry = RouteRegistry(implemented: [.home, .account])
        let session = RouteRegistry.SessionSnapshot(
            isAuthenticated: true,
            capabilities: ["attendance"],
            churchAccess: ["grace-chapel": true]
        )
        let resolution = registry.resolve(.checkIn(churchSlug: "grace-chapel"), session: session)
        #expect(resolution == RouteResolution.rejected(.notImplemented))
    }
}
