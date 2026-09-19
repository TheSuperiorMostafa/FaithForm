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
        let window = proofWindow(host, size: CGSize(width: 390, height: 700))
        defer { window.isHidden = true }

        await model.start()
        #expect(await waitFor(seconds: 20) { model.phase == .playing })
        #expect((adapter.videoPlayer.currentItem?.presentationSize.width ?? 0) > 0)

        let item = try #require(adapter.videoPlayer.currentItem)
        let surface = try #require(videoSurface(in: host.view))
        for size in [CGSize(width: 844, height: 390), CGSize(width: 390, height: 700)] {
            host.view.frame = CGRect(origin: .zero, size: size)
            host.view.layoutIfNeeded()
            try await Task.sleep(for: .milliseconds(500))
            #expect(videoSurface(in: host.view) === surface)
            #expect(adapter.videoPlayer.currentItem === item)
            #expect(model.phase == .playing)
        }

        if Self.holdSeconds > 0 {
            print("LIVE_PROOF_ON_SCREEN")
            try await Task.sleep(for: .seconds(Self.holdSeconds))
        }

        await model.stop()
        host.dismiss(animated: false)
    }
    @Test("recording starts before the response finishes and survives both rotations", .enabled(if: streamURL != nil))
    func recordingStartupAndRotation() async throws {
        let origin = try #require(Self.streamURL)
        let url = try #require(URL(string: "/proof-recording.mp4", relativeTo: origin)?.absoluteURL)
        let adapter = AVPlayerAdapter()
        let granter = LocalGranter(url: url, rendition: .progressive)
        let detail = MediaDetailModel(
            client: MediaClient(api: APIClient(configuration: .init(
                environment: APIEnvironment(key: "proof", baseURL: origin), clientBuild: 1
            ), transport: StubTransport([]), tokens: nil), cache: PartitionedCache()),
            coordinator: MediaPlaybackCoordinator(granter: granter, player: adapter, resumeStore: NoResumeStore()),
            churchSlug: "grace", mediaId: "recording", partition: .init(
                environment: "proof", accountId: "a", churchSlug: "grace", authorizationVersion: 1
            )
        )
        await adapter.setEventHandler { event in Task { @MainActor in await detail.handle(event) } }
        let host = UIHostingController(rootView: RecordingLayout(model: detail, player: adapter.videoPlayer).faithformTheme(nil))
        let window = proofWindow(host, size: CGSize(width: 390, height: 700))
        defer { window.isHidden = true }
        try await Task.sleep(for: .milliseconds(200))
        let start = Date()
        await detail.play(kind: .recording)
        // The fixture deliberately holds the response tail for 12 seconds.
        #expect(await waitFor(seconds: 8) { detail.playback == .playing })
        print("RECORDING_PROOF_STARTUP_SECONDS \(Date().timeIntervalSince(start))")
        let item = try #require(adapter.videoPlayer.currentItem)
        let surface = try #require(videoSurface(in: host.view))
        let before = adapter.videoPlayer.currentTime().seconds
        for size in [CGSize(width: 844, height: 390), CGSize(width: 390, height: 700)] {
            host.view.frame = CGRect(origin: .zero, size: size)
            host.view.setNeedsLayout()
            host.view.layoutIfNeeded()
            try await Task.sleep(for: .milliseconds(600))
            #expect(videoSurface(in: host.view) === surface)
            #expect(adapter.videoPlayer.currentItem === item)
            #expect(detail.playback == .playing)
        }
        #expect(adapter.videoPlayer.currentTime().seconds > before)
        #expect(await granter.requests == 1)
        // Dismissing the screen must still stop playback.
        host.willMove(toParent: nil)
        host.view.removeFromSuperview()
        host.removeFromParent()
        #expect(await waitFor(seconds: 3) { adapter.videoPlayer.currentItem == nil })
        await detail.stop()
    }

    @Test("service thumbnail loads before playback", .enabled(if: streamURL != nil))
    func thumbnailLoads() async throws {
        let origin = try #require(Self.streamURL)
        let url = try #require(URL(string: "/proof-thumbnail.png?fresh=\(UUID())", relativeTo: origin)?.absoluteURL)
        let host = UIHostingController(rootView: StreamThumbnail(url: url.absoluteString).faithformTheme(nil))
        let window = proofWindow(host, size: CGSize(width: 320, height: 180))
        defer { window.isHidden = true }
        #expect(await waitFor(seconds: 5) { centerIsGreen(host.view) })
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
    let rendition: RenditionKind
    private(set) var requests = 0
    init(url: URL, rendition: RenditionKind = .hls) { self.url = url; self.rendition = rendition }

    func grant(churchSlug: String, kind: MediaPlaybackKind, mediaId: String) async throws -> GrantedPlayback {
        requests += 1
        return GrantedPlayback(
            capability: "unused",
            deliveryURL: url,
            renditionKind: rendition,
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

@MainActor
private func proofWindow<Content: View>(_ host: UIHostingController<Content>, size: CGSize) -> UIWindow {
    let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first!
    let window = UIWindow(windowScene: scene)
    let container = UIViewController()
    window.rootViewController = container
    window.windowLevel = .alert + 1
    window.makeKeyAndVisible()
    container.addChild(host)
    container.view.addSubview(host.view)
    host.view.frame = CGRect(origin: .zero, size: size)
    host.didMove(toParent: container)
    host.view.layoutIfNeeded()
    return window
}

@MainActor
private func videoSurface(in view: UIView) -> MediaVideoSurface.SurfaceView? {
    if let surface = view as? MediaVideoSurface.SurfaceView { return surface }
    return view.subviews.lazy.compactMap { videoSurface(in: $0) }.first
}

@MainActor
private func centerIsGreen(_ view: UIView) -> Bool {
    let image = UIGraphicsImageRenderer(bounds: view.bounds).image { _ in
        view.drawHierarchy(in: view.bounds, afterScreenUpdates: true)
    }
    guard let cg = image.cgImage,
          let pixelImage = cg.cropping(to: CGRect(x: cg.width / 2, y: cg.height / 2, width: 1, height: 1)) else { return false }
    var pixel = [UInt8](repeating: 0, count: 4)
    pixel.withUnsafeMutableBytes { bytes in
        let context = CGContext(data: bytes.baseAddress, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4,
                                space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        context.draw(pixelImage, in: CGRect(x: 0, y: 0, width: 1, height: 1))
    }
    return pixel[0] < 30 && pixel[1] > 220 && pixel[2] < 30
}
