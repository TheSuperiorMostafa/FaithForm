package io.faithform.faithful.media

/**
 * Watching a service, with every decision out of Media3's way.
 *
 * The framework part of a player is small: give it a media item, tell it to
 * play, listen for state. Everything that could be *wrong* is here instead, in
 * plain Kotlin with no Media3 import — when to refresh a capability, what an
 * error means to a person, whether a position is worth remembering, and what
 * happens when a church takes something down mid-sermon.
 *
 * Behavioural parity with `MediaPlayback.swift`, arrived at from the same
 * specification rather than shared code.
 */

enum class MediaPlaybackKind(val wire: String) {
    LIVE("live"),
    RECORDING("recording");

    /**
     * Whether scrubbing makes sense.
     *
     * A live stream has a moving edge and a playlist window a few seconds wide;
     * offering a scrubber over it promises something the format cannot deliver.
     */
    val isSeekable: Boolean get() = this == RECORDING

    /**
     * Whether a position is worth remembering.
     *
     * **Never for live.** "Resume where you left off" at a live edge means
     * resuming at a moment that no longer exists, and the next segment window
     * will not contain it.
     */
    val isResumable: Boolean get() = this == RECORDING

    companion object {
        fun fromWire(value: String): MediaPlaybackKind =
            entries.firstOrNull { it.wire == value } ?: RECORDING
    }
}

/**
 * How the bytes arrive.
 *
 * Distinct from [MediaPlaybackKind], which says *what* is being watched. A live
 * service is always HLS; the archive is progressive today because the relay
 * writes one MP4 per service and nothing packages a VOD playlist.
 *
 * The player is **told** rather than left to infer it from the URL. Media3's
 * default media-source factory guesses from the path, and the recording
 * delivery route has no file extension to guess from — so without this a
 * progressive recording could be handed to the HLS extractor.
 */
enum class RenditionKind(val wire: String) {
    HLS("hls"),
    PROGRESSIVE("progressive");

    companion object {
        /**
         * Unknown values fall back to progressive rather than failing: a server
         * that adds a rendition form must not break a released app, and
         * progressive is what every recording is today.
         */
        fun fromWire(value: String?): RenditionKind =
            entries.firstOrNull { it.wire == value } ?: PROGRESSIVE
    }
}

/** One thing to play, and permission to play it. */
data class PlaybackRequest(
    val url: String,
    /**
     * Sent as `Authorization: Bearer` on **every** request the player makes,
     * including each segment. Never appended to [url].
     */
    val capability: String,
    val kind: MediaPlaybackKind,
    val renditionKind: RenditionKind = RenditionKind.PROGRESSIVE,
    /** Where a trimmed recording actually begins inside the stored file. */
    val startOffsetMillis: Long = 0,
    /** Where this person had got to, relative to [startOffsetMillis]. */
    val resumeMillis: Long = 0,
)

sealed interface PlayerCommand {
    data class Load(val request: PlaybackRequest) : PlayerCommand
    data object Play : PlayerCommand
    data object Pause : PlayerCommand
    data class Seek(val millis: Long) : PlayerCommand
    data object Stop : PlayerCommand
    /** Swaps the capability without interrupting playback. */
    data class UpdateCapability(val capability: String) : PlayerCommand
}

/**
 * Why playback stopped, in terms a person can act on.
 *
 * **Deliberately coarse.** A Media3 `PlaybackException` carries an error code,
 * a cause chain, a failing URI and sometimes an upstream response — none of
 * which belongs on a screen or in a log, and all of which would describe the
 * delivery architecture to anyone reading it.
 */
enum class PlayerFailure {
    NETWORK,
    /**
     * The server refused. From a phone's point of view this is one thing: the
     * church took it down, revoked it, or the relationship changed.
     */
    UNAVAILABLE,
    UNSUPPORTED,
    UNKNOWN,
}

sealed interface PlayerEvent {
    data object Buffering : PlayerEvent
    data class ReadyToPlay(val durationMillis: Long?) : PlayerEvent
    data object Playing : PlayerEvent
    data object Paused : PlayerEvent
    data object Ended : PlayerEvent
    data class Progress(val millis: Long, val durationMillis: Long?) : PlayerEvent
    data class Failed(val failure: PlayerFailure) : PlayerEvent
}

/**
 * The exact slice of Media3 this feature needs.
 *
 * **Why a façade rather than `ExoPlayer` directly.** `ExoPlayer` cannot be
 * constructed usefully on a JVM runner: it needs a `Context`, a `Looper`, and a
 * media stack. Without a seam, the *decisions* — refresh timing, error mapping,
 * resume bounds, revocation handling — would be reachable only on a device,
 * which is exactly the code most likely to be subtly wrong.
 */
interface MediaPlayerFacade {
    suspend fun send(command: PlayerCommand)
    fun setEventHandler(handler: (PlayerEvent) -> Unit)
    /** Current position, relative to the start of the trimmed recording. */
    suspend fun currentPositionMillis(): Long
}

object PlayerFailureMapping {
    /**
     * Turns an HTTP status into something a person can be told.
     *
     * 401 and 403 are one answer on purpose. A phone cannot usefully
     * distinguish "your capability expired" from "the church revoked this", and
     * telling them apart would describe the capability model to anyone watching
     * the traffic.
     */
    fun fromStatus(statusCode: Int): PlayerFailure = when (statusCode) {
        401, 403, 404, 410 -> PlayerFailure.UNAVAILABLE
        408, 429, 502, 503, 504 -> PlayerFailure.NETWORK
        415, 416 -> PlayerFailure.UNSUPPORTED
        else -> if (statusCode >= 500) PlayerFailure.NETWORK else PlayerFailure.UNAVAILABLE
    }

    /**
     * The Media3 error codes this app can encounter, as plain integers.
     *
     * Kept here rather than in the adapter because **this is a decision**, and
     * the adapter is supposed to hold none. Expressing it over `Int` also means
     * it runs on the JVM: constructing a real `PlaybackException` under
     * Robolectric drags in enough of Media3's static initialisation to hang the
     * runner, which is a poor reason to leave a decision untested.
     *
     * The constants mirror `androidx.media3.common.PlaybackException`. A
     * Robolectric test asserts the adapter still reads the same fields, so a
     * rename in Media3 fails there rather than silently here.
     */
    const val ERROR_IO_NETWORK_CONNECTION_FAILED = 2001
    const val ERROR_IO_NETWORK_CONNECTION_TIMEOUT = 2002
    const val ERROR_IO_BAD_HTTP_STATUS = 2004
    const val ERROR_IO_FILE_NOT_FOUND = 2005
    const val ERROR_IO_NO_PERMISSION = 2006
    const val ERROR_PARSING_CONTAINER_UNSUPPORTED = 3003
    const val ERROR_PARSING_MANIFEST_UNSUPPORTED = 3004
    const val ERROR_DECODER_INIT_FAILED = 4001
    const val ERROR_DECODING_FAILED = 4003

    /**
     * @param httpStatus the upstream status when the failure carried one; the
     *   status is more specific than the error code and wins where present.
     */
    fun fromPlayerError(errorCode: Int, httpStatus: Int?): PlayerFailure {
        if (httpStatus != null) return fromStatus(httpStatus)
        return when (errorCode) {
            ERROR_IO_NETWORK_CONNECTION_FAILED,
            ERROR_IO_NETWORK_CONNECTION_TIMEOUT,
            ERROR_IO_NO_PERMISSION,
            -> PlayerFailure.NETWORK

            ERROR_IO_BAD_HTTP_STATUS,
            ERROR_IO_FILE_NOT_FOUND,
            -> PlayerFailure.UNAVAILABLE

            ERROR_PARSING_CONTAINER_UNSUPPORTED,
            ERROR_PARSING_MANIFEST_UNSUPPORTED,
            ERROR_DECODER_INIT_FAILED,
            ERROR_DECODING_FAILED,
            -> PlayerFailure.UNSUPPORTED

            else -> PlayerFailure.UNKNOWN
        }
    }
}

// ---------------------------------------------------------------------------
// Capability schedule
// ---------------------------------------------------------------------------

/**
 * When to renew, and what to do when renewal is refused.
 *
 * A capability lasts five minutes. Refreshing on *failure* would mean the
 * person sees a stall every five minutes; refreshing on a schedule means they
 * never do — unless the church has revoked it, which is the one case where
 * stopping is correct.
 */
data class CapabilitySchedule(
    val expiresAtEpochMillis: Long,
    val refreshLeadMillis: Long,
) {
    private val lead: Long get() = maxOf(5_000L, refreshLeadMillis)

    fun refreshAtEpochMillis(): Long = expiresAtEpochMillis - lead
    fun isDue(nowEpochMillis: Long): Boolean = nowEpochMillis >= refreshAtEpochMillis()
    fun isExpired(nowEpochMillis: Long): Boolean = nowEpochMillis >= expiresAtEpochMillis
}

// ---------------------------------------------------------------------------
// Resume positions
// ---------------------------------------------------------------------------

data class ResumePosition(
    val mediaId: String,
    val churchSlug: String,
    val millis: Long,
    val updatedAtEpochMillis: Long,
)

object ResumePolicy {
    /**
     * At most this many positions, newest first.
     *
     * Small on purpose. "The last few things you were watching" is a
     * convenience; a hundred of them is a record of what someone watched all
     * year, which is a different thing and one this app has no business keeping.
     */
    const val MAX_ENTRIES = 20

    /** A month. Long enough to finish a sermon, short enough to empty itself. */
    const val MAX_AGE_MILLIS = 30L * 24 * 60 * 60 * 1000

    /** Below this there is nothing to resume — they meant to start over. */
    const val MINIMUM_MILLIS = 30_000L

    /** Resuming at 99% shows someone the credits. */
    const val COMPLETION_TAIL_MILLIS = 30_000L

    fun shouldStore(
        kind: MediaPlaybackKind,
        millis: Long,
        durationMillis: Long?,
    ): Boolean {
        // **Never for live.** A live edge is not a durable position.
        if (!kind.isResumable) return false
        if (millis < MINIMUM_MILLIS) return false
        if (durationMillis != null && durationMillis > 0) {
            return millis <= durationMillis - COMPLETION_TAIL_MILLIS
        }
        return true
    }

    fun prune(entries: List<ResumePosition>, nowEpochMillis: Long): List<ResumePosition> =
        entries
            .filter { nowEpochMillis - it.updatedAtEpochMillis <= MAX_AGE_MILLIS }
            .sortedByDescending { it.updatedAtEpochMillis }
            .take(MAX_ENTRIES)
}

/**
 * The headers every playback request carries.
 *
 * Pure, and here rather than in the adapter, for the same reason as everything
 * else in this file: what a request carries is a decision, and it is one worth
 * asserting without a media stack in the way.
 *
 * The map is mutable and handed to Media3's data-source factory once, so
 * replacing the capability replaces it for requests that have not been issued
 * yet — a refresh lands without rebuilding the player or reloading the item.
 */
class CapabilityHeaders {
    private val headers = mutableMapOf<String, String>()

    fun set(capability: String) {
        headers["Authorization"] = "Bearer $capability"
    }

    /** The live map the data source reads. Not a copy: that is the point. */
    fun mutableView(): MutableMap<String, String> = headers

    fun snapshot(): Map<String, String> = headers.toMap()
}

/**
 * Where remembered positions live.
 *
 * **Device-local, and deliberately not synced.** A server-held position would
 * be a per-person, per-recording, cross-device record of what someone watched
 * and how far they got — person-level viewing analytics under another name.
 * The requirement is "resume on the same device", and this is what that means.
 */
interface ResumePositionStore {
    suspend fun position(mediaId: String, partitionKey: String, nowEpochMillis: Long): ResumePosition?
    suspend fun record(position: ResumePosition, partitionKey: String, nowEpochMillis: Long)
    suspend fun clear(partitionKey: String)
    /** Every partition. Called on sign-out and on any authorization change. */
    suspend fun clearAll()
}
