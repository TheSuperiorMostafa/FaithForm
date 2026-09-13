package io.faithform.app.media

import io.faithform.app.contract.ArchiveItem
import io.faithform.app.contract.LiveMedia
import io.faithform.app.contract.MediaDetail
import io.faithform.app.contract.MobileErrorCode
import io.faithform.app.network.ApiException
import io.faithform.app.storage.CachePartition
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * The Watch tab's list: what is on now, and everything published before.
 *
 * Mirrors `MediaModel.swift`. It sequences [MediaClient] and writes the answer
 * into [MediaScreenState], which already decides every affordance and is
 * tested on its own. This class decides only what a failure *means*.
 *
 * **A live area exists only when the server returned something live.** There is
 * no placeholder object for a quiet Tuesday; `live` is null and the state
 * carries null through.
 */
class MediaListModel(
    private val client: MediaClient,
    private val churchSlug: String,
    private val partition: CachePartition,
) {
    private val _state = MutableStateFlow(MediaScreenState())
    val state: StateFlow<MediaScreenState> = _state.asStateFlow()

    private var nextCursor: String? = null
    private val pageLock = Mutex()

    /** First load. A second call while a list is showing refreshes in place. */
    suspend fun load() {
        if (_state.value.phase is MediaListPhase.Idle) {
            _state.update { it.copy(phase = MediaListPhase.Loading) }
        }
        reload()
    }

    suspend fun refresh() = reload()

    /**
     * Re-runs the search. The term is recorded first so the empty state can
     * tell "nothing matches that" from "nothing published".
     */
    suspend fun search(term: String) {
        _state.update { it.withSearch(term) }
        reload()
    }

    fun updateSearchTerm(term: String) = _state.update { it.withSearch(term) }

    private suspend fun reload() {
        val term = _state.value.searchTerm.trim().takeIf { it.isNotEmpty() }
        try {
            val (live, archive) = coroutineScope {
                val liveTask = async { client.live(churchSlug, partition) }
                val archiveTask = async { client.archive(churchSlug, term, cursor = null, partition) }
                liveTask.await() to archiveTask.await()
            }
            nextCursor = archive.nextCursor
            _state.update {
                it.copy(
                    phase = MediaListPhase.Loaded(
                        live = live.live?.toCard(),
                        items = archive.items.map(ArchiveItem::toCard),
                    ),
                    hasMore = archive.nextCursor != null,
                    isLoadingMore = false,
                )
            }
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: ApiException) {
            _state.update { it.copy(phase = mediaListPhaseFor(error), hasMore = false) }
        } catch (_: Exception) {
            _state.update { it.copy(phase = MediaListPhase.Offline, hasMore = false) }
        }
    }

    /**
     * The next page, appended.
     *
     * A failed second page keeps what is already on screen: replacing a list
     * with an error because its *second* page failed loses the person's place
     * for no reason. It stops offering more instead.
     */
    suspend fun loadMore() {
        val cursor = nextCursor ?: return
        if (!pageLock.tryLock()) return
        try {
            _state.update { it.copy(isLoadingMore = true) }
            val term = _state.value.searchTerm.trim().takeIf { it.isNotEmpty() }
            val page = client.archive(churchSlug, term, cursor, partition)
            nextCursor = page.nextCursor
            _state.update { current ->
                val loaded = current.phase as? MediaListPhase.Loaded ?: return@update current
                current.copy(
                    phase = loaded.copy(items = loaded.items + page.items.map(ArchiveItem::toCard)),
                    hasMore = page.nextCursor != null,
                    isLoadingMore = false,
                )
            }
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            nextCursor = null
            _state.update { it.copy(isLoadingMore = false, hasMore = false) }
        } finally {
            pageLock.unlock()
        }
    }
}

/**
 * What a list failure means.
 *
 * `not_found`, `blocked` and `forbidden` are one answer: the server deliberately
 * says the same for a hidden church, an unknown slug and a blocked visitor, so
 * the client cannot and must not guess between them.
 */
fun mediaListPhaseFor(error: ApiException): MediaListPhase = when (error.code) {
    MobileErrorCode.BLOCKED, MobileErrorCode.FORBIDDEN, MobileErrorCode.NOT_FOUND -> MediaListPhase.Blocked
    MobileErrorCode.UNAVAILABLE, MobileErrorCode.INTERNAL_ERROR -> MediaListPhase.Offline
    else -> if (error.retryable) MediaListPhase.Offline else MediaListPhase.Failed(error.displayMessage)
}

fun ArchiveItem.toCard() = MediaArchiveCard(
    mediaId = mediaId,
    title = title,
    summary = summary,
    recordedAt = recordedAt,
    durationSeconds = durationSeconds,
    posterUrl = posterUrl,
    seriesName = seriesName,
    speakers = speakers,
    churchTimezone = churchTimezone,
)

fun MediaDetail.toCard() = MediaArchiveCard(
    mediaId = mediaId,
    title = title,
    summary = summary,
    recordedAt = recordedAt,
    durationSeconds = durationSeconds,
    posterUrl = posterUrl,
    seriesName = seriesName,
    speakers = speakers,
    churchTimezone = churchTimezone,
)

fun LiveMedia.toCard() = MediaLiveCard(
    state = state,
    mediaId = mediaId,
    title = title,
    startsAt = startsAt,
    posterUrl = posterUrl,
    churchName = churchName,
    churchTimezone = churchTimezone,
)

/**
 * One recording's page — or the live service — and the session that plays it.
 *
 * Mirrors `MediaDetailModel.swift`. The coordinator owns refresh, revocation,
 * resume and failure; this class loads what to show and republishes the
 * coordinator's state after each step so the screen never has to ask it.
 *
 * For live, there is no archive detail to fetch: the card the list already
 * showed is the whole page, so it is passed in as [knownCard] and [load] does
 * not touch the network.
 */
class MediaDetailModel(
    private val client: MediaClient,
    private val coordinator: MediaPlaybackCoordinator,
    private val churchSlug: String,
    private val mediaId: String,
    private val kind: MediaPlaybackKind,
    private val partition: CachePartition,
    knownCard: MediaArchiveCard? = null,
) {
    private val _state = MutableStateFlow(MediaDetailState(detail = knownCard))
    val state: StateFlow<MediaDetailState> = _state.asStateFlow()

    suspend fun load() {
        if (kind == MediaPlaybackKind.LIVE) return
        try {
            val detail = client.detail(churchSlug, mediaId, partition)
            _state.update { it.copy(detail = detail.toCard(), isUnavailable = false, isOffline = false) }
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: ApiException) {
            // Unpublished or revoked since the list was cached. Said plainly,
            // and without implying the person did something wrong.
            val unavailable = error.code == MobileErrorCode.NOT_FOUND ||
                error.code == MobileErrorCode.BLOCKED ||
                error.code == MobileErrorCode.FORBIDDEN
            _state.update { it.copy(isUnavailable = unavailable, isOffline = !unavailable) }
        } catch (_: Exception) {
            _state.update { it.copy(isOffline = true) }
        }
    }

    /**
     * Starts a viewing session, then plays.
     *
     * A session already under way is resumed rather than restarted — pressing
     * play after a pause must not ask for a new capability or lose the place.
     */
    suspend fun play() {
        val current = coordinator.currentState()
        val sessionUnderWay = coordinator.currentSchedule() != null && (
            current is PlaybackSessionState.Paused ||
                current is PlaybackSessionState.Buffering ||
                current is PlaybackSessionState.Playing
            )
        if (sessionUnderWay) {
            coordinator.play()
            publish()
            return
        }
        coordinator.start(churchSlug, kind, mediaId, partition.storageKey)
        publish()
        if (coordinator.currentState() is PlaybackSessionState.Buffering) {
            coordinator.play()
            publish()
        }
    }

    suspend fun pause() {
        coordinator.pause()
        publish()
    }

    suspend fun handle(event: PlayerEvent) {
        coordinator.handle(event)
        publish()
    }

    /**
     * A periodic check while the screen is open, so a long sermon renews its
     * capability ahead of expiry instead of stalling at minute five. The player
     * adapter emits no progress ticks of its own.
     */
    suspend fun tick() {
        coordinator.refreshIfNeeded()
        publish()
    }

    suspend fun enterBackground() {
        coordinator.enterBackground()
        publish()
    }

    suspend fun enterForeground() {
        coordinator.enterForeground()
        publish()
    }

    suspend fun stop() {
        coordinator.stop()
        publish()
    }

    private fun publish() {
        _state.update { it.copy(playback = coordinator.currentState()) }
    }
}

/**
 * Where resume positions live on this device, for this process.
 *
 * Bounded and pruned by [ResumePolicy] on every write — at most twenty entries,
 * none older than a month — and partitioned by account and church, so signing
 * out and back in as someone else finds nothing. Deliberately in memory for v1:
 * "resume where you left off" within a session needs nothing more, and a
 * position written to disk is a per-person record of what they watched that
 * would need its own purge and its own paragraph in the privacy policy.
 */
class InMemoryResumePositionStore : ResumePositionStore {
    private val mutex = Mutex()
    private val partitions = mutableMapOf<String, List<ResumePosition>>()

    override suspend fun position(mediaId: String, partitionKey: String, nowEpochMillis: Long): ResumePosition? =
        mutex.withLock {
            val pruned = ResumePolicy.prune(partitions[partitionKey].orEmpty(), nowEpochMillis)
            partitions[partitionKey] = pruned
            pruned.firstOrNull { it.mediaId == mediaId }
        }

    override suspend fun record(position: ResumePosition, partitionKey: String, nowEpochMillis: Long) =
        mutex.withLock {
            val others = partitions[partitionKey].orEmpty().filterNot { it.mediaId == position.mediaId }
            partitions[partitionKey] = ResumePolicy.prune(others + position, nowEpochMillis)
        }

    override suspend fun clear(partitionKey: String) = mutex.withLock { partitions.remove(partitionKey); Unit }

    override suspend fun clearAll() = mutex.withLock { partitions.clear() }
}
