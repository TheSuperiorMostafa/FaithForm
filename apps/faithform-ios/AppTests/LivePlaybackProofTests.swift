import AVFoundation
import Foundation
import SwiftUI
import Testing
import UIKit
@testable import FaithForm
import FaithFormKit

/// Plays a live-shaped HLS stream through the shipping player, on a simulator.
///
/// `swift test` has no media stack, so this is where `AVPlayerAdapter` meets
/// real segments. `scripts/verify-ios-live-playback.sh` generates an MPEG-TS
/// stream with ffmpeg, lays it out exactly as the delivery route serves one — a
/// delivery token in the path, every URI root-relative, no ENDLIST — serves it
/// on 127.0.0.1, and passes its URL here. Without that URL these are skipped.
@MainActor
@Suite("Live playback proof", .serialized)
struct LivePlaybackProofTests {
    nonisolated static var streamURL: URL? {
        ProcessInfo.processInfo.environment["FAITHFORM_LIVE_PLAYBACK_URL"].flatMap(URL.init(string:))
    }

    /// How long the full-screen player stays up, so a script can capture it.
    nonisolated static var holdSeconds: Double {
        ProcessInfo.processInfo.environment["FAITHFORM_LIVE_PLAYBACK_HOLD_SECONDS"].flatMap(Double.init) ?? 0
    }

    @Test("a live stream plays through the adapter, with moving pictures", .enabled(if: streamURL != nil))
    func playsWithFrames() async throws {
        let url = try #require(Self.streamURL)
        let adapter = AVPlayerAdapter()
        let log = EventLog()
        await adapter.setEventHandler { event in Task { await log.append(event) } }

        await adapter.send(.load(PlaybackRequest(url: url, capability: "unused", kind: .live, renditionKind: .hls)))
        await adapter.send(.play)

        #expect(await waitFor(seconds: 20) { await log.contains(.playing) })
        let events = await log.events
        #expect(events.contains { if case .readyToPlay = $0 { return true } else { return false } })
        #expect(!events.contains { if case .failed = $0 { return true } else { return false } })

        // A black screen has no picture size, and a frozen one has no clock.
        let size = adapter.videoPlayer.currentItem?.presentationSize ?? .zero
        #expect(size.width > 0 && size.height > 0)
        let before = adapter.videoPlayer.currentTime().seconds
        try await Task.sleep(for: .seconds(1.5))
        #expect(adapter.videoPlayer.currentTime().seconds > before)

        await adapter.send(.stop)
    }

    /// Why the adapter no longer does this: the same stream, through a custom
    /// scheme and a resource loader that answers every request with data —
    /// the previous design — never plays.
    @Test("the previous resource-loader path cannot play the same stream", .enabled(if: streamURL != nil))
    func resourceLoaderCannotPlayHLS() async throws {
        let url = try #require(Self.streamURL)
        var components = try #require(URLComponents(url: url, resolvingAgainstBaseURL: false))
        components.scheme = "faithform-media"
        let loader = PassThroughLoader(realScheme: url.scheme ?? "http")
        let asset = AVURLAsset(url: try #require(components.url))
        asset.resourceLoader.setDelegate(loader, queue: DispatchQueue(label: "proof.loader"))
        let item = AVPlayerItem(asset: asset)
        let player = AVPlayer(playerItem: item)
        player.play()

        #expect(await waitFor(seconds: 20) { item.status == .failed || player.timeControlStatus == .playing })
        #expect(item.status == .failed)
        #expect(player.timeControlStatus != .playing)
        let codes = sequence(first: item.error as NSError?) { $0?.userInfo[NSUnderlyingErrorKey] as? NSError }
            .prefix(while: { $0 != nil })
            .compactMap { $0.map { "\($0.domain) \($0.code)" } }
        print("LIVE_PROOF_OLD_PATH_ERROR \(codes.joined(separator: " <- "))")
        withExtendedLifetime(loader) {}
    }

    @Test("Watch live opens full screen and plays without a second tap", .enabled(if: streamURL != nil))
    func fullScreenPlayer() async throws {
        let url = try #require(Self.streamURL)
        let adapter = AVPlayerAdapter()
        let coordinator = MediaPlaybackCoordinator(
            granter: LocalGranter(url: url),
            player: adapter,
            resumeStore: NoResumeStore()
        )
        let partition = CachePartition(
            environment: "proof", accountId: "a", churchSlug: "grace", authorizationVersion: 1
        )
        let detail = MediaDetailModel(
            client: MediaClient(
                api: APIClient(
                    configuration: .init(
                        environment: APIEnvironment(key: "proof", baseURL: URL(string: "https://example.invalid")!),
                        clientBuild: 1
                    ),
                    transport: StubTransport([]),
                    tokens: nil
                ),
                cache: PartitionedCache()
            ),
            coordinator: coordinator,
            churchSlug: "grace",
            mediaId: "e1",
            partition: partition
        )
        let model = LivePlayerModel(detail: detail, availability: { .live })
        await adapter.setEventHandler { event in
            Task { @MainActor in await model.handle(event) }
        }

        let live = LiveMedia(
            state: "live", mediaId: "e1", kind: "live", title: "Sunday Worship",
            startsAt: "2026-09-20T14:00:00Z", countdownEnabled: false, posterUrl: nil,
            publicationVersion: 1, churchSlug: "grace", churchName: "Grace Community",
            churchTimezone: "America/New_York"
        )
        let host = UIHostingController(
            rootView: LivePlayerView(model: model, player: adapter.videoPlayer, live: live, onClose: {})
                .faithformTheme(nil)
        )
        host.modalPresentationStyle = .fullScreen
        let presenter = try #require(TopViewController.resolve())
        presenter.present(host, animated: false)

        await model.start()
        #expect(await waitFor(seconds: 20) { model.phase == .playing })
        #expect((adapter.videoPlayer.currentItem?.presentationSize.width ?? 0) > 0)

        if Self.holdSeconds > 0 {
            print("LIVE_PROOF_ON_SCREEN")
            try await Task.sleep(for: .seconds(Self.holdSeconds))
        }

        await model.stop()
        host.dismiss(animated: false)
    }
}

// MARK: - Doubles

private actor EventLog {
    private(set) var events: [PlayerEvent] = []
    func append(_ event: PlayerEvent) { events.append(event) }
    func contains(_ event: PlayerEvent) -> Bool { events.contains(event) }
}

private actor LocalGranter: PlaybackGranting {
    let url: URL
    init(url: URL) { self.url = url }

    func grant(churchSlug: String, kind: MediaPlaybackKind, mediaId: String) async throws -> GrantedPlayback {
        GrantedPlayback(
            capability: "unused",
            deliveryURL: url,
            renditionKind: .hls,
            expiresAt: Date().addingTimeInterval(300),
            refreshLeadSeconds: 60,
            startOffsetSeconds: 0
        )
    }
}

private actor NoResumeStore: ResumePositionStoring {
    func position(for mediaId: String, partition: CachePartition, now: Date) async -> ResumePosition? { nil }
    func record(_ position: ResumePosition, partition: CachePartition, now: Date) async {}
    func clear(partition: CachePartition) async {}
    func clearAll() async {}
}

/// The removed design, in miniature: every request answered with its bytes.
private final class PassThroughLoader: NSObject, AVAssetResourceLoaderDelegate, @unchecked Sendable {
    let realScheme: String
    init(realScheme: String) { self.realScheme = realScheme }

    func resourceLoader(
        _ resourceLoader: AVAssetResourceLoader,
        shouldWaitForLoadingOfRequestedResource loadingRequest: AVAssetResourceLoadingRequest
    ) -> Bool {
        guard let url = loadingRequest.request.url,
              var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        else { return false }
        components.scheme = realScheme
        guard let real = components.url else { return false }
        URLSession.shared.dataTask(with: real) { data, _, error in
            if let error {
                loadingRequest.finishLoading(with: error)
                return
            }
            if let data { loadingRequest.dataRequest?.respond(with: data) }
            loadingRequest.finishLoading()
        }.resume()
        return true
    }
}

@MainActor
private func waitFor(seconds: Double, _ condition: @MainActor () async -> Bool) async -> Bool {
    let deadline = Date().addingTimeInterval(seconds)
    while Date() < deadline {
        if await condition() { return true }
        try? await Task.sleep(for: .milliseconds(50))
    }
    return await condition()
}
