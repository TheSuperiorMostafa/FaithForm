import Foundation
import Testing
@testable import FaithFormKit

// ---------------------------------------------------------------------------
// Doubles
// ---------------------------------------------------------------------------

private actor LiveTestTokens: TokenProviding {
    func validAccessToken() async throws -> String { "test-token" }
    func invalidate() async {}
}

/// Answers by route, because `MediaModel` asks for the live projection and the
/// archive concurrently and a queue would hand them out in arrival order.
private actor RoutedTransport: HTTPTransport {
    private var live: [StubTransport.Exchange]
    private let archive: StubTransport.Exchange
    private(set) var liveRequests = 0
    private(set) var archiveRequests = 0

    init(live: [StubTransport.Exchange], archive: StubTransport.Exchange = .init(status: 200, body: envelope(emptyArchive))) {
        self.live = live
        self.archive = archive
    }

    func perform(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let exchange: StubTransport.Exchange
        if request.url!.path.hasSuffix("/live") {
            liveRequests += 1
            guard !live.isEmpty else { throw URLError(.notConnectedToInternet) }
            exchange = live.removeFirst()
        } else {
            archiveRequests += 1
            exchange = archive
        }
        let response = HTTPURLResponse(
            url: request.url!,
            statusCode: exchange.status,
            httpVersion: "HTTP/1.1",
            headerFields: exchange.headers
        )!
        return (exchange.body, response)
    }
}

private func envelope(_ data: String) -> Data {
    Data("""
    {"ok":true,"data":\(data),"meta":{"apiVersion":"1.0","apiMajor":1,"requestId":"r1","minimumSupportedClientBuild":1}}
    """.utf8)
}

private let liveNow = """
{"live":{"state":"live","mediaId":"e1","kind":"live","title":"Sunday","startsAt":"2026-09-20T14:00:00Z",
"countdownEnabled":false,"posterUrl":null,"publicationVersion":1,"churchSlug":"grace",
"churchName":"Grace","churchTimezone":"America/New_York"},"mediaVersion":2}
"""
private let nothingLive = #"{"live":null,"mediaVersion":1}"#
private let emptyArchive = #"{"items":[],"nextCursor":null,"mediaVersion":1}"#

private let livePartition = CachePartition(
    environment: "test", accountId: "account-a", churchSlug: "grace", authorizationVersion: 1
)

private func mediaClient(_ transport: HTTPTransport = StubTransport([])) -> MediaClient {
    MediaClient(
        api: APIClient(
            configuration: .init(
                environment: APIEnvironment(key: "test", baseURL: URL(string: "https://example.invalid")!),
                clientBuild: 1
            ),
            transport: transport,
            tokens: LiveTestTokens()
        ),
        cache: PartitionedCache()
    )
}

/// Retry delays pass at once; the end-of-service check and the stall watchdog
/// wait for a test to ask for them, so they cannot fire in the middle of
/// something else.
private func instantRetries(_ duration: Duration) async throws {
    if duration == LivePlayerModel.monitorInterval || duration == LivePlayerModel.stallTimeout {
        try await Task.sleep(for: .seconds(3600))
    }
}

@MainActor
private func makeLive(
    granter: FakeGranter,
    player: FakePlayer,
    sleep: @escaping @Sendable (Duration) async throws -> Void = instantRetries,
    availability: @escaping @MainActor () async -> LiveAvailability
) -> LivePlayerModel {
    let coordinator = MediaPlaybackCoordinator(
        granter: granter,
        player: player,
        resumeStore: FakeResumeStore(),
        now: { Date(timeIntervalSince1970: 1_800_000_000) }
    )
    let detail = MediaDetailModel(
        client: mediaClient(),
        coordinator: coordinator,
        churchSlug: "grace",
        mediaId: "e1",
        partition: livePartition
    )
    return LivePlayerModel(detail: detail, availability: availability, sleep: sleep)
}

/// Waits for something a background task will do, without guessing how long.
@MainActor
private func eventually(
    within timeout: Duration = .seconds(3),
    _ condition: @MainActor () async -> Bool
) async -> Bool {
    let deadline = ContinuousClock.now + timeout
    while ContinuousClock.now < deadline {
        if await condition() { return true }
        try? await Task.sleep(for: .milliseconds(5))
    }
    return await condition()
}

private func loads(_ player: FakePlayer) async -> Int {
    await player.commands.filter {
        if case .load = $0 { return true }
        return false
    }.count
}

// ---------------------------------------------------------------------------
// Keeping "live" current
// ---------------------------------------------------------------------------

@Suite("Live status")
@MainActor
struct LiveStatusTests {

    @Test("a service that starts after Home loaded appears without a relaunch")
    func appearsWhenItStarts() async {
        let transport = RoutedTransport(live: [
            .init(status: 200, body: envelope(nothingLive)),
            .init(status: 200, body: envelope(liveNow)),
        ])
        let model = MediaModel(client: mediaClient(transport), churchSlug: "grace", partition: livePartition)

        await model.refresh()
        #expect(model.phase.live == nil)

        await model.refreshLive()
        #expect(model.phase.live?.state == "live")
        #expect(model.phase.live?.mediaId == "e1")
        // Only the live projection is asked again; the archive and whatever
        // the person scrolled to are left alone.
        #expect(await transport.archiveRequests == 1)
        #expect(await transport.liveRequests == 2)
    }

    @Test("a missed poll leaves the screen as it was")
    func missedPollKeepsScreen() async {
        let transport = RoutedTransport(live: [.init(status: 200, body: envelope(liveNow))])
        let model = MediaModel(client: mediaClient(transport), churchSlug: "grace", partition: livePartition)
        await model.refresh()

        await model.refreshLive()

        #expect(model.phase.live?.mediaId == "e1")
        #expect(model.phase.isStale == false)
    }

    @Test("a poll with nothing on screen yet loads the whole screen")
    func pollBeforeLoadLoadsEverything() async {
        let transport = RoutedTransport(live: [.init(status: 200, body: envelope(liveNow))])
        let model = MediaModel(client: mediaClient(transport), churchSlug: "grace", partition: livePartition)

        await model.refreshLive()

        #expect(model.phase.live?.mediaId == "e1")
        #expect(await transport.archiveRequests == 1)
    }

    @Test("a live 404 is the stream not being there yet; a refusal is still a refusal")
    func liveNotFoundIsTransient() {
        #expect(PlayerFailureMapping.from(statusCode: 404, kind: .live) == .network)
        #expect(PlayerFailureMapping.from(statusCode: 410, kind: .live) == .network)
        #expect(PlayerFailureMapping.from(statusCode: 401, kind: .live) == .unavailable)
        #expect(PlayerFailureMapping.from(statusCode: 403, kind: .live) == .unavailable)
        // A recording that is gone is gone.
        #expect(PlayerFailureMapping.from(statusCode: 404, kind: .recording) == .unavailable)
        #expect(PlayerFailureMapping.from(statusCode: 503, kind: .recording) == .network)
    }
}

// ---------------------------------------------------------------------------
// The full-screen live player
// ---------------------------------------------------------------------------

@Suite("Live player")
@MainActor
struct LivePlayerModelTests {

    @Test("opening it starts the service with no second tap")
    func startsImmediately() async {
        let granter = FakeGranter()
        await granter.setRenditionKind(.hls)
        let player = FakePlayer()
        let model = makeLive(granter: granter, player: player) { .live }

        await model.start()

        #expect(await granter.calls == [.init(churchSlug: "grace", kind: .live, mediaId: "e1")])
        #expect(await player.commands.contains(.play))
        #expect(model.phase == .connecting)

        await model.handle(.playing)
        #expect(model.phase == .playing)
        await model.stop()
    }

    @Test("a dropped stream reconnects by itself while the church is still live")
    func reconnects() async {
        let granter = FakeGranter()
        let player = FakePlayer()
        let model = makeLive(granter: granter, player: player) { .live }
        await model.start()
        await model.handle(.playing)

        await model.handle(.failed(.network))

        #expect(await eventually { await granter.calls.count == 2 })
        #expect(await loads(player) == 2)
        #expect(model.phase == .reconnecting)

        await model.handle(.playing)
        #expect(model.phase == .playing)
        await model.stop()
    }

    @Test("a stream that is not up yet is waited for, not reported as gone")
    func waitsForTheEncoder() async {
        let granter = FakeGranter()
        let player = FakePlayer()
        let model = makeLive(granter: granter, player: player) { .live }
        await model.start()

        // The playlist 404s while the encoder connects: transient for live.
        await model.handle(.failed(PlayerFailureMapping.from(statusCode: 404, kind: .live)))

        #expect(await eventually { await granter.calls.count == 2 })
        #expect(!model.isTerminal)
        await model.stop()
    }

    @Test("a failure after the service ended says it ended, and stops")
    func endedIsNotRetried() async {
        let granter = FakeGranter()
        let player = FakePlayer()
        let model = makeLive(granter: granter, player: player) { .ended }
        await model.start()
        await model.handle(.playing)

        await model.handle(.failed(.network))

        #expect(await eventually { model.phase == .ended })
        #expect(await player.commands.last == .stop)
        #expect(await granter.calls.count == 1)
        await model.stop()
    }

    @Test("refused twice while still listed as live means this account may not watch")
    func refusalsAreTerminal() async {
        let granter = FakeGranter()
        let player = FakePlayer()
        let model = makeLive(granter: granter, player: player) { .live }
        await model.start()
        await granter.setRefuse(true)

        await model.handle(.failed(.unavailable))

        #expect(await eventually { model.phase == .unavailable })
        await model.stop()
    }

    @Test("reconnecting gives up after its budget, and Try again starts over")
    func givesUpThenRetries() async {
        let granter = FakeGranter()
        let player = FakePlayer()
        let model = makeLive(granter: granter, player: player) { .unknown }
        await model.start()

        for _ in 0..<LivePlayerModel.maxAttempts {
            let before = await granter.calls.count
            await model.handle(.failed(.network))
            #expect(await eventually { await granter.calls.count == before + 1 })
        }
        await model.handle(.failed(.network))
        #expect(await eventually { model.phase == .failed })

        let before = await granter.calls.count
        await model.retry()
        #expect(model.phase == .connecting)
        #expect(await granter.calls.count == before + 1)
        await model.stop()
    }

    @Test("a service that ends while playing is noticed, not left buffering")
    func noticesTheEnd() async {
        let granter = FakeGranter()
        let player = FakePlayer()
        // The end-of-service check runs straight away here.
        let model = makeLive(granter: granter, player: player, sleep: { _ in }) { .ended }

        await model.start()

        #expect(await eventually { model.phase == .ended })
        #expect(await player.commands.last == .stop)
        await model.stop()
    }

    @Test("a stream stuck connecting without an error is rejoined, then given up on")
    func stallWatchdog() async {
        let granter = FakeGranter()
        let player = FakePlayer()
        // The player never reports playing and never reports a failure — how
        // AVPlayer behaves while every segment request 404s.
        let stallsAtOnce: @Sendable (Duration) async throws -> Void = { duration in
            if duration == LivePlayerModel.monitorInterval {
                try await Task.sleep(for: .seconds(3600))
            }
        }
        let model = makeLive(granter: granter, player: player, sleep: stallsAtOnce) { .live }

        await model.start()

        #expect(await eventually { model.phase == .failed })
        // The first attempt, then one fresh grant per stall restart.
        #expect(await granter.calls.count == 1 + LivePlayerModel.maxStallRestarts)
        #expect(await player.commands.last == .stop)

        // And Try again starts over with a fresh budget.
        let before = await granter.calls.count
        await model.retry()
        #expect(await granter.calls.count == before + 1)
        await model.stop()
    }

    @Test("resuming after a pause rejoins at the live edge")
    func resumeRejoinsLive() async {
        let granter = FakeGranter()
        let player = FakePlayer()
        let model = makeLive(granter: granter, player: player) { .live }
        await model.start()
        await model.handle(.playing)

        await model.pause()
        #expect(await player.commands.last == .pause)
        await model.handle(.paused)
        #expect(model.phase == .paused)

        await model.resume()
        // A fresh grant and a fresh load: where it paused may already have
        // scrolled out of the relay's window.
        #expect(await granter.calls.count == 2)
        #expect(await loads(player) == 2)
        await model.stop()
    }

    @Test("coming back to the app rejoins the service where it now is")
    func foregroundRejoins() async {
        let granter = FakeGranter()
        let player = FakePlayer()
        let model = makeLive(granter: granter, player: player) { .live }
        await model.start()
        await model.handle(.playing)

        await model.enterBackground()
        #expect(await player.commands.last == .pause)
        await model.handle(.paused)

        await model.enterForeground()
        #expect(await granter.calls.count == 2)
        #expect(model.phase == .connecting)
        await model.stop()
    }

    @Test("a service the person paused stays paused when they come back")
    func pausedStaysPaused() async {
        let granter = FakeGranter()
        let player = FakePlayer()
        let model = makeLive(granter: granter, player: player) { .live }
        await model.start()
        await model.handle(.playing)
        await model.pause()
        await model.handle(.paused)

        await model.enterBackground()
        await model.enterForeground()

        #expect(await granter.calls.count == 1)
        #expect(model.phase == .paused)
        await model.stop()
    }

    @Test("after closing, nothing is retried")
    func closedMeansClosed() async {
        let granter = FakeGranter()
        let player = FakePlayer()
        let model = makeLive(granter: granter, player: player) { .live }
        await model.start()

        await model.stop()
        await model.handle(.failed(.network))
        try? await Task.sleep(for: .milliseconds(50))

        #expect(await granter.calls.count == 1)
        #expect(await player.commands.last == .stop)
    }
}

// ---------------------------------------------------------------------------
// The coordinator's one retry
// ---------------------------------------------------------------------------

@Suite("Playback retry guard")
struct PlaybackRetryGuardTests {

    @Test("a second refusal before the stream was ever ready is not retried again")
    func oneRetryUntilReady() async {
        let granter = FakeGranter()
        let player = FakePlayer()
        let coordinator = MediaPlaybackCoordinator(
            granter: granter,
            player: player,
            resumeStore: FakeResumeStore(),
            now: { Date(timeIntervalSince1970: 1_800_000_000) }
        )
        await coordinator.start(churchSlug: "grace", kind: .live, mediaId: "e1", partition: livePartition)

        await coordinator.handle(.failed(.unavailable))
        #expect(await granter.calls.count == 2)

        // Still failing with a fresh capability: the capability was not the
        // problem, and renewing it forever would only spend the rate limit.
        await coordinator.handle(.failed(.unavailable))
        #expect(await granter.calls.count == 2)
        #expect(await coordinator.currentState() == .failed(.unavailable))

        // Once the stream became ready, a later refusal earns its retry again.
        await coordinator.handle(.readyToPlay(durationSeconds: nil))
        await coordinator.handle(.failed(.unavailable))
        #expect(await granter.calls.count == 3)
    }
}
