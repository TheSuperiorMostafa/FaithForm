package io.faithform.app.ui.media

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.view.accessibility.AccessibilityManager
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.media3.common.util.UnstableApi
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import io.faithform.app.R
import io.faithform.app.WatchingLive
import io.faithform.app.design.FaithFormTokens
import io.faithform.app.media.LiveAvailability
import io.faithform.app.media.LivePlayerModel
import io.faithform.app.media.Media3PlayerAdapter
import io.faithform.app.media.MediaArchiveCard
import io.faithform.app.media.MediaClient
import io.faithform.app.media.MediaDetailModel
import io.faithform.app.media.MediaPlaybackCoordinator
import io.faithform.app.media.MediaPlaybackKind
import io.faithform.app.media.ResumePositionStore
import io.faithform.app.storage.CachePartition
import io.faithform.app.ui.host.rememberSessionModel
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * A live service, full screen, playing — matching iOS `LivePlayerView`.
 *
 * What "Watch live" opens, from Home or from Watch, drawn over the tabs by
 * `SignedInHost`. The picture fills the screen, letterboxed rather than cropped
 * (a slide with its edges cut off is a slide nobody can read), the system bars
 * step aside, and it follows the phone into landscape. Playback starts without
 * a second tap; [LivePlayerModel] owns that and every reconnection.
 *
 * Controls fade out while the service plays and come back on a tap. They stay
 * put while TalkBack is exploring, where a control that hides itself is a
 * control that cannot be found.
 */
@Composable
fun LivePlayerScreen(
    watching: WatchingLive,
    client: MediaClient,
    resumePositions: ResumePositionStore,
    partition: CachePartition,
    onClose: () -> Unit,
) {
    val appContext = LocalContext.current.applicationContext
    val activity = LocalContext.current.findActivity()
    val card = watching.card

    // One session per tap on "Watch live", kept across rotation.
    val holder = rememberSessionModel(
        key = "live-player|${partition.storageKey}|${watching.presentationId}",
        release = { session: LiveSession -> session.release() },
    ) {
        LiveSession.create(appContext, client, resumePositions, partition, watching)
    }
    val session = holder.value
    val model = session.model

    LaunchedEffect(holder) { holder.launchOnce("start") { model.start() } }

    // Leaving stops the stream — unless "leaving" is only the window being
    // rebuilt for a rotation, which must not interrupt the service.
    DisposableEffect(holder) {
        onDispose {
            if (activity?.isChangingConfigurations != true) holder.launch { model.stop() }
        }
    }
    LifecycleEventEffect(Lifecycle.Event.ON_STOP) {
        if (activity?.isChangingConfigurations != true) holder.launch { model.enterBackground() }
    }
    LifecycleEventEffect(Lifecycle.Event.ON_START) { holder.launch { model.enterForeground() } }

    BackHandler(onBack = onClose)
    ImmersiveWhileShown()

    val phase by model.phase.collectAsStateWithLifecycle()
    val player by session.adapter.videoPlayerState.collectAsStateWithLifecycle()
    val touchExploring = remember(appContext) {
        appContext.getSystemService(AccessibilityManager::class.java)?.isTouchExplorationEnabled == true
    }

    var controlsShown by rememberSaveable { mutableStateOf(true) }
    val showsControls = controlsShown || touchExploring || phase != LivePlayerModel.Phase.PLAYING
    LaunchedEffect(phase, controlsShown) {
        if (phase == LivePlayerModel.Phase.PLAYING && controlsShown) {
            delay(3_000)
            controlsShown = false
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black)
            // A tap on the picture shows or hides the controls. Not a click
            // target: to TalkBack the picture is not a button, the controls are.
            .pointerInput(Unit) { detectTapGestures(onTap = { controlsShown = !controlsShown }) },
    ) {
        VideoSurface(player = player, modifier = Modifier.fillMaxSize())

        LiveStatus(
            phase = phase,
            onRetry = { holder.launch { model.retry() } },
            onClose = onClose,
            modifier = Modifier.align(Alignment.Center),
        )

        AnimatedVisibility(
            visible = showsControls,
            enter = fadeIn(),
            exit = fadeOut(),
            modifier = Modifier.fillMaxSize(),
        ) {
            LiveControls(
                title = card.title,
                phase = phase,
                onClose = onClose,
                onPause = { holder.launch { model.pause() } },
                onResume = { holder.launch { model.resume() } },
            )
        }
    }
}

/**
 * Everything one full-screen viewing holds, released together.
 *
 * Its own scope rather than the session model's, because the model has to be
 * built before the session model that will own it exists. Main-thread, like
 * every other Watch model, so player events and commands never race.
 */
internal class LiveSession private constructor(
    val adapter: Media3PlayerAdapter,
    val model: LivePlayerModel,
    private val scope: CoroutineScope,
) {
    fun release() {
        scope.cancel()
        adapter.release()
    }

    companion object {
        fun create(
            context: Context,
            client: MediaClient,
            resumePositions: ResumePositionStore,
            partition: CachePartition,
            watching: WatchingLive,
        ): LiveSession {
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
            val adapter = Media3PlayerAdapter(context)
            val card = watching.card
            val detail = MediaDetailModel(
                client = client,
                coordinator = MediaPlaybackCoordinator(client, adapter, resumePositions),
                churchSlug = watching.churchSlug,
                mediaId = card.mediaId,
                kind = MediaPlaybackKind.LIVE,
                partition = partition,
                knownCard = MediaArchiveCard(
                    card.mediaId, card.title, null, card.startsAt, null, card.posterUrl, null,
                    emptyList(), card.churchTimezone,
                ),
            )
            val model = LivePlayerModel(
                detail = detail,
                availability = {
                    // The same projection Home and Watch draw from, so "has it
                    // ended" here and the hero disappearing there agree.
                    try {
                        val live = client.live(watching.churchSlug, partition).live
                        if (live != null && live.mediaId == card.mediaId && live.state == "live") {
                            LiveAvailability.LIVE
                        } else {
                            LiveAvailability.ENDED
                        }
                    } catch (cancelled: CancellationException) {
                        throw cancelled
                    } catch (_: Exception) {
                        LiveAvailability.UNKNOWN
                    }
                },
                scope = scope,
            )
            adapter.setEventHandler { event -> scope.launch { model.handle(event) } }
            return LiveSession(adapter, model, scope)
        }
    }
}

@androidx.annotation.OptIn(UnstableApi::class)
@Composable
private fun VideoSurface(player: androidx.media3.common.Player?, modifier: Modifier) {
    AndroidView(
        factory = { context ->
            PlayerView(context).apply {
                useController = false
                resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
                setShutterBackgroundColor(android.graphics.Color.BLACK)
                setKeepContentOnPlayerReset(true)
                // A service is watched, not glanced at: the screen stays on.
                keepScreenOn = true
                importantForAccessibility = android.view.View.IMPORTANT_FOR_ACCESSIBILITY_NO
            }
        },
        // Re-run whenever the player changes: created by the first play,
        // replaced after a release, gone when the screen closes.
        update = { view -> view.player = player },
        onRelease = { view -> view.player = null },
        modifier = modifier,
    )
}

@Composable
private fun LiveStatus(
    phase: LivePlayerModel.Phase,
    onRetry: () -> Unit,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
) {
    when (phase) {
        LivePlayerModel.Phase.CONNECTING, LivePlayerModel.Phase.RECONNECTING -> {
            val text = stringResource(
                if (phase == LivePlayerModel.Phase.CONNECTING) {
                    R.string.media_live_connecting
                } else {
                    R.string.media_live_reconnecting
                },
            )
            Column(
                modifier = modifier
                    .padding(FaithFormTokens.Spacing.lg)
                    .semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite },
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.md),
            ) {
                CircularProgressIndicator(color = Color.White)
                Text(text, color = Color.White.copy(alpha = 0.9f), textAlign = TextAlign.Center)
            }
        }

        LivePlayerModel.Phase.ENDED -> LiveMessage(
            title = stringResource(R.string.media_live_ended),
            body = stringResource(R.string.media_live_ended_body),
            onRetry = null,
            onClose = onClose,
            modifier = modifier,
        )
        LivePlayerModel.Phase.UNAVAILABLE -> LiveMessage(
            title = stringResource(R.string.media_live_unavailable),
            body = null,
            onRetry = onRetry,
            onClose = onClose,
            modifier = modifier,
        )
        LivePlayerModel.Phase.FAILED -> LiveMessage(
            title = stringResource(R.string.media_live_failed),
            body = null,
            onRetry = onRetry,
            onClose = onClose,
            modifier = modifier,
        )

        LivePlayerModel.Phase.PLAYING, LivePlayerModel.Phase.PAUSED -> Unit
    }
}

@Composable
private fun LiveMessage(
    title: String,
    body: String?,
    onRetry: (() -> Unit)?,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .widthIn(max = 420.dp)
            .padding(FaithFormTokens.Spacing.xl)
            // Announced as soon as it appears: someone whose service just
            // stopped is not looking at the screen.
            .semantics { liveRegion = LiveRegionMode.Assertive },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.md),
    ) {
        Text(
            title,
            style = MaterialTheme.typography.titleMedium,
            color = Color.White,
            textAlign = TextAlign.Center,
        )
        if (body != null) {
            Text(
                body,
                style = MaterialTheme.typography.bodyMedium,
                color = Color.White.copy(alpha = 0.8f),
                textAlign = TextAlign.Center,
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.md)) {
            if (onRetry != null) {
                Button(onClick = onRetry) { Text(stringResource(R.string.media_retry)) }
            }
            OutlinedButton(onClick = onClose) {
                Text(stringResource(R.string.media_close_player), color = Color.White)
            }
        }
    }
}

@Composable
private fun LiveControls(
    title: String,
    phase: LivePlayerModel.Phase,
    onClose: () -> Unit,
    onPause: () -> Unit,
    onResume: () -> Unit,
) {
    val liveBadge = stringResource(R.string.media_live_now_badge)
    Box(
        Modifier
            .fillMaxSize()
            .background(
                Brush.verticalGradient(
                    0f to Color.Black.copy(alpha = 0.55f),
                    0.3f to Color.Transparent,
                    0.8f to Color.Transparent,
                    1f to Color.Black.copy(alpha = 0.35f),
                ),
            )
            .safeDrawingPadding(),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = FaithFormTokens.Spacing.md, vertical = FaithFormTokens.Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.md),
        ) {
            IconButton(
                onClick = onClose,
                modifier = Modifier.background(Color.Black.copy(alpha = 0.45f), CircleShape),
            ) {
                Icon(
                    Icons.Filled.Close,
                    contentDescription = stringResource(R.string.media_close_player),
                    tint = Color.White,
                )
            }
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.sm),
                modifier = Modifier
                    .background(Color.Black.copy(alpha = 0.45f), RoundedCornerShape(50))
                    .padding(horizontal = FaithFormTokens.Spacing.sm, vertical = FaithFormTokens.Spacing.xs)
                    .clearAndSetSemantics { contentDescription = liveBadge },
            ) {
                Box(Modifier.size(8.dp).background(Color.Red, CircleShape))
                Text(liveBadge, style = MaterialTheme.typography.labelMedium, color = Color.White)
            }
            Text(
                title,
                style = MaterialTheme.typography.titleMedium,
                color = Color.White,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            Spacer(Modifier.size(FaithFormTokens.Spacing.sm))
        }

        if (phase == LivePlayerModel.Phase.PLAYING || phase == LivePlayerModel.Phase.PAUSED) {
            val playing = phase == LivePlayerModel.Phase.PLAYING
            IconButton(
                onClick = if (playing) onPause else onResume,
                modifier = Modifier
                    .align(Alignment.Center)
                    .size(72.dp)
                    .background(Color.Black.copy(alpha = 0.45f), CircleShape),
            ) {
                Icon(
                    if (playing) Icons.Filled.Pause else Icons.Filled.PlayArrow,
                    contentDescription = stringResource(if (playing) R.string.media_pause else R.string.media_play),
                    tint = Color.White,
                    modifier = Modifier.size(36.dp),
                )
            }
        }
    }
}

/**
 * Hides the status and navigation bars while the player is up, and brings
 * them back when it closes. A swipe from the edge shows them for a moment,
 * as it does in every video app.
 */
@Composable
private fun ImmersiveWhileShown() {
    val view = LocalView.current
    DisposableEffect(view) {
        val window = view.context.findActivity()?.window
        val controller = window?.let { WindowCompat.getInsetsController(it, view) }
        controller?.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        controller?.hide(WindowInsetsCompat.Type.systemBars())
        onDispose { controller?.show(WindowInsetsCompat.Type.systemBars()) }
    }
}

private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}
