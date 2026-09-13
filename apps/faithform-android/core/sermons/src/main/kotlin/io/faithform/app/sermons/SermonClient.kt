package io.faithform.app.sermons

import io.faithform.app.contract.SermonDetail
import io.faithform.app.contract.SermonPage
import io.faithform.app.network.ApiClient
import io.faithform.app.network.ApiException
import io.faithform.app.network.ProjectionCache
import io.faithform.app.storage.CachePartition
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.sync.Mutex

/**
 * Reads the published sermon-notes projections.
 *
 * Mirrors `SermonClient.swift`: `GET api/mobile/v1/sermons/{slug}/archive` with
 * `q` and `cursor`, and `GET api/mobile/v1/sermons/{slug}/item/{id}`. Every
 * response is cached under the caller's partition and revalidated with its
 * ETag; a search and a second page are never cached, because caching every
 * query someone typed would build a local record of what they searched for.
 */
class SermonClient(
    private val api: ApiClient,
    private val cache: ProjectionCache,
) {
    suspend fun archive(
        churchSlug: String,
        query: String?,
        cursor: String?,
        partition: CachePartition,
    ): SermonPage {
        val params = buildMap {
            query?.trim()?.takeIf { it.isNotEmpty() }?.let { put("q", it) }
            cursor?.let { put("cursor", it) }
        }
        return cache.revalidate(
            api = api,
            path = "api/mobile/v1/sermons/$churchSlug/archive",
            serializer = SermonPage.serializer(),
            name = "sermons.archive.$churchSlug",
            partition = partition,
            query = params,
            cacheable = params.isEmpty(),
        )
    }

    suspend fun detail(churchSlug: String, sermonId: String, partition: CachePartition): SermonDetail =
        cache.revalidate(
            api = api,
            path = "api/mobile/v1/sermons/$churchSlug/item/$sermonId",
            serializer = SermonDetail.serializer(),
            name = "sermons.detail.$churchSlug.$sermonId",
            partition = partition,
        )
}

/**
 * A church's published sermon notes.
 *
 * Mirrors `SermonModel.swift`, and deliberately the same shape as the media
 * list minus the live case: there is no "on now" for notes. Which empty state
 * shows and whether another page may be asked for are already decided by
 * [SermonScreenState]; this class sequences the client and maps failures
 * through [sermonListPhaseFor].
 */
class SermonListModel(
    private val client: SermonClient,
    private val churchSlug: String,
    private val partition: CachePartition,
) {
    private val _state = MutableStateFlow(SermonScreenState())
    val state: StateFlow<SermonScreenState> = _state.asStateFlow()

    private var nextCursor: String? = null
    private val pageLock = Mutex()

    suspend fun load() {
        if (_state.value.phase is SermonListPhase.Idle) {
            _state.update { it.copy(phase = SermonListPhase.Loading) }
        }
        reload()
    }

    suspend fun refresh() = reload()

    suspend fun search(term: String) {
        _state.update { it.copy(searchTerm = term) }
        reload()
    }

    fun updateSearchTerm(term: String) = _state.update { it.copy(searchTerm = term) }

    private suspend fun reload() {
        try {
            val page = client.archive(churchSlug, _state.value.searchTerm, cursor = null, partition = partition)
            nextCursor = page.nextCursor
            _state.update {
                it.copy(
                    phase = SermonListPhase.Loaded(page.items),
                    hasMore = page.nextCursor != null,
                    isLoadingMore = false,
                )
            }
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: ApiException) {
            _state.update {
                it.copy(phase = sermonListPhaseFor(error.code.wire, error.displayMessage), hasMore = false)
            }
        } catch (_: Exception) {
            _state.update { it.copy(phase = SermonListPhase.Offline, hasMore = false) }
        }
    }

    /** Appends the next page; a failed page keeps what is already on screen. */
    suspend fun loadMore() {
        if (!_state.value.canLoadMore) return
        val cursor = nextCursor ?: return
        if (!pageLock.tryLock()) return
        try {
            _state.update { it.copy(isLoadingMore = true) }
            val page = client.archive(churchSlug, _state.value.searchTerm, cursor, partition)
            nextCursor = page.nextCursor
            _state.update { current ->
                val loaded = current.phase as? SermonListPhase.Loaded ?: return@update current
                current.copy(
                    phase = loaded.copy(items = loaded.items + page.items),
                    hasMore = page.nextCursor != null,
                    isLoadingMore = false,
                )
            }
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            nextCursor = null
            _state.update { it.copy(hasMore = false, isLoadingMore = false) }
        } finally {
            pageLock.unlock()
        }
    }
}

/** One sermon's notes. Mirrors `SermonDetailModel.swift`. */
class SermonDetailModel(
    private val client: SermonClient,
    private val churchSlug: String,
    private val sermonId: String,
    private val partition: CachePartition,
) {
    private val _phase = MutableStateFlow<SermonDetailPhase>(SermonDetailPhase.Loading)
    val phase: StateFlow<SermonDetailPhase> = _phase.asStateFlow()

    suspend fun load() {
        _phase.value = try {
            SermonDetailPhase.Loaded(client.detail(churchSlug, sermonId, partition))
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: ApiException) {
            sermonDetailPhaseFor(error.code.wire, error.displayMessage)
        } catch (_: Exception) {
            SermonDetailPhase.Offline
        }
    }
}
