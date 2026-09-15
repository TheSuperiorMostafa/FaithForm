import Foundation

/// Reads published presentation (slide deck) projections.
public actor PresentationClient {
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
    ) async throws -> PresentationPageResponse {
        var params: [String: String] = [:]
        if let query, !query.isEmpty { params["q"] = query }
        if let cursor { params["cursor"] = cursor }

        let cacheable = params.isEmpty
        let key = "presentations.archive.\(churchSlug)"
        let cached = cacheable
            ? await cache.load(PresentationPageResponse.self, name: key, partition: partition)
            : nil

        let response = try await api.send(
            "api/mobile/v1/presentations/\(churchSlug)/archive",
            query: params,
            ifNoneMatch: cached?.etag,
            as: PresentationPageResponse.self
        )

        if response.notModified, let cached { return cached.value }
        guard let value = response.value else {
            throw APIError(code: .unavailable, message: L.presentationsOfflineBody)
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

    public func cachedArchive(
        churchSlug: String,
        partition: CachePartition
    ) async -> CacheEntry<PresentationPageResponse>? {
        await cache.load(
            PresentationPageResponse.self,
            name: "presentations.archive.\(churchSlug)",
            partition: partition
        )
    }

    public func detail(
        churchSlug: String,
        presentationId: String,
        partition: CachePartition
    ) async throws -> PresentationDetail {
        let key = "presentations.detail.\(churchSlug).\(presentationId)"
        let cached = await cache.load(PresentationDetail.self, name: key, partition: partition)

        let response = try await api.send(
            "api/mobile/v1/presentations/\(churchSlug)/item/\(presentationId)",
            ifNoneMatch: cached?.etag,
            as: PresentationDetail.self
        )

        if response.notModified, let cached { return cached.value }
        guard let value = response.value else {
            throw APIError(code: .unavailable, message: L.presentationsOfflineBody)
        }
        try? await cache.store(
            CacheEntry(value: value, etag: response.etag, storedAt: Date()),
            name: key,
            partition: partition
        )
        return value
    }

    public func cachedDetail(
        churchSlug: String,
        presentationId: String,
        partition: CachePartition
    ) async -> CacheEntry<PresentationDetail>? {
        await cache.load(
            PresentationDetail.self,
            name: "presentations.detail.\(churchSlug).\(presentationId)",
            partition: partition
        )
    }
}
