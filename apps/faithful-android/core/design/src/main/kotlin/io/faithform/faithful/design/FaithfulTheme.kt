package io.faithform.faithful.design

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.dp

/**
 * Resolves the canonical tokens for Compose.
 *
 * Everything the app draws comes from [FaithfulTokens], which is generated from
 * `design/faithful/tokens.json`. Material3's own colour scheme is filled in from
 * the same values so any Material component that slips in still looks like
 * Faithful rather than like stock Material.
 */
data class FaithfulThemeState(
    val palette: FaithfulTokens.Palette,
    val reduceMotion: Boolean,
    val increaseContrast: Boolean
) {
    /** High contrast raises border weight rather than changing hue. */
    val borderWidth = if (increaseContrast) {
        FaithfulTokens.BorderWidth.standard * 1.5f
    } else {
        FaithfulTokens.BorderWidth.standard
    }

    /** Muted text is promoted to secondary under increased contrast. */
    val mutedContent = if (increaseContrast) palette.contentSecondary else palette.contentMuted

    /** Decorative depth is dropped; separation comes from borders instead. */
    val usesDecorativeShadow = !increaseContrast

    val elevation = if (usesDecorativeShadow) FaithfulTokens.Elevation.cardY else 0.dp

    /** Reduced motion shortens a transition; it never removes it. */
    fun durationMillis(standard: Int): Int =
        if (reduceMotion) FaithfulTokens.Motion.REDUCED_MOTION_MS else standard
}

val LocalFaithfulTheme = staticCompositionLocalOf {
    FaithfulThemeState(FaithfulTokens.LIGHT, reduceMotion = false, increaseContrast = false)
}

private fun textStyle(role: FaithfulTokens.TextRole) = TextStyle(
    fontSize = role.size,
    lineHeight = role.lineHeight,
    fontWeight = role.weight
)

@Composable
fun FaithfulTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    reduceMotion: Boolean = false,
    increaseContrast: Boolean = false,
    content: @Composable () -> Unit
) {
    val palette = if (darkTheme) FaithfulTokens.DARK else FaithfulTokens.LIGHT
    val state = FaithfulThemeState(palette, reduceMotion, increaseContrast)

    val colors = if (darkTheme) {
        darkColorScheme(
            primary = palette.brandAccent,
            onPrimary = palette.contentOnAccent,
            background = palette.background,
            onBackground = palette.contentPrimary,
            surface = palette.surface,
            onSurface = palette.contentPrimary,
            surfaceVariant = palette.surfaceSunken,
            onSurfaceVariant = palette.contentSecondary,
            error = palette.destructive,
            onError = palette.destructiveContent,
            outline = palette.border
        )
    } else {
        lightColorScheme(
            primary = palette.brandPrimary,
            onPrimary = palette.contentInverse,
            background = palette.background,
            onBackground = palette.contentPrimary,
            surface = palette.surface,
            onSurface = palette.contentPrimary,
            surfaceVariant = palette.surfaceSunken,
            onSurfaceVariant = palette.contentSecondary,
            error = palette.destructive,
            onError = palette.destructiveContent,
            outline = palette.border
        )
    }

    CompositionLocalProvider(LocalFaithfulTheme provides state) {
        MaterialTheme(
            colorScheme = colors,
            typography = Typography(
                displayLarge = textStyle(FaithfulTokens.Text.displayLarge),
                displayMedium = textStyle(FaithfulTokens.Text.displayMedium),
                titleLarge = textStyle(FaithfulTokens.Text.titleLarge),
                titleMedium = textStyle(FaithfulTokens.Text.titleMedium),
                bodyLarge = textStyle(FaithfulTokens.Text.body),
                bodyMedium = textStyle(FaithfulTokens.Text.bodySmall),
                labelLarge = textStyle(FaithfulTokens.Text.label),
                labelSmall = textStyle(FaithfulTokens.Text.caption)
            ),
            content = content
        )
    }
}
