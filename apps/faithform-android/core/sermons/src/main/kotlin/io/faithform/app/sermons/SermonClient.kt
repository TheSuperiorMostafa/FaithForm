package io.faithform.app.sermons

import io.faithform.app.contract.SermonDetail
import io.faithform.app.contract.SermonPage
import io.faithform.app.network.ApiClient
import io.faithform.app.network.ApiException
import io.faithform.app.network.ProjectionCache
import io.faithform.app.storage.CacheEntry
import io.faithform.app.storage.CachePartition
import io.faithform.app.storage.Freshness
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

    suspend fun cachedArchive(churchSlug: String, partition: CachePartition) =
        cache.load("sermons.archive.$churchSlug", partition, SermonPage.serializer())

    suspend fun detail(churchSlug: String, sermonId: String, partition: CachePartition): SermonDetail =
        cache.revalidate(
            api = api,
            path = "api/mobile/v1/sermons/$churchSlug/item/$sermonId",
            serializer = SermonDetail.serializer(),
            name = "sermons.detail.$churchSlug.$sermonId",
            partition = partition,
        )

    suspend fun cachedDetail(churchSlug: String, sermonId: String, partition: CachePartition) =
        cache.load("sermons.detail.$churchSlug.$sermonId", partition, SermonDetail.serializer())
}

/**
 * A church's published sermon notes.
 *
 * Mirrors `SermonModel.swift`, and deliberately the same shape as the media
 * list minus the live case: there is no "on now" for notes. Which empty state
 * shows and whether another page may be asked for are already decided by
 * [SermonScreenState]; this class sequences the client and maps failures
 * through [sermonListPhaseFor].
 *
 * ## Which answer wins
 *
 * A first load, a pull-to-refresh, a refresh on returning to the screen and a
 * search can all be in flight at once. Every one of them takes a generation
 * number when it starts, and only the most recently *started* one may change
 * the list — so a slow answer for "gra" can never land on top of the answer for
 * "grace" that came back first. A next page belongs to the list it was asked
 * for: it uses that list's query and cursor, and is dropped if the list was
 * replaced while it was on its way.
 *
 * ## Searching
 *
 * [search] only records what was typed. [observeSearch], run for the life of
 * the model, waits until typing pauses for [SEARCH_DEBOUNCE_MILLIS] and then
 * asks; a new keystroke cancels both the wait and a request already sent.
 * Clearing the box asks at once, because the full list is the answer a person
 * expects immediately.
 */
class SermonListModel(
    private val client: SermonClient,
    private val churchSlug: String,
    private val partition: CachePartition,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    private val _state = MutableStateFlow(SermonScreenState())
    val state: StateFlow<SermonScreenState> = _state.asStateFlow()

    private var nextCursor: String? = null
    /** The query (trimmed) that produced the list on screen, or null when none is. */
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
        if (_state.value.phase is SermonListPhase.Idle) {
            paintCachedOrLoading()
        }
        reload(_state.value.searchTerm)
    }

    private suspend fun paintCachedOrLoading() {
        val cached = client.cachedArchive(churchSlug, partition)
        val now = clock()
        if (cached != null && cached.isDisplayable(now) && _state.value.searchTerm.isBlank()) {
            nextCursor = cached.value.nextCursor
            loadedQuery = ""
            _state.update {
                it.copy(
                    phase = SermonListPhase.Loaded(
                        cached.value.items,
                        isStale = cached.freshness(now, CacheEntry.PROJECTION_TTL_MILLIS) !is Freshness.Fresh,
                    ),
                    hasMore = cached.value.nextCursor != null,
                    loadMoreFailed = false,
                )
            }
        } else {
            _state.update { it.copy(phase = SermonListPhase.Loading) }
        }
    }

    /**
     * Asks again for the list the person is looking at. Over a loaded list this
     * is a pull-to-refresh and keeps the list on screen; from an error it shows
     * progress again rather than leaving a dead retry.
     */
    suspend fun refresh() {
        _state.update {
            if (it.phase is SermonListPhase.Loaded) {
                it.copy(isRefreshing = true)
            } else {
                it.copy(phase = SermonListPhase.Loading)
            }
        }
        try {
            reload(_state.value.searchTerm)
        } finally {
            _state.update { it.copy(isRefreshing = false) }
        }
    }

    /**
     * Called every time the screen is entered. Models live for the whole
     * session, so without this a list read on Sunday morning would still be the
     * list on Sunday evening. The first entry loads; a list older than
     * [STALE_AFTER_MILLIS], one already marked stale, or an error screen is
     * asked for again quietly; a fresh list and anything already in flight are
     * left alone.
     */
    suspend fun refreshIfStale() {
        val current = _state.value
        val phase = current.phase
        val loadedAt = lastLoadedAtMillis
        when {
            phase is SermonListPhase.Idle -> load()
            phase is SermonListPhase.Loading || current.isRefreshing -> Unit
            phase !is SermonListPhase.Loaded ||
                phase.isStale ||
                loadedAt == null ||
                clock() - loadedAt >= STALE_AFTER_MILLIS -> reload(current.searchTerm)
        }
    }

    /** Records what was typed. The request itself is made by [observeSearch]. */
    fun search(term: String) {
        _state.update { it.copy(searchTerm = term) }
        typedTerms.tryEmit(term)
    }

    /**
     * Turns typing into requests, for as long as the caller's scope lives.
     * Suspends forever; run it once per model.
     */
    suspend fun observeSearch() {
        typedTerms.collectLatest { term ->
            val query = term.trim()
            if (query.isNotEmpty()) delay(SEARCH_DEBOUNCE_MILLIS)
            // Typing back to what is already on screen asks for nothing — unless
            // another request is on its way that would replace it.
            val alreadyShowing = query == loadedQuery &&
                reloadsInFlight.get() == 0 &&
                (_state.value.phase as? SermonListPhase.Loaded)?.isStale == false
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
                    phase = SermonListPhase.Loaded(page.items),
                    hasMore = page.nextCursor != null,
                    loadMoreFailed = false,
                )
            }
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: ApiException) {
            if (mine == generation.get()) fail(query, sermonListPhaseFor(error.code.wire, error.displayMessage))
        } catch (_: Exception) {
            if (mine == generation.get()) fail(query, SermonListPhase.Offline)
        } finally {
            reloadsInFlight.decrementAndGet()
        }
    }

    /**
     * A failed refresh of the list already on screen, for the same query, keeps
     * that list and marks it stale: losing the connection is not a reason to
     * take away what was already read. Anything else — a blocked church, a
     * different search, an error with its own message — replaces it.
     */
    private fun fail(query: String, phase: SermonListPhase) {
        val loaded = _state.value.phase as? SermonListPhase.Loaded
        if (phase is SermonListPhase.Offline && loaded != null && query == loadedQuery) {
            _state.update { it.copy(phase = loaded.copy(isStale = true)) }
            return
        }
        nextCursor = null
        loadedQuery = null
        // `isLoadingMore` is left to the page in flight, if any: it clears it
        // when it lands, so the next list never sees a lock it cannot take.
        _state.update { it.copy(phase = phase, hasMore = false, loadMoreFailed = false) }
    }

    /**
     * Appends the next page. A failed page keeps what is already on screen and
     * its cursor, and sets [SermonScreenState.loadMoreFailed] so the list offers
     * a retry instead of requesting the page again on its own.
     */
    suspend fun loadMore() {
        if (!_state.value.canLoadMore) return
        val cursor = nextCursor ?: return
        if (!pageLock.tryLock()) return
        val mine = generation.get()
        try {
            _state.update { it.copy(isLoadingMore = true, loadMoreFailed = false) }
            val page = client.archive(churchSlug, loadedQuery, cursor, partition)
            // The list was replaced while this page was on its way; the new
            // list has its own first page and its own cursor.
            if (mine != generation.get()) return
            nextCursor = page.nextCursor
            _state.update { current ->
                val loaded = current.phase as? SermonListPhase.Loaded ?: return@update current
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

    /** The retry under a failed page: the one way a failed page is asked for again. */
    suspend fun retryLoadMore() {
        if (!_state.value.showsLoadMoreRetry) return
        _state.update { it.copy(loadMoreFailed = false) }
        loadMore()
    }

    companion object {
        /** How long typing must pause before a search is sent. */
        const val SEARCH_DEBOUNCE_MILLIS = 300L

        /** How old a list may be before entering the screen asks for it again. */
        const val STALE_AFTER_MILLIS = 5 * 60 * 1000L
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
        val now = System.currentTimeMillis()
        client.cachedDetail(churchSlug, sermonId, partition)?.let { cached ->
            if (cached.isDisplayable(now)) {
                _phase.value = SermonDetailPhase.Loaded(cached.value)
            }
        }
        _phase.value = try {
            SermonDetailPhase.Loaded(client.detail(churchSlug, sermonId, partition))
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: ApiException) {
            keepDetailOr(sermonDetailPhaseFor(error.code.wire, error.displayMessage))
        } catch (_: Exception) {
            keepDetailOr(SermonDetailPhase.Offline)
        }
    }

    private fun keepDetailOr(fallback: SermonDetailPhase): SermonDetailPhase =
        when (fallback) {
            SermonDetailPhase.Unavailable -> fallback
            else -> _phase.value as? SermonDetailPhase.Loaded ?: fallback
        }
}
