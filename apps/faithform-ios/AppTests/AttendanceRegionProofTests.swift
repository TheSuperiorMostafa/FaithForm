import Testing
import Foundation
@testable import FaithForm
import FaithFormKit

/// Automatic check-in on a real Core Location stack, in the simulator.
///
/// **Not part of the ordinary run.** It needs the simulator's location moved
/// from outside, which a test inside the app cannot do, so it only runs when
/// `FAITHFORM_REGION_PROOF=1` reaches the host (`TEST_RUNNER_FAITHFORM_REGION_PROOF=1`
/// on the `xcodebuild` line) and a script beside it is moving the simulator.
///
/// The handshake is a pair of files in the app's temporary directory: the test
/// writes `<step>.request` and waits for `<step>.done`, which the script writes
/// after `xcrun simctl location set`. Everything between — the region monitor,
/// the delegate, the one-shot fix, the evidence flow, the request body — is the
/// shipping code. Only the server and the clock are stand-ins: the server so
/// nothing touches a real church, the clock so a two-minute dwell does not
/// take two minutes.
@Suite("Automatic check-in on the simulator", .serialized)
struct AttendanceRegionProofTests {
    nonisolated static var enabled: Bool {
        ProcessInfo.processInfo.environment["FAITHFORM_REGION_PROOF"] == "1"
    }

    /// Apple Park, which the simulator ships routes around.
    static let campus = (latitude: 37.33490, longitude: -122.00900)
    static let regionId = "faithform.campus.00000000-0000-4000-8000-00000000c0de"
    static let churchSlug = "proof-church"

    @Test("a brief pass sends nothing; a stay is checked in exactly once", .enabled(if: enabled), .timeLimit(.minutes(15)))
    func briefPassThenStay() async throws {
        let log = ProofLog()
        let handshake = try Handshake()
        let clock = OffsetClock()
        let server = ProofServer(clock: clock, campus: Self.campus, regionId: Self.regionId, churchSlug: Self.churchSlug)
        let api = APIClient(
            configuration: APIClient.Configuration(
                environment: APIEnvironment(key: "proof", baseURL: URL(string: "https://proof.faithform.invalid")!),
                clientBuild: 1
            ),
            transport: server,
            tokens: ProofTokens()
        )

        // The shipping adapter, created on the main thread so Core Location
        // delivers to a run loop — exactly as `AppDependencies` does at launch.
        let location = await MainActor.run { CoreLocationAdapter() }
        #expect(await location.currentAuthorization() == .authorizedAlways, "grant location-always before running")
        #expect(await location.currentAccuracy() == .full)

        let secure = KeychainStore(service: "io.faithform.attendance-proof")
        try? secure.deleteAll()
        let store = KeychainAttemptStore(secureStore: secure)
        let notifier = ProofNotifier()
        let reconciler = GeofenceReconciler(
            monitor: location, authorization: location,
            source: APIGeofenceConfigurationSource(api: api), now: { clock.now }
        )
        let coordinator = AutomaticAttendanceCoordinator(
            reconciler: reconciler,
            submitter: APIAttendanceSubmitter(api: api),
            sampler: location,
            store: store,
            authorization: location,
            notifier: notifier,
            now: { clock.now }
        )
        let service = AutomaticAttendanceService(
            coordinator: coordinator,
            reconciler: reconciler,
            settingsStore: KeychainAutomaticAttendanceSettingsStore(secureStore: secure),
            environment: "proof"
        )
        await location.setRegionHandler { identifier, transition in
            await log.record(identifier, transition)
            await service.handleRegion(identifier: identifier, transition: transition)
        }

        // Signed in, consent granted, switched on.
        await service.updateAccount(
            accountId: "00000000-0000-4000-8000-0000000000aa",
            authorizationVersion: 1,
            serverConsent: "granted",
            churches: [AttendanceChurch(slug: Self.churchSlug, name: "Proof Church")]
        )
        let outcome = await service.enable()
        #expect(outcome.monitoring == 1)
        #expect(await location.monitoredRegions().map(\.identifier) == [Self.regionId])
        await log.note("monitoring \(Self.regionId), radius 150 m")

        // ---- A brief pass: in, and straight back out. ---------------------
        try await handshake.request("inside-1")
        try await log.waitFor(Self.regionId, [.entered, .inside])
        #expect(await server.attempts().isEmpty, "an arrival was submitted on entry")
        #expect(await store.current(partition: Self.partition, now: clock.now) != nil, "the arrival was not held")

        try await handshake.request("outside-1")
        try await log.waitFor(Self.regionId, [.exited, .outside])
        // Give the exit a moment to reach the Keychain.
        try await Task.sleep(for: .seconds(1))
        #expect(await store.current(partition: Self.partition, now: clock.now) == nil, "the exit did not abandon the arrival")

        // Long past the dwell, every opportunity still sends nothing.
        clock.advance(by: 300)
        _ = await service.resume()
        await service.foreground()
        #expect(await server.attempts().isEmpty, "a brief pass was checked in")
        await log.note("brief pass: 0 attempts")

        // ---- A stay: in, and still there after the dwell. ----------------
        try await handshake.request("inside-2")
        try await log.waitFor(Self.regionId, [.entered, .inside], after: 1)
        #expect(await server.attempts().isEmpty, "submitted before the dwell")

        clock.advance(by: 121)
        _ = await service.resume()

        let attempts = await server.attempts()
        #expect(attempts.count == 1, "expected exactly one attempt after the dwell, got \(attempts.count)")
        let body = try #require(attempts.first)
        #expect(body.idempotencyKey.hasPrefix("gf-"))
        #expect(body.json["source"] as? String == "geofence")
        #expect(body.json["phase"] as? String == "detected")
        #expect(body.json["occurrenceId"] as? String == ProofServer.occurrenceId)
        #expect(body.json["regionId"] as? String == Self.regionId)
        let latitude = try #require(body.json["latitude"] as? Double)
        let longitude = try #require(body.json["longitude"] as? Double)
        #expect(abs(latitude - Self.campus.latitude) < 0.001, "the fix was not the simulated position")
        #expect(abs(longitude - Self.campus.longitude) < 0.001)
        for forbidden in ["accountId", "memberId", "churchId", "churchSlug", "mockLocationReported"] {
            #expect(body.json[forbidden] == nil, "the attempt carried \(forbidden)")
        }
        #expect(await notifier.checkedIn == [Self.churchSlug])
        await log.note("stay: 1 attempt, keys \(body.json.keys.sorted().joined(separator: ","))")

        // Every later opportunity, and the OS saying "inside" again, sends
        // nothing more.
        _ = await service.resume()
        await service.foreground()
        await service.handleRegion(identifier: Self.regionId, transition: .entered)
        clock.advance(by: 600)
        _ = await service.resume()
        #expect(await server.attempts().count == 1, "the stay was submitted more than once")

        // ---- Signing out leaves nothing registered. ----------------------
        await service.signedOut()
        #expect(await location.monitoredRegions().isEmpty)
        try? secure.deleteAll()
        await log.note("signed out: 0 regions")
        try handshake.finish(report: await log.lines())
    }

    static let partition = CachePartition(
        environment: "proof",
        accountId: "00000000-0000-4000-8000-0000000000aa",
        churchSlug: churchSlug,
        authorizationVersion: 1
    )
}

// MARK: - Stand-ins

/// The test's clock: real time, plus whatever the test has skipped.
final class OffsetClock: @unchecked Sendable {
    private let lock = NSLock()
    private var offset: TimeInterval = 0

    var now: Date {
        lock.lock(); defer { lock.unlock() }
        return Date().addingTimeInterval(offset)
    }

    func advance(by seconds: TimeInterval) {
        lock.lock(); offset += seconds; lock.unlock()
    }
}

private actor ProofTokens: TokenProviding {
    func validAccessToken() async throws -> String { "proof-token" }
    func invalidate() async {}
}

actor ProofNotifier: AttendanceNotifying {
    private(set) var checkedIn: [String] = []
    private(set) var scheduled: [String: Date] = [:]
    func authorizationStatus() async -> NotificationAuthorization { .authorized }
    func requestAuthorization() async -> NotificationAuthorization { .authorized }
    func scheduleArrivalPrompt(churchSlug: String, churchName: String, at: Date) async { scheduled[churchSlug] = at }
    func cancelArrivalPrompt(churchSlug: String) async { scheduled[churchSlug] = nil }
    func cancelAll() async { scheduled = [:] }
    func postCheckedIn(churchSlug: String, churchName: String) async { checkedIn.append(churchSlug) }
    func postNotCheckedIn(churchSlug: String, churchName: String) async {}
}

/// The four routes automatic check-in calls, answered as the real server
/// answers them for a church that does not ask for confirmation.
actor ProofServer: HTTPTransport {
    static let occurrenceId = "00000000-0000-4000-8000-00000000cafe"

    struct Attempt: @unchecked Sendable {
        let idempotencyKey: String
        let json: [String: Any]
    }

    private let clock: OffsetClock
    private let campus: (latitude: Double, longitude: Double)
    private let regionId: String
    private let churchSlug: String
    private var recorded: [Attempt] = []

    init(clock: OffsetClock, campus: (latitude: Double, longitude: Double), regionId: String, churchSlug: String) {
        self.clock = clock
        self.campus = campus
        self.regionId = regionId
        self.churchSlug = churchSlug
    }

    func attempts() -> [Attempt] { recorded }

    nonisolated func perform(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        try await respond(
            path: request.url?.path ?? "",
            method: request.httpMethod ?? "GET",
            key: request.value(forHTTPHeaderField: "Idempotency-Key"),
            body: request.httpBody,
            url: request.url!
        )
    }

    private func respond(path: String, method: String, key: String?, body: Data?, url: URL) throws -> (Data, HTTPURLResponse) {
        let now = clock.now
        func instant(_ offset: TimeInterval) -> String { FaithFormInstant.format(now.addingTimeInterval(offset)) }

        let data: String
        switch (method, path) {
        case ("GET", "/api/mobile/v1/attendance/\(churchSlug)/geofence-config"):
            data = """
            {"configuration":{"churchSlug":"\(churchSlug)","regions":[{"regionId":"\(regionId)","campusName":"Main","latitude":\(campus.latitude),"longitude":\(campus.longitude),"radiusMeters":150}],"windows":[{"occurrenceId":"\(Self.occurrenceId)","label":"Sunday Service","startsAt":"\(instant(600))","endsAt":"\(instant(4200))","checkinOpensAt":"\(instant(-1200))","checkinClosesAt":"\(instant(7200))","timezone":"America/Los_Angeles"}],"sources":{"geofence":true,"qr":true,"manual":true},"requiresConfirmation":false,"minDwellSeconds":120,"maxLocationAccuracyM":100,"configVersion":1001,"expiresAt":"\(instant(900))"},"refusalReason":null,"message":null}
            """
        case ("GET", "/api/mobile/v1/attendance/\(churchSlug)/occurrence"):
            data = """
            {"occurrence":{"occurrenceId":"\(Self.occurrenceId)","label":"Sunday Service","churchSlug":"\(churchSlug)","campusName":"Main","localServiceDate":"2026-09-13","timezone":"America/Los_Angeles","startsAt":"\(instant(600))","endsAt":"\(instant(4200))","checkinOpensAt":"\(instant(-1200))","checkinClosesAt":"\(instant(7200))","status":"scheduled"}}
            """
        case ("GET", "/api/mobile/v1/attendance/status/\(Self.occurrenceId)"):
            data = """
            {"occurrenceId":"\(Self.occurrenceId)","isCounted":\(recorded.isEmpty ? "false" : "true"),"status":\(recorded.isEmpty ? "null" : "\"active\""),"source":\(recorded.isEmpty ? "null" : "\"geofence\""),"countedAt":null}
            """
        case ("POST", "/api/mobile/v1/attendance/attempt"):
            let json = (try? JSONSerialization.jsonObject(with: body ?? Data())) as? [String: Any] ?? [:]
            let replay = recorded.contains { $0.idempotencyKey == key }
            if !replay { recorded.append(Attempt(idempotencyKey: key ?? "", json: json)) }
            data = """
            {"outcome":"\(replay ? "already_counted" : "counted")","message":"You're checked in.","occurrenceId":"\(Self.occurrenceId)","countedAt":"\(instant(0))","confirmationNotBefore":null,"detectionId":null}
            """
        default:
            let failure = #"{"ok":false,"error":{"code":"not_found","message":"Not found.","retryable":false},"meta":{"apiVersion":"1.0","apiMajor":1,"requestId":"proof","minimumSupportedClientBuild":1}}"#
            return (Data(failure.utf8), HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: nil)!)
        }

        let envelope = #"{"ok":true,"data":"# + data + #","meta":{"apiVersion":"1.0","apiMajor":1,"requestId":"proof","minimumSupportedClientBuild":1}}"#
        return (Data(envelope.utf8), HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: nil)!)
    }
}

/// What the region monitor delivered, in order.
actor ProofLog {
    private var events: [(String, RegionTransition, Date)] = []
    private var notes: [String] = []

    func record(_ identifier: String, _ transition: RegionTransition) {
        events.append((identifier, transition, Date()))
        notes.append("event \(transition) \(identifier)")
    }

    func note(_ line: String) { notes.append(line) }
    func lines() -> [String] { notes }

    /// Waits for the `index`-th (zero-based) delivery of any of `transitions`.
    func waitFor(
        _ identifier: String,
        _ transitions: [RegionTransition],
        after index: Int = 0,
        timeout: TimeInterval = 180
    ) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            let matching = events.filter { $0.0 == identifier && transitions.contains($0.1) }
            if matching.count > index { return }
            try await Task.sleep(for: .milliseconds(250))
        }
        throw ProofError.timedOut("\(transitions) for \(identifier)")
    }
}

enum ProofError: Error {
    case timedOut(String)
}

/// The file handshake with the script that moves the simulator.
struct Handshake {
    let directory: URL

    init() throws {
        directory = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("attendance-proof")
        try? FileManager.default.removeItem(at: directory)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    func request(_ step: String, timeout: TimeInterval = 180) async throws {
        try Data(step.utf8).write(to: directory.appendingPathComponent("\(step).request"))
        let done = directory.appendingPathComponent("\(step).done")
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if FileManager.default.fileExists(atPath: done.path) { return }
            try await Task.sleep(for: .milliseconds(250))
        }
        throw ProofError.timedOut("the script never completed \(step)")
    }

    func finish(report: [String]) throws {
        try Data(report.joined(separator: "\n").utf8).write(to: directory.appendingPathComponent("report.txt"))
        try Data().write(to: directory.appendingPathComponent("finished"))
    }
}
