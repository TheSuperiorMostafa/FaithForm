package io.faithform.app.ui.church

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.invisibleToUser
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import coil.request.ImageRequest
import io.faithform.app.R
import io.faithform.app.design.FaithFormTokens
import io.faithform.app.design.LocalFaithFormTheme

/** Church logo with monogram fallback — discovery, the Home bar, and the Church info hero. */
@OptIn(ExperimentalComposeUiApi::class)
@Composable
fun ChurchAvatar(
    logoUrl: String?,
    name: String,
    modifier: Modifier = Modifier,
    size: Dp = FaithFormTokens.TouchTarget.recommended,
    shape: Shape = RoundedCornerShape(FaithFormTokens.Radius.md),
    bordered: Boolean = true,
) {
    val theme = LocalFaithFormTheme.current
    Box(
        modifier = modifier
            .size(size)
            .clip(shape)
            .background(theme.palette.surfaceSunken)
            .then(if (bordered) Modifier.border(theme.borderWidth, theme.palette.border, shape) else Modifier)
            .semantics { invisibleToUser() },
        contentAlignment = Alignment.Center,
    ) {
        if (!logoUrl.isNullOrBlank()) {
            AsyncImage(
                model = ImageRequest.Builder(LocalContext.current)
                    .data(logoUrl)
                    .crossfade(true)
                    .build(),
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
        } else {
            Text(
                initials(name),
                style = if (size >= 64.dp) MaterialTheme.typography.titleLarge else MaterialTheme.typography.titleMedium,
                color = theme.palette.brandPrimary,
            )
        }
    }
}

/** How tall the cover is before larger text makes it grow. */
val ChurchHeroHeight: Dp = 260.dp

/**
 * The Church info page's immersive cover.
 *
 * The cover runs edge to edge and drifts at half the scroll speed; with no
 * cover, a gradient built from the church's own accent stands in. A dark scrim
 * at the bottom carries the name, tagline and place in white, beside the logo
 * on a surface-coloured ring — white on that scrim holds its contrast over any
 * photo. [topInset] keeps the text clear of the bar floating above; the hero
 * grows rather than clipping when text is scaled up. [bottomInset] leaves room
 * for the quick-action card that overlaps its bottom edge.
 */
@Composable
fun ChurchHero(
    coverImageUrl: String?,
    logoUrl: String?,
    name: String,
    tagline: String?,
    detailLine: String?,
    isYourChurch: Boolean,
    scrollOffset: () -> Int,
    topInset: Dp,
    bottomInset: Dp,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = ChurchHeroHeight)
            .clipToBounds(),
    ) {
        Box(
            Modifier
                .matchParentSize()
                .graphicsLayer { translationY = scrollOffset() * 0.5f },
        ) {
            ChurchCoverArt(coverImageUrl, Modifier.matchParentSize())
        }
        Box(
            Modifier
                .matchParentSize()
                .background(
                    Brush.verticalGradient(
                        0f to Color.Black.copy(alpha = 0.40f),
                        0.26f to Color.Transparent,
                        0.42f to Color.Transparent,
                        1f to Color.Black.copy(alpha = 0.80f),
                    ),
                ),
        )
        Row(
            modifier = Modifier
                .align(Alignment.BottomStart)
                .fillMaxWidth()
                .padding(
                    start = FaithFormTokens.Layout.screenPaddingHorizontal,
                    end = FaithFormTokens.Layout.screenPaddingHorizontal,
                    top = topInset + FaithFormTokens.Spacing.base,
                    bottom = bottomInset + FaithFormTokens.Spacing.lg,
                ),
            horizontalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.base),
            verticalAlignment = Alignment.Bottom,
        ) {
            HeroLogo(logoUrl = logoUrl, name = name)
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.xs),
            ) {
                if (isYourChurch) YourChurchBadge()
                Text(
                    name,
                    style = MaterialTheme.typography.displayMedium.copy(fontWeight = FontWeight.Bold),
                    color = Color.White,
                    modifier = Modifier.semantics { heading() },
                )
                tagline?.takeIf { it.isNotBlank() }?.let {
                    Text(
                        it,
                        style = MaterialTheme.typography.titleMedium,
                        color = Color.White.copy(alpha = 0.92f),
                    )
                }
                detailLine?.let {
                    Text(
                        it,
                        style = MaterialTheme.typography.bodyMedium,
                        color = Color.White.copy(alpha = 0.82f),
                    )
                }
            }
        }
    }
}

/** The cover photo over the brand gradient, so loading never shows a blank box. */
@Composable
fun ChurchCoverArt(coverImageUrl: String?, modifier: Modifier = Modifier) {
    val theme = LocalFaithFormTheme.current
    val accent = theme.palette.brandAccent
    val glow = theme.palette.brandAccentSoft
    val deep = lerp(theme.palette.brandPrimary, Color.Black, 0.45f)
    Box(
        modifier = modifier
            .background(
                Brush.linearGradient(
                    colors = listOf(accent, lerp(accent, deep, 0.6f), deep),
                    start = Offset.Zero,
                    end = Offset.Infinite,
                ),
            )
            .drawBehind {
                drawRect(
                    Brush.radialGradient(
                        colors = listOf(glow.copy(alpha = 0.6f), glow.copy(alpha = 0f)),
                        center = Offset(size.width * 0.85f, size.height * 0.1f),
                        radius = size.maxDimension * 0.75f,
                    ),
                )
            },
    ) {
        if (!coverImageUrl.isNullOrBlank()) {
            AsyncImage(
                model = ImageRequest.Builder(LocalContext.current)
                    .data(coverImageUrl)
                    .crossfade(true)
                    .build(),
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
        }
    }
}

@Composable
private fun HeroLogo(logoUrl: String?, name: String) {
    val theme = LocalFaithFormTheme.current
    Box(
        modifier = Modifier
            .shadow(if (theme.usesDecorativeShadow) 8.dp else 0.dp, CircleShape)
            .background(theme.palette.surface, CircleShape)
            .padding(3.dp),
    ) {
        ChurchAvatar(
            logoUrl = logoUrl,
            name = name,
            size = 70.dp,
            shape = CircleShape,
            bordered = false,
        )
    }
}

/** "Your church", on the hero's scrim. */
@Composable
private fun YourChurchBadge() {
    Row(
        modifier = Modifier
            .background(Color.White.copy(alpha = 0.18f), RoundedCornerShape(FaithFormTokens.Radius.pill))
            .border(1.dp, Color.White.copy(alpha = 0.32f), RoundedCornerShape(FaithFormTokens.Radius.pill))
            .padding(horizontal = FaithFormTokens.Spacing.sm + 2.dp, vertical = FaithFormTokens.Spacing.xs),
        horizontalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            Icons.Rounded.CheckCircle,
            contentDescription = null,
            tint = Color.White,
            modifier = Modifier.size(FaithFormTokens.IconSize.sizeSmall),
        )
        Text(
            stringResource(R.string.your_church),
            style = MaterialTheme.typography.labelLarge,
            color = Color.White,
        )
    }
}

/**
 * [this] darkened until white text on it reads at AA, whatever colour a church
 * chose as its brand. Gold, for instance, is far too light for white on its own.
 */
fun Color.deepenedForWhiteText(maxLuminance: Float = 0.16f): Color {
    var color = this
    repeat(12) {
        if (color.luminance() <= maxLuminance) return color
        color = lerp(color, Color.Black, 0.12f)
    }
    return color
}

private fun initials(name: String): String {
    val parts = name.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }.take(2)
    return if (parts.isEmpty()) {
        "?"
    } else {
        parts.mapNotNull { it.firstOrNull()?.uppercaseChar() }.joinToString("")
    }
}
