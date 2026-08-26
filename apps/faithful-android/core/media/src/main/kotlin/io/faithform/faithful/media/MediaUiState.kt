package io.faithform.faithful.media

/**
 * What the Watch screen shows, as data.
 *
 * Pure and in `:core:media` on purpose: the parity check between iOS and
 * Android compares *behaviour*, and behaviour that lives inside a Composable is
 * only comparable by reading it. Every rule about which affordance appears is
 * decided here and asserted by `gradlew :core:media:test`.
 */

data class MediaLiveCard(
    val state: String,
    val mediaId: String,
    val title: String,
    val startsAt: String,
    val posterUrl: String?,
    val churchName: String,
    val churchTimezone: String,
) {
    val isLive: Boolean get() = state == "live"
    val isUpcoming: Boolean get() = state == "upcoming"
    val hasEnded: Boolean get() = state == "recent_ended"

    /** Only a service that is actually on air offers a watch button. */
    val offersWatch: Boolean get() = isLive
}

data class MediaArchiveCard(
    val mediaId: String,
    val title: String,
    val summary: String?,
    val recordedAt: String,
    val durationSeconds: Int?,
    val posterUrl: String?,
    val seriesName: String?,
    val speakers: List<String>,
    val churchTimezone: String,
)

sealed interface MediaListPhase {
    data object Idle : MediaListPhase
    data object Loading : MediaListPhase
    data class Loaded(
        val live: MediaLiveCard?,
        val items: List<MediaArchiveCard>,
        val isStale: Boolean = false,
    ) : MediaListPhase
    /** The church is not available to this account at all. */
    data object Blocked : MediaListPhase
    data object Offline : MediaListPhase
    data class Failed(val message: String) : MediaListPhase
}

data class MediaScreenState(
    val phase: MediaListPhase = MediaListPhase.Idle,
    val searchTerm: String = "",
    val isLoadingMore: Boolean = false,
    val hasMore: Boolean = false,
) {
    /**
     * **The rule that keeps a home screen honest.**
     *
     * A live area is drawn only when there is something to draw. No placeholder,
     * no grey box, no "not live right now" strip on a Tuesday.
     */
    val showsLiveArea: Boolean
        get() = (phase as? MediaListPhase.Loaded)?.live != null

    val liveCard: MediaLiveCard? get() = (phase as? MediaListPhase.Loaded)?.live
    val items: List<MediaArchiveCard> get() = (phase as? MediaListPhase.Loaded)?.items ?: emptyList()

    val showsSearch: Boolean get() = phase is MediaListPhase.Loaded
    val showsRetry: Boolean get() = phase is MediaListPhase.Offline || phase is MediaListPhase.Failed

    /**
     * Which empty state to show.
     *
     * "Nothing published" and "nothing matches that" are different sentences,
     * and showing the first when someone has typed a search reads as though the
     * church has no recordings at all.
     */
    val emptyReason: EmptyReason?
        get() = when {
            phase !is MediaListPhase.Loaded -> null
            items.isNotEmpty() -> null
            searchTerm.isNotBlank() -> EmptyReason.NO_MATCHES
            else -> EmptyReason.NOTHING_PUBLISHED
        }

    enum class EmptyReason { NOTHING_PUBLISHED, NO_MATCHES }

    fun withSearch(term: String): MediaScreenState = copy(searchTerm = term)
}

data class MediaDetailState(
    val detail: MediaArchiveCard? = null,
    val isUnavailable: Boolean = false,
    val isOffline: Boolean = false,
    val playback: PlaybackSessionState = PlaybackSessionState.Idle,
) {
    val isPlaying: Boolean get() = playback is PlaybackSessionState.Playing
    val isBuffering: Boolean
        get() = playback is PlaybackSessionState.Buffering || playback is PlaybackSessionState.Preparing

    /** Play is offered whenever nothing is in flight. */
    val offersPlay: Boolean
        get() = detail != null && !isPlaying && !isBuffering

    val offersPause: Boolean get() = isPlaying

    val failure: PlayerFailure? get() = (playback as? PlaybackSessionState.Failed)?.failure
}
