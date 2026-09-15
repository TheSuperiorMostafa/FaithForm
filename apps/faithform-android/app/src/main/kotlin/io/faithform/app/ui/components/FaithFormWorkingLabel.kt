package io.faithform.app.ui.components

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import io.faithform.app.ui.brand.rememberReducedMotion

/**
 * Button and status copy that is still working, without a spinner.
 *
 * The label stays so the layout does not jump. A shallow pulse says the app
 * is busy; reduced motion keeps it still.
 */
@Composable
fun FaithFormWorkingLabel(
    text: String,
    working: Boolean,
    modifier: Modifier = Modifier,
    color: Color = LocalContentColor.current,
    style: TextStyle? = null,
) {
    val reduceMotion = rememberReducedMotion()
    val alpha = if (working && !reduceMotion) {
        val transition = rememberInfiniteTransition(label = "working-pulse")
        val animated by transition.animateFloat(
            initialValue = 0.55f,
            targetValue = 1f,
            animationSpec = infiniteRepeatable(
                animation = tween(900),
                repeatMode = RepeatMode.Reverse,
            ),
            label = "working-pulse-alpha",
        )
        animated
    } else {
        1f
    }
    Text(
        text = text,
        color = color,
        style = style ?: androidx.compose.material3.LocalTextStyle.current,
        modifier = modifier.alpha(alpha),
    )
}
