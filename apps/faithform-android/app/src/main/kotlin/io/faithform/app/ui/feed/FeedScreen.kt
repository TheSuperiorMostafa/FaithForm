package io.faithform.app.ui.feed

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.CalendarContract
import android.text.format.DateUtils
import android.util.Patterns
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material.icons.outlined.Block
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.Campaign
import androidx.compose.material.icons.outlined.EditCalendar
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material.icons.outlined.NorthEast
import androidx.compose.material.icons.outlined.Place
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material.icons.outlined.WifiOff
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedIconButton
import androidx.compose.material3.Text
import androidx.compose.material3.ripple
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.BlurredEdgeTreatment
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import coil.compose.AsyncImagePainter
import coil.request.ImageRequest
import io.faithform.app.R
import io.faithform.app.contract.FeedItem
import io.faithform.app.design.FaithFormTokens
import io.faithform.app.design.LocalFaithFormTheme
import io.faithform.app.ui.components.FeedSkeleton
import io.faithform.app.ui.components.skeletonShimmer
import io.faithform.app.ui.discovery.EmptyState
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

/** Mirrors the iOS FeedPhase. Every state is one the contract can produce. */
sealed interface FeedPhase {
    data object Loading : FeedPhase
    data class Loaded(val items: List<FeedItem>, val isStale: Boolean) : FeedPhase
    data object Empty : FeedPhase
    data object OfflineNoCache : FeedPhase
    data object Blocked : FeedPhase
    data class Failed(val message: String) : FeedPhase
}

/** Announcement graphics are generated at 1200 × 630. */
const val BANNER_ASPECT_RATIO = 1200f / 630f

/** The Home feed: pinned first, then today, the rest of the week, and later. */
@Composable
fun HomeFeedScreen(
    phase: FeedPhase,
    onOpenItem: (FeedItem) -> Unit,
    onReachedEnd: () -> Unit,
    modifier: Modifier = Modifier,
    isJoinPending: Boolean = false,
) {
    val theme = LocalFaithFormTheme.current

    LazyColumn(
        modifier = modifier
            .fillMaxSize()
            .background(theme.palette.background),
        // Padding inside the list rather than around it, so a card's shadow is
        // not cut off at the screen's edge.
        contentPadding = PaddingValues(
            horizontal = FaithFormTokens.Layout.screenPaddingHorizontal,
            vertical = FaithFormTokens.Spacing.base,
        ),
    ) {
        if (isJoinPending) {
            item(key = "join-pending") {
                Column(Modifier.padding(bottom = FaithFormTokens.Spacing.lg)) { JoinPendingBanner() }
            }
        }

        when (phase) {
            is FeedPhase.Loading -> item { FeedSkeleton() }

            is FeedPhase.Loaded -> {
                if (phase.isStale) {
                    item(key = "stale") {
                        Column(Modifier.padding(bottom = FaithFormTokens.Spacing.lg)) {
                            OfflineBanner(stringResource(R.string.offline_cached))
                        }
                    }
                }
                val now = Instant.now()
                AnnouncementTiming.sections(phase.items, now).forEachIndexed { index, group ->
                    item(key = "section-${group.section.name}") {
                        FeedSectionHeader(
                            title = sectionTitle(group.section),
                            modifier = Modifier.padding(
                                top = if (index == 0) 0.dp else FaithFormTokens.Spacing.sm,
                                bottom = FaithFormTokens.Spacing.md,
                            ),
                        )
                    }
                    items(group.items, key = { it.id }) { item ->
                        AnnouncementCard(
                            item = item,
                            now = now,
                            modifier = Modifier.padding(bottom = FaithFormTokens.Spacing.lg),
                        ) { onOpenItem(item) }
                        // Once per last item, not on every recomposition of it.
                        if (item.id == phase.items.lastOrNull()?.id) {
                            LaunchedEffect(item.id) { onReachedEnd() }
                        }
                    }
                }
            }

            is FeedPhase.Empty -> item {
                EmptyState(
                    stringResource(R.string.empty_feed_title),
                    stringResource(R.string.empty_feed_body),
                    icon = Icons.Outlined.Inbox,
                )
            }
            is FeedPhase.OfflineNoCache -> item {
                EmptyState(
                    stringResource(R.string.offline_title),
                    stringResource(R.string.offline_body),
                    icon = Icons.Outlined.WifiOff,
                )
            }
            is FeedPhase.Blocked -> item {
                EmptyState(
                    stringResource(R.string.blocked_title),
                    stringResource(R.string.blocked_body),
                    icon = Icons.Outlined.Block,
                )
            }
            is FeedPhase.Failed -> item {
                EmptyState(stringResource(R.string.error_title), phase.message, icon = Icons.Outlined.WarningAmber)
            }
        }
    }
}

@Composable
private fun sectionTitle(section: FeedSection): String = when (section) {
    FeedSection.PINNED -> stringResource(R.string.pinned_label)
    FeedSection.TODAY -> stringResource(R.string.announcement_today)
    FeedSection.THIS_WEEK -> stringResource(R.string.announcement_this_week)
    FeedSection.LATER -> stringResource(R.string.announcement_coming_up)
}

@Composable
private fun FeedSectionHeader(title: String, modifier: Modifier = Modifier) {
    val theme = LocalFaithFormTheme.current
    Text(
        title.uppercase(),
        style = MaterialTheme.typography.labelLarge.copy(letterSpacing = 1.sp),
        color = theme.mutedContent,
        modifier = modifier
            .fillMaxWidth()
            .semantics { heading() },
    )
}

@Composable
private fun momentLabel(moment: AnnouncementMoment): String? = when (moment) {
    AnnouncementMoment.HAPPENING_NOW -> stringResource(R.string.announcement_happening_now)
    AnnouncementMoment.TODAY -> stringResource(R.string.announcement_today)
    AnnouncementMoment.TOMORROW -> stringResource(R.string.announcement_tomorrow)
    AnnouncementMoment.UPCOMING, AnnouncementMoment.PAST -> null
}

/**
 * A banner-first announcement card.
 *
 * The church's banner leads, uncropped at the 1200 × 630 it is generated at:
 * the title and date are part of the artwork, so trimming its edges trims the
 * words. Nothing is laid over it but two small chips in its corners. The title,
 * time and place sit below on a solid surface, readable at any contrast
 * setting, beside a tear-off date tile that says when at a glance.
 */
@Composable
fun AnnouncementCard(
    item: FeedItem,
    modifier: Modifier = Modifier,
    now: Instant = Instant.now(),
    onOpen: () -> Unit,
) {
    val theme = LocalFaithFormTheme.current
    val moment = AnnouncementTiming.moment(item, now)
    val momentText = momentLabel(moment)
    val pinnedText = stringResource(R.string.pinned_label)
    val timeLine = AnnouncementFormatting.timeLine(item, stringResource(R.string.announcement_all_day))

    val description = listOfNotNull(
        momentText,
        if (item.isPinned) pinnedText else null,
        item.title,
        formatWhen(item),
        item.location,
        item.posterAltText,
    ).filter { it.isNotBlank() }.joinToString(", ")

    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    // Sinks a little under the finger; Reduce Motion keeps the ripple only.
    val scale by animateFloatAsState(
        targetValue = if (pressed && !theme.reduceMotion) 0.97f else 1f,
        animationSpec = if (theme.reduceMotion) {
            tween(FaithFormTokens.Motion.REDUCED_MOTION_MS)
        } else {
            spring(dampingRatio = 0.7f, stiffness = Spring.StiffnessMediumLow)
        },
        label = "card-press",
    )
    val shape = RoundedCornerShape(FaithFormTokens.Radius.xl)

    Column(
        modifier = modifier
            .fillMaxWidth()
            .graphicsLayer {
                scaleX = scale
                scaleY = scale
            }
            .shadow(
                elevation = if (theme.usesDecorativeShadow) 6.dp else 0.dp,
                shape = shape,
                ambientColor = theme.palette.brandPrimary.copy(alpha = 0.16f),
                spotColor = theme.palette.brandPrimary.copy(alpha = 0.16f),
            )
            .clip(shape)
            .background(theme.palette.surface)
            .border(FaithFormTokens.BorderWidth.hairline, theme.palette.border, shape)
            .clickable(
                interactionSource = interaction,
                indication = ripple(),
                role = Role.Button,
                onClick = onOpen,
            )
            .semantics(mergeDescendants = true) { contentDescription = description },
    ) {
        Box(
            Modifier
                .fillMaxWidth()
                .aspectRatio(BANNER_ASPECT_RATIO),
        ) {
            PosterArtwork(item, Modifier.matchParentSize())
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(FaithFormTokens.Spacing.md),
                verticalAlignment = Alignment.Top,
            ) {
                if (momentText != null) {
                    GlassChip(
                        text = momentText,
                        dot = if (moment == AnnouncementMoment.HAPPENING_NOW) theme.palette.live else theme.palette.brandAccent,
                    )
                }
                Spacer(Modifier.weight(1f))
                if (item.isPinned) GlassPin()
            }
        }

        Row(
            modifier = Modifier.padding(FaithFormTokens.Spacing.base),
            horizontalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.md),
        ) {
            AnnouncementFormatting.tile(item)?.let { (month, day) -> DateTile(month, day) }

            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.sm),
            ) {
                Text(
                    item.title,
                    style = MaterialTheme.typography.titleLarge,
                    color = theme.palette.contentPrimary,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                Column(verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.xs)) {
                    MetaRow(Icons.Outlined.Schedule, timeLine)
                    item.location?.takeIf { it.isNotBlank() }?.let { MetaRow(Icons.Outlined.Place, it) }
                }
                if (item.body.isNotBlank()) {
                    Text(
                        item.body,
                        style = MaterialTheme.typography.bodyMedium,
                        color = theme.palette.contentSecondary,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
    }
}

/**
 * The banner, loaded through Coil — which keeps it in memory, so the detail
 * screen shows the same picture at once rather than fetching it again. A
 * banner that will not load falls back to the designed placeholder.
 */
@Composable
internal fun PosterArtwork(item: FeedItem, modifier: Modifier = Modifier, placeholderGlyph: Dp? = 28.dp) {
    val theme = LocalFaithFormTheme.current
    val url = item.posterUrl
    if (url == null) {
        AnnouncementPlaceholderArt(item, modifier, placeholderGlyph)
        return
    }

    var state by remember(url) { mutableStateOf<AsyncImagePainter.State>(AsyncImagePainter.State.Empty) }
    Box(modifier) {
        when (state) {
            is AsyncImagePainter.State.Error -> AnnouncementPlaceholderArt(item, Modifier.matchParentSize(), placeholderGlyph)
            is AsyncImagePainter.State.Success -> Unit
            else -> Box(
                Modifier
                    .matchParentSize()
                    .background(theme.palette.skeletonBase)
                    .skeletonShimmer(),
            )
        }
        AsyncImage(
            model = ImageRequest.Builder(LocalContext.current)
                .data(url)
                .crossfade(true)
                .build(),
            contentDescription = null,
            contentScale = ContentScale.Crop,
            onState = { state = it },
            modifier = Modifier.matchParentSize(),
        )
    }
}

/**
 * Stands in for a banner when there is none, so every card keeps the same
 * rhythm: the brand's gradient, a soft glow, and one glyph.
 */
@Composable
internal fun AnnouncementPlaceholderArt(item: FeedItem, modifier: Modifier = Modifier, glyphSize: Dp? = 28.dp) {
    val theme = LocalFaithFormTheme.current
    // The dark palette's primary is gold, and gold on gold reads as a flat
    // block; dark mode builds from its own surfaces instead.
    val isDark = theme.palette.background.luminance() < 0.5f
    val base = if (isDark) {
        listOf(theme.palette.surfaceRaised, theme.palette.surfaceSunken)
    } else {
        listOf(theme.palette.brandPrimary, theme.palette.brandPrimary.copy(alpha = 0.82f))
    }
    val glow = theme.palette.brandAccent

    Box(
        modifier = modifier
            .background(Brush.linearGradient(base))
            .drawBehind {
                val warm = Offset(size.width * 0.95f, 0f)
                drawCircle(
                    brush = Brush.radialGradient(listOf(glow.copy(alpha = 0.55f), Color.Transparent), warm, size.width * 0.55f),
                    radius = size.width * 0.55f,
                    center = warm,
                )
                val soft = Offset(size.width * 0.05f, size.height)
                drawCircle(
                    brush = Brush.radialGradient(listOf(Color.White.copy(alpha = 0.12f), Color.Transparent), soft, size.width * 0.4f),
                    radius = size.width * 0.4f,
                    center = soft,
                )
            }
            .clearAndSetSemantics { },
        contentAlignment = Alignment.Center,
    ) {
        if (glyphSize != null) {
            Box(
                modifier = Modifier
                    .size(glyphSize * 2.4f)
                    .background(Color.White.copy(alpha = 0.14f), CircleShape)
                    .border(1.dp, Color.White.copy(alpha = 0.28f), CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    if (item.isEvent) Icons.Outlined.CalendarMonth else Icons.Outlined.Campaign,
                    contentDescription = null,
                    tint = Color.White,
                    modifier = Modifier.size(glyphSize),
                )
            }
        }
    }
}

/** "SEP" over "20", like a page torn from a desk calendar. */
@Composable
private fun DateTile(month: String, day: String) {
    val theme = LocalFaithFormTheme.current
    val display = MaterialTheme.typography.displayMedium.fontFamily
    val shape = RoundedCornerShape(FaithFormTokens.Radius.md)

    Column(
        modifier = Modifier
            .width(52.dp)
            .clip(shape)
            .background(theme.palette.surfaceRaised)
            .border(FaithFormTokens.BorderWidth.hairline, theme.palette.border, shape)
            // The card's own description already says the date in full.
            .clearAndSetSemantics { },
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            month,
            style = TextStyle(fontFamily = display, fontWeight = FontWeight.Bold, fontSize = 11.sp, letterSpacing = 0.8.sp),
            color = theme.palette.contentOnAccent,
            maxLines = 1,
            textAlign = TextAlign.Center,
            modifier = Modifier
                .fillMaxWidth()
                .background(theme.palette.brandAccent)
                .padding(vertical = 3.dp),
        )
        Text(
            day,
            style = TextStyle(fontFamily = display, fontWeight = FontWeight.Bold, fontSize = 24.sp, lineHeight = 28.sp),
            color = theme.palette.contentPrimary,
            maxLines = 1,
            modifier = Modifier.padding(vertical = 6.dp),
        )
    }
}

@Composable
private fun MetaRow(icon: ImageVector, text: String) {
    val theme = LocalFaithFormTheme.current
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Icon(icon, contentDescription = null, tint = theme.palette.brandAccent, modifier = Modifier.size(16.dp))
        Text(
            text,
            style = MaterialTheme.typography.bodyMedium,
            color = theme.palette.contentSecondary,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/** A small dark label over artwork, readable on a pale banner as well as a dark one. */
@Composable
private fun GlassChip(text: String, dot: Color) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        modifier = Modifier
            .background(Color.Black.copy(alpha = 0.45f), CircleShape)
            .border(0.5.dp, Color.White.copy(alpha = 0.18f), CircleShape)
            .padding(horizontal = 10.dp, vertical = 5.dp),
    ) {
        // A filled dot, not a pulse: an animation someone cannot switch off
        // is a distraction under reduced motion.
        Box(
            Modifier
                .size(7.dp)
                .background(dot, CircleShape),
        )
        Text(text, style = MaterialTheme.typography.labelLarge, color = Color.White, maxLines = 1)
    }
}

@Composable
private fun GlassPin() {
    Box(
        modifier = Modifier
            .size(30.dp)
            .background(Color.Black.copy(alpha = 0.45f), CircleShape)
            .border(0.5.dp, Color.White.copy(alpha = 0.18f), CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            Icons.Filled.PushPin,
            contentDescription = null,
            tint = Color.White,
            modifier = Modifier
                .size(15.dp)
                .rotate(45f),
        )
    }
}

@Composable
internal fun OfflineBanner(message: String) {
    val theme = LocalFaithFormTheme.current
    Text(
        message,
        style = MaterialTheme.typography.bodyMedium,
        color = theme.palette.warningContent,
        modifier = Modifier
            .fillMaxWidth()
            .background(theme.palette.warning, RoundedCornerShape(FaithFormTokens.Radius.md))
            .padding(FaithFormTokens.Spacing.md)
    )
}

@Composable
internal fun JoinPendingBanner() {
    val theme = LocalFaithFormTheme.current
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(theme.palette.warning, RoundedCornerShape(FaithFormTokens.Radius.md))
            .padding(FaithFormTokens.Spacing.md),
        verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.sm),
    ) {
        Text(
            stringResource(R.string.join_pending_home_title),
            style = MaterialTheme.typography.titleMedium,
            color = theme.palette.warningContent,
        )
        Text(
            stringResource(R.string.join_pending_home_body),
            style = MaterialTheme.typography.bodyMedium,
            color = theme.palette.warningContent,
        )
    }
}

/**
 * Always the church's timezone, never the device's: "Sunday at 10" means the
 * church's Sunday, and someone travelling must not see it shifted.
 */
fun formatWhen(item: FeedItem): String {
    val zone = AnnouncementTiming.churchZone(item)
    val start = AnnouncementTiming.start(item) ?: return ""

    if (item.allDay) {
        // Stored as midnight UTC on the date, so read in UTC — in the church's
        // zone it was the evening before.
        return DateTimeFormatter.ofPattern("EEEE d MMMM").format(start.atZone(ZoneOffset.UTC))
    }

    val startLocal = start.atZone(zone)
    val full = DateTimeFormatter.ofPattern("EEEE d MMMM, h:mm a")
    val timeOnly = DateTimeFormatter.ofPattern("h:mm a")
    val startText = full.format(startLocal)

    val end = AnnouncementTiming.end(item) ?: return startText
    val endLocal = end.atZone(zone)

    // Same day shows a time range; a multi-day event shows both dates.
    val endFormatter = if (startLocal.toLocalDate() == endLocal.toLocalDate()) timeOnly else full
    return "$startText – ${endFormatter.format(endLocal)}"
}

// ---------------------------------------------------------------------------
// One announcement
// ---------------------------------------------------------------------------

private val DetailBarHeight = 64.dp

/**
 * An announcement or event, in full.
 *
 * The banner is shown whole — its title and date are part of the artwork —
 * with a glow of its own colours behind it. Below it come the two things
 * someone opens an announcement to learn, when and where, then a way to keep
 * it, then the rest of what the church wrote. The back button floats over the
 * banner; once the banner has scrolled away the bar takes a background and
 * the title, so nothing scrolls under a bare arrow.
 */
@Composable
fun AnnouncementDetailScreen(item: FeedItem, onBack: () -> Unit, modifier: Modifier = Modifier) {
    val theme = LocalFaithFormTheme.current
    val scroll = rememberScrollState()
    val density = LocalDensity.current
    var heroHeight by remember { mutableIntStateOf(0) }
    val collapsed by remember {
        derivedStateOf {
            heroHeight > 0 && scroll.value > heroHeight - with(density) { DetailBarHeight.roundToPx() }
        }
    }

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(theme.palette.background),
    ) {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(scroll),
        ) {
            DetailHero(item, Modifier.onSizeChanged { heroHeight = it.height })
            DetailContent(item)
        }
        DetailTopBar(title = item.title, collapsed = collapsed, onBack = onBack)
    }
}

@Composable
private fun DetailTopBar(title: String, collapsed: Boolean, onBack: () -> Unit) {
    val theme = LocalFaithFormTheme.current
    val progress by animateFloatAsState(
        targetValue = if (collapsed) 1f else 0f,
        animationSpec = tween(theme.durationMillis(FaithFormTokens.Motion.STANDARD_MS)),
        label = "detail-bar",
    )

    Column {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(DetailBarHeight)
                .background(theme.palette.background.copy(alpha = progress))
                .padding(horizontal = FaithFormTokens.Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(
                onClick = onBack,
                colors = IconButtonDefaults.iconButtonColors(
                    // A translucent disc over the banner's glow, fading to a
                    // plain arrow once the bar has a background of its own.
                    containerColor = theme.palette.surface.copy(alpha = 0.85f * (1f - progress)),
                    contentColor = theme.palette.contentPrimary,
                ),
            ) {
                Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = stringResource(R.string.nav_back))
            }
            Text(
                title,
                style = MaterialTheme.typography.titleMedium,
                color = theme.palette.contentPrimary.copy(alpha = progress),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier
                    .padding(start = FaithFormTokens.Spacing.sm)
                    .weight(1f)
                    // Read once, from the heading below, not twice.
                    .clearAndSetSemantics { },
            )
        }
        Box(
            Modifier
                .fillMaxWidth()
                .height(FaithFormTokens.BorderWidth.hairline)
                .background(theme.palette.divider.copy(alpha = progress)),
        )
    }
}

/** The banner, whole, with a glow of itself behind it. */
@Composable
private fun DetailHero(item: FeedItem, modifier: Modifier = Modifier) {
    val theme = LocalFaithFormTheme.current
    val shape = RoundedCornerShape(FaithFormTokens.Radius.xl)
    // `Modifier.blur` is a no-op before Android 12, and an unblurred copy of
    // the banner behind itself would read as a mistake; older phones get the
    // brand's gradient instead.
    val canBlur = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
    val background = theme.palette.background

    Box(modifier.fillMaxWidth()) {
        Box(Modifier.matchParentSize()) {
            if (item.posterUrl != null && canBlur) {
                AsyncImage(
                    model = item.posterUrl,
                    contentDescription = null,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier
                        .matchParentSize()
                        .blur(48.dp, BlurredEdgeTreatment.Rectangle),
                )
            } else {
                AnnouncementPlaceholderArt(item, Modifier.matchParentSize(), glyphSize = null)
            }
            // The page's own colour at the top and bottom, the artwork's
            // between: a glow around the banner rather than a block behind it.
            Box(
                Modifier
                    .matchParentSize()
                    .background(
                        Brush.verticalGradient(
                            0f to background,
                            0.22f to background.copy(alpha = 0.55f),
                            0.5f to background.copy(alpha = 0.05f),
                            0.8f to background.copy(alpha = 0.6f),
                            1f to background,
                        ),
                    ),
            )
        }

        Box(
            modifier = Modifier
                .padding(
                    start = FaithFormTokens.Layout.screenPaddingHorizontal,
                    end = FaithFormTokens.Layout.screenPaddingHorizontal,
                    top = DetailBarHeight + FaithFormTokens.Spacing.sm,
                    bottom = FaithFormTokens.Spacing.lg,
                )
                .fillMaxWidth()
                .aspectRatio(BANNER_ASPECT_RATIO)
                .shadow(if (theme.usesDecorativeShadow) 16.dp else 0.dp, shape)
                .clip(shape)
                .border(FaithFormTokens.BorderWidth.hairline, Color.White.copy(alpha = 0.16f), shape)
                .then(
                    item.posterAltText?.let { alt -> Modifier.semantics { contentDescription = alt } }
                        ?: Modifier.clearAndSetSemantics { },
                ),
        ) {
            PosterArtwork(item, Modifier.matchParentSize(), placeholderGlyph = 40.dp)
        }
    }
}

@Composable
private fun DetailContent(item: FeedItem) {
    val theme = LocalFaithFormTheme.current
    val context = LocalContext.current
    val allDay = stringResource(R.string.announcement_all_day)
    val whenText = AnnouncementFormatting.detailWhen(item, allDay)
    val moment = AnnouncementTiming.moment(item)
    val momentText = momentLabel(moment)
    val posted = postedLine(item)
    val shareText = listOfNotNull(
        item.title,
        listOfNotNull(whenText.date, whenText.time).joinToString(" · "),
        item.location,
        item.churchName,
    ).filter { it.isNotBlank() }.joinToString("\n")

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = FaithFormTokens.Layout.screenPaddingHorizontal)
            .padding(bottom = FaithFormTokens.Spacing.xxl),
        verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.lg),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.sm)) {
            if (momentText != null || item.isPinned) {
                Row(horizontalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.sm)) {
                    if (momentText != null) {
                        val live = moment == AnnouncementMoment.HAPPENING_NOW
                        Pill(
                            momentText,
                            background = if (live) theme.palette.live else theme.palette.surfaceSunken,
                            content = if (live) theme.palette.liveContent else theme.palette.contentSecondary,
                        )
                    }
                    if (item.isPinned) {
                        Pill(
                            stringResource(R.string.pinned_label),
                            background = theme.palette.surfaceSunken,
                            content = theme.palette.contentSecondary,
                        )
                    }
                }
            }
            Text(
                item.title,
                style = MaterialTheme.typography.displayMedium,
                color = theme.palette.contentPrimary,
                modifier = Modifier.semantics { heading() },
            )
            Text(
                listOfNotNull(item.churchName, posted).joinToString(" · "),
                style = MaterialTheme.typography.labelSmall,
                color = theme.mutedContent,
            )
        }

        val cardShape = RoundedCornerShape(FaithFormTokens.Radius.xl)
        Column(
            Modifier
                .fillMaxWidth()
                .clip(cardShape)
                .background(theme.palette.surface)
                .border(FaithFormTokens.BorderWidth.hairline, theme.palette.border, cardShape),
        ) {
            InfoRow(Icons.Outlined.CalendarMonth, whenText.date, whenText.time)
            item.location?.takeIf { it.isNotBlank() }?.let { location ->
                Box(
                    Modifier
                        .padding(start = FaithFormTokens.Spacing.base + 42.dp + FaithFormTokens.Spacing.md)
                        .fillMaxWidth()
                        .height(FaithFormTokens.BorderWidth.hairline)
                        .background(theme.palette.divider),
                )
                InfoRow(
                    icon = Icons.Outlined.Place,
                    title = location,
                    subtitle = stringResource(R.string.announcement_directions),
                    trailing = Icons.Outlined.NorthEast,
                    onClickLabel = stringResource(R.string.announcement_directions_hint),
                    onClick = { context.openDirections(location) },
                )
            }
        }

        Row(
            horizontalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.md),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Button(
                onClick = { context.addToCalendar(item) },
                modifier = Modifier
                    .weight(1f)
                    .heightIn(min = FaithFormTokens.TouchTarget.recommended),
                shape = RoundedCornerShape(FaithFormTokens.Radius.control),
                colors = ButtonDefaults.buttonColors(
                    containerColor = theme.palette.brandAccent,
                    contentColor = theme.palette.contentOnAccent,
                ),
            ) {
                Icon(Icons.Outlined.EditCalendar, contentDescription = null, modifier = Modifier.size(20.dp))
                Spacer(Modifier.width(FaithFormTokens.Spacing.sm))
                Text(stringResource(R.string.announcement_add_to_calendar), style = MaterialTheme.typography.titleMedium)
            }
            OutlinedIconButton(
                onClick = { context.share(item.title, shareText) },
                modifier = Modifier.size(FaithFormTokens.TouchTarget.recommended),
                shape = RoundedCornerShape(FaithFormTokens.Radius.control),
                border = BorderStroke(theme.borderWidth, theme.palette.brandPrimary.copy(alpha = 0.45f)),
            ) {
                Icon(
                    Icons.Outlined.Share,
                    contentDescription = stringResource(R.string.announcement_share),
                    tint = theme.palette.contentPrimary,
                )
            }
        }

        if (item.body.isNotBlank()) {
            Column(verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.sm)) {
                Text(
                    stringResource(R.string.announcement_details).uppercase(),
                    style = MaterialTheme.typography.labelLarge.copy(letterSpacing = 1.sp),
                    color = theme.mutedContent,
                    modifier = Modifier.semantics { heading() },
                )
                SelectionContainer {
                    Text(
                        linked(item.body, theme.palette.brandPrimary),
                        style = MaterialTheme.typography.bodyLarge,
                        color = theme.palette.contentPrimary,
                    )
                }
            }
        }
    }
}

@Composable
private fun Pill(text: String, background: Color, content: Color) {
    Text(
        text,
        style = MaterialTheme.typography.labelLarge,
        color = content,
        modifier = Modifier
            .background(background, CircleShape)
            .padding(horizontal = FaithFormTokens.Spacing.sm, vertical = FaithFormTokens.Spacing.xs),
    )
}

/** One row of the when-and-where card. */
@Composable
private fun InfoRow(
    icon: ImageVector,
    title: String,
    subtitle: String?,
    trailing: ImageVector? = null,
    onClickLabel: String? = null,
    onClick: (() -> Unit)? = null,
) {
    val theme = LocalFaithFormTheme.current
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .then(
                if (onClick != null) {
                    Modifier.clickable(onClickLabel = onClickLabel, role = Role.Button, onClick = onClick)
                } else {
                    Modifier
                },
            )
            .padding(FaithFormTokens.Spacing.base)
            .semantics(mergeDescendants = true) {},
        horizontalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .size(42.dp)
                .background(theme.palette.brandAccent.copy(alpha = 0.18f), RoundedCornerShape(FaithFormTokens.Radius.md)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, contentDescription = null, tint = theme.palette.brandPrimary, modifier = Modifier.size(20.dp))
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium, color = theme.palette.contentPrimary)
            subtitle?.let {
                Text(it, style = MaterialTheme.typography.bodyMedium, color = theme.palette.contentSecondary)
            }
        }
        trailing?.let {
            Icon(it, contentDescription = null, tint = theme.mutedContent, modifier = Modifier.size(18.dp))
        }
    }
}

@Composable
private fun postedLine(item: FeedItem): String? {
    val posted = AnnouncementTiming.parseInstant(item.publishedAt) ?: return null
    val now = System.currentTimeMillis()
    val relative = DateUtils.getRelativeTimeSpanString(
        minOf(posted.toEpochMilli(), now),
        now,
        DateUtils.MINUTE_IN_MILLIS,
    ).toString()
    return stringResource(R.string.announcement_posted, relative)
}

/**
 * Web addresses and phone numbers in what the church wrote, made tappable and
 * underlined — the link colour alone is too close to the text's.
 */
private fun linked(text: String, linkColor: Color): AnnotatedString = buildAnnotatedString {
    append(text)
    val style = TextLinkStyles(SpanStyle(color = linkColor, textDecoration = TextDecoration.Underline))
    val taken = mutableListOf<IntRange>()

    val web = Patterns.WEB_URL.matcher(text)
    while (web.find()) {
        val raw = web.group()
        // A bare domain inside an email address is not a link to open.
        if (web.start() > 0 && text[web.start() - 1] == '@') continue
        val url = if (raw.startsWith("http://", true) || raw.startsWith("https://", true)) raw else "https://$raw"
        addLink(LinkAnnotation.Url(url, style), web.start(), web.end())
        taken += web.start() until web.end()
    }

    val phone = Patterns.PHONE.matcher(text)
    while (phone.find()) {
        val range = phone.start() until phone.end()
        val digits = phone.group().filter { it.isDigit() || it == '+' }
        // The pattern is generous — "412 Main St" matches it — so only
        // something with a phone number's worth of digits is linked.
        if (digits.count { it.isDigit() } < 7 || taken.any { it.first <= range.last && range.first <= it.last }) continue
        addLink(LinkAnnotation.Url("tel:$digits", style), phone.start(), phone.end())
    }
}

// ---------------------------------------------------------------------------
// Handing off to other apps
// ---------------------------------------------------------------------------

private fun Context.startSafely(intent: Intent): Boolean = try {
    startActivity(intent)
    true
} catch (_: ActivityNotFoundException) {
    false
}

/** The calendar app's own insert screen: no calendar permission needed. */
private fun Context.addToCalendar(item: FeedItem) {
    val span = AnnouncementTiming.calendarSpan(item) ?: return
    val intent = Intent(Intent.ACTION_INSERT, CalendarContract.Events.CONTENT_URI)
        .putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, span.beginMillis)
        .putExtra(CalendarContract.EXTRA_EVENT_END_TIME, span.endMillis)
        .putExtra(CalendarContract.EXTRA_EVENT_ALL_DAY, span.allDay)
        .putExtra(CalendarContract.Events.EVENT_TIMEZONE, span.timeZone)
        .putExtra(CalendarContract.Events.TITLE, item.title)
    item.location?.takeIf { it.isNotBlank() }?.let { intent.putExtra(CalendarContract.Events.EVENT_LOCATION, it) }
    if (item.body.isNotBlank()) intent.putExtra(CalendarContract.Events.DESCRIPTION, item.body)
    startSafely(intent)
}

private fun Context.openDirections(location: String) {
    val query = Uri.encode(location)
    if (!startSafely(Intent(Intent.ACTION_VIEW, Uri.parse("geo:0,0?q=$query")))) {
        startSafely(Intent(Intent.ACTION_VIEW, Uri.parse("https://www.google.com/maps/search/?api=1&query=$query")))
    }
}

private fun Context.share(subject: String, text: String) {
    val send = Intent(Intent.ACTION_SEND)
        .setType("text/plain")
        .putExtra(Intent.EXTRA_SUBJECT, subject)
        .putExtra(Intent.EXTRA_TEXT, text)
    startSafely(Intent.createChooser(send, null))
}
