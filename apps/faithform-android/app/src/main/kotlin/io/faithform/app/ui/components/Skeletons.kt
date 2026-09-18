package io.faithform.app.ui.components

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.faithform.app.R
import io.faithform.app.design.FaithFormTokens
import io.faithform.app.design.LocalFaithFormTheme
import io.faithform.app.ui.brand.rememberReducedMotion

/**
 * Loading placeholders that mirror the layout they stand in for.
 *
 * The design rule is in `design/faithform/components.json`: a skeleton that
 * does not match what loads is a worse lie than a spinner. Bones use
 * `skeletonBase` / `skeletonSheen`, shimmer for 1.2s, and sit still when
 * Reduce Motion is on.
 */

private const val SHIMMER_MS = 1200

@Composable
internal fun Modifier.skeletonShimmer(onDark: Boolean = false): Modifier {
    val theme = LocalFaithFormTheme.current
    val reduceMotion = rememberReducedMotion()
    if (reduceMotion) return this

    val transition = rememberInfiniteTransition(label = "skeleton-shimmer")
    val progress by transition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(SHIMMER_MS, easing = LinearEasing),
            repeatMode = RepeatMode.Restart,
        ),
        label = "skeleton-sheen",
    )
    val sheen = if (onDark) Color.White.copy(alpha = 0.28f) else theme.palette.skeletonSheen
    return this
        .graphicsLayer {
            compositingStrategy = CompositingStrategy.Offscreen
        }
        .drawWithContent {
            drawContent()
            val width = size.width.coerceAtLeast(1f)
            val band = (width * 0.42f).coerceAtLeast(56.dp.toPx())
            val startX = -band + progress * (width + band)
            drawRect(
                brush = Brush.linearGradient(
                    colors = listOf(sheen.copy(alpha = 0f), sheen, sheen.copy(alpha = 0f)),
                    start = Offset(startX, 0f),
                    end = Offset(startX + band, 0f),
                ),
                blendMode = BlendMode.SrcAtop,
            )
        }
}

@Composable
private fun skeletonLabel(): Modifier {
    val label = stringResource(R.string.media_loading)
    return Modifier.semantics { contentDescription = label }
}

@Composable
fun SkeletonBone(
    modifier: Modifier = Modifier,
    height: Dp,
    widthFraction: Float = 1f,
    cornerRadius: Dp = FaithFormTokens.Radius.md,
    fill: Color? = null,
) {
    val theme = LocalFaithFormTheme.current
    Box(
        modifier
            .fillMaxWidth(widthFraction.coerceIn(0.12f, 1f))
            .height(height)
            .clip(RoundedCornerShape(cornerRadius))
            .background(fill ?: theme.palette.skeletonBase),
    )
}

@Composable
fun SkeletonPoster(
    modifier: Modifier = Modifier,
    cornerRadius: Dp = FaithFormTokens.Radius.lg,
    fill: Color? = null,
) {
    val theme = LocalFaithFormTheme.current
    Box(
        modifier
            .fillMaxWidth()
            .aspectRatio(16f / 9f)
            .clip(RoundedCornerShape(cornerRadius))
            .background(fill ?: theme.palette.skeletonBase),
    )
}

@Composable
fun SkeletonSearchField(modifier: Modifier = Modifier) {
    val theme = LocalFaithFormTheme.current
    Row(
        modifier = modifier
            .fillMaxWidth()
            .height(FaithFormTokens.TouchTarget.minimum)
            .clip(CircleShape)
            .background(theme.palette.surfaceSunken)
            .border(theme.borderWidth, theme.palette.border, CircleShape)
            .padding(horizontal = FaithFormTokens.Spacing.base),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        SkeletonBone(
            height = 17.dp,
            widthFraction = 0.42f,
            cornerRadius = FaithFormTokens.Radius.pill,
        )
    }
}

@Composable
fun SkeletonAvatar(
    modifier: Modifier = Modifier,
    size: Dp = FaithFormTokens.TouchTarget.recommended,
) {
    val theme = LocalFaithFormTheme.current
    Box(
        modifier
            .size(size)
            .clip(RoundedCornerShape(FaithFormTokens.Radius.md))
            .background(theme.palette.skeletonBase),
    )
}

@Composable
private fun SkeletonCardChrome(
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    val theme = LocalFaithFormTheme.current
    val shape = RoundedCornerShape(FaithFormTokens.Radius.md)
    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(theme.palette.surface, shape)
            .border(theme.borderWidth, theme.palette.border, shape)
            .padding(FaithFormTokens.Spacing.base),
        verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.sm),
    ) { content() }
}

@Composable
fun DiscoveryCardSkeleton(modifier: Modifier = Modifier) {
    SkeletonCardChrome(modifier) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.base),
            verticalAlignment = Alignment.Top,
        ) {
            SkeletonAvatar()
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.sm),
            ) {
                SkeletonBone(height = 17.dp, widthFraction = 0.62f)
                SkeletonBone(height = 15.dp, widthFraction = 0.92f)
                SkeletonBone(height = 15.dp, widthFraction = 0.48f)
                SkeletonBone(
                    height = 22.dp,
                    widthFraction = 0.28f,
                    cornerRadius = FaithFormTokens.Radius.pill,
                )
            }
        }
    }
}

/** Church-row card used by discovery and leftover list loading. */
@Composable
fun SkeletonCard(modifier: Modifier = Modifier) {
    DiscoveryCardSkeleton(modifier)
}

@Composable
fun ChooserRowSkeleton(modifier: Modifier = Modifier) {
    SkeletonCardChrome(modifier) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.base),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            SkeletonAvatar()
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.xs),
            ) {
                SkeletonBone(height = 17.dp, widthFraction = 0.7f)
                SkeletonBone(
                    height = 22.dp,
                    widthFraction = 0.32f,
                    cornerRadius = FaithFormTokens.Radius.pill,
                )
            }
        }
    }
}

@Composable
fun FeedCardSkeleton(modifier: Modifier = Modifier) {
    val theme = LocalFaithFormTheme.current
    val shape = RoundedCornerShape(FaithFormTokens.Radius.xl)
    // Matches `AnnouncementCard`: the banner at its generated shape, then the
    // date tile beside the title, time and place.
    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(shape)
            .background(theme.palette.surface)
            .border(FaithFormTokens.BorderWidth.hairline, theme.palette.border, shape),
    ) {
        Box(
            Modifier
                .fillMaxWidth()
                .aspectRatio(1200f / 630f)
                .background(theme.palette.skeletonBase),
        )
        Row(
            modifier = Modifier.padding(FaithFormTokens.Spacing.base),
            horizontalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.md),
        ) {
            Box(
                Modifier
                    .size(width = 52.dp, height = 58.dp)
                    .clip(RoundedCornerShape(FaithFormTokens.Radius.md))
                    .background(theme.palette.skeletonBase),
            )
            Column(verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.sm)) {
                SkeletonBone(height = 22.dp, widthFraction = 0.78f)
                SkeletonBone(height = 15.dp, widthFraction = 0.55f)
                SkeletonBone(height = 15.dp, widthFraction = 0.4f)
            }
        }
    }
}

@Composable
fun MediaCardSkeleton(modifier: Modifier = Modifier) {
    SkeletonCardChrome(modifier) {
        SkeletonBone(height = 17.dp, widthFraction = 0.82f)
        SkeletonBone(height = 12.dp, widthFraction = 0.4f)
        SkeletonBone(height = 12.dp, widthFraction = 0.68f)
    }
}

@Composable
fun PresentationCardSkeleton(modifier: Modifier = Modifier) {
    SkeletonCardChrome(modifier) {
        SkeletonBone(height = 12.dp, widthFraction = 0.38f)
        SkeletonBone(height = 17.dp, widthFraction = 0.86f)
        SkeletonBone(height = 15.dp, widthFraction = 0.52f)
    }
}

@Composable
fun GivingFundCardSkeleton(modifier: Modifier = Modifier) {
    SkeletonCardChrome(modifier) {
        SkeletonBone(height = 17.dp, widthFraction = 0.48f)
        SkeletonBone(height = 15.dp, widthFraction = 1f)
        SkeletonBone(height = 15.dp, widthFraction = 0.7f)
    }
}

@Composable
fun GivingHistoryRowSkeleton(modifier: Modifier = Modifier) {
    SkeletonCardChrome(modifier) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.Top,
        ) {
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.xs),
            ) {
                SkeletonBone(height = 17.dp, widthFraction = 0.4f)
                SkeletonBone(height = 15.dp, widthFraction = 0.55f)
                SkeletonBone(height = 12.dp, widthFraction = 0.32f)
            }
            SkeletonBone(
                height = 22.dp,
                widthFraction = 0.18f,
                cornerRadius = FaithFormTokens.Radius.pill,
            )
        }
    }
}

@Composable
fun SermonHubCardSkeleton(modifier: Modifier = Modifier) {
    val theme = LocalFaithFormTheme.current
    val shape = RoundedCornerShape(FaithFormTokens.Radius.md)
    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(shape)
            .background(theme.palette.surface)
            .border(theme.borderWidth, theme.palette.border, shape),
    ) {
        Box(contentAlignment = Alignment.Center) {
            SkeletonPoster()
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.sm),
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = FaithFormTokens.Spacing.lg),
            ) {
                SkeletonBone(
                    height = 18.dp,
                    widthFraction = 0.55f,
                    fill = theme.palette.skeletonSheen.copy(alpha = 0.85f),
                )
                SkeletonBone(
                    height = 12.dp,
                    widthFraction = 0.22f,
                    fill = theme.palette.skeletonSheen.copy(alpha = 0.7f),
                )
            }
        }
        Column(
            modifier = Modifier.padding(FaithFormTokens.Spacing.base),
            verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.sm),
        ) {
            SkeletonBone(height = 13.dp, widthFraction = 0.4f)
            SkeletonBone(height = 17.dp, widthFraction = 0.84f)
            SkeletonBone(height = 13.dp, widthFraction = 0.46f)
            Row(horizontalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.sm)) {
                SkeletonBone(
                    modifier = Modifier.weight(1f),
                    height = FaithFormTokens.TouchTarget.minimum - 8.dp,
                    cornerRadius = FaithFormTokens.Radius.pill,
                )
                SkeletonBone(
                    modifier = Modifier.weight(1f),
                    height = FaithFormTokens.TouchTarget.minimum - 8.dp,
                    cornerRadius = FaithFormTokens.Radius.pill,
                )
            }
        }
    }
}

@Composable
fun FeedSkeleton(modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .then(skeletonLabel())
            .skeletonShimmer(),
        verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.lg),
    ) {
        SkeletonBone(height = 13.dp, widthFraction = 0.24f)
        repeat(3) { FeedCardSkeleton() }
    }
}

@Composable
fun DiscoveryResultsSkeleton(modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .then(skeletonLabel())
            .skeletonShimmer(),
        verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.md),
    ) {
        repeat(3) { DiscoveryCardSkeleton() }
    }
}

@Composable
fun ChurchProfileSkeleton(modifier: Modifier = Modifier) {
    val theme = LocalFaithFormTheme.current
    Column(
        modifier = modifier
            .fillMaxWidth()
            .then(skeletonLabel())
            .skeletonShimmer(),
        verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.lg),
    ) {
        Box {
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(160.dp)
                    .clip(RoundedCornerShape(FaithFormTokens.Radius.lg))
                    .background(theme.palette.skeletonBase),
            )
            SkeletonAvatar(
                modifier = Modifier
                    .align(Alignment.BottomStart)
                    .padding(FaithFormTokens.Spacing.base)
                    .offset(y = 24.dp),
                size = 64.dp,
            )
        }
        Spacer(Modifier.height(FaithFormTokens.Spacing.md))
        Column(verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.sm)) {
            SkeletonBone(height = 34.dp, widthFraction = 0.72f)
            SkeletonBone(height = 17.dp, widthFraction = 0.5f)
            SkeletonBone(height = 17.dp, widthFraction = 1f)
            SkeletonBone(height = 17.dp, widthFraction = 0.88f)
            SkeletonBone(height = 17.dp, widthFraction = 0.64f)
        }
        SkeletonBone(
            height = FaithFormTokens.TouchTarget.recommended,
            cornerRadius = FaithFormTokens.Radius.control,
        )
        Column(verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.md)) {
            SkeletonBone(height = 13.dp, widthFraction = 0.28f)
            SkeletonCardChrome {
                SkeletonBone(height = 17.dp, widthFraction = 0.44f)
                SkeletonBone(height = 15.dp, widthFraction = 0.8f)
                SkeletonBone(height = 15.dp, widthFraction = 0.52f)
            }
        }
    }
}

@Composable
fun ChurchChooserSkeleton(modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .then(skeletonLabel())
            .skeletonShimmer(),
        verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.md),
    ) {
        repeat(2) { ChooserRowSkeleton() }
    }
}

@Composable
fun SermonListSkeleton(modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .then(skeletonLabel())
            .skeletonShimmer(),
        verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.lg),
    ) {
        SkeletonSearchField()
        SkeletonBone(height = 13.dp, widthFraction = 0.3f)
        repeat(2) { SermonHubCardSkeleton() }
    }
}

@Composable
fun MediaListSkeleton(modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .then(skeletonLabel())
            .skeletonShimmer(),
        verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.lg),
    ) {
        SkeletonCardChrome {
            SkeletonBone(height = 12.dp, widthFraction = 0.22f)
            SkeletonBone(height = 34.dp, widthFraction = 0.7f)
            SkeletonBone(height = 17.dp, widthFraction = 0.5f)
            SkeletonBone(
                height = FaithFormTokens.TouchTarget.recommended,
                cornerRadius = FaithFormTokens.Radius.control,
            )
        }
        SkeletonBone(height = 17.dp, widthFraction = 0.36f)
        SkeletonSearchField()
        repeat(3) { MediaCardSkeleton() }
    }
}

@Composable
fun PresentationListSkeleton(modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .then(skeletonLabel())
            .skeletonShimmer(),
        verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.lg),
    ) {
        SkeletonSearchField()
        repeat(4) { PresentationCardSkeleton() }
    }
}

@Composable
fun GivingHomeSkeleton(modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .then(skeletonLabel())
            .skeletonShimmer(),
        verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.lg),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.xs)) {
            SkeletonBone(height = 34.dp, widthFraction = 0.62f)
            SkeletonBone(height = 17.dp, widthFraction = 0.78f)
        }
        repeat(3) { GivingFundCardSkeleton() }
        SkeletonBone(
            height = FaithFormTokens.TouchTarget.recommended,
            widthFraction = 0.4f,
            cornerRadius = FaithFormTokens.Radius.control,
        )
    }
}

@Composable
fun GivingHistorySkeleton(modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .then(skeletonLabel())
            .skeletonShimmer(),
        verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.md),
    ) {
        SkeletonBone(height = 12.dp, widthFraction = 0.55f)
        repeat(4) { GivingHistoryRowSkeleton() }
    }
}

@Composable
fun ContentSkeleton(count: Int = 3, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .then(skeletonLabel())
            .skeletonShimmer(),
        verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.md),
    ) {
        repeat(count) { DiscoveryCardSkeleton() }
    }
}

@Composable
fun DetailSkeleton(modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .then(skeletonLabel())
            .skeletonShimmer(),
        verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.lg),
    ) {
        SkeletonBone(height = 13.dp, widthFraction = 0.34f)
        SkeletonBone(height = 22.dp, widthFraction = 0.88f)
        SkeletonBone(height = 13.dp, widthFraction = 0.4f)
        Column(verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.sm)) {
            SkeletonBone(height = 17.dp, widthFraction = 1f)
            SkeletonBone(height = 17.dp, widthFraction = 0.96f)
            SkeletonBone(height = 17.dp, widthFraction = 0.74f)
        }
        Column(verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.sm)) {
            SkeletonBone(height = 13.dp, widthFraction = 0.26f)
            SkeletonBone(height = 17.dp, widthFraction = 0.58f)
        }
        Column(verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.md)) {
            SkeletonBone(height = 13.dp, widthFraction = 0.22f)
            SkeletonBone(height = 17.dp, widthFraction = 0.7f)
            SkeletonBone(height = 15.dp, widthFraction = 1f)
            SkeletonBone(height = 15.dp, widthFraction = 0.82f)
            SkeletonBone(height = 17.dp, widthFraction = 0.62f)
            SkeletonBone(height = 15.dp, widthFraction = 0.9f)
        }
    }
}

/** Full-screen slide canvas matching [io.faithform.app.ui.sermons.PresentationDetailScreen]. */
@Composable
fun SlideSkeleton(modifier: Modifier = Modifier) {
    val theme = LocalFaithFormTheme.current
    val bone = Color.White.copy(alpha = 0.22f)
    Column(
        modifier = modifier
            .fillMaxSize()
            .background(theme.palette.brandPrimary)
            .then(skeletonLabel())
            .skeletonShimmer(onDark = true)
            .padding(
                horizontal = FaithFormTokens.Spacing.xxl,
                vertical = FaithFormTokens.Spacing.xl,
            ),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.weight(1f))
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.lg),
        ) {
            SkeletonBone(
                height = 36.dp,
                widthFraction = 0.72f,
                fill = bone,
            )
            SkeletonBone(
                height = 22.dp,
                widthFraction = 0.44f,
                fill = Color.White.copy(alpha = 0.3f),
            )
            Column(
                modifier = Modifier.fillMaxWidth(),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.sm),
            ) {
                SkeletonBone(height = 20.dp, widthFraction = 0.86f, fill = bone)
                SkeletonBone(height = 20.dp, widthFraction = 0.78f, fill = bone)
                SkeletonBone(height = 20.dp, widthFraction = 0.64f, fill = bone)
            }
        }
        Spacer(Modifier.weight(1f))
        SkeletonBone(
            height = 13.dp,
            widthFraction = 0.14f,
            fill = Color.White.copy(alpha = 0.18f),
        )
    }
}
