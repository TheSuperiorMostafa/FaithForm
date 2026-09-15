import Foundation
import Observation

/// What the sermon-notes screen is showing.
public enum SermonListPhase: Equatable, Sendable {
    case idle
    case loading
    case loaded(items: [SermonListItem], isStale: Bool)
    /// The church is not available to this account at all.
    case blocked
    case offline
    case failed(String)

    public var items: [SermonListItem] {
        if case let .loaded(items, _) = self { return items }
        return []
    }

    public var isStale: Bool {
        if case let .loaded(_, stale) = self { return stale }
        return false
    }
}

/// A church's published sermon notes.
///
/// Deliberately the same shape as `MediaModel` minus the live case: there is no
/// "on now" for notes, so there is no optional hero and no empty area waiting
/// for one.
@MainActor
@Observable
public final class SermonModel {
    public private(set) var phase: SermonListPhase = .idle
    public private(set) var nextCursor: String?
    public private(set) var isLoadingMore = false
    /// The last next-page request failed. The cursor is kept, so the list is
    /// not quietly declared finished; the view offers a retry, and scrolling
    /// back to the bottom does not hammer a failing server.
    public private(set) var loadMoreFailed = false

    /// The search box, as typed. Nothing is fetched for it until it is
    /// submitted — see `submittedQuery`.
    public var searchTerm: String = ""

    /// The query the list on screen actually answers. Kept apart from the text
    /// field so a next page, a refresh or an empty-state message follows what
    /// was searched, not whatever has been typed since.
    public private(set) var submittedQuery: String = ""

    private let client: SermonClient
    private let churchSlug: String
    private let partition: CachePartition
    private let now: () -> Date
    private var lastLoadedAt: Date?

    /// Bumped by every request that replaces the list, so an older answer
    /// arriving late — a slow search overtaken by clearing it — is dropped
    /// rather than drawn over the newer one.
    private var generation = 0

    /// Coming back to a list that just loaded must not ask the server again.
    /// Five minutes matches Android; pull-to-refresh and search still fetch.
    public static let staleAfter: TimeInterval = 5 * 60

    public init(
        client: SermonClient,
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

    public func search(_ term: String) async {
        searchTerm = term
        submittedQuery = term.trimmingCharacters(in: .whitespacesAndNewlines)
        await reload()
    }

    /// Called as the search box changes. Emptying it brings the whole list
    /// back without needing a submit — there is nothing left to submit.
    public func searchTextChanged() async {
        guard searchTerm.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              !submittedQuery.isEmpty
        else { return }
        submittedQuery = ""
        await reload()
    }

    private func paintCachedIfIdle() async {
        guard case .idle = phase else { return }
        guard submittedQuery.isEmpty,
              let cached = await client.cachedArchive(churchSlug: churchSlug, partition: partition),
              cached.isDisplayable(now: now())
        else {
            phase = .loading
            return
        }
        nextCursor = cached.value.nextCursor
        phase = .loaded(
            items: cached.value.items,
            isStale: cached.freshness(now: now(), ttl: 300) != .fresh
        )
    }

    private func reload() async {
        generation += 1
        let current = generation
        let query = submittedQuery
        // The old list's cursor belongs to the old list: a page fetched with it
        // must not be appended to whatever this request returns.
        nextCursor = nil
        isLoadingMore = false
        loadMoreFailed = false

        do {
            let page = try await client.archive(
                churchSlug: churchSlug,
                query: query.isEmpty ? nil : query,
                cursor: nil,
                partition: partition
            )
            guard current == generation else { return }
            nextCursor = page.nextCursor
            lastLoadedAt = now()
            phase = .loaded(items: page.items, isStale: false)
        } catch {
            guard current == generation else { return }
            if error.isCancellation { return }
            phase = mapped(error)
        }
    }

    /// The next page, when the last row appears. Does nothing after a failure
    /// until `retryLoadMore` is tapped.
    public func loadMore() async {
        guard case .loaded = phase,
              let cursor = nextCursor,
              !isLoadingMore,
              !loadMoreFailed
        else { return }

        let current = generation
        let query = submittedQuery
        isLoadingMore = true
        defer { if current == generation { isLoadingMore = false } }

        do {
            let page = try await client.archive(
                churchSlug: churchSlug,
                query: query.isEmpty ? nil : query,
                cursor: cursor,
                partition: partition
            )
            guard current == generation else { return }
            nextCursor = page.nextCursor
            if case let .loaded(existing, stale) = phase {
                phase = .loaded(items: existing + page.items, isStale: stale)
            }
        } catch {
            guard current == generation else { return }
            if error.isCancellation { return }
            // A failed next page keeps what is already on screen, and keeps
            // its cursor: the rest of the list still exists.
            loadMoreFailed = true
        }
    }

    public func retryLoadMore() async {
        loadMoreFailed = false
        await loadMore()
    }

    public func invalidate() async {
        generation += 1
        nextCursor = nil
        isLoadingMore = false
        loadMoreFailed = false
        lastLoadedAt = nil
        phase = .idle
    }

    /// A list older than `staleAfter`, one already marked stale, or anything
    /// that is not a successful list, is asked for again. A fresh list is left
    /// alone so leaving the tab and coming back cannot cancel a refetch and
    /// paint an offline screen over rows that just loaded.
    private var shouldSkipReload: Bool {
        guard case let .loaded(_, stale) = phase, !stale, let lastLoadedAt else { return false }
        return now().timeIntervalSince(lastLoadedAt) < Self.staleAfter
    }

    private func mapped(_ error: Error) -> SermonListPhase {
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

    /// Losing the connection is not a reason to take away what was already read.
    private func keepLoadedOrOffline() -> SermonListPhase {
        if case let .loaded(items, _) = phase {
            return .loaded(items: items, isStale: true)
        }
        return .offline
    }
}

/// One sermon's notes.
public enum SermonDetailPhase: Equatable, Sendable {
    case loading
    case loaded(SermonDetail)
    /// Unpublished since the list was cached, or never available to this reader.
    case unavailable
    case offline
    case failed(String)
}

@MainActor
@Observable
public final class SermonDetailModel {
    public private(set) var phase: SermonDetailPhase = .loading

    private let client: SermonClient
    private let churchSlug: String
    private let sermonId: String
    private let partition: CachePartition

    public init(
        client: SermonClient,
        churchSlug: String,
        sermonId: String,
        partition: CachePartition
    ) {
        self.client = client
        self.churchSlug = churchSlug
        self.sermonId = sermonId
        self.partition = partition
    }

    public func load() async {
        do {
            if let cached = await client.cachedDetail(
                churchSlug: churchSlug,
                sermonId: sermonId,
                partition: partition
            ), cached.isDisplayable() {
                phase = .loaded(cached.value)
            }
            let detail = try await client.detail(
                churchSlug: churchSlug,
                sermonId: sermonId,
                partition: partition
            )
            phase = .loaded(detail)
        } catch {
            if error.isCancellation { return }
            guard let api = error as? APIError else {
                phase = keepDetail(or: .offline)
                return
            }
            switch api.code {
            // The server answers `not_found` for unpublished, revoked and
            // never-published alike, so a stale list opening a sermon that has
            // since been taken down lands here rather than showing anything.
            case .notFound, .blocked, .forbidden:
                phase = .unavailable
            case .unavailable, .internalError:
                phase = keepDetail(or: .offline)
            default:
                phase = .failed(api.message)
            }
        }
    }

    private func keepDetail(or fallback: SermonDetailPhase) -> SermonDetailPhase {
        if case .loaded = phase { return phase }
        return fallback
    }
}
