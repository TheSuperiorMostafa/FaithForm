package io.faithform.app.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.RowScope
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Shape

@Composable
fun FaithFormButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    shape: Shape = ButtonDefaults.shape,
    colors: ButtonColors = ButtonDefaults.buttonColors(),
    elevation: ButtonElevation? = ButtonDefaults.buttonElevation(),
    border: BorderStroke? = null,
    contentPadding: PaddingValues = ButtonDefaults.ContentPadding,
    interactionSource: MutableInteractionSource? = null,
    content: @Composable RowScope.() -> Unit,
) {
    val source = interactionSource ?: remember { MutableInteractionSource() }
    androidx.compose.material3.Button(
        onClick = onClick, modifier = modifier.motionPress(source, enabled), enabled = enabled,
        shape = shape, colors = colors, elevation = elevation, border = border,
        contentPadding = contentPadding, interactionSource = source, content = content,
    )
}

@Composable
fun FaithFormOutlinedButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    shape: Shape = ButtonDefaults.shape,
    colors: ButtonColors = ButtonDefaults.outlinedButtonColors(),
    elevation: ButtonElevation? = null,
    border: BorderStroke? = ButtonDefaults.outlinedButtonBorder(enabled),
    contentPadding: PaddingValues = ButtonDefaults.ContentPadding,
    interactionSource: MutableInteractionSource? = null,
    content: @Composable RowScope.() -> Unit,
) {
    val source = interactionSource ?: remember { MutableInteractionSource() }
    androidx.compose.material3.OutlinedButton(
        onClick = onClick, modifier = modifier.motionPress(source, enabled), enabled = enabled,
        shape = shape, colors = colors, elevation = elevation, border = border,
        contentPadding = contentPadding, interactionSource = source, content = content,
    )
}

@Composable
fun FaithFormTextButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    shape: Shape = ButtonDefaults.shape,
    colors: ButtonColors = ButtonDefaults.textButtonColors(),
    elevation: ButtonElevation? = null,
    border: BorderStroke? = null,
    contentPadding: PaddingValues = ButtonDefaults.TextButtonContentPadding,
    interactionSource: MutableInteractionSource? = null,
    content: @Composable RowScope.() -> Unit,
) {
    val source = interactionSource ?: remember { MutableInteractionSource() }
    androidx.compose.material3.TextButton(
        onClick = onClick, modifier = modifier.motionPress(source, enabled), enabled = enabled,
        shape = shape, colors = colors, elevation = elevation, border = border,
        contentPadding = contentPadding, interactionSource = source, content = content,
    )
}

@Composable
fun FaithFormIconButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    colors: IconButtonColors = IconButtonDefaults.iconButtonColors(),
    interactionSource: MutableInteractionSource? = null,
    content: @Composable () -> Unit,
) {
    val source = interactionSource ?: remember { MutableInteractionSource() }
    androidx.compose.material3.IconButton(
        onClick = onClick, modifier = modifier.motionPress(source, enabled, 0.93f), enabled = enabled,
        colors = colors, interactionSource = source, content = content,
    )
}

@Composable
fun FaithFormFilledIconButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    shape: Shape = IconButtonDefaults.filledShape,
    colors: IconButtonColors = IconButtonDefaults.filledIconButtonColors(),
    interactionSource: MutableInteractionSource? = null,
    content: @Composable () -> Unit,
) {
    val source = interactionSource ?: remember { MutableInteractionSource() }
    androidx.compose.material3.FilledIconButton(
        onClick = onClick, modifier = modifier.motionPress(source, enabled, 0.93f), enabled = enabled,
        shape = shape, colors = colors, interactionSource = source, content = content,
    )
}

@Composable
fun FaithFormOutlinedIconButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    shape: Shape = IconButtonDefaults.filledShape,
    border: BorderStroke? = IconButtonDefaults.outlinedIconButtonBorder(enabled),
    colors: IconButtonColors = IconButtonDefaults.outlinedIconButtonColors(),
    interactionSource: MutableInteractionSource? = null,
    content: @Composable () -> Unit,
) {
    val source = interactionSource ?: remember { MutableInteractionSource() }
    androidx.compose.material3.OutlinedIconButton(
        onClick = onClick, modifier = modifier.motionPress(source, enabled, 0.93f), enabled = enabled,
        shape = shape, border = border, colors = colors, interactionSource = source, content = content,
    )
}

@Composable
fun FaithFormFilledTonalIconButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    shape: Shape = IconButtonDefaults.filledShape,
    colors: IconButtonColors = IconButtonDefaults.filledTonalIconButtonColors(),
    interactionSource: MutableInteractionSource? = null,
    content: @Composable () -> Unit,
) {
    val source = interactionSource ?: remember { MutableInteractionSource() }
    androidx.compose.material3.FilledTonalIconButton(
        onClick = onClick, modifier = modifier.motionPress(source, enabled, 0.93f), enabled = enabled,
        shape = shape, colors = colors, interactionSource = source, content = content,
    )
}
