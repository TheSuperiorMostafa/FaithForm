import Foundation
import Observation

/// The Home feed's state. `.loaded` carries `isStale` so cached content can be
/// shown and labelled rather than silently presented as current.
public enum FeedPhase: Equatable, Sendable {
    case loading
    case loaded(items: [FeedItem], isStale: Bool)
    case empty
    case offlineNoCache
    case blocked
    case failed(String)
}

@Observable
@MainActor
public final class FeedModel {
    public private(set) var phase: FeedPhase = .loading
    public private(set) var isRefreshing = false
    public private(set) var nextCursor: String?

    private let api: APIClient
    private let cache: PartitionedCache
    private var etag: String?
    private var partition: CachePartition?

    public init(api: APIClient, cache: PartitionedCache) {
        self.api = api
        self.cache = cache
    }

    /// Cached-first: whatever is stored for *this* partition renders
    /// immediately, then the network confirms or replaces it. A different
    /// church or a bumped authorization version is a different partition, so
    /// switching churches can never show the previous one's content.
    public func load(churchSlug: String, partition: CachePartition) async {
        self.partition = partition

        if let cached = await cache.load([FeedItem].self, name: "feed", partition: partition) {
            let freshness = cached.freshness(now: Date(), ttl: 300)
            if freshness != .expired {
                phase = .loaded(items: cached.value, isStale: freshness != .fresh)
                etag = cached.etag
            }
        }

        await refresh(churchSlug: churchSlug)
    }

    public func refresh(churchSlug: String) async {
        guard let partition else { return }
        isRefreshing = true
        defer { isRefreshing = false }

        do {
            let response = try await api.send(
                "api/mobile/v1/feed/\(churchSlug)",
                ifNoneMatch: etag,
                as: FeedPage.self
            )

            // 304: what is cached is current. Promote it out of "stale".
            if response.notModified {
                if case let .loaded(items, _) = phase {
                    phase = .loaded(items: items, isStale: false)
                }
                return
            }

            guard let page = response.value else { return }
            etag = response.etag
            nextCursor = page.nextCursor

            try? await cache.store(
                CacheEntry(value: page.items, etag: response.etag, storedAt: Date()),
                name: "feed",
                partition: partition
            )

            phase = page.items.isEmpty ? .empty : .loaded(items: page.items, isStale: false)
        } catch let error as APIError {
            switch error.code {
            case .blocked:
                // Losing access drops the cached copy immediately rather than
                // leaving it readable offline.
                await cache.purge(partition: partition)
                phase = .blocked
            case .unavailable:
                if case .loaded = phase { return }   // keep showing the cache
                phase = .offlineNoCache
            default:
                if case .loaded = phase { return }
                phase = .failed(error.displayMessage)
            }
        } catch {
            if case .loaded = phase { return }
            phase = .offlineNoCache
        }
    }

    /// Cursor pagination. Appends rather than replacing, and stops cleanly when
    /// the server says there is no next page.
    public func loadMore(churchSlug: String) async {
        guard let cursor = nextCursor, case let .loaded(items, isStale) = phase else { return }

        do {
            let response = try await api.send(
                "api/mobile/v1/feed/\(churchSlug)",
                query: ["cursor": cursor],
                as: FeedPage.self
            )
            guard let page = response.value else { return }
            nextCursor = page.nextCursor
            phase = .loaded(items: items + page.items, isStale: isStale)
        } catch {
            // A failed page-two does not discard page one.
            nextCursor = nil
        }
    }
}
