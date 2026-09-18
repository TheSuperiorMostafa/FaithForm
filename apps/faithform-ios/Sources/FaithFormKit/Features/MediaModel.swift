import Foundation
import Observation

/// What the Watch screen is showing.
public enum MediaListPhase: Equatable, Sendable {
    case idle
    case loading
    case loaded(live: LiveMedia?, items: [ArchiveItem], isStale: Bool)
    /// The church is not available to this account at all.
    case blocked
    case offline
    case failed(String)

    public var items: [ArchiveItem] {
        if case let .loaded(_, items, _) = self { return items }
        return []
    }

    public var live: LiveMedia? {
        if case let .loaded(live, _, _) = self { return live }
        return nil
    }

    public var isStale: Bool {
        if case let .loaded(_, _, stale) = self { return stale }
        return false
    }
}

/// The church's media: what is on now, and everything published before.
///
/// **A live area is drawn only when `live` is non-nil.** There is no empty
/// "Live" placeholder on a Tuesday, because there is no object to draw one
/// around — the server returns null and this model carries null through.
@MainActor
@Observable
public final class MediaModel {
    public private(set) var phase: MediaListPhase = .idle
    public private(set) var nextCursor: String?
    public private(set) var isLoadingMore = false

    /// The search box. Debounced by the view; the model only ever sees a term.
    public var searchTerm: String = ""

    private let client: MediaClient
    private let churchSlug: String
    private let partition: CachePartition
    private let now: () -> Date
    private var lastLoadedAt: Date?

    public static let staleAfter: TimeInterval = 5 * 60

    public init(
        client: MediaClient,
        churchSlug: String,
        partition: CachePartition,
        now: @escaping () -> Date = Date.init
    ) {
        self.client = client
        self.churchSlug = churchSlug
        self.partition = partition
        self.now = now
    }

    public func load() async {
        if shouldSkipReload { return }
        await paintCachedIfIdle()
        await reload()
    }

    public func refresh() async {
        await reload()
    }

    /// Re-reads only what is on now.
    ///
    /// The live state is the one part of these screens that changes while a
    /// person is looking at them: a service starts with the app already open.
    /// Called on a timer while Home or Watch is showing, it costs one
    /// conditional request that the server answers 304 almost every time — and
    /// leaves the archive, the search and the scroll position alone.
    public func refreshLive() async {
        switch phase {
        case .loaded:
            break
        case .loading, .blocked:
            // A full load is already on its way, or there is nothing to watch.
            return
        case .idle, .offline, .failed:
            // Nothing is drawn yet, so load the whole screen rather than half.
            await reload()
            return
        }

        do {
            let response = try await client.live(churchSlug: churchSlug, partition: partition)
            // Read again after the await: a search or a page may have landed.
            if case let .loaded(_, items, stale) = phase {
                phase = .loaded(live: response.live, items: items, isStale: stale)
            }
        } catch {
            // A missed poll changes nothing on screen; the next one tries again.
        }
    }

    /// Re-runs the search. Separate from `refresh` so a search never silently
    /// discards a cached first page the person may come back to.
    public func search(_ term: String) async {
        searchTerm = term
        await reload()
    }

    private func paintCachedIfIdle() async {
        guard case .idle = phase else { return }
        guard searchTerm.isEmpty,
              let archive = await client.cachedArchive(churchSlug: churchSlug, partition: partition),
              archive.isDisplayable(now: now())
        else {
            phase = .loading
            return
        }
        let live = await client.cachedLive(churchSlug: churchSlug, partition: partition)
        let liveValue = live.flatMap { $0.isDisplayable(now: now()) ? $0.value.live : nil }
        let archiveStale = archive.freshness(now: now(), ttl: 300) != .fresh
        let liveStale = live.map { $0.freshness(now: now(), ttl: 300) != .fresh } ?? false
        nextCursor = archive.value.nextCursor
        phase = .loaded(
            live: liveValue,
            items: archive.value.items,
            isStale: false
        )
    }

    private func reload() async {
        do {
            async let liveTask = client.live(churchSlug: churchSlug, partition: partition)
            async let archiveTask = client.archive(
                churchSlug: churchSlug,
                query: searchTerm.isEmpty ? nil : searchTerm,
                cursor: nil,
                partition: partition
            )

            let (live, archive) = try await (liveTask, archiveTask)
            nextCursor = archive.nextCursor
            lastLoadedAt = now()
            phase = .loaded(live: live.live, items: archive.items, isStale: false)
        } catch {
            if error.isCancellation { return }
            phase = mapped(error)
        }
    }

    public func loadMore() async {
        guard let cursor = nextCursor, !isLoadingMore else { return }
        isLoadingMore = true
        defer { isLoadingMore = false }

        do {
            let page = try await client.archive(
                churchSlug: churchSlug,
                query: searchTerm.isEmpty ? nil : searchTerm,
                cursor: cursor,
                partition: partition
            )
            nextCursor = page.nextCursor
            if case let .loaded(live, existing, stale) = phase {
                phase = .loaded(live: live, items: existing + page.items, isStale: stale)
            }
        } catch {
            if error.isCancellation { return }
            // A failed page keeps what is already on screen. Replacing a list
            // with an error because its *second* page failed loses the person's
            // place for no reason.
            nextCursor = nil
        }
    }

    /// Called when a church revokes, an account signs out, or a detail screen
    /// discovers an item has gone. Everything cached under this partition is
    /// dropped, not merely hidden.
    public func invalidate() async {
        nextCursor = nil
        lastLoadedAt = nil
        phase = .idle
    }

    private var shouldSkipReload: Bool {
        guard case let .loaded(_, _, stale) = phase, !stale, let lastLoadedAt else { return false }
        return now().timeIntervalSince(lastLoadedAt) < Self.staleAfter
    }

    private func mapped(_ error: Error) -> MediaListPhase {
        if let api = error as? APIError {
            switch api.code {
            case .blocked, .forbidden, .notFound:
                // A hidden church, an unknown slug and a blocked visitor are one
                // answer server-side, so the client cannot and must not guess.
                return .blocked
            case .unavailable, .internalError:
                return keepLoadedOrOffline()
            default:
                return .failed(api.message)
            }
        }
        return keepLoadedOrOffline()
    }

    private func keepLoadedOrOffline() -> MediaListPhase {
        if case let .loaded(live, items, _) = phase {
            return .loaded(live: live, items: items, isStale: true)
        }
        return .offline
    }
}

/// One recording's page, and the session that plays it.
@MainActor
@Observable
public final class MediaDetailModel {
    public enum Phase: Equatable, Sendable {
        case loading
        case loaded(MediaDetail)
        case unavailable
        case offline
    }

    public private(set) var phase: Phase = .loading
    public private(set) var playback: PlaybackSessionState = .idle
    public private(set) var resumeSeconds: Double?

    private let client: MediaClient
    private let coordinator: MediaPlaybackCoordinator
    private let churchSlug: String
    private let mediaId: String
    private let partition: CachePartition

    public init(
        client: MediaClient,
        coordinator: MediaPlaybackCoordinator,
        churchSlug: String,
        mediaId: String,
        partition: CachePartition
    ) {
        self.client = client
        self.coordinator = coordinator
        self.churchSlug = churchSlug
        self.mediaId = mediaId
        self.partition = partition
    }

    public func load() async {
        do {
            if let cached = await client.cachedDetail(
                churchSlug: churchSlug,
                mediaId: mediaId,
                partition: partition
            ), cached.isDisplayable() {
                phase = .loaded(cached.value)
            }
            phase = .loaded(
                try await client.detail(
                    churchSlug: churchSlug,
                    mediaId: mediaId,
                    partition: partition
                )
            )
        } catch let error as APIError where error.code == .notFound {
            // Unpublished or revoked since the list was cached. Said plainly,
            // and without implying the person did something wrong.
            phase = .unavailable
        } catch {
            if error.isCancellation { return }
            if case .loaded = phase { return }
            phase = .offline
        }
    }

    public func play(kind: MediaPlaybackKind) async {
        await coordinator.start(
            churchSlug: churchSlug,
            kind: kind,
            mediaId: mediaId,
            partition: partition
        )
        playback = await coordinator.currentState()
        if case .buffering = playback {
            await coordinator.play()
            playback = await coordinator.currentState()
        }
    }

    public func pause() async {
        await coordinator.pause()
        playback = await coordinator.currentState()
    }

    public func stop() async {
        await coordinator.stop()
        playback = .idle
    }

    public func enterBackground() async { await coordinator.enterBackground() }

    public func enterForeground() async {
        await coordinator.enterForeground()
        playback = await coordinator.currentState()
    }

    public func handle(_ event: PlayerEvent) async {
        await coordinator.handle(event)
        playback = await coordinator.currentState()
    }

    /// What the person is told when playback stops. Never a URL or a status.
    public var failureMessage: String? {
        guard case let .failed(failure) = playback else { return nil }
        return PlayerFailureMapping.message(for: failure)
    }
}
