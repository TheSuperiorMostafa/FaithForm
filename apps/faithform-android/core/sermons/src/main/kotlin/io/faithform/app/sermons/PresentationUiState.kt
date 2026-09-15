package io.faithform.app.sermons

import io.faithform.app.contract.PresentationDetail
import io.faithform.app.contract.PresentationListItem

/**
 * What the presentation (slides) screens show, as data.
 *
 * Same phase shape as [SermonListPhase] / [SermonDetailPhase] so Services'
 * Sermons and Slides panes behave alike under failure and empty states.
 */

sealed interface PresentationListPhase {
    data object Idle : PresentationListPhase
    data object Loading : PresentationListPhase
    data class Loaded(
        val items: List<PresentationListItem>,
        val isStale: Boolean = false,
    ) : PresentationListPhase
    data object Blocked : PresentationListPhase
    data object Offline : PresentationListPhase
    data class Failed(val message: String) : PresentationListPhase
}

data class PresentationScreenState(
    val phase: PresentationListPhase = PresentationListPhase.Idle,
    val searchTerm: String = "",
    val isLoadingMore: Boolean = false,
    val hasMore: Boolean = false,
    val isRefreshing: Boolean = false,
    val loadMoreFailed: Boolean = false,
) {
    val items: List<PresentationListItem>
        get() = (phase as? PresentationListPhase.Loaded)?.items.orEmpty()

    val showsEmptyState: Boolean
        get() = phase is PresentationListPhase.Loaded && items.isEmpty()

    val emptyIsSearch: Boolean
        get() = showsEmptyState && searchTerm.isNotBlank()

    val canLoadMore: Boolean
        get() = phase is PresentationListPhase.Loaded && hasMore && !isLoadingMore && !loadMoreFailed

    val showsLoadMoreRetry: Boolean
        get() = phase is PresentationListPhase.Loaded && hasMore && loadMoreFailed && !isLoadingMore
}

sealed interface PresentationDetailPhase {
    data object Loading : PresentationDetailPhase
    data class Loaded(val detail: PresentationDetail) : PresentationDetailPhase
    data object Unavailable : PresentationDetailPhase
    data object Offline : PresentationDetailPhase
    data class Failed(val message: String) : PresentationDetailPhase
}

fun presentationListPhaseFor(errorCode: String, message: String): PresentationListPhase =
    when (errorCode) {
        "blocked", "forbidden", "not_found" -> PresentationListPhase.Blocked
        "unavailable", "internal_error" -> PresentationListPhase.Offline
        else -> PresentationListPhase.Failed(message)
    }

fun presentationDetailPhaseFor(errorCode: String, message: String): PresentationDetailPhase =
    when (errorCode) {
        "not_found", "blocked", "forbidden" -> PresentationDetailPhase.Unavailable
        "unavailable", "internal_error" -> PresentationDetailPhase.Offline
        else -> PresentationDetailPhase.Failed(message)
    }
