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

    public init(client: MediaClient, churchSlug: String, partition: CachePartition) {
        self.client = client
        self.churchSlug = churchSlug
        self.partition = partition
    }

    public func load() async {
        if case .idle = phase { phase = .loading }
        await reload()
    }

    public func refresh() async {
        await reload()
    }

    /// Re-runs the search. Separate from `refresh` so a search never silently
    /// discards a cached first page the person may come back to.
    public func search(_ term: String) async {
        searchTerm = term
        await reload()
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
            phase = .loaded(live: live.live, items: archive.items, isStale: false)
        } catch let error as APIError {
            phase = mapped(error)
        } catch {
            phase = .offline
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
        phase = .idle
    }

    private func mapped(_ error: APIError) -> MediaListPhase {
        switch error.code {
        case .blocked, .forbidden:
            return .blocked
        case .unavailable, .internalError:
            return .offline
        case .notFound:
            // A hidden church, an unknown slug and a blocked visitor are one
            // answer server-side, so the client cannot and must not guess.
            return .blocked
        default:
            return .failed(error.message)
        }
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
