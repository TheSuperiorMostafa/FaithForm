import Foundation
import Testing
@testable import FaithfulKit

// ---------------------------------------------------------------------------
// Doubles
// ---------------------------------------------------------------------------

/// A granter that records every request and can be made to refuse.
actor FakeGranter: PlaybackGranting {
    struct Call: Equatable {
        let churchSlug: String
        let kind: MediaPlaybackKind
        let mediaId: String
    }

    private(set) var calls: [Call] = []
    var refuse = false
    var expiresAt: Date
    var capabilities: [String]
    var renditionKind: RenditionKind = .progressive
    private var issued = 0
    /// Set to make a grant hang, so a single-flight can be observed.
    var gate: (stream: AsyncStream<Void>, continuation: AsyncStream<Void>.Continuation)?
    /// Lets a test wait until a caller has actually arrived in `grant`, rather
    /// than assuming a child task has started. See `waitUntilCalls`.
    private var arrivalTarget: Int?
    private var arrivalWaiter: CheckedContinuation<Void, Never>?

    init(
        expiresAt: Date = Date(timeIntervalSince1970: 1_800_000_300),
        capabilities: [String] = ["cap-1", "cap-2", "cap-3", "cap-4"]
    ) {
        self.expiresAt = expiresAt
        self.capabilities = capabilities
    }

    func setRefuse(_ value: Bool) { refuse = value }
    func setRenditionKind(_ value: RenditionKind) { renditionKind = value }
    func setExpiry(_ value: Date) { expiresAt = value }
    func openGate() {
        let (stream, continuation) = AsyncStream<Void>.makeStream()
        gate = (stream, continuation)
    }
    func releaseGate() { gate?.continuation.finish() }

    /// Suspends until `grant` has been entered `count` times.
    ///
    /// `async let` creates a child task; it does not run it. A test that opens
    /// the gate and releases it in the next statement can release before any
    /// caller has arrived, which makes the gate do nothing and lets the callers
    /// run one after another — the single-flight then "passes" without ever
    /// having been concurrent. Waiting on the arrival makes it a rendezvous.
    func waitUntilCalls(_ count: Int) async {
        if calls.count >= count { return }
        arrivalTarget = count
        await withCheckedContinuation { arrivalWaiter = $0 }
    }

    func grant(
        churchSlug: String,
        kind: MediaPlaybackKind,
        mediaId: String
    ) async throws -> GrantedPlayback {
        calls.append(Call(churchSlug: churchSlug, kind: kind, mediaId: mediaId))
        if let target = arrivalTarget, calls.count >= target {
            arrivalTarget = nil
            arrivalWaiter?.resume()
            arrivalWaiter = nil
        }
        if let gate { for await _ in gate.stream {} }
        if refuse { throw APIError(code: .notFound, message: "gone") }

        let capability = capabilities[min(issued, capabilities.count - 1)]
        issued += 1
        return GrantedPlayback(
            capability: capability,
            deliveryURL: URL(string: "https://example.test/api/media/v1/recording/grace/x")!,
            renditionKind: renditionKind,
            expiresAt: expiresAt,
            refreshLeadSeconds: 60,
            startOffsetSeconds: 0
        )
    }
}

/// A player that records commands and never touches AVFoundation.
actor FakePlayer: MediaPlayerFacade {
    private(set) var commands: [PlayerCommand] = []
    var position: Double = 0
    private var handler: (@Sendable (PlayerEvent) -> Void)?

    func send(_ command: PlayerCommand) async { commands.append(command) }
    func setEventHandler(_ handler: @Sendable @escaping (PlayerEvent) -> Void) async {
        self.handler = handler
    }
    func currentPositionSeconds() async -> Double { position }
    func setPosition(_ value: Double) { position = value }

    var capabilitiesUsed: [String] {
        commands.compactMap {
            if case let .updateCapability(value) = $0 { return value }
            if case let .load(request) = $0 { return request.capability }
            return nil
        }
    }
}

actor FakeResumeStore: ResumePositionStoring {
    private var entries: [String: [ResumePosition]] = [:]
    private(set) var clearAllCount = 0

    func position(for mediaId: String, partition: CachePartition, now: Date) async -> ResumePosition? {
        ResumePolicy.prune(entries[partition.storageKey] ?? [], now: now)
            .first { $0.mediaId == mediaId }
    }

    func record(_ position: ResumePosition, partition: CachePartition, now: Date) async {
        var list = (entries[partition.storageKey] ?? []).filter { $0.mediaId != position.mediaId }
        list.append(position)
        entries[partition.storageKey] = ResumePolicy.prune(list, now: now)
    }

    func clear(partition: CachePartition) async { entries[partition.storageKey] = nil }
    func clearAll() async { entries.removeAll(); clearAllCount += 1 }

    func all(_ partition: CachePartition) -> [ResumePosition] {
        entries[partition.storageKey] ?? []
    }
}

private let partitionA = CachePartition(
    environment: "test", accountId: "account-a", churchSlug: "grace", authorizationVersion: 1
)
private let partitionB = CachePartition(
    environment: "test", accountId: "account-b", churchSlug: "grace", authorizationVersion: 1
)
private let bumpedVersion = CachePartition(
    environment: "test", accountId: "account-a", churchSlug: "grace", authorizationVersion: 2
)

private let fixedNow = Date(timeIntervalSince1970: 1_800_000_000)

private func makeCoordinator(
    granter: FakeGranter,
    player: FakePlayer,
    store: FakeResumeStore,
    now: @escaping @Sendable () -> Date = { fixedNow }
) -> MediaPlaybackCoordinator {
    MediaPlaybackCoordinator(granter: granter, player: player, resumeStore: store, now: now)
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

@Suite("Media contract")
struct MediaContractTests {

    @Test("a live projection decodes, and its absence is expressible")
    func liveDecodes() throws {
        let json = """
        {"live":{"state":"live","mediaId":"e1","kind":"live","title":"Sunday",
          "startsAt":"2026-08-30T14:00:00Z","countdownEnabled":true,"posterUrl":null,
          "publicationVersion":3,"churchSlug":"grace","churchName":"Grace",
          "churchTimezone":"America/New_York"},"mediaVersion":9}
        """.data(using: .utf8)!

        let decoded = try JSONDecoder.faithful.decode(LiveMediaResponse.self, from: json)
        #expect(decoded.live?.state == "live")
        #expect(decoded.mediaVersion == 9)

        // **Null is the normal answer**, and the type says so rather than
        // needing a falsy flag the UI might still draw a frame around.
        let empty = """
        {"live":null,"mediaVersion":0}
        """.data(using: .utf8)!
        #expect(try JSONDecoder.faithful.decode(LiveMediaResponse.self, from: empty).live == nil)
    }

    @Test("an archive page decodes, including a null cursor")
    func archiveDecodes() throws {
        let json = """
        {"items":[{"mediaId":"r1","kind":"recording","title":"Hope","summary":null,
          "publishedAt":"2026-08-24T18:00:00Z","recordedAt":"2026-08-24T14:00:00Z",
          "durationSeconds":3600,"posterUrl":null,"seriesName":"Advent",
          "speakers":["Pastor Ada"],"publicationVersion":2,"churchSlug":"grace",
          "churchName":"Grace","churchTimezone":"America/New_York"}],
         "nextCursor":null,"mediaVersion":4}
        """.data(using: .utf8)!

        let page = try JSONDecoder.faithful.decode(MediaPage.self, from: json)
        #expect(page.items.count == 1)
        #expect(page.items[0].speakers == ["Pastor Ada"])
        #expect(page.nextCursor == nil)
    }

    @Test("a grant decodes and carries no credential in its URL")
    func grantDecodes() throws {
        let json = """
        {"capability":"FFM1.body.sig","expiresAt":"2026-08-30T14:05:00Z",
         "deliveryUrl":"/api/media/v1/recording/grace/r1","kind":"recording",
         "renditionKind":"progressive","mediaId":"r1","refreshAfterSeconds":60,
         "startOffsetSeconds":12}
        """.data(using: .utf8)!

        let grant = try JSONDecoder.faithful.decode(PlaybackGrant.self, from: json)
        #expect(grant.renditionKind == "progressive")
        #expect(grant.deliveryUrl == "/api/media/v1/recording/grace/r1")
        // The whole point of the header strategy.
        #expect(!grant.deliveryUrl.contains(grant.capability))
        #expect(!grant.deliveryUrl.contains("cap="))
        #expect(!grant.deliveryUrl.contains("token"))
        // Relative, so a response cannot point the player at another host.
        #expect(grant.deliveryUrl.hasPrefix("/"))
    }

    @Test("the rendition kind reaches the player, and an unknown one is safe")
    func renditionKindReachesPlayer() async {
        let granter = FakeGranter()
        await granter.setRenditionKind(.hls)
        let player = FakePlayer()
        let coordinator = makeCoordinator(granter: granter, player: player, store: FakeResumeStore())

        await coordinator.start(
            churchSlug: "grace", kind: .live, mediaId: "e1", partition: partitionA
        )

        let loaded = await player.commands.compactMap { command -> PlaybackRequest? in
            if case let .load(request) = command { return request }
            return nil
        }
        // Media3 infers an extractor from the path and the recording route has
        // no extension, so the server saying which form it serves is what keeps
        // the two ends agreeing.
        #expect(loaded.first?.renditionKind == .hls)

        // A form this build has never heard of falls back rather than failing:
        // a released app must not break because the server added one.
        #expect(RenditionKind(rawValue: "some-future-form") == nil)
    }

    @Test("a visitor is never told why a recording was ineligible")
    func noEligibilityReasonReachesAVisitor() throws {
        // The eligibility *reasons* are staff-facing. A visitor's app is told
        // the rendition form and nothing else — an ineligible recording is
        // simply absent from their list.
        let json = """
        {"items":[{"mediaId":"r1","kind":"recording","title":"Hope","summary":null,
          "publishedAt":"2026-08-24T18:00:00Z","recordedAt":"2026-08-24T14:00:00Z",
          "durationSeconds":3600,"posterUrl":null,"seriesName":null,
          "speakers":[],"publicationVersion":2,"churchSlug":"grace",
          "churchName":"Grace","churchTimezone":"America/New_York"}],
         "nextCursor":null,"mediaVersion":4}
        """.data(using: .utf8)!

        let page = try JSONDecoder.faithful.decode(MediaPage.self, from: json)
        let encoded = String(data: try JSONEncoder.faithful.encode(page.items[0]), encoding: .utf8)!
        for forbidden in ["codec", "container", "avc1", "mp4a", "isom", "reason", "playable"] {
            #expect(!encoded.lowercased().contains(forbidden), "an archive item exposes \(forbidden)")
        }
    }

    @Test("an unknown additive field does not break decoding")
    func additiveFieldsIgnored() throws {
        let json = """
        {"items":[],"nextCursor":null,"mediaVersion":1,"somethingNew":{"a":1}}
        """.data(using: .utf8)!
        #expect(try JSONDecoder.faithful.decode(MediaPage.self, from: json).items.isEmpty)
    }
}

// ---------------------------------------------------------------------------
// Capability schedule and refresh
// ---------------------------------------------------------------------------

@Suite("Capability refresh")
struct CapabilityRefreshTests {

    @Test("a schedule refreshes before it expires, not after")
    func refreshesEarly() {
        let schedule = CapabilitySchedule(
            expiresAt: fixedNow.addingTimeInterval(300),
            refreshLeadSeconds: 60
        )
        #expect(!schedule.isDue(at: fixedNow))
        #expect(!schedule.isDue(at: fixedNow.addingTimeInterval(239)))
        // A capability that expires mid-segment is a stall the person sees.
        #expect(schedule.isDue(at: fixedNow.addingTimeInterval(240)))
        #expect(!schedule.isExpired(at: fixedNow.addingTimeInterval(240)))
        #expect(schedule.isExpired(at: fixedNow.addingTimeInterval(300)))
    }

    @Test("a lead longer than the life still leaves a floor")
    func leadIsBounded() {
        let schedule = CapabilitySchedule(expiresAt: fixedNow, refreshLeadSeconds: 0)
        #expect(schedule.refreshAt() < fixedNow)
    }

    // The rendezvous below is deterministic, which means a *broken*
    // single-flight parks the second caller inside `grant` and the release
    // never runs. A time limit turns that deadlock into a reported failure
    // rather than a hung suite.
    @Test("two callers noticing at once produce one request", .timeLimit(.minutes(1)))
    func singleFlight() async {
        let granter = FakeGranter()
        let player = FakePlayer()
        let coordinator = makeCoordinator(granter: granter, player: player, store: FakeResumeStore())

        await coordinator.start(
            churchSlug: "grace", kind: .recording, mediaId: "r1", partition: partitionA
        )
        #expect(await granter.calls.count == 1)

        // A scheduled refresh and a 401 from a segment, at the same moment.
        //
        // The order is a rendezvous, not a hope: the second caller may only run
        // while the first is provably parked inside `grant`. Releasing the gate
        // one statement after opening it let the first refresh finish before
        // the second began, and the test passed without the two ever
        // overlapping — one run in twelve.
        await granter.openGate()
        async let first = coordinator.refreshIfNeeded(force: true)
        await granter.waitUntilCalls(2)

        // The first caller holds the in-flight flag. This one returns without
        // suspending, so no ordering is left to the scheduler.
        let joined = await coordinator.refreshIfNeeded(force: true)
        await granter.releaseGate()
        _ = await first

        // **The TOCTOU that produced eight concurrent geofence submissions in
        // Prompt 7.** The in-flight flag is claimed before any suspension.
        #expect(joined, "the joining caller reported a failure it did not have")
        #expect(await granter.calls.count == 2, "a refresh raced itself")
    }

    @Test("a refresh swaps the capability without reloading")
    func refreshSwapsInPlace() async {
        let granter = FakeGranter()
        let player = FakePlayer()
        let coordinator = makeCoordinator(granter: granter, player: player, store: FakeResumeStore())

        await coordinator.start(
            churchSlug: "grace", kind: .recording, mediaId: "r1", partition: partitionA
        )
        _ = await coordinator.refreshIfNeeded(force: true)

        let commands = await player.commands
        // Exactly one load. A reload would restart the sermon.
        #expect(commands.filter { if case .load = $0 { return true }; return false }.count == 1)
        #expect(await player.capabilitiesUsed == ["cap-1", "cap-2"])
    }

    @Test("a refresh is not attempted before it is due")
    func notDueIsNotRefreshed() async {
        let granter = FakeGranter(expiresAt: fixedNow.addingTimeInterval(300))
        let coordinator = makeCoordinator(
            granter: granter, player: FakePlayer(), store: FakeResumeStore()
        )
        await coordinator.start(
            churchSlug: "grace", kind: .recording, mediaId: "r1", partition: partitionA
        )

        #expect(await coordinator.refreshIfNeeded() == true)
        #expect(await granter.calls.count == 1, "a refresh ran early")
    }
}

// ---------------------------------------------------------------------------
// Revocation
// ---------------------------------------------------------------------------

@Suite("Revocation and unpublish")
struct RevocationTests {

    @Test("a refused refresh stops playback and does not reuse the old capability")
    func refusedRefreshStops() async {
        let granter = FakeGranter()
        let player = FakePlayer()
        let coordinator = makeCoordinator(granter: granter, player: player, store: FakeResumeStore())

        await coordinator.start(
            churchSlug: "grace", kind: .recording, mediaId: "r1", partition: partitionA
        )
        await granter.setRefuse(true)

        #expect(await coordinator.refreshIfNeeded(force: true) == false)
        #expect(await coordinator.currentState() == .failed(.unavailable))

        let commands = await player.commands
        #expect(commands.contains(.stop))
        // **Not retried, and not fallen back.** A church that revoked something
        // meant it, and the segments already buffered are not a licence.
        #expect(await player.capabilitiesUsed == ["cap-1"])
    }

    @Test("a start that is refused fails without touching the player")
    func refusedStart() async {
        let granter = FakeGranter()
        await granter.setRefuse(true)
        let player = FakePlayer()
        let coordinator = makeCoordinator(granter: granter, player: player, store: FakeResumeStore())

        await coordinator.start(
            churchSlug: "grace", kind: .recording, mediaId: "r1", partition: partitionA
        )

        #expect(await coordinator.currentState() == .failed(.unavailable))
        #expect(await player.commands.isEmpty)
    }

    @Test("an unavailable failure retries once through a fresh capability")
    func retriesOnceThenGivesUp() async {
        let granter = FakeGranter()
        let player = FakePlayer()
        let coordinator = makeCoordinator(granter: granter, player: player, store: FakeResumeStore())

        await coordinator.start(
            churchSlug: "grace", kind: .recording, mediaId: "r1", partition: partitionA
        )

        // An expired capability and a revoked one look identical from the
        // transport's point of view, so one refresh is attempted.
        await coordinator.handle(.failed(.unavailable))
        #expect(await granter.calls.count == 2)
        #expect(await player.commands.contains(.play))

        // If that refresh is also refused, it is terminal.
        await granter.setRefuse(true)
        await coordinator.handle(.failed(.unavailable))
        #expect(await coordinator.currentState() == .failed(.unavailable))
    }

    @Test("a network failure is not retried as though it were a revocation")
    func networkIsNotRevocation() async {
        let granter = FakeGranter()
        let coordinator = makeCoordinator(
            granter: granter, player: FakePlayer(), store: FakeResumeStore()
        )
        await coordinator.start(
            churchSlug: "grace", kind: .recording, mediaId: "r1", partition: partitionA
        )

        await coordinator.handle(.failed(.network))

        // Spending a capability refresh on a dead connection helps nobody.
        #expect(await granter.calls.count == 1)
        #expect(await coordinator.currentState() == .failed(.network))
    }
}

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------

@Suite("Player error mapping")
struct PlayerErrorTests {

    @Test("401 and 403 are one answer")
    func authFailuresAreOne() {
        #expect(PlayerFailureMapping.from(statusCode: 401) == .unavailable)
        #expect(PlayerFailureMapping.from(statusCode: 403) == .unavailable)
        #expect(PlayerFailureMapping.from(statusCode: 404) == .unavailable)
        // A phone cannot usefully tell "expired" from "revoked", and telling
        // them apart would describe the capability model to anyone watching.
        #expect(
            PlayerFailureMapping.message(for: .unavailable)
                == PlayerFailureMapping.message(for: .unavailable)
        )
    }

    @Test("transient statuses are network failures")
    func transientAreNetwork() {
        for status in [408, 429, 502, 503, 504, 500] {
            #expect(PlayerFailureMapping.from(statusCode: status) == .network, "\(status)")
        }
    }

    @Test("no message names a URL, a status, or a transport detail")
    func messagesAreSafe() {
        for failure in [PlayerFailure.network, .unavailable, .unsupported, .unknown] {
            let message = PlayerFailureMapping.message(for: failure)
            #expect(!message.isEmpty)
            for leak in ["http", "://", "AVFoundation", "NSURL", "status", "401", "403", "capability"] {
                #expect(
                    !message.lowercased().contains(leak.lowercased()),
                    "\(failure) leaks \(leak)"
                )
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Resume positions
// ---------------------------------------------------------------------------

@Suite("Resume positions")
struct ResumePositionTests {

    @Test("a live edge is never a resume point")
    func liveNeverResumes() {
        // A position at a live edge is a position that no longer exists, and
        // the next playlist window will not contain it.
        #expect(!MediaPlaybackKind.live.isResumable)
        #expect(!ResumePolicy.shouldStore(kind: .live, seconds: 600, durationSeconds: nil))
        #expect(ResumePolicy.shouldStore(kind: .recording, seconds: 600, durationSeconds: nil))
    }

    @Test("a live stream is not seekable")
    func liveIsNotSeekable() {
        #expect(!MediaPlaybackKind.live.isSeekable)
        #expect(MediaPlaybackKind.recording.isSeekable)
    }

    @Test("a glance is not a position, and neither is the end")
    func boundsAreEnforced() {
        #expect(!ResumePolicy.shouldStore(kind: .recording, seconds: 5, durationSeconds: 3600))
        #expect(ResumePolicy.shouldStore(kind: .recording, seconds: 600, durationSeconds: 3600))
        // Resuming at 99% shows someone the credits.
        #expect(!ResumePolicy.shouldStore(kind: .recording, seconds: 3595, durationSeconds: 3600))
    }

    @Test("the store is bounded and drops stale entries")
    func storeIsBounded() {
        let entries = (0..<50).map { index in
            ResumePosition(
                mediaId: "r\(index)",
                churchSlug: "grace",
                seconds: 100,
                updatedAt: fixedNow.addingTimeInterval(Double(index))
            )
        }
        let pruned = ResumePolicy.prune(entries, now: fixedNow.addingTimeInterval(100))
        // A hundred positions is a record of what someone watched all year.
        #expect(pruned.count == ResumePolicy.maxEntries)
        #expect(pruned.first?.mediaId == "r49", "newest first")

        let old = ResumePosition(
            mediaId: "ancient", churchSlug: "grace", seconds: 100,
            updatedAt: fixedNow.addingTimeInterval(-ResumePolicy.maxAge - 1)
        )
        #expect(ResumePolicy.prune([old], now: fixedNow).isEmpty)
    }

    @Test("positions are isolated between accounts and authorization versions")
    func partitionsAreIsolated() async {
        let store = FakeResumeStore()
        let position = ResumePosition(
            mediaId: "r1", churchSlug: "grace", seconds: 300, updatedAt: fixedNow
        )
        await store.record(position, partition: partitionA, now: fixedNow)

        #expect(await store.position(for: "r1", partition: partitionA, now: fixedNow) != nil)
        // Another account on the same device sees nothing.
        #expect(await store.position(for: "r1", partition: partitionB, now: fixedNow) == nil)
        // And an authorization change — a revoked relationship, a sign-out —
        // moves the partition, so the old positions are unreachable.
        #expect(await store.position(for: "r1", partition: bumpedVersion, now: fixedNow) == nil)
    }

    @Test("a session records a position on pause and on ending")
    func recordsOnPauseAndEnd() async {
        let store = FakeResumeStore()
        let player = FakePlayer()
        await player.setPosition(400)
        let coordinator = makeCoordinator(granter: FakeGranter(), player: player, store: store)

        await coordinator.start(
            churchSlug: "grace", kind: .recording, mediaId: "r1", partition: partitionA
        )
        await coordinator.handle(.readyToPlay(durationSeconds: 3600))
        await coordinator.pause()

        #expect(await store.position(for: "r1", partition: partitionA, now: fixedNow)?.seconds == 400)
    }

    @Test("a live session records nothing at all")
    func liveRecordsNothing() async {
        let store = FakeResumeStore()
        let player = FakePlayer()
        await player.setPosition(900)
        let coordinator = makeCoordinator(granter: FakeGranter(), player: player, store: store)

        await coordinator.start(
            churchSlug: "grace", kind: .live, mediaId: "e1", partition: partitionA
        )
        await coordinator.pause()

        #expect(await store.all(partitionA).isEmpty)
    }

    @Test("a session resumes from a stored position")
    func resumesFromStore() async {
        let store = FakeResumeStore()
        await store.record(
            ResumePosition(mediaId: "r1", churchSlug: "grace", seconds: 725, updatedAt: fixedNow),
            partition: partitionA,
            now: fixedNow
        )
        let player = FakePlayer()
        let coordinator = makeCoordinator(granter: FakeGranter(), player: player, store: store)

        await coordinator.start(
            churchSlug: "grace", kind: .recording, mediaId: "r1", partition: partitionA
        )

        let loaded = await player.commands.compactMap { command -> PlaybackRequest? in
            if case let .load(request) = command { return request }
            return nil
        }
        #expect(loaded.first?.resumeSeconds == 725)
    }
}

// ---------------------------------------------------------------------------
// Background and foreground
// ---------------------------------------------------------------------------

@Suite("Lifecycle")
struct MediaLifecycleTests {

    @Test("going to the background saves the position immediately")
    func backgroundSaves() async {
        let store = FakeResumeStore()
        let player = FakePlayer()
        await player.setPosition(512)
        let coordinator = makeCoordinator(granter: FakeGranter(), player: player, store: store)

        await coordinator.start(
            churchSlug: "grace", kind: .recording, mediaId: "r1", partition: partitionA
        )
        // There may be no later opportunity: iOS can suspend without warning.
        await coordinator.enterBackground()

        #expect(await store.position(for: "r1", partition: partitionA, now: fixedNow)?.seconds == 512)
    }

    @Test("coming back refreshes a capability that expired while suspended")
    func foregroundRefreshes() async {
        // Expired an hour ago, as far as the coordinator's clock is concerned.
        let granter = FakeGranter(expiresAt: fixedNow.addingTimeInterval(-3600))
        let coordinator = makeCoordinator(
            granter: granter, player: FakePlayer(), store: FakeResumeStore()
        )

        await coordinator.start(
            churchSlug: "grace", kind: .recording, mediaId: "r1", partition: partitionA
        )
        await granter.setExpiry(fixedNow.addingTimeInterval(300))
        await coordinator.enterForeground()

        // The first thing the person sees must not be a failure.
        #expect(await granter.calls.count == 2)
    }

    @Test("stopping clears the session so nothing leaks into the next one")
    func stopClears() async {
        let coordinator = makeCoordinator(
            granter: FakeGranter(), player: FakePlayer(), store: FakeResumeStore()
        )
        await coordinator.start(
            churchSlug: "grace", kind: .recording, mediaId: "r1", partition: partitionA
        )
        await coordinator.stop()

        #expect(await coordinator.currentState() == .idle)
        #expect(await coordinator.currentSchedule() == nil)
        // A refresh after a stop has nothing to refresh.
        #expect(await coordinator.refreshIfNeeded(force: true) == false)
    }
}

// ---------------------------------------------------------------------------
// A capability never lands anywhere durable
// ---------------------------------------------------------------------------

@Suite("Capability handling")
struct CapabilityHandlingTests {

    @Test("a capability is never written to the resume store")
    func neverInResumeStore() async {
        let store = FakeResumeStore()
        let player = FakePlayer()
        await player.setPosition(300)
        let coordinator = makeCoordinator(granter: FakeGranter(), player: player, store: store)

        await coordinator.start(
            churchSlug: "grace", kind: .recording, mediaId: "r1", partition: partitionA
        )
        await coordinator.handle(.readyToPlay(durationSeconds: 3600))
        await coordinator.pause()

        // A `ResumePosition` has four fields and none of them is a credential.
        let stored = await store.all(partitionA)
        for entry in stored {
            let encoded = String(data: try! JSONEncoder.faithful.encode(entry), encoding: .utf8)!
            #expect(!encoded.contains("cap-1"))
            #expect(!encoded.lowercased().contains("bearer"))
            #expect(!encoded.contains("FFM1"))
        }
    }

    @Test("a delivery URL never carries the capability")
    func urlNeverCarriesCapability() async {
        let player = FakePlayer()
        let coordinator = makeCoordinator(
            granter: FakeGranter(), player: player, store: FakeResumeStore()
        )
        await coordinator.start(
            churchSlug: "grace", kind: .recording, mediaId: "r1", partition: partitionA
        )

        let requests = await player.commands.compactMap { command -> PlaybackRequest? in
            if case let .load(request) = command { return request }
            return nil
        }
        for request in requests {
            #expect(!request.url.absoluteString.contains(request.capability))
            #expect(request.url.query == nil, "the delivery URL carries a query string")
        }
    }
}
