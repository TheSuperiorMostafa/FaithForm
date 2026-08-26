import Foundation

/// Reads the published-media projections and asks for playback.
///
/// Every response is cached under the caller's partition —
/// `environment | account | church | authorizationVersion` — and revalidated
/// with its ETag. A capability is **never** cached: it is a credential with a
/// five-minute life, and the route that issues it says `no-store` for exactly
/// that reason.
public actor MediaClient: PlaybackGranting {
    private let api: APIClient
    private let cache: PartitionedCache

    public init(api: APIClient, cache: PartitionedCache) {
        self.api = api
        self.cache = cache
    }

    // MARK: - Live

    public func live(
        churchSlug: String,
        partition: CachePartition
    ) async throws -> LiveMediaResponse {
        let key = "media.live.\(churchSlug)"
        let cached = await cache.load(LiveMediaResponse.self, name: key, partition: partition)

        let response = try await api.send(
            "api/mobile/v1/media/\(churchSlug)/live",
            ifNoneMatch: cached?.etag,
            as: LiveMediaResponse.self
        )

        if response.notModified, let cached {
            return cached.value
        }
        guard let value = response.value else {
            // A 304 with nothing cached is unrecoverable by revalidation, so
            // the caller must be told rather than shown an empty screen.
            throw APIError(code: .unavailable, message: L.mediaOfflineBody)
        }
        try? await cache.store(
            CacheEntry(value: value, etag: response.etag, storedAt: Date()),
            name: key,
            partition: partition
        )
        return value
    }

    // MARK: - Archive

    public func archive(
        churchSlug: String,
        query: String?,
        cursor: String?,
        partition: CachePartition
    ) async throws -> MediaPage {
        var params: [String: String] = [:]
        if let query, !query.isEmpty { params["q"] = query }
        if let cursor { params["cursor"] = cursor }

        // Only the unfiltered first page is cached. A search result is a
        // transient view of the same data, and caching every query someone
        // typed would build a local record of what they searched for.
        let cacheable = params.isEmpty
        let key = "media.archive.\(churchSlug)"
        let cached = cacheable
            ? await cache.load(MediaPage.self, name: key, partition: partition)
            : nil

        let response = try await api.send(
            "api/mobile/v1/media/\(churchSlug)/archive",
            query: params,
            ifNoneMatch: cached?.etag,
            as: MediaPage.self
        )

        if response.notModified, let cached { return cached.value }
        guard let value = response.value else {
            throw APIError(code: .unavailable, message: L.mediaOfflineBody)
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

    // MARK: - Detail

    public func detail(
        churchSlug: String,
        mediaId: String,
        partition: CachePartition
    ) async throws -> MediaDetail {
        let key = "media.detail.\(churchSlug).\(mediaId)"
        let cached = await cache.load(MediaDetail.self, name: key, partition: partition)

        let response = try await api.send(
            "api/mobile/v1/media/\(churchSlug)/item/\(mediaId)",
            ifNoneMatch: cached?.etag,
            as: MediaDetail.self
        )

        if response.notModified, let cached { return cached.value }
        guard let value = response.value else {
            throw APIError(code: .unavailable, message: L.mediaOfflineBody)
        }
        try? await cache.store(
            CacheEntry(value: value, etag: response.etag, storedAt: Date()),
            name: key,
            partition: partition
        )
        return value
    }

    // MARK: - Playback

    /// Asks for permission to watch.
    ///
    /// **Nothing here is cached and nothing is stored.** The grant is handed
    /// straight to the coordinator, which hands the capability to the loader,
    /// which puts it in a header. It never reaches the projection cache, the
    /// Keychain, a log, or a URL.
    public func grant(
        churchSlug: String,
        kind: MediaPlaybackKind,
        mediaId: String
    ) async throws -> GrantedPlayback {
        let response = try await api.send(
            "api/mobile/v1/media/playback",
            method: .post,
            body: PlaybackGrantRequest(
                churchSlug: churchSlug,
                kind: kind.rawValue,
                mediaId: mediaId
            ),
            as: PlaybackGrant.self
        )

        guard
            let grant = response.value,
            let url = await api.absoluteURL(for: grant.deliveryUrl),
            let expiresAt = FaithfulInstant.parse(grant.expiresAt)
        else {
            throw APIError(code: .notFound, message: L.mediaUnavailableBody)
        }

        return GrantedPlayback(
            capability: grant.capability,
            deliveryURL: url,
            // Unknown values fall back to progressive rather than failing: a
            // server that adds a rendition form must not break a released app,
            // and progressive is what every recording is today.
            renditionKind: RenditionKind(rawValue: grant.renditionKind) ?? .progressive,
            expiresAt: expiresAt,
            refreshLeadSeconds: TimeInterval(grant.refreshAfterSeconds),
            startOffsetSeconds: Double(grant.startOffsetSeconds)
        )
    }
}
