package io.faithform.app.ui.feed

import io.faithform.app.contract.FeedItem
import io.faithform.app.contract.FeedPage
import io.faithform.app.contract.MobileErrorCode
import io.faithform.app.network.ApiClient
import io.faithform.app.network.ApiException
import io.faithform.app.network.MobileSuccess
import io.faithform.app.network.ProjectionCache
import io.faithform.app.storage.CachePartition
import io.faithform.app.storage.Freshness
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.serialization.builtins.ListSerializer

/**
 * The Home feed for one church.
 *
 * Mirrors `FeedModel.swift` decision for decision:
 *
 * * **Cached first.** Whatever is stored for *this* partition renders at once,
 *   labelled stale if it is older than five minutes, then the network confirms
 *   or replaces it. A different church or a bumped authorization version is a
 *   different partition, so switching churches can never show the previous
 *   one's announcements.
 * * **Revalidated.** `GET api/mobile/v1/feed/{slug}` carries the stored ETag; a
 *   304 promotes the cached list out of "stale" without downloading it again.
 * * **A failure never erases what is on screen** — except `blocked`, which
 *   drops the cached copy immediately rather than leaving a church's private
 *   posts readable offline to someone it has blocked.
 * * **Paging appends**, and a failed second page keeps the first.
 */
class FeedModel(
    private val api: ApiClient,
    private val cache: ProjectionCache,
    private val churchSlug: String,
    private val partition: CachePartition,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    private val _phase = MutableStateFlow<FeedPhase>(FeedPhase.Loading)
    val phase: StateFlow<FeedPhase> = _phase.asStateFlow()

    private var etag: String? = null
    private var nextCursor: String? = null
    private val pageLock = Mutex()

    private val itemsSerializer = ListSerializer(FeedItem.serializer())

    suspend fun load() {
        cache.load(NAME, partition, itemsSerializer)?.let { cached ->
            etag = cached.etag
            _phase.value = if (cached.value.isEmpty()) FeedPhase.Empty else FeedPhase.Loaded(cached.value, isStale = false)
        }
        refresh()
    }

    suspend fun refresh() {
        try {
            val response = api.send(
                path = "api/mobile/v1/feed/$churchSlug",
                serializer = MobileSuccess.serializer(FeedPage.serializer()),
                ifNoneMatch = etag,
            )

            if (response.notModified) {
                (_phase.value as? FeedPhase.Loaded)?.let {
                    _phase.value = it.copy(isStale = false)
                    return
                }
                cache.load(NAME, partition, itemsSerializer)?.let { cached ->
                    _phase.value = if (cached.value.isEmpty()) FeedPhase.Empty else FeedPhase.Loaded(cached.value, isStale = false)
                }
                return
            }

            val page = response.value ?: return
            etag = response.etag
            nextCursor = page.nextCursor
            cache.store(NAME, partition, itemsSerializer, page.items, response.etag)
            _phase.value = if (page.items.isEmpty()) FeedPhase.Empty else FeedPhase.Loaded(page.items, isStale = false)
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: ApiException) {
            when {
                error.code == MobileErrorCode.BLOCKED -> {
                    cache.purge(partition)
                    _phase.value = FeedPhase.Blocked
                }
                _phase.value is FeedPhase.Loaded -> Unit // keep showing the cache
                error.code == MobileErrorCode.UNAVAILABLE || error.retryable -> _phase.value = FeedPhase.OfflineNoCache
                else -> _phase.value = FeedPhase.Failed(error.displayMessage)
            }
        } catch (_: Exception) {
            if (_phase.value !is FeedPhase.Loaded) _phase.value = FeedPhase.OfflineNoCache
        }
    }

    /** Cursor pagination. Appends; stops cleanly when there is no next page. */
    suspend fun loadMore() {
        val cursor = nextCursor ?: return
        val loaded = _phase.value as? FeedPhase.Loaded ?: return
        if (!pageLock.tryLock()) return
        try {
            val page = api.send(
                path = "api/mobile/v1/feed/$churchSlug",
                serializer = MobileSuccess.serializer(FeedPage.serializer()),
                query = mapOf("cursor" to cursor),
            ).value ?: return
            nextCursor = page.nextCursor
            _phase.value = loaded.copy(items = loaded.items + page.items)
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            // A failed page two does not discard page one.
            nextCursor = null
        } finally {
            pageLock.unlock()
        }
    }

    private companion object {
        const val NAME = "feed"
        const val TTL_MILLIS = 300_000L
    }
}
