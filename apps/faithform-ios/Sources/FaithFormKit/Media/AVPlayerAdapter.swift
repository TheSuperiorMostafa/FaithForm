#if canImport(AVFoundation)
import AVFoundation
import Foundation
#if canImport(UniformTypeIdentifiers)
import UniformTypeIdentifiers
#endif

/// The only file in FaithForm that touches AVFoundation.
///
/// **It contains no decisions.** When to refresh a capability, what a failure
/// means to a person, whether a position is worth remembering, what happens on
/// a revocation — all of that lives in `MediaPlayback.swift` and
/// `MediaPlaybackCoordinator`, which are plain Swift and run on any test
/// runner. This file translates, in both directions: commands in, and what the
/// player *actually* did — observed, never assumed — back out.
///
/// ## Two ways in, by rendition
///
/// **HLS (every live service) is a plain HTTPS asset.** AVFoundation refuses
/// media segments served through an `AVAssetResourceLoaderDelegate` — the only
/// response it accepts for one is a redirect, which drops any header
/// (CoreMediaErrorDomain -12881, "custom url not redirect"). A live stream
/// routed through a loader therefore never shows a frame. So the server hands
/// out a delivery URL whose *path* carries a delivery token (see the server's
/// `playback-capability.ts`), and `AVPlayer` fetches the playlist and every
/// segment itself — which is also what lets AirPlay and the system's own
/// buffering work.
///
/// **Progressive (the archive) goes through a resource loader.** The asset is
/// created with a custom scheme so `AVPlayer` cannot fetch it itself, every byte
/// range arrives here instead, and each is issued with `URLSession` carrying the
/// capability as a bearer header. That is allowed for progressive media, and
/// keeps the capability out of any URL.
///
/// ## What is not exercised in CI
///
/// `swift test` runs on macOS with no iOS media stack, so **the player wiring
/// below is not covered by `swift test`**; the app's tests play a real stream
/// through it on a simulator. What *is* covered here — because it was
/// deliberately kept out of this file — is the refresh schedule, the
/// single-flight, the error mapping, the resume policy and the revocation
/// behaviour.
public actor AVPlayerAdapter: MediaPlayerFacade {

    /// The scheme that keeps `AVPlayer` out of the network for progressive media.
    ///
    /// It must not be one the system can resolve; `AVPlayer` only consults a
    /// resource loader for schemes it does not recognise.
    static let interceptScheme = "faithform-media"

    #if os(iOS)
    private let surface = PlayerSurface()
    private var player: AVPlayer { surface.player }
    private var loader: CapabilityResourceLoader?
    private var item: AVPlayerItem?
    private var timeObserver: Any?
    private var startOffset: Double = 0

    /// What is loaded, so an item that failed can be built again from it —
    /// `AVPlayer` never plays a failed item, however often it is told to.
    private var request: PlaybackRequest?
    /// The newest capability, which a rebuilt progressive item must use rather
    /// than the one the request was first made with.
    private var capability: String?

    private var observations: [NSKeyValueObservation] = []
    private var notificationTokens: [NSObjectProtocol] = []
    /// Bumped on every load and stop. Callbacks from an item that has since
    /// been replaced carry an older value and are dropped, so a stale failure
    /// can never land on the stream that followed it.
    private var generation = 0
    #endif

    private var handler: (@Sendable (PlayerEvent) -> Void)?

    public init() {}

    #if os(iOS)
    /// The player, for the layer that shows its picture — and for nothing else.
    ///
    /// Without it a recording plays as sound over a screen of text: the Watch
    /// tab's whole point, missing. Exposed the way `AVFoundationScanner` exposes
    /// its capture session to the camera preview, and for the same reasons.
    /// `nonisolated` because a layer is built on the main actor and cannot await,
    /// and safe to hand out because `AVPlayerLayer` only *displays* a player
    /// something else drives. **Every command still goes through this actor**:
    /// `MediaVideoSurface` has no play, no seek, no item and no capability.
    public nonisolated var videoPlayer: AVPlayer { surface.player }

    /// Holds the player so the reference can be read from any isolation.
    ///
    /// `@unchecked Sendable` is a claim, and this is the claim: the one stored
    /// value is immutable, the actor is the only thing that mutates the player
    /// it points at, and the only other reader is a display layer.
    private final class PlayerSurface: @unchecked Sendable {
        let player = AVPlayer()
    }
    #endif

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
            capability = request.capability
            await load(request)
        case .play:
            // A failed item stays failed. Playing again means building the item
            // again — through whatever capability the coordinator just renewed.
            if item?.status == .failed, let request {
                await load(request)
            }
            // No synthetic "playing": the time-control observer reports what
            // the player actually does, and a stream that never loads must not
            // read as playing in the meantime.
            player.play()
        case .pause:
            player.pause()
        case .seek(let seconds):
            let target = CMTime(seconds: startOffset + max(0, seconds), preferredTimescale: 600)
            await player.seek(to: target, toleranceBefore: .zero, toleranceAfter: .zero)
        case .stop:
            tearDown()
            player.pause()
            player.replaceCurrentItem(with: nil)
            request = nil
            capability = nil
        case .updateCapability(let capability):
            // Swapped in place: the loader uses it on the next request it
            // makes, so a refresh never interrupts playback.
            //
            // Not awaited, and not an actor: the loader is called back on
            // AVFoundation's own delegate queue, so it guards its capability
            // with a lock rather than with isolation. Awaiting it would have
            // suggested a suspension point that does not exist.
            self.capability = capability
            loader?.update(capability: capability)
        }
        #else
        _ = command
        #endif
    }

    #if os(iOS)
    private func load(_ request: PlaybackRequest) async {
        tearDown()
        self.request = request
        startOffset = request.startOffsetSeconds

        let asset: AVURLAsset
        switch request.renditionKind {
        case .hls:
            // Plain HTTPS: the delivery path carries its own token, and every
            // playlist and segment URL the player derives from it inherits it.
            asset = AVURLAsset(url: request.url)
        case .progressive:
            guard let intercepted = interceptedAsset(for: request) else {
                handler?(.failed(.unknown))
                return
            }
            asset = intercepted
        }

        // Duration is already supplied by the API. Do not hold first playback
        // behind an extra duration scan of the asset.
        let item = AVPlayerItem(asset: asset, automaticallyLoadedAssetKeys: [])
        if request.kind == .live {
            // After a stall, catch up to where the rest of the congregation is
            // rather than resuming a minute behind them.
            item.automaticallyPreservesTimeOffsetFromLive = true
        }
        self.item = item
        observe(item, kind: request.kind, generation: generation)

        // Left at the system default (true) for live and recorded alike. With
        // it off, `play()` on a stream that has not buffered yet starts, stalls
        // and stops — a black frame that never recovers on its own.
        player.automaticallyWaitsToMinimizeStalling = true
        player.replaceCurrentItem(with: item)

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

    private func interceptedAsset(for request: PlaybackRequest) -> AVURLAsset? {
        guard var components = URLComponents(url: request.url, resolvingAgainstBaseURL: false) else {
            return nil
        }
        // The asset's URL is deliberately unresolvable by the system, so every
        // request lands in the loader.
        components.scheme = Self.interceptScheme
        guard let interceptURL = components.url else { return nil }

        let loader = CapabilityResourceLoader(
            capability: capability ?? request.capability,
            realScheme: request.url.scheme ?? "https",
        ) { [weak self, generation] failure in
            Task { await self?.report(.failed(failure), generation: generation) }
        }
        self.loader = loader

        let asset = AVURLAsset(url: interceptURL)
        asset.resourceLoader.setDelegate(loader, queue: loader.queue)
        return asset
    }

    // MARK: - Observing what the player actually does

    private func observe(_ item: AVPlayerItem, kind: MediaPlaybackKind, generation: Int) {
        observations = [
            item.observe(\.status, options: [.new]) { [weak self] item, _ in
                let status = item.status
                let duration = item.duration.seconds
                let failure = status == .failed ? Self.failure(of: item, kind: kind) : nil
                Task {
                    await self?.itemStatusChanged(
                        status,
                        duration: duration,
                        failure: failure,
                        generation: generation,
                    )
                }
            },
            player.observe(\.timeControlStatus, options: [.new]) { [weak self] player, _ in
                let status = player.timeControlStatus
                Task { await self?.timeControlChanged(status, generation: generation) }
            },
        ]

        let center = NotificationCenter.default
        notificationTokens = [
            center.addObserver(
                forName: AVPlayerItem.didPlayToEndTimeNotification,
                object: item,
                queue: nil,
            ) { [weak self] _ in
                Task { await self?.report(.ended, generation: generation) }
            },
            center.addObserver(
                forName: AVPlayerItem.failedToPlayToEndTimeNotification,
                object: item,
                queue: nil,
            ) { [weak self] note in
                let error = note.userInfo?[AVPlayerItemFailedToPlayToEndTimeErrorKey] as? NSError
                let failure = error.map { Self.failure(of: $0, kind: kind) } ?? .network
                Task { await self?.report(.failed(failure), generation: generation) }
            },
        ]
    }

    private func itemStatusChanged(
        _ status: AVPlayerItem.Status,
        duration: Double,
        failure: PlayerFailure?,
        generation: Int,
    ) {
        guard generation == self.generation else { return }
        switch status {
        case .readyToPlay:
            handler?(.readyToPlay(durationSeconds: duration.isFinite ? duration : nil))
            // Ready and "playing" arrive on separate observers in no promised
            // order. Restating the player's state after "ready" means the last
            // word is always what the player is doing now.
            if let event = Self.event(for: player.timeControlStatus) { handler?(event) }
        case .failed:
            handler?(.failed(failure ?? .unknown))
        case .unknown:
            break
        @unknown default:
            break
        }
    }

    private func timeControlChanged(_ status: AVPlayer.TimeControlStatus, generation: Int) {
        guard generation == self.generation, let item else { return }
        // Before an item is ready, "paused" is only its starting state, and
        // after it fails the player pauses as a consequence. Neither is a
        // pause anyone asked for, and reporting one would hide the failure.
        if status == .paused, item.status != .readyToPlay { return }
        if let event = Self.event(for: status) { handler?(event) }
    }

    private func report(_ event: PlayerEvent, generation: Int) {
        guard generation == self.generation else { return }
        handler?(event)
    }

    private static func event(for status: AVPlayer.TimeControlStatus) -> PlayerEvent? {
        switch status {
        case .playing: return .playing
        case .paused: return .paused
        case .waitingToPlayAtSpecifiedRate: return .buffering
        @unknown default: return nil
        }
    }

    private func tearDown() {
        generation += 1
        observations.forEach { $0.invalidate() }
        observations = []
        notificationTokens.forEach { NotificationCenter.default.removeObserver($0) }
        notificationTokens = []
        if let timeObserver {
            player.removeTimeObserver(timeObserver)
            self.timeObserver = nil
        }
        item = nil
        loader?.cancelAll()
        loader = nil
    }

    private func observeProgress() {
        let generation = generation
        let interval = CMTime(seconds: 5, preferredTimescale: 600)
        timeObserver = player.addPeriodicTimeObserver(
            forInterval: interval,
            queue: .main,
        ) { [weak self] time in
            let seconds = time.seconds
            Task { await self?.reportProgress(seconds, generation: generation) }
        }
    }

    private func reportProgress(_ seconds: Double, generation: Int) {
        guard generation == self.generation, seconds.isFinite else { return }
        let duration = item?.duration.seconds
        handler?(.progress(
            seconds: max(0, seconds - startOffset),
            durationSeconds: duration?.isFinite == true ? duration : nil,
        ))
    }

    // MARK: - What a failure means

    /// The class of a failure, read from what AVFoundation recorded about it.
    ///
    /// The error log names the HTTP status of a failed playlist or segment
    /// request, which the error itself usually buries under a CoreMedia code.
    /// Only the class leaves this function: never the URL, the comment, or the
    /// domain.
    private nonisolated static func failure(of item: AVPlayerItem, kind: MediaPlaybackKind) -> PlayerFailure {
        if let event = item.errorLog()?.events.last,
           let status = httpStatus(code: event.errorStatusCode, comment: event.errorComment) {
            return PlayerFailureMapping.from(statusCode: status, kind: kind)
        }
        if let error = item.error as NSError? { return failure(of: error, kind: kind) }
        return .unknown
    }

    private nonisolated static func failure(of error: NSError, kind: MediaPlaybackKind) -> PlayerFailure {
        if let status = httpStatus(code: error.code, comment: error.localizedDescription) {
            return PlayerFailureMapping.from(statusCode: status, kind: kind)
        }
        if error.domain == NSURLErrorDomain { return .network }
        if error.domain == AVFoundationErrorDomain,
           let code = AVError.Code(rawValue: error.code) {
            switch code {
            case .fileFormatNotRecognized, .decoderNotFound, .formatUnsupported:
                return .unsupported
            case .contentIsUnavailable, .contentIsProtected, .contentIsNotAuthorized:
                return .unavailable
            default:
                break
            }
        }
        if let underlying = error.userInfo[NSUnderlyingErrorKey] as? NSError {
            return failure(of: underlying, kind: kind)
        }
        return .unknown
    }

    /// An HTTP status, from a status code or from CoreMedia's "HTTP 404: …".
    private nonisolated static func httpStatus(code: Int, comment: String?) -> Int? {
        if (400...599).contains(code) { return code }
        switch code {
        // CoreMedia's own codes for the statuses that decide something.
        case -12937: return 401
        case -12660: return 403
        case -12938: return 404
        default: break
        }
        guard let comment,
              let range = comment.range(of: #"HTTP (\d{3})"#, options: .regularExpression)
        else { return nil }
        return Int(comment[range].dropFirst(5))
    }
    #endif
}

#if os(iOS)
/// Issues every byte-range request `AVPlayer` makes for a progressive
/// recording, with the capability attached as a header.
///
/// **Holds nothing.** No response body is cached, no file is written, and the
/// capability lives only in this object for as long as the session does. There
/// is no download feature and no offline store — a `AVAssetDownloadTask` would
/// be one, and there is none anywhere in this package.
private final class CapabilityResourceLoader: NSObject, AVAssetResourceLoaderDelegate, URLSessionDataDelegate, @unchecked Sendable {
    // Resource-loader and URLSession callbacks share one serial queue. Only
    // capability replacement crosses queues, guarded separately by the lock.
    let queue = DispatchQueue(label: "faithform.media.loader")
    private let lock = NSLock()
    private var capability: String
    private let realScheme: String
    private let onFailure: @Sendable (PlayerFailure) -> Void
    private var transfers: [Int: AVAssetResourceLoadingRequest] = [:]
    private var stopped = false
    private lazy var session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        let callbacks = OperationQueue()
        callbacks.maxConcurrentOperationCount = 1
        callbacks.underlyingQueue = queue
        return URLSession(configuration: configuration, delegate: self, delegateQueue: callbacks)
    }()
    private var tasks: [Int: URLSessionDataTask] = [:]

    init(capability: String, realScheme: String, onFailure: @escaping @Sendable (PlayerFailure) -> Void) {
        self.capability = capability
        self.realScheme = realScheme
        self.onFailure = onFailure
        super.init()
    }

    func update(capability: String) {
        lock.withLock { self.capability = capability }
    }

    func cancelAll() {
        queue.async { [self] in
            stopped = true
            transfers.removeAll()
            tasks.removeAll()
            session.invalidateAndCancel()
        }
    }

    func resourceLoader(
        _ resourceLoader: AVAssetResourceLoader,
        shouldWaitForLoadingOfRequestedResource loadingRequest: AVAssetResourceLoadingRequest
    ) -> Bool {
        guard !stopped else { return false }
        guard let requestedURL = loadingRequest.request.url,
              var components = URLComponents(url: requestedURL, resolvingAgainstBaseURL: false)
        else { return false }
        components.scheme = realScheme
        guard let url = components.url else { return false }
        var request = URLRequest(url: url)
        request.setValue("Bearer \(lock.withLock { capability })", forHTTPHeaderField: "Authorization")
        request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        if let data = loadingRequest.dataRequest {
            let start = max(data.requestedOffset, data.currentOffset)
            if data.requestsAllDataToEndOfResource {
                request.setValue("bytes=\(start)-", forHTTPHeaderField: "Range")
            } else {
                let end = data.requestedOffset + Int64(data.requestedLength) - 1
                request.setValue("bytes=\(start)-\(max(start, end))", forHTTPHeaderField: "Range")
            }
        } else {
            // Metadata needs headers, not the entire recording.
            request.setValue("bytes=0-1", forHTTPHeaderField: "Range")
        }
        let task = session.dataTask(with: request)
        transfers[task.taskIdentifier] = loadingRequest
        tasks[task.taskIdentifier] = task
        task.resume()
        return true
    }

    func resourceLoader(_ resourceLoader: AVAssetResourceLoader, didCancel loadingRequest: AVAssetResourceLoadingRequest) {
        guard let id = transfers.first(where: { $0.value === loadingRequest })?.key else { return }
        transfers.removeValue(forKey: id)
        tasks.removeValue(forKey: id)?.cancel()
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping @Sendable (URLSession.ResponseDisposition) -> Void) {
        guard let loading = transfers[dataTask.taskIdentifier], !loading.isCancelled else {
            completionHandler(.cancel); return
        }
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            fail(dataTask, failure: (response as? HTTPURLResponse).map { PlayerFailureMapping.from(statusCode: $0.statusCode) } ?? .unknown)
            completionHandler(.cancel); return
        }
        let offset = loading.dataRequest.map { max($0.requestedOffset, $0.currentOffset) } ?? 0
        // A server ignoring Range must never deliver byte zero at a seek offset.
        let responseOffset = http.value(forHTTPHeaderField: "Content-Range")?
            .split(separator: " ").last?.split(separator: "-").first.flatMap { Int64($0) }
        guard (http.statusCode == 206 && responseOffset == offset) || (http.statusCode == 200 && offset == 0) else {
            fail(dataTask, failure: .network); completionHandler(.cancel); return
        }
        if let info = loading.contentInformationRequest {
            info.contentType = Self.uniformType(forMIMEType: http.value(forHTTPHeaderField: "Content-Type"))
            info.isByteRangeAccessSupported = http.statusCode == 206 || http.value(forHTTPHeaderField: "Accept-Ranges")?.lowercased() == "bytes"
            info.contentLength = Self.totalLength(of: http)
        }
        if loading.dataRequest == nil {
            finish(dataTask); completionHandler(.cancel)
        } else {
            completionHandler(.allow)
        }
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard let loading = transfers[dataTask.taskIdentifier], !loading.isCancelled,
              let requested = loading.dataRequest else { return }
        // Feed AVFoundation as bytes arrive. A completion-handler data task
        // buffers the entire range, delaying playback by minutes on long files.
        if requested.requestsAllDataToEndOfResource {
            requested.respond(with: data)
        } else {
            let remaining = max(0, requested.requestedOffset + Int64(requested.requestedLength) - max(requested.currentOffset, requested.requestedOffset))
            requested.respond(with: Data(data.prefix(Int(min(Int64(data.count), remaining)))))
            if requested.currentOffset >= requested.requestedOffset + Int64(requested.requestedLength) {
                finish(dataTask)
                dataTask.cancel()
            }
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let loading = transfers[task.taskIdentifier] else { return }
        if loading.isCancelled {
            transfers.removeValue(forKey: task.taskIdentifier)
            tasks.removeValue(forKey: task.taskIdentifier)
        } else if error != nil {
            fail(task, failure: .network)
        } else {
            finish(task)
        }
    }

    private func finish(_ task: URLSessionTask) {
        tasks.removeValue(forKey: task.taskIdentifier)
        transfers.removeValue(forKey: task.taskIdentifier)?.finishLoading()
    }

    private func fail(_ task: URLSessionTask, failure: PlayerFailure) {
        tasks.removeValue(forKey: task.taskIdentifier)
        transfers.removeValue(forKey: task.taskIdentifier)?.finishLoading(with: URLError(.cannotLoadFromNetwork))
        onFailure(failure)
    }

    /// `Content-Range: bytes 0-1/48213000` → 48213000; a 200's own length otherwise.
    static func totalLength(of response: HTTPURLResponse) -> Int64 {
        if let range = response.value(forHTTPHeaderField: "Content-Range"),
           let slash = range.lastIndex(of: "/"),
           let total = Int64(range[range.index(after: slash)...].trimmingCharacters(in: .whitespaces)) {
            return total
        }
        return max(0, response.expectedContentLength)
    }

    static func uniformType(forMIMEType mime: String?) -> String {
        #if canImport(UniformTypeIdentifiers)
        if let mime,
           let base = mime.split(separator: ";").first?.trimmingCharacters(in: .whitespaces),
           let type = UTType(mimeType: base) {
            return type.identifier
        }
        return UTType.mpeg4Movie.identifier
        #else
        return AVFileType.mp4.rawValue
        #endif
    }
}
#endif
#endif
