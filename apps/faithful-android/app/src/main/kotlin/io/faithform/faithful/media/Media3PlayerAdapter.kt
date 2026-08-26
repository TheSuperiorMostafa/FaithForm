package io.faithform.faithful.media

import android.content.Context
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.HttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * The only file in Faithful that touches Media3.
 *
 * **It contains no decisions.** When to refresh a capability, what a failure
 * means to a person, whether a position is worth remembering, what happens on a
 * revocation — all of that lives in `:core:media`, which is pure JVM and fully
 * tested. This file translates.
 *
 * ## Why a data source and not a signed URL
 *
 * `DefaultHttpDataSource.Factory.setDefaultRequestProperties` attaches headers
 * to **every** request the player makes — the playlist, each segment, each byte
 * range. So the capability travels in an `Authorization` header and never in a
 * URL, a browser history, a proxy log, or a screenshot.
 *
 * The properties map is mutable and swapped in place by
 * [PlayerCommand.UpdateCapability], which is what lets a refresh land without
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
class Media3PlayerAdapter(
    context: Context,
    private val playerFactory: (Context) -> ExoPlayer = { ctx ->
        ExoPlayer.Builder(ctx)
            .setMediaSourceFactory(DefaultMediaSourceFactory(ctx))
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
     * Nothing about Faithful needs a Media3 object to exist until something is
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
    private val appContext = context.applicationContext

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
            is PlayerCommand.Play -> {
                player?.play()
                handler?.invoke(PlayerEvent.Playing)
            }
            is PlayerCommand.Pause -> {
                player?.pause()
                handler?.invoke(PlayerEvent.Paused)
            }
            is PlayerCommand.Seek ->
                player?.seekTo(startOffsetMillis + maxOf(0, command.millis))
            is PlayerCommand.Stop -> {
                player?.release()
                player = null
            }
            is PlayerCommand.UpdateCapability -> setCapability(command.capability)
        }
    }

    internal fun setCapability(capability: String) = headers.set(capability)

    internal fun currentRequestProperties(): Map<String, String> = headers.snapshot()

    private fun load(request: PlaybackRequest) {
        startOffsetMillis = request.startOffsetMillis
        setCapability(request.capability)

        val instance = player ?: playerFactory(appContext).also { created ->
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

        override fun onPlayerError(error: PlaybackException) {
            handler?.invoke(PlayerEvent.Failed(mapPlaybackError(error)))
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
        fun mapPlaybackError(error: PlaybackException): PlayerFailure {
            val cause = error.cause
            val httpStatus = (cause as? HttpDataSource.InvalidResponseCodeException)?.responseCode
            return PlayerFailureMapping.fromPlayerError(error.errorCode, httpStatus)
        }

    }
}
