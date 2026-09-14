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

    /// Bumped by every request that replaces the list, so an older answer
    /// arriving late — a slow search overtaken by clearing it — is dropped
    /// rather than drawn over the newer one.
    private var generation = 0

    public init(client: SermonClient, churchSlug: String, partition: CachePartition) {
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
            phase = .loaded(items: page.items, isStale: false)
        } catch let error as APIError {
            guard current == generation else { return }
            phase = mapped(error)
        } catch {
            guard current == generation else { return }
            phase = .offline
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
        phase = .idle
    }

    private func mapped(_ error: APIError) -> SermonListPhase {
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
            let detail = try await client.detail(
                churchSlug: churchSlug,
                sermonId: sermonId,
                partition: partition
            )
            phase = .loaded(detail)
        } catch let error as APIError {
            switch error.code {
            // The server answers `not_found` for unpublished, revoked and
            // never-published alike, so a stale list opening a sermon that has
            // since been taken down lands here rather than showing anything.
            case .notFound, .blocked, .forbidden:
                phase = .unavailable
            case .unavailable, .internalError:
                phase = .offline
            default:
                phase = .failed(error.message)
            }
        } catch {
            phase = .offline
        }
    }
}
