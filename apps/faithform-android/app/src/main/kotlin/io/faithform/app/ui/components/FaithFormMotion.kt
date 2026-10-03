package io.faithform.app.ui.components

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.dp
import io.faithform.app.design.FaithFormTokens
import io.faithform.app.ui.brand.rememberReducedMotion

/** Draw-only motion: retains one screen, its model, scroll position and touch geometry. */
@Composable
internal fun Modifier.motionReveal(key: Any?, travel: Boolean = true): Modifier {
    val reduced = rememberReducedMotion()
    val progress = remember { Animatable(1f) }
    LaunchedEffect(key, reduced) {
        if (reduced) progress.snapTo(1f)
        else {
            progress.snapTo(0f)
            progress.animateTo(1f, tween(FaithFormTokens.Motion.STANDARD_MS, easing = FastOutSlowInEasing))
        }
    }
    return graphicsLayer {
        // Keep content legible immediately; settle it rather than introduce a blank frame.
        alpha = 0.6f + progress.value * 0.4f
        translationY = if (travel) (1f - progress.value) * 8.dp.toPx() else 0f
    }
}

@Composable
internal fun Modifier.motionPress(source: MutableInteractionSource, enabled: Boolean = true, amount: Float = 0.97f): Modifier {
    val reduced = rememberReducedMotion()
    val pressed by source.collectIsPressedAsState()
    val scale by animateFloatAsState(
        if (pressed && enabled && !reduced) amount else 1f,
        animationSpec = if (reduced) tween(0) else spring(dampingRatio = 0.85f, stiffness = 700f),
        label = "FaithForm press",
    )
    return graphicsLayer { scaleX = scale; scaleY = scale }
}
