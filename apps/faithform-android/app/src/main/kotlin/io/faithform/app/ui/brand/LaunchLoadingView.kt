package io.faithform.app.ui.brand

import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.unit.dp
import io.faithform.app.R
import io.faithform.app.design.FaithFormTokens
import io.faithform.app.design.LocalFaithFormTheme
import io.faithform.app.ui.components.FaithFormWorkingLabel
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
 * ## After the hand-over
 *
 * The system splash is mark-only — Android's splash API cannot draw a wordmark,
 * so neither platform does. Once this view owns the frame the mark settles, the
 * name fades in under it, and a working label appears only if the load is still
 * going after a beat. Nothing loops. Reduce Motion and Increase Contrast keep
 * the lockup still and drop the decorative glow. Returning visits restore the
 * last shell from disk and skip this view entirely.
 *
 * Mirrors the iPhone's `LaunchLoadingView`.
 */
@Composable
fun LaunchLoadingView() {
    val theme = LocalFaithFormTheme.current
    val reduceMotion = rememberReducedMotion()
    val label = stringResource(R.string.loading_account)
    val name = stringResource(R.string.app_name)

    var settled by remember { mutableStateOf(reduceMotion) }
    var showWordmark by remember { mutableStateOf(reduceMotion) }
    var showWorking by remember { mutableStateOf(false) }

    val scale by animateFloatAsState(
        targetValue = if (settled) 1f else LaunchLoading.SETTLE_SCALE,
        animationSpec = tween(
            durationMillis = if (reduceMotion) 0 else FaithFormTokens.Motion.DELIBERATE_MS,
            easing = FastOutSlowInEasing,
        ),
        label = "launch-settle",
    )
    val wordmarkAlpha by animateFloatAsState(
        targetValue = if (showWordmark) 1f else 0f,
        animationSpec = tween(
            durationMillis = if (reduceMotion) 0 else FaithFormTokens.Motion.SLOW_MS,
        ),
        label = "launch-wordmark",
    )

    LaunchedEffect(reduceMotion) {
        if (!reduceMotion) {
            settled = true
            delay(FaithFormTokens.Motion.FAST_MS.toLong())
            showWordmark = true
        }
        delay(LaunchLoading.WORKING_DELAY_MS.toLong())
        showWorking = true
    }

    Box(
        contentAlignment = Alignment.Center,
        modifier = Modifier
            .fillMaxSize()
            .background(theme.palette.background)
            .clearAndSetSemantics { contentDescription = label }
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.lg),
        ) {
            Box(contentAlignment = Alignment.Center) {
                if (!theme.increaseContrast && !reduceMotion) {
                    Box(
                        Modifier
                            .size(LaunchLoading.GLOW_SIZE)
                            .background(
                                Brush.radialGradient(
                                    colors = listOf(
                                        theme.palette.brandAccent.copy(alpha = 0.18f),
                                        Color.Transparent,
                                    )
                                )
                            )
                    )
                }
                FaithFormMark(
                    Modifier
                        .height(LaunchLoading.MARK_HEIGHT)
                        .graphicsLayer {
                            scaleX = scale
                            scaleY = scale
                        }
                )
            }

            Text(
                name,
                style = MaterialTheme.typography.titleLarge,
                color = theme.palette.contentPrimary,
                modifier = Modifier.graphicsLayer { alpha = wordmarkAlpha },
            )

            if (showWorking) {
                FaithFormWorkingLabel(
                    text = label,
                    working = true,
                    color = theme.mutedContent,
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
        }
    }
}

internal object LaunchLoading {
    /** Matches `ic_launch_mark` as the system draws it. Change one, change both. */
    val MARK_HEIGHT = 96.dp
    val GLOW_SIZE = 180.dp
    const val SETTLE_SCALE = 0.94f
    /** Brand dwell for a cold signed-in load with no snapshot. Reduce Motion skips it. */
    const val DWELL_MS = 700
    const val WORKING_DELAY_MS = 900
}
