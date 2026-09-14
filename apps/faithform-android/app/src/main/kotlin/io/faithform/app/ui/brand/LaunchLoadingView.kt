package io.faithform.app.ui.brand

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.unit.dp
import io.faithform.app.R
import io.faithform.app.design.FaithFormTokens
import io.faithform.app.design.LocalFaithFormTheme
import kotlinx.coroutines.delay

/**
 * What stands on screen while the account loads.
 *
 * ## A continuation of the launch screen, not a new screen
 *
 * The system splash (`Theme.FaithForm.Starting`) draws the page colour with
 * `ic_launch_mark` centred at 96dp. This view draws the same ground and the same
 * mark at the same height, centred on the whole window rather than inside the
 * system bars, so the moment the splash hands over to the first frame nothing
 * moves. The large spinner it replaces arrived after the splash on its own,
 * which made launch look like two loading screens in a row.
 *
 * ## Why no spinner at first
 *
 * Most loads finish in well under a second, and a spinner that flashes for a
 * fraction of one reads as a glitch. The mark breathes instead; only a load that
 * is genuinely slow earns a small indicator beneath it, so a person on poor
 * signal can still tell the app has not frozen.
 *
 * Mirrors the iPhone's `LaunchLoadingView`.
 */
@Composable
fun LaunchLoadingView() {
    val theme = LocalFaithFormTheme.current
    val reduceMotion = rememberReducedMotion()
    val label = stringResource(R.string.loading_account)

    var showsIndicator by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        delay(LaunchLoading.INDICATOR_DELAY_MS)
        showsIndicator = true
    }

    // A slow, shallow pulse. Reduced motion keeps the mark still — no
    // transition runs at all — and the indicator below still says the app is
    // working.
    val breathing = if (reduceMotion) null else {
        rememberInfiniteTransition(label = "launch-breathing").animateFloat(
            initialValue = 1f,
            targetValue = LaunchLoading.BREATH_LOW_ALPHA,
            animationSpec = infiniteRepeatable(
                tween(LaunchLoading.BREATH_MS, easing = FastOutSlowInEasing),
                RepeatMode.Reverse
            ),
            label = "launch-breathing-alpha"
        )
    }

    Box(
        contentAlignment = Alignment.Center,
        modifier = Modifier
            .fillMaxSize()
            .background(theme.palette.background)
            .clearAndSetSemantics { contentDescription = label }
    ) {
        FaithFormMark(
            Modifier
                .height(LaunchLoading.MARK_HEIGHT)
                // Read in the layer, so each frame of the pulse redraws
                // without recomposing.
                .graphicsLayer { alpha = breathing?.value ?: 1f }
        )

        AnimatedVisibility(
            visible = showsIndicator,
            enter = fadeIn(tween(theme.durationMillis(FaithFormTokens.Motion.STANDARD_MS))),
            modifier = Modifier.offset(y = LaunchLoading.MARK_HEIGHT / 2 + FaithFormTokens.Spacing.xl)
        ) {
            CircularProgressIndicator(
                color = theme.mutedContent,
                strokeWidth = 2.dp,
                modifier = Modifier.size(FaithFormTokens.IconSize.sizeMedium)
            )
        }
    }
}

internal object LaunchLoading {
    /** Matches `ic_launch_mark` as the system draws it. Change one, change both. */
    val MARK_HEIGHT = 96.dp
    const val INDICATOR_DELAY_MS = 1_200L
    const val BREATH_MS = 1_100
    const val BREATH_LOW_ALPHA = 0.72f
}
