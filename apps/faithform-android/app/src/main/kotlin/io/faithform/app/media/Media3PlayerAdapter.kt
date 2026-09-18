package io.faithform.app.media

import android.content.Context
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.HttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext

/**
 * The only file in FaithForm that touches Media3.
 *
 * **It contains no decisions.** When to refresh a capability, what a failure
 * means to a person, whether a position is worth remembering, what happens on a
 * revocation — all of that lives in `:core:media`, which is pure JVM and fully
 * tested. This file translates.
 *
 * ## What a request carries
 *
 * `DefaultHttpDataSource.Factory.setDefaultRequestProperties` attaches headers
 * to **every** request the player makes — the playlist, each segment, each byte
 * range. So the capability travels in an `Authorization` header and never in a
 * URL. A live stream's delivery URL also carries its own delivery token in the
 * path (iOS cannot put a header on HLS segments), and the server accepts either;
 * Android sends both.
 *
 * [PlayerCommand.UpdateCapability] hands the renewed header to the factory's
 * shared request properties, which is what lets a refresh land without
 * interrupting playback.
 *
 * ## What is deliberately absent
 *
 * No `DownloadManager`, no `DownloadService`, no `CacheDataSource`, no cast
 * provider. Prompt 9 excludes offline downloads and casting; a cache would also
 * mean a church's unpublish leaves playable segments on a device.
 *
 * ## What is not exercised in CI
 *
 * `ExoPlayer` needs a `Context`, a `Looper` and a media stack, so **the player
 * wiring below is not covered by an automated test** and is verified by the
 * device runbook instead. What *is* covered — because it was deliberately kept
 * out of this file — is the refresh schedule, the single-flight, the error
 * mapping, the resume policy, the audio-focus policy and the revocation
 * behaviour. The one piece of translation that lives here, mapping a
 * `PlaybackException` onto a `PlayerFailure`, is exercised through
 * [mapPlaybackError] by a Robolectric test.
 */
// Media3 marks the data-source and media-source factory configuration used
// here as unstable API. They are the documented way to attach request headers
// and a data source, the version is pinned in the catalog, and a signature
// change fails this file's compilation rather than behaviour at runtime.
@OptIn(UnstableApi::class)
class Media3PlayerAdapter(
    context: Context,
    /**
     * Builds the player **around [dataSourceFactory]**.
     *
     * This used to build `DefaultMediaSourceFactory(context)`, which creates a
     * data source of its own — so the header-carrying factory below was never
     * used, no request ever carried the capability, and every recording and
     * live stream would have been refused by the delivery route. Found by
     * playing against a local server and watching the requests arrive without
     * an `Authorization` header.
     */
    private val playerFactory: (Context, DataSource.Factory) -> ExoPlayer = { ctx, dataSource ->
        ExoPlayer.Builder(ctx)
            .setMediaSourceFactory(DefaultMediaSourceFactory(dataSource))
            .build()
    },
) : MediaPlayerFacade {

    /**
     * The headers every request carries.
     *
     * A `:core:media` type, so what a request carries is asserted on the JVM
     * rather than behind a media stack.
     */
    private val headers = CapabilityHeaders()

    /**
     * Built on first use, not at construction.
     *
     * Nothing about FaithForm needs a Media3 object to exist until something is
     * actually played — and creating one eagerly pulls Media3's static
     * initialisation into every test that merely constructs this class.
     */
    private val dataSourceFactory: HttpDataSource.Factory by lazy {
        DefaultHttpDataSource.Factory()
            .setDefaultRequestProperties(headers.mutableView())
            .setAllowCrossProtocolRedirects(false)
            .setConnectTimeoutMs(15_000)
            .setReadTimeoutMs(15_000)
    }

    private var player: ExoPlayer? = null
    private var handler: ((PlayerEvent) -> Unit)? = null
    private var startOffsetMillis: Long = 0
    private var kind: MediaPlaybackKind = MediaPlaybackKind.RECORDING
    private val appContext = context.applicationContext

    /**
     * The player a `PlayerView` shows, as state it can follow.
     *
     * The player is created by the first Play, *after* the view exists. Read
     * as a plain property the view was bound once, to null, and never again —
     * a black rectangle with the sermon playing somewhere behind it. Observed,
     * the view is handed the player the moment there is one, and let go of it
     * the moment it is released.
     */
    private val _videoPlayerState = MutableStateFlow<Player?>(null)
    val videoPlayerState: StateFlow<Player?> = _videoPlayerState.asStateFlow()

    override fun setEventHandler(handler: (PlayerEvent) -> Unit) {
        this.handler = handler
    }

    override suspend fun currentPositionMillis(): Long = withContext(Dispatchers.Main) {
        val position = player?.currentPosition ?: 0
        // Reported relative to the start of the trimmed recording, so a resume
        // position means the same thing to a person as it does to the server.
        maxOf(0, position - startOffsetMillis)
    }

    override suspend fun send(command: PlayerCommand): Unit = withContext(Dispatchers.Main) {
        when (command) {
            is PlayerCommand.Load -> load(command.request)
            is PlayerCommand.Play -> player?.let { current ->
                // After an error the player sits idle with its item still set;
                // playing again means loading again, through whatever
                // capability the coordinator has just renewed.
                if (current.playbackState == Player.STATE_IDLE && current.mediaItemCount > 0) current.prepare()
                current.play()
                // No synthetic "playing" here: `onIsPlayingChanged` reports
                // what the player actually does, and a stream that fails to
                // load must not read as playing in the meantime.
            }
            is PlayerCommand.Pause -> player?.pause()
            is PlayerCommand.Seek ->
                player?.seekTo(startOffsetMillis + maxOf(0, command.millis))
            is PlayerCommand.Stop -> release()
            is PlayerCommand.UpdateCapability -> setCapability(command.capability)
        }
    }

    internal fun setCapability(capability: String) {
        headers.set(capability)
        // Media3 copies the map it is given into the factory's shared request
        // properties rather than reading it live, so a renewed capability is
        // handed over again. Every data source the factory created reads those
        // shared properties on its next request — the playlist refresh, the
        // next segment — without the player being rebuilt.
        dataSourceFactory.setDefaultRequestProperties(headers.mutableView())
    }

    /**
     * The player a `PlayerView` renders, or null before anything was loaded.
     *
     * Exposed for the video surface only — and a surface should follow
     * [videoPlayerState] rather than read this once. Commands still go through
     * [send], so nothing a screen does to the view can bypass the coordinator.
     */
    val videoPlayer: Player? get() = player

    /**
     * Releases the player immediately, on the calling (main) thread.
     *
     * Also for the one moment [send] cannot be used: a view model being
     * cleared, whose coroutine scope is already cancelled. Leaving the player
     * alive there would keep a decoder, a network connection and audio focus
     * held for a screen that no longer exists.
     */
    fun release() {
        // The view lets go first, so it never holds a released player.
        _videoPlayerState.value = null
        player?.release()
        player = null
    }

    internal fun currentRequestProperties(): Map<String, String> = headers.snapshot()

    private fun load(request: PlaybackRequest) {
        startOffsetMillis = request.startOffsetMillis
        kind = request.kind
        setCapability(request.capability)

        val instance = player ?: playerFactory(appContext, dataSourceFactory).also { created ->
            created.setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(C.USAGE_MEDIA)
                    .setContentType(C.AUDIO_CONTENT_TYPE_SPEECH)
                    .build(),
                // Media3 handles the focus request itself when this is true;
                // `AudioFocusPolicy` still decides what the *app* does, which is
                // what the tests cover.
                true,
            )
            created.addListener(listener)
            player = created
            _videoPlayerState.value = created
        }

        // **The MIME type is declared, not inferred.**
        //
        // `DefaultMediaSourceFactory` picks an extractor from the URI's path,
        // and the recording delivery route ends in an id rather than a file
        // extension — so without this a progressive MP4 could be handed to the
        // wrong extractor. The server says which form it is serving; the player
        // uses that.
        instance.setMediaItem(
            MediaItem.Builder()
                .setUri(request.url)
                .setMimeType(
                    when (request.renditionKind) {
                        RenditionKind.HLS -> MimeTypes.APPLICATION_M3U8
                        RenditionKind.PROGRESSIVE -> MimeTypes.VIDEO_MP4
                    },
                )
                .build(),
        )
        instance.prepare()

        val seekTo = startOffsetMillis + if (request.kind.isResumable) request.resumeMillis else 0
        if (seekTo > 0) instance.seekTo(seekTo)

        handler?.invoke(PlayerEvent.Buffering)
    }

    private val listener by lazy { buildListener() }

    private fun buildListener() = object : Player.Listener {
        override fun onPlaybackStateChanged(playbackState: Int) {
            when (playbackState) {
                Player.STATE_BUFFERING -> handler?.invoke(PlayerEvent.Buffering)
                Player.STATE_READY -> {
                    val duration = player?.duration
                    handler?.invoke(
                        PlayerEvent.ReadyToPlay(
                            if (duration != null && duration != C.TIME_UNSET) duration else null,
                        ),
                    )
                }
                Player.STATE_ENDED -> handler?.invoke(PlayerEvent.Ended)
                else -> Unit
            }
        }

        /**
         * Playing and paused as the player actually is, not as last commanded.
         * `READY` arrives before `isPlaying` turns true, so a play requested
         * while buffering would otherwise read as paused once the stream is
         * ready — with the sermon audibly playing.
         */
        override fun onIsPlayingChanged(isPlaying: Boolean) {
            handler?.invoke(if (isPlaying) PlayerEvent.Playing else PlayerEvent.Paused)
        }

        override fun onPlayerError(error: PlaybackException) {
            if (error.errorCode == PlaybackException.ERROR_CODE_BEHIND_LIVE_WINDOW) {
                // Fell behind the relay's few-second window — a stall on a slow
                // network, or a phone left paused. Media3's documented recovery
                // is to rejoin at the live edge, not to report a failure.
                player?.let { current ->
                    current.seekToDefaultPosition()
                    current.prepare()
                }
                return
            }
            handler?.invoke(PlayerEvent.Failed(mapPlaybackError(error, kind)))
        }
    }

    companion object {
        /**
         * Extracts the two numbers the decision needs, and nothing else.
         *
         * **No decision lives here.** `PlayerFailureMapping.fromPlayerError` is
         * in `:core:media` and is tested on the JVM; this function's whole job
         * is to pull an error code and, when the failure carried one, an HTTP
         * status out of a Media3 exception.
         *
         * The exception's own message carries a URI, a response body and a
         * cause chain. None of it crosses this boundary.
         */
        fun mapPlaybackError(
            error: PlaybackException,
            kind: MediaPlaybackKind = MediaPlaybackKind.RECORDING,
        ): PlayerFailure {
            val cause = error.cause
            val httpStatus = (cause as? HttpDataSource.InvalidResponseCodeException)?.responseCode
            return PlayerFailureMapping.fromPlayerError(error.errorCode, httpStatus, kind)
        }

    }
}
