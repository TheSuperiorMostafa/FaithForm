package io.faithform.faithful.media

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

data class GrantedPlayback(
    val capability: String,
    val deliveryUrl: String,
    val renditionKind: RenditionKind = RenditionKind.PROGRESSIVE,
    val expiresAtEpochMillis: Long,
    val refreshLeadMillis: Long,
    val startOffsetMillis: Long,
)

/** Acquires and refreshes a playback capability. */
interface PlaybackGranting {
    /** @throws PlaybackRefusedException when the church will not allow it. */
    suspend fun grant(
        churchSlug: String,
        kind: MediaPlaybackKind,
        mediaId: String,
    ): GrantedPlayback
}

/**
 * The server refused.
 *
 * Never published, unpublished, revoked, blocked, or the encoder has gone —
 * one exception, because a phone cannot usefully tell them apart and telling
 * them apart would describe the model.
 */
class PlaybackRefusedException(message: String) : Exception(message)

/** Something else went wrong on the way. Retryable; not a refusal. */
class PlaybackTransportException(message: String) : Exception(message)

sealed interface PlaybackSessionState {
    data object Idle : PlaybackSessionState
    data object Preparing : PlaybackSessionState
    data object Buffering : PlaybackSessionState
    data object Playing : PlaybackSessionState
    data object Paused : PlaybackSessionState
    data object Ended : PlaybackSessionState
    data class Failed(val failure: PlayerFailure) : PlaybackSessionState
}

/**
 * Drives one viewing session, from tapping play to the church taking it down.
 *
 * ## Single-flight refresh
 *
 * A capability expires every five minutes. Two things can notice at once — the
 * scheduled refresh and a 401 from a segment — and both will ask for a new one.
 * The in-flight flag is claimed **under a mutex before any suspension point**,
 * so they produce one request and share its answer. A check that ran after a
 * suspension would let both through, which is the same TOCTOU that produced
 * eight concurrent geofence submissions in Prompt 7.
 *
 * ## Revocation
 *
 * A refused refresh is terminal. The coordinator does not retry it, does not
 * fall back to the old capability, and does not keep playing on the segments
 * already buffered. That is what "revoke stops playback that is already
 * running" has to mean.
 */
class MediaPlaybackCoordinator(
    private val granter: PlaybackGranting,
    private val player: MediaPlayerFacade,
    private val resumeStore: ResumePositionStore,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    private val mutex = Mutex()

    private var state: PlaybackSessionState = PlaybackSessionState.Idle
    private var schedule: CapabilitySchedule? = null
    private var churchSlug: String? = null
    private var kind: MediaPlaybackKind? = null
    private var mediaId: String? = null
    private var partitionKey: String? = null
    private var refreshing = false
    private var lastKnownDuration: Long? = null

    fun currentState(): PlaybackSessionState = state
    fun currentSchedule(): CapabilitySchedule? = schedule

    /**
     * Starts a viewing session.
     *
     * The resume position is read **before** the grant, so a refused grant costs
     * nothing and leaves no partial state. Live never resumes.
     */
    suspend fun start(
        churchSlug: String,
        kind: MediaPlaybackKind,
        mediaId: String,
        partitionKey: String,
    ) {
        state = PlaybackSessionState.Preparing
        this.churchSlug = churchSlug
        this.kind = kind
        this.mediaId = mediaId
        this.partitionKey = partitionKey

        val resume = if (kind.isResumable) {
            resumeStore.position(mediaId, partitionKey, clock())?.millis ?: 0L
        } else {
            0L
        }

        state = try {
            val granted = granter.grant(churchSlug, kind, mediaId)
            schedule = CapabilitySchedule(
                expiresAtEpochMillis = granted.expiresAtEpochMillis,
                refreshLeadMillis = granted.refreshLeadMillis,
            )
            player.send(
                PlayerCommand.Load(
                    PlaybackRequest(
                        url = granted.deliveryUrl,
                        capability = granted.capability,
                        kind = kind,
                        renditionKind = granted.renditionKind,
                        startOffsetMillis = granted.startOffsetMillis,
                        resumeMillis = resume,
                    ),
                ),
            )
            PlaybackSessionState.Buffering
        } catch (_: Exception) {
            PlaybackSessionState.Failed(PlayerFailure.UNAVAILABLE)
        }
    }

    /**
     * Refreshes if the schedule says it is time, or if something demanded it.
     *
     * @return whether playback may continue.
     */
    suspend fun refreshIfNeeded(force: Boolean = false): Boolean {
        val slug = churchSlug ?: return false
        val currentKind = kind ?: return false
        val currentMedia = mediaId ?: return false
        val currentSchedule = schedule ?: return false
        if (!force && !currentSchedule.isDue(clock())) return true

        // **Claimed under the mutex before any suspension.** Two callers
        // noticing at once produce one request.
        val claimed = mutex.withLock {
            if (refreshing) false else { refreshing = true; true }
        }
        if (!claimed) return true

        return try {
            val granted = granter.grant(slug, currentKind, currentMedia)
            schedule = CapabilitySchedule(
                expiresAtEpochMillis = granted.expiresAtEpochMillis,
                refreshLeadMillis = granted.refreshLeadMillis,
            )
            // Swapped without interrupting playback: the data source uses the
            // new one on its next request.
            player.send(PlayerCommand.UpdateCapability(granted.capability))
            true
        } catch (_: Exception) {
            // Terminal. Not retried, and the old capability is not reused — a
            // church that revoked something meant it.
            savePosition()
            player.send(PlayerCommand.Stop)
            state = PlaybackSessionState.Failed(PlayerFailure.UNAVAILABLE)
            false
        } finally {
            mutex.withLock { refreshing = false }
        }
    }

    suspend fun handle(event: PlayerEvent) {
        when (event) {
            is PlayerEvent.Buffering -> state = PlaybackSessionState.Buffering
            is PlayerEvent.ReadyToPlay -> {
                lastKnownDuration = event.durationMillis
                state = PlaybackSessionState.Paused
            }
            is PlayerEvent.Playing -> state = PlaybackSessionState.Playing
            is PlayerEvent.Paused -> {
                state = PlaybackSessionState.Paused
                savePosition()
            }
            is PlayerEvent.Ended -> {
                state = PlaybackSessionState.Ended
                savePosition()
            }
            is PlayerEvent.Progress -> {
                event.durationMillis?.let { lastKnownDuration = it }
                // A refresh that lands on a progress tick keeps a long sermon
                // playing without the person ever seeing a stall.
                refreshIfNeeded()
            }
            is PlayerEvent.Failed -> {
                if (event.failure == PlayerFailure.UNAVAILABLE) {
                    // One retry through a fresh capability: an expired one looks
                    // exactly like a revoked one from the transport's point of
                    // view, and only the server can tell them apart.
                    if (refreshIfNeeded(force = true)) {
                        player.send(PlayerCommand.Play)
                        return
                    }
                }
                savePosition()
                state = PlaybackSessionState.Failed(event.failure)
            }
        }
    }

    suspend fun play() = player.send(PlayerCommand.Play)

    suspend fun pause() {
        player.send(PlayerCommand.Pause)
        savePosition()
    }

    suspend fun seek(millis: Long) {
        if (kind?.isSeekable != true) return
        player.send(PlayerCommand.Seek(maxOf(0, millis)))
    }

    /**
     * The app went to the background, or lost audio focus permanently.
     *
     * The position is saved immediately rather than on the next tick, because
     * there may not be a next tick — Android can stop the process without
     * warning.
     */
    suspend fun enterBackground() = savePosition()

    /**
     * The app came back.
     *
     * A capability that expired while stopped is refreshed before anything is
     * asked of the player, so the first thing the person sees is not a failure.
     */
    suspend fun enterForeground() {
        val currentSchedule = schedule ?: return
        if (currentSchedule.isExpired(clock()) || currentSchedule.isDue(clock())) {
            refreshIfNeeded(force = true)
        }
    }

    suspend fun stop() {
        savePosition()
        player.send(PlayerCommand.Stop)
        state = PlaybackSessionState.Idle
        churchSlug = null
        kind = null
        mediaId = null
        schedule = null
    }

    private suspend fun savePosition() {
        val currentKind = kind ?: return
        val currentMedia = mediaId ?: return
        val partition = partitionKey ?: return
        val slug = churchSlug ?: return

        val millis = player.currentPositionMillis()
        if (!ResumePolicy.shouldStore(currentKind, millis, lastKnownDuration)) return

        resumeStore.record(
            ResumePosition(
                mediaId = currentMedia,
                churchSlug = slug,
                millis = millis,
                updatedAtEpochMillis = clock(),
            ),
            partition,
            clock(),
        )
    }
}

// ---------------------------------------------------------------------------
// Audio focus
// ---------------------------------------------------------------------------

/** What the system told us about audio focus. */
enum class AudioFocusChange { GAINED, LOST_TRANSIENT, LOST_TRANSIENT_CAN_DUCK, LOST }

/** What the app should do about it. */
enum class AudioFocusAction { RESUME, PAUSE, DUCK, STOP, NOTHING }

/**
 * Audio focus, as a decision rather than a callback.
 *
 * Kept here so the behaviour is tested on the JVM. Android's own callback is a
 * thin adapter in `:app` that turns an int into an [AudioFocusChange].
 *
 * Ducking rather than pausing on a transient-can-duck is the difference between
 * a sermon that survives a navigation prompt and one that stops for it.
 */
object AudioFocusPolicy {
    fun action(change: AudioFocusChange, wasPlaying: Boolean): AudioFocusAction =
        when (change) {
            AudioFocusChange.GAINED ->
                if (wasPlaying) AudioFocusAction.RESUME else AudioFocusAction.NOTHING
            AudioFocusChange.LOST_TRANSIENT ->
                if (wasPlaying) AudioFocusAction.PAUSE else AudioFocusAction.NOTHING
            AudioFocusChange.LOST_TRANSIENT_CAN_DUCK ->
                if (wasPlaying) AudioFocusAction.DUCK else AudioFocusAction.NOTHING
            // Permanent loss — another app took over. Stopping releases the
            // player rather than leaving it paused and holding a session.
            AudioFocusChange.LOST -> AudioFocusAction.STOP
        }
}
