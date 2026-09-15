package io.faithform.app.media

import io.faithform.app.contract.LiveMediaResponse
import io.faithform.app.contract.MediaDetail
import io.faithform.app.contract.MediaPage
import io.faithform.app.contract.PlaybackGrant
import io.faithform.app.contract.PlaybackGrantRequest
import io.faithform.app.network.ApiClient
import io.faithform.app.network.ApiException
import io.faithform.app.network.FaithFormJson
import io.faithform.app.network.MobileSuccess
import io.faithform.app.network.ProjectionCache
import io.faithform.app.storage.CachePartition
import java.time.Instant

/**
 * Reads the published-media projections and asks for playback.
 *
 * Mirrors `MediaClient.swift` route for route:
 *
 * | call      | route                                              | cached |
 * |-----------|----------------------------------------------------|--------|
 * | [live]    | `GET  api/mobile/v1/media/{slug}/live`             | yes, ETag |
 * | [archive] | `GET  api/mobile/v1/media/{slug}/archive?q&cursor` | first unfiltered page only |
 * | [detail]  | `GET  api/mobile/v1/media/{slug}/item/{id}`        | yes, ETag |
 * | [grant]   | `POST api/mobile/v1/media/playback`                | **never** |
 *
 * Every projection is cached under the caller's partition — environment,
 * account, church, authorization version — and revalidated with its ETag. A
 * search result or a second page is not: caching every query someone typed
 * would build a local record of what they searched for.
 *
 * ## The capability
 *
 * A playback grant is a credential with a five-minute life, and its route
 * answers `no-store` for exactly that reason. [grant] reads it and hands it
 * straight to the coordinator, which hands it to the player's request headers.
 * It never reaches [ProjectionCache], a log, or a URL.
 */
class MediaClient(
    private val api: ApiClient,
    private val cache: ProjectionCache,
) : PlaybackGranting {

    suspend fun live(churchSlug: String, partition: CachePartition): LiveMediaResponse =
        cache.revalidate(
            api = api,
            path = "api/mobile/v1/media/$churchSlug/live",
            serializer = LiveMediaResponse.serializer(),
            name = "media.live.$churchSlug",
            partition = partition,
        )

    suspend fun cachedLive(churchSlug: String, partition: CachePartition) =
        cache.load("media.live.$churchSlug", partition, LiveMediaResponse.serializer())

    suspend fun archive(
        churchSlug: String,
        query: String?,
        cursor: String?,
        partition: CachePartition,
    ): MediaPage {
        val params = buildMap {
            query?.trim()?.takeIf { it.isNotEmpty() }?.let { put("q", it) }
            cursor?.let { put("cursor", it) }
        }
        return cache.revalidate(
            api = api,
            path = "api/mobile/v1/media/$churchSlug/archive",
            serializer = MediaPage.serializer(),
            name = "media.archive.$churchSlug",
            partition = partition,
            query = params,
            // Only the unfiltered first page. See the class comment.
            cacheable = params.isEmpty(),
        )
    }

    suspend fun cachedArchive(churchSlug: String, partition: CachePartition) =
        cache.load("media.archive.$churchSlug", partition, MediaPage.serializer())

    suspend fun detail(churchSlug: String, mediaId: String, partition: CachePartition): MediaDetail =
        cache.revalidate(
            api = api,
            path = "api/mobile/v1/media/$churchSlug/item/$mediaId",
            serializer = MediaDetail.serializer(),
            name = "media.detail.$churchSlug.$mediaId",
            partition = partition,
        )

    suspend fun cachedDetail(churchSlug: String, mediaId: String, partition: CachePartition) =
        cache.load("media.detail.$churchSlug.$mediaId", partition, MediaDetail.serializer())

    /**
     * Asks for permission to watch.
     *
     * Refresh is the same call: the server re-runs the whole authorization
     * rather than extending what it issued, which is what lets a revocation stop
     * playback that is already running.
     *
     * A refusal and a transport failure are thrown as different types so the
     * coordinator — and a person — can tell "this is no longer available" from
     * "try again". A grant whose delivery URL is not a path on this build's own
     * origin, or whose expiry cannot be read, is a refusal: the player is never
     * pointed at another host, and a capability with no known lifetime cannot be
     * scheduled for renewal.
     */
    override suspend fun grant(
        churchSlug: String,
        kind: MediaPlaybackKind,
        mediaId: String,
    ): GrantedPlayback {
        val response = try {
            api.send(
                path = "api/mobile/v1/media/playback",
                serializer = MobileSuccess.serializer(PlaybackGrant.serializer()),
                method = "POST",
                body = FaithFormJson.encodeToString(
                    PlaybackGrantRequest.serializer(),
                    PlaybackGrantRequest(churchSlug = churchSlug, kind = kind.wire, mediaId = mediaId),
                ),
            )
        } catch (error: ApiException) {
            if (error.retryable) throw PlaybackTransportException(error.displayMessage)
            throw PlaybackRefusedException(error.displayMessage)
        }

        val grant = response.value ?: throw PlaybackRefusedException(UNAVAILABLE)
        val url = api.absoluteUrl(grant.deliveryUrl) ?: throw PlaybackRefusedException(UNAVAILABLE)
        val expiresAt = runCatching { Instant.parse(grant.expiresAt).toEpochMilli() }.getOrNull()
            ?: throw PlaybackRefusedException(UNAVAILABLE)

        return GrantedPlayback(
            capability = grant.capability,
            deliveryUrl = url,
            renditionKind = RenditionKind.fromWire(grant.renditionKind),
            expiresAtEpochMillis = expiresAt,
            // Named exactly as iOS passes it: the server's `refreshAfterSeconds`
            // is the lead the schedule renews ahead of expiry by.
            refreshLeadMillis = grant.refreshAfterSeconds * 1_000L,
            startOffsetMillis = grant.startOffsetSeconds * 1_000L,
        )
    }

    private companion object {
        const val UNAVAILABLE = "That is not available to watch."
    }
}
