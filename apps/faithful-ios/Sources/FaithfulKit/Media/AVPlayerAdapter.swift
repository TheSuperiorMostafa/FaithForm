#if canImport(AVFoundation)
import AVFoundation
import Foundation

/// The only file in Faithful that touches AVFoundation.
///
/// **It contains no decisions.** When to refresh a capability, what a failure
/// means to a person, whether a position is worth remembering, what happens on
/// a revocation — all of that lives in `MediaPlayback.swift` and
/// `MediaPlaybackCoordinator`, which are plain Swift and run on any test
/// runner. This file translates.
///
/// ## Why a resource loader and not a signed URL
///
/// `AVPlayer` fetches a playlist and then every segment in it. Handing it a URL
/// with a credential in the query string would put that credential into each of
/// those requests, into any proxy log between here and the server, and into
/// whatever the system does with a URL it is asked to play.
///
/// `AVURLAssetHTTPHeaderFieldsKey` would attach a header, but it is
/// undocumented and using it risks a review rejection for private API. The
/// documented mechanism is `AVAssetResourceLoaderDelegate`: the asset is created
/// with a **custom scheme** so `AVPlayer` cannot fetch it itself, every request
/// — playlist, segment, byte range — arrives here instead, and each is issued
/// with `URLSession` carrying the capability as a bearer header.
///
/// The capability therefore appears in exactly one place: an HTTP header on an
/// outbound request. Not in a URL, not in a log, not in a screenshot.
///
/// ## What is not exercised in CI
///
/// `swift test` runs on macOS with no iOS media stack, and no simulator vends
/// real HLS segments. So **the player wiring below is not covered by an
/// automated test** and is verified by the device runbook instead. What *is*
/// covered — because it was deliberately kept out of this file — is the refresh
/// schedule, the single-flight, the error mapping, the resume policy and the
/// revocation behaviour.
public actor AVPlayerAdapter: MediaPlayerFacade {

    /// The scheme that keeps `AVPlayer` out of the network.
    ///
    /// It must not be one the system can resolve; `AVPlayer` only consults a
    /// resource loader for schemes it does not recognise.
    static let interceptScheme = "faithful-media"

    #if os(iOS)
    private let player = AVPlayer()
    private var loader: CapabilityResourceLoader?
    private var item: AVPlayerItem?
    private var timeObserver: Any?
    private var startOffset: Double = 0
    #endif

    private var handler: (@Sendable (PlayerEvent) -> Void)?

    public init() {}

    public func setEventHandler(_ handler: @Sendable @escaping (PlayerEvent) -> Void) async {
        self.handler = handler
    }

    public func currentPositionSeconds() async -> Double {
        #if os(iOS)
        let seconds = player.currentTime().seconds
        guard seconds.isFinite else { return 0 }
        // Reported relative to the start of the trimmed recording, so a resume
        // position means the same thing to a person as it does to the server.
        return max(0, seconds - startOffset)
        #else
        return 0
        #endif
    }

    public func send(_ command: PlayerCommand) async {
        #if os(iOS)
        switch command {
        case .load(let request):
            await load(request)
        case .play:
            player.play()
            handler?(.playing)
        case .pause:
            player.pause()
            handler?(.paused)
        case .seek(let seconds):
            let target = CMTime(seconds: startOffset + max(0, seconds), preferredTimescale: 600)
            await player.seek(to: target, toleranceBefore: .zero, toleranceAfter: .zero)
        case .stop:
            player.pause()
            player.replaceCurrentItem(with: nil)
            item = nil
            loader = nil
        case .updateCapability(let capability):
            // Swapped in place: the loader uses it on the next request it
            // makes, so a refresh never interrupts playback.
            //
            // Not awaited, and not an actor: the loader is called back on
            // AVFoundation's own delegate queue, so it guards its capability
            // with a lock rather than with isolation. Awaiting it would have
            // suggested a suspension point that does not exist.
            loader?.update(capability: capability)
        }
        #else
        _ = command
        #endif
    }

    #if os(iOS)
    private func load(_ request: PlaybackRequest) async {
        startOffset = request.startOffsetSeconds

        guard var components = URLComponents(url: request.url, resolvingAgainstBaseURL: false) else {
            handler?(.failed(.unknown))
            return
        }
        // The asset's URL is deliberately unresolvable by the system, so every
        // request lands in the loader.
        components.scheme = Self.interceptScheme
        guard let interceptURL = components.url else {
            handler?(.failed(.unknown))
            return
        }

        let originalScheme = request.url.scheme ?? "https"
        let loader = CapabilityResourceLoader(
            capability: request.capability,
            realScheme: originalScheme,
        ) { [weak self] failure in
            Task { await self?.report(.failed(failure)) }
        }
        self.loader = loader

        let asset = AVURLAsset(url: interceptURL)
        asset.resourceLoader.setDelegate(loader, queue: DispatchQueue(label: "faithful.media.loader"))

        let item = AVPlayerItem(asset: asset)
        self.item = item
        player.replaceCurrentItem(with: item)

        // A live stream must not be paused into a stall by the system deciding
        // to buffer more; a recording benefits from it.
        player.automaticallyWaitsToMinimizeStalling = request.kind == .recording

        if request.kind.isResumable, request.resumeSeconds > 0 {
            let target = CMTime(
                seconds: startOffset + request.resumeSeconds,
                preferredTimescale: 600,
            )
            await player.seek(to: target, toleranceBefore: .zero, toleranceAfter: .zero)
        } else if request.startOffsetSeconds > 0 {
            let target = CMTime(seconds: startOffset, preferredTimescale: 600)
            await player.seek(to: target, toleranceBefore: .zero, toleranceAfter: .zero)
        }

        observeProgress()
        handler?(.buffering)
    }

    private func observeProgress() {
        if let timeObserver {
            player.removeTimeObserver(timeObserver)
            self.timeObserver = nil
        }
        let interval = CMTime(seconds: 5, preferredTimescale: 600)
        timeObserver = player.addPeriodicTimeObserver(
            forInterval: interval,
            queue: .main,
        ) { [weak self] time in
            Task { await self?.reportProgress(time.seconds) }
        }
    }

    private func reportProgress(_ seconds: Double) {
        guard seconds.isFinite else { return }
        let duration = item?.duration.seconds
        handler?(.progress(
            seconds: max(0, seconds - startOffset),
            durationSeconds: duration?.isFinite == true ? duration : nil,
        ))
    }

    private func report(_ event: PlayerEvent) {
        handler?(event)
    }
    #endif
}

#if os(iOS)
/// Issues every request `AVPlayer` would have made, with the capability
/// attached as a header.
///
/// **Holds nothing.** No response body is cached, no file is written, and the
/// capability lives only in this object for as long as the session does. There
/// is no download feature and no offline store — a `AVAssetDownloadTask` would
/// be one, and there is none anywhere in this package.
private final class CapabilityResourceLoader: NSObject, AVAssetResourceLoaderDelegate, @unchecked Sendable {
    private let lock = NSLock()
    private var capability: String
    private let realScheme: String
    private let onFailure: @Sendable (PlayerFailure) -> Void
    private let session: URLSession

    init(
        capability: String,
        realScheme: String,
        onFailure: @escaping @Sendable (PlayerFailure) -> Void
    ) {
        self.capability = capability
        self.realScheme = realScheme
        self.onFailure = onFailure

        let configuration = URLSessionConfiguration.ephemeral
        // **Nothing on disk.** An ephemeral session keeps no cache, no cookies
        // and no credential store, so a capability and a segment cannot outlive
        // the session that fetched them.
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        self.session = URLSession(configuration: configuration)
        super.init()
    }

    func update(capability: String) {
        lock.lock()
        self.capability = capability
        lock.unlock()
    }

    private func currentCapability() -> String {
        lock.lock()
        defer { lock.unlock() }
        return capability
    }

    func resourceLoader(
        _ resourceLoader: AVAssetResourceLoader,
        shouldWaitForLoadingOfRequestedResource loadingRequest: AVAssetResourceLoadingRequest,
    ) -> Bool {
        guard
            let requestedURL = loadingRequest.request.url,
            var components = URLComponents(url: requestedURL, resolvingAgainstBaseURL: false)
        else { return false }

        components.scheme = realScheme
        guard let url = components.url else { return false }

        var request = URLRequest(url: url)
        request.setValue("Bearer \(currentCapability())", forHTTPHeaderField: "Authorization")
        request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData

        // Byte ranges, so a recording can be scrubbed. Without this the player
        // downloads from zero on every seek and refuses to scrub at all.
        if let dataRequest = loadingRequest.dataRequest, dataRequest.requestedOffset > 0
            || dataRequest.requestedLength != Int.max {
            let start = dataRequest.requestedOffset
            let end = start + Int64(dataRequest.requestedLength) - 1
            request.setValue("bytes=\(start)-\(end)", forHTTPHeaderField: "Range")
        }

        session.dataTask(with: request) { [weak self] data, response, error in
            guard let self else { return }

            if error != nil {
                // The transport's own message can name a host and a path.
                // Only the class of failure crosses back.
                loadingRequest.finishLoading(with: URLError(.cannotLoadFromNetwork))
                self.onFailure(.network)
                return
            }

            guard let http = response as? HTTPURLResponse else {
                loadingRequest.finishLoading(with: URLError(.badServerResponse))
                self.onFailure(.unknown)
                return
            }

            guard (200...299).contains(http.statusCode) else {
                loadingRequest.finishLoading(with: URLError(.badServerResponse))
                self.onFailure(PlayerFailureMapping.from(statusCode: http.statusCode))
                return
            }

            if let contentInformation = loadingRequest.contentInformationRequest {
                contentInformation.contentType = http.value(forHTTPHeaderField: "Content-Type")
                contentInformation.isByteRangeAccessSupported =
                    http.value(forHTTPHeaderField: "Accept-Ranges") == "bytes"
                contentInformation.contentLength = http.expectedContentLength
            }

            if let data { loadingRequest.dataRequest?.respond(with: data) }
            loadingRequest.finishLoading()
        }.resume()

        return true
    }
}
#endif
#endif
