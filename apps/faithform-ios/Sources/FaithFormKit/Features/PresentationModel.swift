import Foundation
import Observation

public enum PresentationListPhase: Equatable, Sendable {
    case idle
    case loading
    case loaded(items: [PresentationListItem], isStale: Bool)
    case blocked
    case offline
    case failed(String)

    public var items: [PresentationListItem] {
        if case let .loaded(items, _) = self { return items }
        return []
    }
}

@MainActor
@Observable
public final class PresentationModel {
    public private(set) var phase: PresentationListPhase = .idle
    public private(set) var nextCursor: String?
    public private(set) var isLoadingMore = false
    public private(set) var loadMoreFailed = false
    public var searchTerm: String = ""
    public private(set) var submittedQuery: String = ""

    private let client: PresentationClient
    private let churchSlug: String
    private let partition: CachePartition
    private var generation = 0

    public init(client: PresentationClient, churchSlug: String, partition: CachePartition) {
        self.client = client
        self.churchSlug = churchSlug
        self.partition = partition
    }

    public func load() async {
        if case .idle = phase { phase = .loading }
        await reload()
    }

    public func refresh() async { await reload() }

    public func search(_ term: String) async {
        searchTerm = term
        submittedQuery = term.trimmingCharacters(in: .whitespacesAndNewlines)
        await reload()
    }

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
            loadMoreFailed = true
        }
    }

    public func retryLoadMore() async {
        loadMoreFailed = false
        await loadMore()
    }

    private func mapped(_ error: APIError) -> PresentationListPhase {
        switch error.code {
        case .blocked, .forbidden, .notFound: return .blocked
        case .unavailable, .internalError: return .offline
        default: return .failed(error.message)
        }
    }
}

public enum PresentationDetailPhase: Equatable, Sendable {
    case loading
    case loaded(PresentationDetail)
    case unavailable
    case offline
    case failed(String)
}

@MainActor
@Observable
public final class PresentationDetailModel {
    public private(set) var phase: PresentationDetailPhase = .loading

    private let client: PresentationClient
    private let churchSlug: String
    private let presentationId: String
    private let partition: CachePartition

    public init(
        client: PresentationClient,
        churchSlug: String,
        presentationId: String,
        partition: CachePartition
    ) {
        self.client = client
        self.churchSlug = churchSlug
        self.presentationId = presentationId
        self.partition = partition
    }

    public func load() async {
        do {
            let detail = try await client.detail(
                churchSlug: churchSlug,
                presentationId: presentationId,
                partition: partition
            )
            phase = .loaded(detail)
        } catch let error as APIError {
            switch error.code {
            case .notFound, .blocked, .forbidden: phase = .unavailable
            case .unavailable, .internalError: phase = .offline
            default: phase = .failed(error.message)
            }
        } catch {
            phase = .offline
        }
    }
}
