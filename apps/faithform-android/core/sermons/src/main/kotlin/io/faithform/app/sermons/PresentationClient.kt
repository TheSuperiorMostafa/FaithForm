package io.faithform.app.sermons

import io.faithform.app.contract.PresentationDetail
import io.faithform.app.contract.PresentationPageResponse
import io.faithform.app.network.ApiClient
import io.faithform.app.network.ApiException
import io.faithform.app.network.ProjectionCache
import io.faithform.app.storage.CachePartition
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.sync.Mutex

/**
 * Reads published presentation (slide) projections.
 *
 * Mirrors [SermonClient]:
 * `GET api/mobile/v1/presentations/{slug}/archive` and
 * `GET api/mobile/v1/presentations/{slug}/item/{id}`.
 */
class PresentationClient(
    private val api: ApiClient,
    private val cache: ProjectionCache,
) {
    suspend fun archive(
        churchSlug: String,
        query: String?,
        cursor: String?,
        partition: CachePartition,
    ): PresentationPageResponse {
        val params = buildMap {
            query?.trim()?.takeIf { it.isNotEmpty() }?.let { put("q", it) }
            cursor?.let { put("cursor", it) }
        }
        return cache.revalidate(
            api = api,
            path = "api/mobile/v1/presentations/$churchSlug/archive",
            serializer = PresentationPageResponse.serializer(),
            name = "presentations.archive.$churchSlug",
            partition = partition,
            query = params,
            cacheable = params.isEmpty(),
        )
    }

    suspend fun detail(
        churchSlug: String,
        presentationId: String,
        partition: CachePartition,
    ): PresentationDetail =
        cache.revalidate(
            api = api,
            path = "api/mobile/v1/presentations/$churchSlug/item/$presentationId",
            serializer = PresentationDetail.serializer(),
            name = "presentations.detail.$churchSlug.$presentationId",
            partition = partition,
        )
}

/**
 * A church's published slide decks. Mirrors [SermonListModel].
 */
class PresentationListModel(
    private val client: PresentationClient,
    private val churchSlug: String,
    private val partition: CachePartition,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    private val _state = MutableStateFlow(PresentationScreenState())
    val state: StateFlow<PresentationScreenState> = _state.asStateFlow()

    private var nextCursor: String? = null
    private var loadedQuery: String? = null
    private var lastLoadedAtMillis: Long? = null
    private val generation = AtomicLong(0)
    private val reloadsInFlight = AtomicInteger(0)
    private val pageLock = Mutex()
    private val typedTerms = MutableSharedFlow<String>(
        extraBufferCapacity = 1,
        onBufferOverflow = BufferOverflow.DROP_OLDEST,
    )

    suspend fun load() {
        if (_state.value.phase is PresentationListPhase.Idle) {
            _state.update { it.copy(phase = PresentationListPhase.Loading) }
        }
        reload(_state.value.searchTerm)
    }

    suspend fun refresh() {
        _state.update {
            if (it.phase is PresentationListPhase.Loaded) {
                it.copy(isRefreshing = true)
            } else {
                it.copy(phase = PresentationListPhase.Loading)
            }
        }
        try {
            reload(_state.value.searchTerm)
        } finally {
            _state.update { it.copy(isRefreshing = false) }
        }
    }

    suspend fun refreshIfStale() {
        val current = _state.value
        val phase = current.phase
        val loadedAt = lastLoadedAtMillis
        when {
            phase is PresentationListPhase.Idle -> load()
            phase is PresentationListPhase.Loading || current.isRefreshing -> Unit
            phase !is PresentationListPhase.Loaded ||
                phase.isStale ||
                loadedAt == null ||
                clock() - loadedAt >= STALE_AFTER_MILLIS -> reload(current.searchTerm)
        }
    }

    fun search(term: String) {
        _state.update { it.copy(searchTerm = term) }
        typedTerms.tryEmit(term)
    }

    suspend fun observeSearch() {
        typedTerms.collectLatest { term ->
            val query = term.trim()
            if (query.isNotEmpty()) delay(SEARCH_DEBOUNCE_MILLIS)
            val alreadyShowing = query == loadedQuery &&
                reloadsInFlight.get() == 0 &&
                (_state.value.phase as? PresentationListPhase.Loaded)?.isStale == false
            if (!alreadyShowing) reload(query)
        }
    }

    private suspend fun reload(term: String) {
        val query = term.trim()
        val mine = generation.incrementAndGet()
        reloadsInFlight.incrementAndGet()
        try {
            val page = client.archive(churchSlug, query, cursor = null, partition = partition)
            if (mine != generation.get()) return
            nextCursor = page.nextCursor
            loadedQuery = query
            lastLoadedAtMillis = clock()
            _state.update {
                it.copy(
                    phase = PresentationListPhase.Loaded(page.items),
                    hasMore = page.nextCursor != null,
                    loadMoreFailed = false,
                )
            }
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: ApiException) {
            if (mine == generation.get()) {
                fail(query, presentationListPhaseFor(error.code.wire, error.displayMessage))
            }
        } catch (_: Exception) {
            if (mine == generation.get()) fail(query, PresentationListPhase.Offline)
        } finally {
            reloadsInFlight.decrementAndGet()
        }
    }

    private fun fail(query: String, phase: PresentationListPhase) {
        val loaded = _state.value.phase as? PresentationListPhase.Loaded
        if (phase is PresentationListPhase.Offline && loaded != null && query == loadedQuery) {
            _state.update { it.copy(phase = loaded.copy(isStale = true)) }
            return
        }
        nextCursor = null
        loadedQuery = null
        _state.update { it.copy(phase = phase, hasMore = false, loadMoreFailed = false) }
    }

    suspend fun loadMore() {
        if (!_state.value.canLoadMore) return
        val cursor = nextCursor ?: return
        if (!pageLock.tryLock()) return
        val mine = generation.get()
        try {
            _state.update { it.copy(isLoadingMore = true, loadMoreFailed = false) }
            val page = client.archive(churchSlug, loadedQuery, cursor, partition)
            if (mine != generation.get()) return
            nextCursor = page.nextCursor
            _state.update { current ->
                val loaded = current.phase as? PresentationListPhase.Loaded ?: return@update current
                current.copy(
                    phase = loaded.copy(items = loaded.items + page.items),
                    hasMore = page.nextCursor != null,
                    loadMoreFailed = false,
                )
            }
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            if (mine == generation.get()) _state.update { it.copy(loadMoreFailed = true) }
        } finally {
            _state.update { it.copy(isLoadingMore = false) }
            pageLock.unlock()
        }
    }

    suspend fun retryLoadMore() {
        if (!_state.value.showsLoadMoreRetry) return
        _state.update { it.copy(loadMoreFailed = false) }
        loadMore()
    }

    companion object {
        const val SEARCH_DEBOUNCE_MILLIS = 300L
        const val STALE_AFTER_MILLIS = 5 * 60 * 1000L
    }
}

/** One published slide deck. Mirrors [SermonDetailModel]. */
class PresentationDetailModel(
    private val client: PresentationClient,
    private val churchSlug: String,
    private val presentationId: String,
    private val partition: CachePartition,
) {
    private val _phase = MutableStateFlow<PresentationDetailPhase>(PresentationDetailPhase.Loading)
    val phase: StateFlow<PresentationDetailPhase> = _phase.asStateFlow()

    suspend fun load() {
        _phase.value = try {
            PresentationDetailPhase.Loaded(client.detail(churchSlug, presentationId, partition))
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: ApiException) {
            presentationDetailPhaseFor(error.code.wire, error.displayMessage)
        } catch (_: Exception) {
            PresentationDetailPhase.Offline
        }
    }
}
