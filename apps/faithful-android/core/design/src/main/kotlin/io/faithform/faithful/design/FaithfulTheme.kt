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
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
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

/**
 * The web's type, bundled.
 *
 * Montserrat is `--font-heading` and Nunito is `--font-sans` in the web app, so
 * a member moving between the site and the phone reads the same voice. The
 * tokens used to name Fraunces and Inter — neither of which the web actually
 * loads, and neither of which shipped here — so every screen fell back to
 * Roboto. Both families are SIL OFL 1.1; the licences sit in `core/design`.
 */
private val DisplayFamily = FontFamily(
    Font(R.font.montserrat_semibold, FontWeight.SemiBold),
    Font(R.font.montserrat_bold, FontWeight.Bold)
)

private val TextFamily = FontFamily(
    Font(R.font.nunito_regular, FontWeight.Normal),
    Font(R.font.nunito_semibold, FontWeight.SemiBold)
)

private fun textStyle(role: FaithfulTokens.TextRole) = TextStyle(
    fontSize = role.size,
    lineHeight = role.lineHeight,
    fontWeight = role.weight,
    // `isDisplay` is the token's own answer to which family a role belongs to,
    // so the split matches iOS and the web without a second list to keep.
    fontFamily = if (role.isDisplay) DisplayFamily else TextFamily
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
            // Gold, matching the web's `bg-accent` primary button — and
            // matching this file's own dark scheme, which already used the
            // accent. Light was the odd one out: a navy CTA on the phone
            // against a gold one on the website, in the same product.
            //
            // `contentOnAccent` is navy rather than the web's white. White on
            // this gold is 2.46:1, under the 4.5:1 AA needs; navy is 5.55:1.
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
