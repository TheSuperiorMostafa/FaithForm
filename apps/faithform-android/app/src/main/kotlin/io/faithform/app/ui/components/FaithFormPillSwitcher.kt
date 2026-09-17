package io.faithform.app.ui.components

import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.faithform.app.design.FaithFormTokens
import io.faithform.app.design.LocalFaithFormTheme

data class FaithFormPillOption<T>(val value: T, val label: String)

/**
 * Branded, animated switcher shared by Home and Services.
 *
 * Unlike Material's outlined segmented button, this reads as one calm surface
 * with a clear sliding selection. Every choice is still a semantic tab and a
 * 48dp touch target, and reduced-motion preferences shorten the movement.
 */
@Composable
fun <T> FaithFormPillSwitcher(
    options: List<FaithFormPillOption<T>>,
    selected: T,
    onSelect: (T) -> Unit,
    modifier: Modifier = Modifier,
) {
    if (options.isEmpty()) return

    val theme = LocalFaithFormTheme.current
    val selectedIndex = options.indexOfFirst { it.value == selected }.coerceAtLeast(0)

    BoxWithConstraints(
        modifier = modifier
            .height(56.dp)
            .background(theme.palette.surfaceSunken, CircleShape)
            .border(theme.borderWidth, theme.palette.border, CircleShape)
            .padding(FaithFormTokens.Spacing.xs),
    ) {
        val segmentWidth = maxWidth / options.size
        val indicatorOffset by animateDpAsState(
            targetValue = segmentWidth * selectedIndex,
            animationSpec = tween(
                durationMillis = theme.durationMillis(FaithFormTokens.Motion.STANDARD_MS),
            ),
            label = "FaithForm pill selection",
        )

        Box(
            modifier = Modifier
                .offset(x = indicatorOffset)
                .width(segmentWidth)
                .fillMaxHeight()
                .shadow(
                    elevation = if (theme.increaseContrast) 0.dp else 3.dp,
                    shape = CircleShape,
                    clip = false,
                )
                .background(theme.palette.brandAccent, CircleShape),
        )

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .fillMaxHeight()
                .selectableGroup(),
        ) {
            options.forEach { option ->
                val isSelected = option.value == selected
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .fillMaxHeight()
                        .selectable(
                            selected = isSelected,
                            onClick = { onSelect(option.value) },
                            role = Role.Tab,
                        )
                        .padding(horizontal = FaithFormTokens.Spacing.sm),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        text = option.label,
                        color = if (isSelected) {
                            theme.palette.contentOnAccent
                        } else {
                            theme.palette.contentSecondary
                        },
                        fontSize = FaithFormTokens.Text.label.size,
                        fontWeight = FaithFormTokens.Text.label.weight,
                        letterSpacing = FaithFormTokens.Text.label.trackingSp.sp,
                        maxLines = 1,
                        textAlign = TextAlign.Center,
                    )
                }
            }
        }
    }
}
