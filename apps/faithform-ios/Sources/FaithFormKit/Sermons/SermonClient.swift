import Foundation

/// Reads the published sermon-notes projections.
///
/// Mirrors `MediaClient`: every response is cached under the caller's partition
/// and revalidated with its ETag, and a search is never cached — caching every
/// query someone typed would build a local record of what they searched for.
public actor SermonClient {
    private let api: APIClient
    private let cache: PartitionedCache

    public init(api: APIClient, cache: PartitionedCache) {
        self.api = api
        self.cache = cache
    }

    public func archive(
        churchSlug: String,
        query: String?,
        cursor: String?,
        partition: CachePartition
    ) async throws -> SermonPage {
        var params: [String: String] = [:]
        if let query, !query.isEmpty { params["q"] = query }
        if let cursor { params["cursor"] = cursor }

        // Only the unfiltered first page is cached.
        let cacheable = params.isEmpty
        let key = "sermons.archive.\(churchSlug)"
        let cached = cacheable
            ? await cache.load(SermonPage.self, name: key, partition: partition)
            : nil

        let response = try await api.send(
            "api/mobile/v1/sermons/\(churchSlug)/archive",
            query: params,
            ifNoneMatch: cached?.etag,
            as: SermonPage.self
        )

        if response.notModified, let cached { return cached.value }
        guard let value = response.value else {
            // A 304 with nothing cached cannot be recovered by revalidating.
            throw APIError(code: .unavailable, message: L.sermonsOfflineBody)
        }
        if cacheable {
            try? await cache.store(
                CacheEntry(value: value, etag: response.etag, storedAt: Date()),
                name: key,
                partition: partition
            )
        }
        return value
    }

    public func detail(
        churchSlug: String,
        sermonId: String,
        partition: CachePartition
    ) async throws -> SermonDetail {
        let key = "sermons.detail.\(churchSlug).\(sermonId)"
        let cached = await cache.load(SermonDetail.self, name: key, partition: partition)

        let response = try await api.send(
            "api/mobile/v1/sermons/\(churchSlug)/item/\(sermonId)",
            ifNoneMatch: cached?.etag,
            as: SermonDetail.self
        )

        if response.notModified, let cached { return cached.value }
        guard let value = response.value else {
            throw APIError(code: .unavailable, message: L.sermonsOfflineBody)
        }
        try? await cache.store(
            CacheEntry(value: value, etag: response.etag, storedAt: Date()),
            name: key,
            partition: partition
        )
        return value
    }
}
