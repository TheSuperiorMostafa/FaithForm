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

    public var isStale: Bool {
        if case let .loaded(_, stale) = self { return stale }
        return false
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
    private let now: () -> Date
    private var lastLoadedAt: Date?
    private var generation = 0

    public static let staleAfter: TimeInterval = 5 * 60

    public init(
        client: PresentationClient,
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
            isStale: false
        )
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
            lastLoadedAt = now()
            phase = .loaded(items: page.items, isStale: false)
        } catch {
            guard current == generation else { return }
            if error.isCancellation { return }
            phase = mapped(error)
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
            if error.isCancellation { return }
            loadMoreFailed = true
        }
    }

    public func retryLoadMore() async {
        loadMoreFailed = false
        await loadMore()
    }

    private var shouldSkipReload: Bool {
        guard case let .loaded(_, stale) = phase, !stale, let lastLoadedAt else { return false }
        return now().timeIntervalSince(lastLoadedAt) < Self.staleAfter
    }

    private func mapped(_ error: Error) -> PresentationListPhase {
        if let api = error as? APIError {
            switch api.code {
            case .blocked, .forbidden, .notFound: return .blocked
            case .unavailable, .internalError: return keepLoadedOrOffline()
            default: return .failed(api.message)
            }
        }
        return keepLoadedOrOffline()
    }

    private func keepLoadedOrOffline() -> PresentationListPhase {
        if case let .loaded(items, _) = phase {
            return .loaded(items: items, isStale: true)
        }
        return .offline
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
            if let cached = await client.cachedDetail(
                churchSlug: churchSlug,
                presentationId: presentationId,
                partition: partition
            ), cached.isDisplayable() {
                phase = .loaded(cached.value)
            }
            let detail = try await client.detail(
                churchSlug: churchSlug,
                presentationId: presentationId,
                partition: partition
            )
            phase = .loaded(detail)
        } catch {
            if error.isCancellation { return }
            guard let api = error as? APIError else {
                if case .loaded = phase { return }
                phase = .offline
                return
            }
            switch api.code {
            case .notFound, .blocked, .forbidden: phase = .unavailable
            case .unavailable, .internalError:
                if case .loaded = phase { return }
                phase = .offline
            default: phase = .failed(api.message)
            }
        }
    }
}
