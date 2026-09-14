package io.faithform.app.sermons

import io.faithform.app.contract.SermonDetail
import io.faithform.app.contract.SermonListItem

/**
 * What the sermon-notes screens show, as data.
 *
 * Pure and in `:core:sermons` for the same reason `:core:media` is pure: the
 * parity check between iOS and Android compares *behaviour*, and behaviour that
 * lives inside a Composable is only comparable by reading it.
 */

sealed interface SermonListPhase {
    data object Idle : SermonListPhase
    data object Loading : SermonListPhase
    data class Loaded(
        val items: List<SermonListItem>,
        val isStale: Boolean = false,
    ) : SermonListPhase
    /** The church is not available to this account at all. */
    data object Blocked : SermonListPhase
    data object Offline : SermonListPhase
    data class Failed(val message: String) : SermonListPhase
}

data class SermonScreenState(
    val phase: SermonListPhase = SermonListPhase.Idle,
    val searchTerm: String = "",
    val isLoadingMore: Boolean = false,
    val hasMore: Boolean = false,
    /** A pull-to-refresh is in flight over a list already on screen. */
    val isRefreshing: Boolean = false,
    /**
     * The last attempt at the next page failed. The cursor is kept, and the
     * list offers a retry instead of asking again on its own — a list that
     * re-requested a failing page every time its end came into view would
     * spin against a dead connection.
     */
    val loadMoreFailed: Boolean = false,
) {
    val items: List<SermonListItem>
        get() = (phase as? SermonListPhase.Loaded)?.items.orEmpty()

    /**
     * An empty list is a real state with two different causes, and they do not
     * read the same: a church that has published nothing is not a search that
     * found nothing.
     */
    val showsEmptyState: Boolean
        get() = phase is SermonListPhase.Loaded && items.isEmpty()

    val emptyIsSearch: Boolean
        get() = showsEmptyState && searchTerm.isNotBlank()

    /**
     * Another page is only ever requested for a list that already loaded, and
     * never on its own after the last attempt failed — only [showsLoadMoreRetry]
     * asks again.
     */
    val canLoadMore: Boolean
        get() = phase is SermonListPhase.Loaded && hasMore && !isLoadingMore && !loadMoreFailed

    /** The end of the list says the next page failed and offers to try again. */
    val showsLoadMoreRetry: Boolean
        get() = phase is SermonListPhase.Loaded && hasMore && loadMoreFailed && !isLoadingMore
}

sealed interface SermonDetailPhase {
    data object Loading : SermonDetailPhase
    data class Loaded(val detail: SermonDetail) : SermonDetailPhase
    /** Unpublished since the list was cached, or never available to this reader. */
    data object Unavailable : SermonDetailPhase
    data object Offline : SermonDetailPhase
    data class Failed(val message: String) : SermonDetailPhase
}

/**
 * Maps a failure to a phase.
 *
 * `NOT_FOUND` becomes `Blocked` rather than a distinct "no such church": the
 * server deliberately answers the same for a hidden church, an unknown slug and
 * a blocked visitor, so the client cannot and must not guess between them.
 */
fun sermonListPhaseFor(errorCode: String, message: String): SermonListPhase =
    when (errorCode) {
        "blocked", "forbidden", "not_found" -> SermonListPhase.Blocked
        "unavailable", "internal_error" -> SermonListPhase.Offline
        else -> SermonListPhase.Failed(message)
    }

fun sermonDetailPhaseFor(errorCode: String, message: String): SermonDetailPhase =
    when (errorCode) {
        // A stale list opening a sermon the church has since taken down lands
        // here rather than showing anything.
        "not_found", "blocked", "forbidden" -> SermonDetailPhase.Unavailable
        "unavailable", "internal_error" -> SermonDetailPhase.Offline
        else -> SermonDetailPhase.Failed(message)
    }
