package io.faithform.app.ui.media

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.pm.ActivityInfo
import android.content.res.Configuration
import android.view.accessibility.AccessibilityManager
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Fullscreen
import androidx.compose.material.icons.filled.FullscreenExit
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Replay
import androidx.compose.material.icons.outlined.Movie
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import coil.compose.AsyncImage
import io.faithform.app.R
import io.faithform.app.design.FaithFormTokens
import io.faithform.app.design.LocalFaithFormTheme
import io.faithform.app.media.MediaDetailState
import kotlinx.coroutines.delay

/**
 * The building blocks of the Watch experience, matching iOS `MediaStage.swift`:
 * one picture of the service, one way to say "live", one loading state, and
 * one full-screen behaviour. Every media surface draws from these.
 */

// ---------------------------------------------------------------------------
// Thumbnail
// ---------------------------------------------------------------------------

/**
 * A 16:9 picture of the service — the frame FaithForm captured from the stream
 * when there is one, otherwise a quiet branded placeholder.
 *
 * [showsGlyph] is false where a play button or spinner is laid over the
 * centre: the placeholder's own icon would show through behind it.
 */
@Composable
fun StreamThumbnail(url: String?, modifier: Modifier = Modifier, showsGlyph: Boolean = true) {
    val palette = LocalFaithFormTheme.current.palette
    Box(
        modifier = modifier
            .fillMaxWidth()
            .aspectRatio(16f / 9f)
            .background(
                Brush.linearGradient(listOf(palette.brandPrimary, palette.brandPrimary.copy(alpha = 0.78f))),
            )
            .clearAndSetSemantics { },
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier
                .matchParentSize()
                .background(
                    Brush.radialGradient(
                        listOf(palette.brandAccent.copy(alpha = 0.35f), Color.Transparent),
                    ),
                ),
        )
        if (showsGlyph) {
            Icon(
                Icons.Outlined.Movie,
                contentDescription = null,
                tint = Color.White.copy(alpha = 0.22f),
                modifier = Modifier.size(44.dp),
            )
        }
        if (url != null) {
            AsyncImage(
                model = url,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.matchParentSize(),
            )
        }
    }
}

// ---------------------------------------------------------------------------
// Badges, loading, play
// ---------------------------------------------------------------------------

/** "● LIVE" — always the word as well as the colour. */
@Composable
fun LiveBadge(modifier: Modifier = Modifier, compact: Boolean = false) {
    val palette = LocalFaithFormTheme.current.palette
    val description = stringResource(R.string.media_live_now_badge)
    Row(
        modifier = modifier
            .background(palette.live, RoundedCornerShape(6.dp))
            .padding(horizontal = if (compact) 7.dp else 9.dp, vertical = if (compact) 3.dp else 5.dp)
            .clearAndSetSemantics { contentDescription = description },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        Box(Modifier.size(6.dp).background(Color.White, CircleShape))
        Text(
            stringResource(R.string.media_live_short),
            color = Color.White,
            fontSize = if (compact) 11.sp else 12.sp,
            fontWeight = FontWeight.Black,
            letterSpacing = 0.8.sp,
        )
    }
}

/** A plain dark pill label, for "Starting soon" and "Replay available". */
@Composable
fun StateBadge(text: String, modifier: Modifier = Modifier) {
    Text(
        text,
        color = Color.White,
        fontSize = 12.sp,
        fontWeight = FontWeight.Bold,
        modifier = modifier
            .background(Color.Black.copy(alpha = 0.55f), RoundedCornerShape(6.dp))
            .padding(horizontal = 9.dp, vertical = 5.dp),
    )
}

/**
 * The one loading state for video: a spinner in a fixed-size ring, centred on
 * the picture. Never a line of text that reflows the layout around it.
 */
@Composable
fun VideoLoadingRing(modifier: Modifier = Modifier) {
    val description = stringResource(R.string.media_loading_video)
    Box(
        modifier = modifier
            .size(64.dp)
            .background(Color.Black.copy(alpha = 0.45f), CircleShape)
            .semantics {
                contentDescription = description
                liveRegion = LiveRegionMode.Polite
            },
        contentAlignment = Alignment.Center,
    ) {
        CircularProgressIndicator(color = Color.White, strokeWidth = 3.dp, modifier = Modifier.size(34.dp))
    }
}

/** The big round play button laid over a thumbnail. */
@Composable
fun PlayGlyph(modifier: Modifier = Modifier, size: Dp = 64.dp) {
    Box(
        modifier = modifier
            .size(size)
            .background(Color.Black.copy(alpha = 0.42f), CircleShape)
            .border(1.dp, Color.White.copy(alpha = 0.35f), CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            Icons.Filled.PlayArrow,
            contentDescription = null,
            tint = Color.White,
            modifier = Modifier.size(size * 0.55f).offset(x = size * 0.03f),
        )
    }
}

internal fun formatClock(millis: Long): String {
    val total = (millis.coerceAtLeast(0) / 1000).toInt()
    val h = total / 3600
    val m = (total % 3600) / 60
    val s = total % 60
    return if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%d:%02d".format(m, s)
}

// ---------------------------------------------------------------------------
// Full screen
// ---------------------------------------------------------------------------

/** Whether the window is currently wider than it is tall. */
@Composable
fun isLandscape(): Boolean =
    LocalConfiguration.current.orientation == Configuration.ORIENTATION_LANDSCAPE

/**
 * "Full screen" rotates to landscape whatever the phone's auto-rotate says —
 * and "Exit" returns to portrait even while the phone is held sideways.
 * Leaving the screen always hands it back, so nothing else is left sideways.
 */
@Composable
fun rememberFullScreenToggle(): (Boolean) -> Unit {
    val activity = LocalContext.current.findHostActivity()
    DisposableEffect(activity) {
        onDispose {
            if (activity?.isChangingConfigurations != true) {
                activity?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
            }
        }
    }
    return { enter ->
        activity?.requestedOrientation = if (enter) {
            ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        } else {
            ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT
        }
    }
}

/** Hides the system bars while [immersive], the way a video app does. */
@Composable
fun SystemBarsHidden(immersive: Boolean) {
    val view = LocalView.current
    DisposableEffect(view, immersive) {
        val window = view.context.findHostActivity()?.window
        val controller = window?.let { WindowCompat.getInsetsController(it, view) }
        val previousBehavior = controller?.systemBarsBehavior
        if (immersive) {
            controller?.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            controller?.hide(WindowInsetsCompat.Type.systemBars())
        }
        onDispose {
            if (immersive) {
                controller?.show(WindowInsetsCompat.Type.systemBars())
                previousBehavior?.let { controller?.systemBarsBehavior = it }
            }
        }
    }
}

internal tailrec fun Context.findHostActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findHostActivity()
    else -> null
}

/** Keep controls discoverable if TalkBack is switched on while watching. */
@Composable
internal fun touchExplorationEnabled(): Boolean {
    val context = LocalContext.current
    val manager = remember(context) { context.getSystemService(AccessibilityManager::class.java) }
    var enabled by remember(manager) { mutableStateOf(manager?.isTouchExplorationEnabled == true) }
    DisposableEffect(manager) {
        val listener = AccessibilityManager.TouchExplorationStateChangeListener { enabled = it }
        manager?.addTouchExplorationStateChangeListener(listener)
        onDispose { manager?.removeTouchExplorationStateChangeListener(listener) }
    }
    return enabled
}

@Composable
internal fun FullScreenControl(fullScreen: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
    IconButton(onClick = onClick, modifier = modifier) {
        Icon(
            if (fullScreen) Icons.Filled.FullscreenExit else Icons.Filled.Fullscreen,
            contentDescription = stringResource(if (fullScreen) R.string.media_exit_full_screen else R.string.media_full_screen),
            tint = Color.White,
        )
    }
}

// ---------------------------------------------------------------------------
// Video surface
// ---------------------------------------------------------------------------

@androidx.annotation.OptIn(UnstableApi::class)
@Composable
fun VideoSurface(player: Player?, modifier: Modifier = Modifier) {
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
        update = { view -> view.player = player },
        onRelease = { view -> view.player = null },
        modifier = modifier,
    )
}

// ---------------------------------------------------------------------------
// Replay stage
// ---------------------------------------------------------------------------

/**
 * A past service's player: the picture and everything laid over it — the
 * thumbnail with a play button before the first tap, a centred spinner while
 * loading, and controls that fade while playing: play/pause, fifteen seconds
 * back and forward, a scrubber with times, and full screen.
 */
@Composable
fun RecordingStage(
    state: MediaDetailState,
    player: Player?,
    isFullScreen: Boolean,
    onPlay: () -> Unit,
    onPause: () -> Unit,
    onSeek: (Long) -> Unit,
    onToggleFullScreen: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val palette = LocalFaithFormTheme.current.palette
    val detail = state.detail
    val offsetMillis = (detail?.startOffsetSeconds ?: 0) * 1000L
    val knownMillis = detail?.durationSeconds?.takeIf { it > 0 }?.let { it * 1000L }
    val touchExploring = touchExplorationEnabled()

    var position by remember { mutableLongStateOf(0L) }
    var length by remember { mutableLongStateOf(0L) }
    var scrub by remember { mutableStateOf<Float?>(null) }
    var controlsShown by remember { mutableStateOf(true) }

    // Observes only; every command goes through the model and coordinator.
    LaunchedEffect(player, offsetMillis, knownMillis) {
        length = knownMillis ?: 0L
        while (true) {
            player?.let {
                position = (it.currentPosition - offsetMillis).coerceAtLeast(0)
                val raw = it.duration
                length = knownMillis ?: if (raw > 0) (raw - offsetMillis).coerceAtLeast(0) else 0
            }
            delay(250)
        }
    }

    val started = state.isPlaying || state.isBuffering || state.playback is io.faithform.app.media.PlaybackSessionState.Paused
    val showsPoster = !started || (state.isBuffering && position == 0L)
    val chromeVisible = started && !state.isBuffering && (controlsShown || touchExploring || scrub != null || !state.isPlaying)

    LaunchedEffect(state.isPlaying, controlsShown, touchExploring, scrub) {
        if (state.isPlaying && controlsShown && !touchExploring && scrub == null) {
            delay(3_000)
            controlsShown = false
        }
    }

    Box(
        modifier = modifier
            .background(Color.Black)
            .pointerInput(started) { detectTapGestures(onTap = { if (started) controlsShown = !controlsShown }) },
        contentAlignment = Alignment.Center,
    ) {
        VideoSurface(player = player, modifier = Modifier.fillMaxSize())

        if (showsPoster) {
            StreamThumbnail(url = detail?.posterUrl, modifier = Modifier.fillMaxSize(), showsGlyph = false)
            Box(Modifier.matchParentSize().background(Color.Black.copy(alpha = 0.18f)))
        }

        when {
            state.failure != null || state.isOffline || state.isUnavailable -> Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.md),
                modifier = Modifier
                    .widthIn(max = 360.dp)
                    .padding(FaithFormTokens.Spacing.lg)
                    .semantics { liveRegion = LiveRegionMode.Assertive },
            ) {
                Text(
                    stringResource(when {
                        state.isUnavailable -> R.string.media_unavailable_title
                        state.isOffline -> R.string.media_offline_title
                        else -> failureMessage(state.failure!!)
                    }),
                    color = Color.White,
                    textAlign = TextAlign.Center,
                )
                TextButton(
                    onClick = onPlay,
                    modifier = Modifier.background(Color.White, RoundedCornerShape(50)),
                ) {
                    Icon(Icons.Filled.Refresh, contentDescription = null, tint = Color.Black)
                    Spacer(Modifier.size(6.dp))
                    Text(stringResource(R.string.media_retry), color = Color.Black, fontWeight = FontWeight.SemiBold)
                }
            }

            state.isBuffering || detail == null -> VideoLoadingRing()

            !started -> {
                val label = stringResource(R.string.media_play_service)
                IconButton(
                    onClick = onPlay,
                    modifier = Modifier.size(if (isFullScreen) 84.dp else 72.dp).semantics { contentDescription = label },
                ) {
                    PlayGlyph(size = if (isFullScreen) 80.dp else 68.dp)
                }
            }
        }

        if (!started || state.isBuffering) {
            FullScreenControl(
                fullScreen = isFullScreen,
                onClick = onToggleFullScreen,
                modifier = Modifier.align(Alignment.BottomEnd)
                    .then(if (isFullScreen) Modifier.safeDrawingPadding() else Modifier),
            )
        }

        AnimatedVisibility(
            visible = chromeVisible,
            enter = fadeIn(),
            exit = fadeOut(),
            modifier = Modifier.matchParentSize(),
        ) {
            Box(Modifier.fillMaxSize().then(if (isFullScreen) Modifier.safeDrawingPadding() else Modifier)) {
                Box(
                    Modifier
                        .matchParentSize()
                        .background(
                            Brush.verticalGradient(
                                0f to Color.Black.copy(alpha = 0.15f),
                                0.6f to Color.Transparent,
                                1f to Color.Black.copy(alpha = 0.7f),
                            ),
                        ),
                )
                Row(
                    modifier = Modifier.align(Alignment.Center),
                    horizontalArrangement = Arrangement.spacedBy(if (isFullScreen) 56.dp else 36.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    SkipButton(back = true) { onSeek((position - 15_000).coerceAtLeast(0)) }
                    RoundControl(
                        size = if (isFullScreen) 76.dp else 64.dp,
                        label = stringResource(if (state.isPlaying) R.string.media_pause else R.string.media_play),
                        onClick = if (state.isPlaying) onPause else onPlay,
                    ) {
                        Icon(
                            if (state.isPlaying) Icons.Filled.Pause else Icons.Filled.PlayArrow,
                            contentDescription = null,
                            tint = Color.White,
                            modifier = Modifier.size(34.dp),
                        )
                    }
                    SkipButton(back = false) {
                        onSeek(if (length > 0) (position + 15_000).coerceAtMost(length) else position + 15_000)
                    }
                }

                Column(
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .fillMaxWidth()
                        .padding(
                            horizontal = if (isFullScreen) FaithFormTokens.Spacing.xl else FaithFormTokens.Spacing.md,
                            vertical = if (isFullScreen) FaithFormTokens.Spacing.base else 0.dp,
                        ),
                ) {
                    val positionLabel = stringResource(R.string.media_playback_position)
                    val sliderValue = scrub ?: position.toFloat()
                    Slider(
                        value = sliderValue.coerceIn(0f, maxOf(length.toFloat(), 1f)),
                        onValueChange = { controlsShown = true; scrub = it },
                        onValueChangeFinished = {
                            scrub?.let { onSeek(it.toLong()) }
                            scrub = null
                        },
                        valueRange = 0f..maxOf(length.toFloat(), 1f),
                        enabled = length > 0,
                        colors = SliderDefaults.colors(
                            thumbColor = palette.brandAccent,
                            activeTrackColor = palette.brandAccent,
                            inactiveTrackColor = Color.White.copy(alpha = 0.3f),
                        ),
                        modifier = Modifier
                            .fillMaxWidth()
                            .scale(scaleX = 1f, scaleY = 0.85f)
                            .semantics {
                                contentDescription = positionLabel
                                stateDescription = "${formatClock(position)} / ${formatClock(length)}"
                            },
                    )
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            "${formatClock(scrub?.toLong() ?: position)} / ${formatClock(length)}",
                            color = Color.White,
                            fontSize = 13.sp,
                            fontWeight = FontWeight.SemiBold,
                            fontFamily = FontFamily.Monospace,
                        )
                        Spacer(Modifier.weight(1f))
                        FullScreenControl(fullScreen = isFullScreen, onClick = onToggleFullScreen)
                    }
                }
            }
        }
    }
}

@Composable
internal fun RoundControl(
    size: Dp,
    label: String,
    onClick: () -> Unit,
    content: @Composable BoxScope.() -> Unit,
) {
    IconButton(
        onClick = onClick,
        modifier = Modifier
            .size(size)
            .clip(CircleShape)
            .background(Color.Black.copy(alpha = 0.38f), CircleShape)
            .semantics { contentDescription = label },
    ) {
        Box(contentAlignment = Alignment.Center, content = content)
    }
}

@Composable
private fun SkipButton(back: Boolean, onClick: () -> Unit) {
    RoundControl(
        size = 48.dp,
        label = stringResource(if (back) R.string.media_skip_back else R.string.media_skip_forward),
        onClick = onClick,
    ) {
        Icon(
            Icons.Filled.Replay,
            contentDescription = null,
            tint = Color.White,
            modifier = Modifier
                .size(30.dp)
                .scale(scaleX = if (back) 1f else -1f, scaleY = 1f),
        )
        Text("15", color = Color.White, fontSize = 9.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 2.dp))
    }
}
