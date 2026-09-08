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

    /// The search box. Debounced by the view; the model only sees a term.
    public var searchTerm: String = ""

    private let client: SermonClient
    private let churchSlug: String
    private let partition: CachePartition

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
        await reload()
    }

    private func reload() async {
        do {
            let page = try await client.archive(
                churchSlug: churchSlug,
                query: searchTerm.isEmpty ? nil : searchTerm,
                cursor: nil,
                partition: partition
            )
            nextCursor = page.nextCursor
            phase = .loaded(items: page.items, isStale: false)
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
            if case let .loaded(existing, stale) = phase {
                phase = .loaded(items: existing + page.items, isStale: stale)
            }
        } catch {
            // A failed second page keeps what is already on screen.
            nextCursor = nil
        }
    }

    public func invalidate() async {
        nextCursor = nil
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
