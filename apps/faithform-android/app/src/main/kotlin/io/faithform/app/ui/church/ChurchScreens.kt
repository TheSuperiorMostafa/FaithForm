package io.faithform.app.ui.church

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.text.format.DateFormat
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.MutableTransitionState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.slideInVertically
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.LocalIndication
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material.icons.outlined.AlternateEmail
import androidx.compose.material.icons.outlined.Block
import androidx.compose.material.icons.outlined.CameraAlt
import androidx.compose.material.icons.outlined.Directions
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material.icons.outlined.Language
import androidx.compose.material.icons.outlined.Link
import androidx.compose.material.icons.outlined.MailOutline
import androidx.compose.material.icons.outlined.MusicNote
import androidx.compose.material.icons.outlined.Phone
import androidx.compose.material.icons.outlined.Place
import androidx.compose.material.icons.outlined.Podcasts
import androidx.compose.material.icons.outlined.SearchOff
import androidx.compose.material.icons.outlined.SmartDisplay
import androidx.compose.material.icons.outlined.SwapHoriz
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material.icons.outlined.WifiOff
import androidx.compose.material.icons.rounded.Schedule
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.PullToRefreshDefaults
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.layout.layout
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.faithform.app.R
import io.faithform.app.contract.ChurchProfile
import io.faithform.app.contract.ChurchQuickLink
import io.faithform.app.contract.ChurchSocialLink
import io.faithform.app.contract.PublicCampus
import io.faithform.app.contract.PublicServiceTime
import io.faithform.app.design.FaithFormTokens
import io.faithform.app.design.LocalFaithFormTheme
import io.faithform.app.ui.account.openWebLink
import io.faithform.app.ui.brand.rememberReducedMotion
import io.faithform.app.ui.components.ChurchProfileSkeleton
import io.faithform.app.ui.components.FaithFormWorkingLabel
import io.faithform.app.ui.discovery.EmptyState
import java.time.Instant
import java.time.chrono.IsoChronology
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeFormatterBuilder
import java.time.format.FormatStyle
import java.time.format.TextStyle
import java.util.Locale
import kotlin.math.ceil
import kotlin.math.floor

private val CardRadius = 20.dp
private val BarHeight = 64.dp
private val QuickActionOverlap = 28.dp

private enum class Confirmation { SWITCH, REMOVE }

/**
 * A church's page: what it is, when it meets, where, and how to reach it — and
 * what this person can do about it.
 *
 * One screen, two doors. From search it is how someone weighs a church before
 * making it theirs ([ChurchAction.ADD], [ChurchAction.SWITCH], an invitation);
 * from Home's "Church info" it is their own church's page
 * ([ChurchAction.CURRENT]), with "Change church" and "Remove church" at the
 * foot. Everything on it is controlled from the church's web dashboard. Same
 * information hierarchy as the SwiftUI `ChurchProfileView`, drawn with
 * Android's own components.
 *
 * The cover runs edge to edge under a bar that turns solid, with the church's
 * name, once the cover has scrolled away. In discovery the primary action
 * sticks to the bottom, so it is reachable from anywhere on the page.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChurchInfoScreen(
    phase: ChurchProfilePhase,
    hasOtherChurch: Boolean,
    currentChurchName: String?,
    isActing: Boolean,
    actionError: String?,
    isRefreshing: Boolean,
    onRefresh: () -> Unit,
    onRetry: () -> Unit,
    onBack: (() -> Unit)?,
    onAdd: () -> Unit,
    onHaveInvitation: () -> Unit,
    onChangeChurch: (() -> Unit)?,
    onRemove: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val theme = LocalFaithFormTheme.current
    val density = LocalDensity.current
    val haptics = LocalHapticFeedback.current
    val scroll = rememberScrollState()
    val barHeightPx = with(density) { BarHeight.toPx() }
    var heroHeightPx by remember { mutableIntStateOf(0) }
    var stickyHeightPx by remember { mutableIntStateOf(0) }
    var confirming by rememberSaveable { mutableStateOf<Confirmation?>(null) }

    if (onBack != null) BackHandler(onBack = onBack)

    val profile = (phase as? ChurchProfilePhase.Loaded)?.profile
    val action = profile?.let { ChurchActions.forProfile(it, hasOtherChurch) }
    val hasStickyAction = action == ChurchAction.ADD ||
        action == ChurchAction.SWITCH ||
        action == ChurchAction.INVITATION_REQUIRED
    // Over the cover the bar is clear; with no cover to sit over, it is solid.
    val overCover = phase is ChurchProfilePhase.Loaded || phase is ChurchProfilePhase.Loading
    val collapse = remember(overCover) {
        derivedStateOf {
            when {
                !overCover -> 1f
                heroHeightPx == 0 -> 0f
                else -> ((scroll.value - (heroHeightPx - 2 * barHeightPx)) / barHeightPx).coerceIn(0f, 1f)
            }
        }
    }

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(theme.palette.background),
    ) {
        val pullState = rememberPullToRefreshState()
        PullToRefreshBox(
            isRefreshing = isRefreshing,
            onRefresh = onRefresh,
            state = pullState,
            modifier = Modifier.fillMaxSize(),
            indicator = {
                PullToRefreshDefaults.Indicator(
                    state = pullState,
                    isRefreshing = isRefreshing,
                    modifier = Modifier
                        .align(Alignment.TopCenter)
                        .padding(top = BarHeight),
                    containerColor = theme.palette.surface,
                    color = theme.palette.brandAccent,
                )
            },
        ) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .verticalScroll(scroll),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                when (phase) {
                    is ChurchProfilePhase.Loading -> ChurchProfileSkeleton()

                    is ChurchProfilePhase.Loaded -> LoadedContent(
                        profile = phase.profile,
                        action = checkNotNull(action),
                        scrollOffset = { scroll.value },
                        onHeroHeight = { heroHeightPx = it },
                        isActing = isActing,
                        actionError = actionError,
                        onChangeChurch = onChangeChurch,
                        onRemove = { confirming = Confirmation.REMOVE },
                    )

                    // A hidden church and an unknown slug read identically, on purpose.
                    is ChurchProfilePhase.NotFound -> StatePage {
                        EmptyState(
                            stringResource(R.string.no_results_title),
                            stringResource(R.string.no_results_body),
                            icon = Icons.Outlined.SearchOff,
                        )
                    }

                    is ChurchProfilePhase.Offline -> StatePage {
                        EmptyState(
                            stringResource(R.string.offline_title),
                            stringResource(R.string.offline_body),
                            icon = Icons.Outlined.WifiOff,
                            onRetry = onRetry,
                        )
                    }

                    is ChurchProfilePhase.Failed -> StatePage {
                        EmptyState(
                            stringResource(R.string.error_title),
                            phase.message,
                            icon = Icons.Outlined.WarningAmber,
                            onRetry = onRetry,
                        )
                    }
                }
                val stickySpace = if (hasStickyAction) with(density) { stickyHeightPx.toDp() } else 0.dp
                Spacer(Modifier.height(stickySpace + FaithFormTokens.Spacing.xl))
            }
        }

        ChurchInfoTopBar(
            title = profile?.name,
            progress = { collapse.value },
            onBack = onBack,
        )

        if (profile != null && hasStickyAction) {
            StickyActionBar(
                action = checkNotNull(action),
                isActing = isActing,
                actionError = actionError,
                onPrimary = {
                    if (action == ChurchAction.SWITCH) confirming = Confirmation.SWITCH else onAdd()
                },
                onHaveInvitation = onHaveInvitation,
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .onSizeChanged { stickyHeightPx = it.height },
            )
        }
    }

    if (profile != null) {
        when (confirming) {
            Confirmation.SWITCH -> ConfirmDialog(
                title = stringResource(R.string.switch_church_confirm_title, profile.name),
                body = stringResource(
                    R.string.switch_church_confirm_body,
                    currentChurchName ?: stringResource(R.string.your_church),
                ),
                confirmLabel = stringResource(R.string.switch_church_confirm_action),
                destructive = false,
                onConfirm = {
                    confirming = null
                    onAdd()
                },
                onDismiss = { confirming = null },
            )

            Confirmation.REMOVE -> ConfirmDialog(
                title = stringResource(R.string.remove_church_confirm_title, profile.name),
                body = stringResource(R.string.remove_church_confirm_body),
                confirmLabel = stringResource(R.string.remove_church_confirm_action),
                destructive = true,
                onConfirm = {
                    confirming = null
                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                    onRemove()
                },
                onDismiss = { confirming = null },
            )

            null -> Unit
        }
    }
}

@Composable
private fun StatePage(content: @Composable () -> Unit) {
    Column(
        modifier = Modifier
            .widthIn(max = FaithFormTokens.Layout.contentMaxWidth)
            .fillMaxWidth()
            .padding(top = BarHeight + FaithFormTokens.Spacing.xl),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) { content() }
}

// ---------------------------------------------------------------------------
// The page itself
// ---------------------------------------------------------------------------

@Composable
private fun LoadedContent(
    profile: ChurchProfile,
    action: ChurchAction,
    scrollOffset: () -> Int,
    onHeroHeight: (Int) -> Unit,
    isActing: Boolean,
    actionError: String?,
    onChangeChurch: (() -> Unit)?,
    onRemove: () -> Unit,
) {
    val context = LocalContext.current
    val dayNames = dayNames()
    val timeFormatter = rememberServiceTimeFormatter()
    val quickActions = remember(profile) { ChurchLinks.quickActions(profile) }
    val groups = remember(profile) { ServiceTimes.groups(profile) }
    // Worked out again whenever the page is refreshed, so "Today" moves on.
    val next = remember(profile) {
        ServiceTimes.next(profile.serviceTimes, ServiceTimes.zone(profile.timezone), Instant.now())
    }
    val about = remember(profile) { ChurchActions.aboutText(profile) }
    val socials = profile.socialLinks.orEmpty().filter { ChurchLinks.webUrl(it.url) != null }
    val links = profile.quickLinks.orEmpty().filter { ChurchLinks.webUrl(it.url) != null && it.label.isNotBlank() }
    val overlap = if (quickActions.isEmpty()) 0.dp else QuickActionOverlap
    val horizontal = Modifier.padding(horizontal = FaithFormTokens.Layout.screenPaddingHorizontal)

    ChurchHero(
        coverImageUrl = profile.coverImageUrl,
        logoUrl = profile.logoUrl,
        name = profile.name,
        tagline = profile.tagline,
        detailLine = ChurchActions.detailLine(profile),
        isYourChurch = action == ChurchAction.CURRENT,
        scrollOffset = scrollOffset,
        topInset = BarHeight,
        bottomInset = overlap,
        modifier = Modifier.onSizeChanged { onHeroHeight(it.height) },
    )

    Column(
        modifier = Modifier
            .widthIn(max = FaithFormTokens.Layout.contentMaxWidth)
            .fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.lg + FaithFormTokens.Spacing.xs),
    ) {
        var index = 0

        if (quickActions.isNotEmpty()) {
            StaggeredSection(index++, Modifier.overlapUpward(overlap)) {
                QuickActionsCard(
                    actions = quickActions,
                    onAction = { context.open(it) },
                    modifier = horizontal,
                )
            }
        } else {
            Spacer(Modifier.height(0.dp))
        }

        if (action == ChurchAction.UNAVAILABLE) {
            StaggeredSection(index++) { UnavailableNotice(horizontal) }
        }

        next?.let { upcoming ->
            StaggeredSection(index++) {
                NextServiceCard(
                    next = upcoming,
                    dayName = dayNames[upcoming.service.dayOfWeek.coerceIn(0, 6)],
                    time = formatTime(upcoming.service.startTime, timeFormatter),
                    campusName = profile.campuses
                        .takeIf { it.size > 1 }
                        ?.firstOrNull { it.slug == upcoming.service.campusSlug }
                        ?.name,
                    modifier = horizontal,
                )
            }
        }

        if (groups.isNotEmpty()) {
            StaggeredSection(index++) {
                Section(stringResource(R.string.service_times_title), horizontal) {
                    ServiceTimesCard(groups, dayNames, timeFormatter)
                }
            }
        }

        about?.let { text ->
            StaggeredSection(index++) {
                Section(stringResource(R.string.about_title), horizontal) { AboutCard(text) }
            }
        }

        if (socials.isNotEmpty()) {
            StaggeredSection(index++) {
                ConnectSection(socials, onOpen = { openWebLink(context, it) })
            }
        }

        if (links.isNotEmpty()) {
            StaggeredSection(index++) {
                Section(stringResource(R.string.links_title), horizontal) {
                    LinksCard(links, onOpen = { openWebLink(context, it) })
                }
            }
        }

        if (profile.campuses.isNotEmpty()) {
            StaggeredSection(index++) {
                Section(stringResource(R.string.locations_title), horizontal) {
                    Column(verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.md)) {
                        profile.campuses
                            .sortedByDescending { it.isPrimary }
                            .forEach { campus ->
                                CampusCard(campus, onDirections = { context.openDirections(it) })
                            }
                    }
                }
            }
        }

        val contact = contactRows(profile)
        if (contact.isNotEmpty()) {
            StaggeredSection(index++) {
                Section(stringResource(R.string.contact_title), horizontal) {
                    ContactCard(contact, onOpen = { context.open(it) })
                }
            }
        }

        if (action == ChurchAction.CURRENT) {
            StaggeredSection(index) {
                CurrentChurchFooter(
                    isActing = isActing,
                    actionError = actionError,
                    onChangeChurch = onChangeChurch,
                    onRemove = onRemove,
                    modifier = horizontal,
                )
            }
        }
    }
}

/**
 * Lays [this] out [overlap] shorter and draws it that much higher, so it
 * floats over the bottom edge of whatever came before it without leaving a gap
 * behind it.
 */
private fun Modifier.overlapUpward(overlap: Dp): Modifier = layout { measurable, constraints ->
    val placeable = measurable.measure(constraints)
    val shift = overlap.roundToPx().coerceAtMost(placeable.height)
    layout(placeable.width, placeable.height - shift) { placeable.place(0, -shift) }
}

/**
 * Sections arrive one after another, a beat apart, rising slightly as they
 * fade in. Reduced motion (the theme's or Android's "Remove animations") shows
 * them at once; Compose already scales every duration by the system's
 * animator duration scale.
 */
@Composable
private fun StaggeredSection(
    index: Int,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    val theme = LocalFaithFormTheme.current
    val reduceMotion = rememberReducedMotion()
    val visible = remember { MutableTransitionState(reduceMotion).apply { targetState = true } }
    val duration = theme.durationMillis(FaithFormTokens.Motion.SLOW_MS)
    val delay = if (reduceMotion) 0 else (index * 55).coerceAtMost(385)
    AnimatedVisibility(
        visibleState = visible,
        modifier = modifier,
        enter = fadeIn(tween(duration, delayMillis = delay)) +
            if (reduceMotion) {
                EnterTransition.None
            } else {
                slideInVertically(tween(duration, delayMillis = delay, easing = FastOutSlowInEasing)) { it / 6 }
            },
        exit = ExitTransition.None,
        label = "church-section",
    ) { content() }
}

/** A section: its label in the muted label style, then its content. */
@Composable
private fun Section(
    title: String,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.md),
    ) {
        SectionTitle(title)
        content()
    }
}

@Composable
private fun SectionTitle(title: String, modifier: Modifier = Modifier) {
    val theme = LocalFaithFormTheme.current
    Text(
        title,
        style = MaterialTheme.typography.labelLarge,
        color = theme.mutedContent,
        modifier = modifier.semantics { heading() },
    )
}

/** The page's card: the surface, a hairline of border, and a soft shadow where decoration is on. */
@Composable
private fun InfoCard(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    val theme = LocalFaithFormTheme.current
    val shape = RoundedCornerShape(CardRadius)
    Column(
        modifier = modifier
            .fillMaxWidth()
            .then(
                if (theme.usesDecorativeShadow) {
                    Modifier.shadow(2.dp, shape, ambientColor = Color.Black.copy(alpha = 0.06f), spotColor = Color.Black.copy(alpha = 0.08f))
                } else {
                    Modifier
                },
            )
            .clip(shape)
            .background(theme.palette.surface)
            .border(theme.borderWidth, theme.palette.border, shape),
        content = content,
    )
}

/** A rounded tonal square holding an icon — the page's one icon shape. */
@Composable
private fun IconTile(
    icon: ImageVector,
    modifier: Modifier = Modifier,
    size: Dp = 40.dp,
    background: Color = LocalFaithFormTheme.current.palette.brandAccent.copy(alpha = 0.16f),
    tint: Color = LocalFaithFormTheme.current.palette.brandPrimary,
) {
    Box(
        modifier = modifier
            .size(size)
            .background(background, RoundedCornerShape(size * 0.32f)),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(size * 0.52f))
    }
}

// ---------------------------------------------------------------------------
// Top bar
// ---------------------------------------------------------------------------

/**
 * Clear over the cover, with the back arrow on a dark disc so it reads over
 * any photo; solid, with the church's name, once the cover has gone by.
 */
@Composable
private fun ChurchInfoTopBar(title: String?, progress: () -> Float, onBack: (() -> Unit)?) {
    val theme = LocalFaithFormTheme.current
    val collapsed = progress()
    Column(Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(BarHeight)
                .drawBehind { drawRect(theme.palette.background.copy(alpha = collapsed)) }
                .padding(horizontal = FaithFormTokens.Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (onBack != null) {
                IconButton(
                    onClick = onBack,
                    colors = IconButtonDefaults.iconButtonColors(
                        containerColor = Color.Black.copy(alpha = 0.42f * (1f - collapsed)),
                        contentColor = lerp(Color.White, theme.palette.contentPrimary, collapsed),
                    ),
                ) {
                    Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = stringResource(R.string.nav_back))
                }
            }
            Text(
                title.orEmpty(),
                style = MaterialTheme.typography.titleMedium,
                color = theme.palette.contentPrimary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier
                    .padding(start = FaithFormTokens.Spacing.sm)
                    .weight(1f)
                    .graphicsLayer { alpha = progress() }
                    // Read once, from the heading on the cover, not twice.
                    .clearAndSetSemantics { },
            )
        }
        Box(
            Modifier
                .fillMaxWidth()
                .height(FaithFormTokens.BorderWidth.hairline)
                .drawBehind { drawRect(theme.palette.divider.copy(alpha = collapsed)) },
        )
    }
}

// ---------------------------------------------------------------------------
// Quick actions
// ---------------------------------------------------------------------------

/**
 * Directions, Call, Email and Website — only those the church filled in — on a
 * card that floats over the cover's edge. As many tiles share a row as their
 * labels allow, so a longer translation or a larger font wraps to two rows of
 * two instead of cutting words off.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun QuickActionsCard(
    actions: List<QuickAction>,
    onAction: (QuickAction) -> Unit,
    modifier: Modifier = Modifier,
) {
    val theme = LocalFaithFormTheme.current
    val shape = RoundedCornerShape(FaithFormTokens.Radius.xl)
    val labels = actions.map { stringResource(it.labelRes) }
    val measurer = rememberTextMeasurer()
    val labelStyle = MaterialTheme.typography.labelLarge
    val density = LocalDensity.current

    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = shape,
        color = theme.palette.surface,
        tonalElevation = 3.dp,
        shadowElevation = if (theme.usesDecorativeShadow) 10.dp else 0.dp,
        border = if (theme.usesDecorativeShadow) null else BorderStroke(theme.borderWidth, theme.palette.border),
    ) {
        BoxWithConstraints(Modifier.padding(FaithFormTokens.Spacing.sm)) {
            val gap = FaithFormTokens.Spacing.xs
            val widestLabel = labels.maxOf { label ->
                measurer.measure(label, labelStyle, maxLines = 1).size.width
            }
            val tileMin = maxOf(with(density) { widestLabel.toDp() } + TilePadding * 2, 64.dp)
            val fits = floor((maxWidth + gap) / (tileMin + gap)).toInt().coerceIn(1, actions.size)
            // Balanced rows: four that do not fit in one become two and two, not three and one.
            val rows = ceil(actions.size / fits.toFloat()).toInt()
            val perRow = ceil(actions.size / rows.toFloat()).toInt()

            FlowRow(
                maxItemsInEachRow = perRow,
                horizontalArrangement = Arrangement.spacedBy(gap),
                verticalArrangement = Arrangement.spacedBy(gap),
                modifier = Modifier.fillMaxWidth(),
            ) {
                actions.forEachIndexed { index, action ->
                    QuickActionTile(
                        icon = action.icon,
                        label = labels[index],
                        onClick = { onAction(action) },
                        modifier = Modifier.weight(1f),
                    )
                }
            }
        }
    }
}

private val TilePadding = 6.dp

@Composable
private fun QuickActionTile(
    icon: ImageVector,
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val theme = LocalFaithFormTheme.current
    val reduceMotion = rememberReducedMotion()
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val scale by animateFloatAsState(
        targetValue = if (pressed && !reduceMotion) 0.94f else 1f,
        animationSpec = tween(FaithFormTokens.Motion.FAST_MS),
        label = "tile-press",
    )
    val shape = RoundedCornerShape(FaithFormTokens.Radius.lg)

    Column(
        modifier = modifier
            .graphicsLayer {
                scaleX = scale
                scaleY = scale
            }
            .clip(shape)
            .clickable(
                interactionSource = interaction,
                indication = LocalIndication.current,
                role = Role.Button,
                onClick = onClick,
            )
            .heightIn(min = 76.dp)
            .padding(horizontal = TilePadding, vertical = FaithFormTokens.Spacing.md),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.sm, Alignment.CenterVertically),
    ) {
        IconTile(icon, size = 44.dp)
        Text(
            label,
            style = MaterialTheme.typography.labelLarge,
            color = theme.palette.contentPrimary,
            textAlign = TextAlign.Center,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

private val QuickAction.labelRes: Int
    get() = when (this) {
        is QuickAction.Directions -> R.string.action_directions
        is QuickAction.Call -> R.string.action_call
        is QuickAction.Email -> R.string.action_email
        is QuickAction.Website -> R.string.action_website
    }

private val QuickAction.icon: ImageVector
    get() = when (this) {
        is QuickAction.Directions -> Icons.Outlined.Directions
        is QuickAction.Call -> Icons.Outlined.Phone
        is QuickAction.Email -> Icons.Outlined.MailOutline
        is QuickAction.Website -> Icons.Outlined.Language
    }

// ---------------------------------------------------------------------------
// Primary action
// ---------------------------------------------------------------------------

/**
 * "Add church", "Make this my church", or the invitation entry, held at the
 * bottom of the screen above a shadow so it is always one tap away.
 */
@Composable
private fun StickyActionBar(
    action: ChurchAction,
    isActing: Boolean,
    actionError: String?,
    onPrimary: () -> Unit,
    onHaveInvitation: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val theme = LocalFaithFormTheme.current
    Surface(
        modifier = modifier.fillMaxWidth(),
        color = theme.palette.surface,
        shadowElevation = if (theme.usesDecorativeShadow) 16.dp else 0.dp,
    ) {
        Column(Modifier.fillMaxWidth()) {
            if (!theme.usesDecorativeShadow) HorizontalDivider(thickness = theme.borderWidth, color = theme.palette.border)
            Column(
                modifier = Modifier
                    .navigationBarsPadding()
                    .align(Alignment.CenterHorizontally)
                    .widthIn(max = FaithFormTokens.Layout.contentMaxWidth)
                    .fillMaxWidth()
                    .padding(
                        horizontal = FaithFormTokens.Layout.screenPaddingHorizontal,
                        vertical = FaithFormTokens.Spacing.md,
                    ),
                verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.sm),
            ) {
                val fill = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 52.dp)
                when (action) {
                    ChurchAction.ADD, ChurchAction.SWITCH -> Button(
                        onClick = onPrimary,
                        enabled = !isActing,
                        modifier = fill,
                    ) {
                        FaithFormWorkingLabel(
                            text = stringResource(
                                if (action == ChurchAction.ADD) R.string.add_church else R.string.make_my_church,
                            ),
                            working = isActing,
                            style = MaterialTheme.typography.titleMedium,
                        )
                    }

                    ChurchAction.INVITATION_REQUIRED -> {
                        Text(
                            stringResource(R.string.invite_only_explainer),
                            style = MaterialTheme.typography.bodyMedium,
                            color = theme.palette.contentSecondary,
                        )
                        OutlinedButton(
                            onClick = onHaveInvitation,
                            modifier = fill,
                            border = BorderStroke(theme.borderWidth, theme.palette.borderStrong),
                        ) {
                            Text(
                                stringResource(R.string.have_invitation_link),
                                style = MaterialTheme.typography.titleMedium,
                                color = theme.palette.contentPrimary,
                            )
                        }
                    }

                    else -> Unit
                }
                actionError?.let { ActionErrorText(it) }
            }
        }
    }
}

@Composable
private fun ActionErrorText(message: String) {
    val theme = LocalFaithFormTheme.current
    Text(
        message,
        style = MaterialTheme.typography.bodyMedium,
        color = theme.palette.destructive,
        modifier = Modifier
            .fillMaxWidth()
            // Announced as it appears: the person just pressed a button and
            // is waiting to hear what happened.
            .semantics { liveRegion = LiveRegionMode.Assertive },
    )
}

@Composable
private fun UnavailableNotice(modifier: Modifier = Modifier) {
    val theme = LocalFaithFormTheme.current
    InfoCard(modifier) {
        Row(
            modifier = Modifier
                .padding(FaithFormTokens.Spacing.base)
                .semantics(mergeDescendants = true) {},
            horizontalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.md),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconTile(
                Icons.Outlined.Block,
                background = theme.palette.destructive.copy(alpha = 0.12f),
                tint = theme.palette.destructive,
            )
            Text(
                stringResource(R.string.blocked_body),
                style = MaterialTheme.typography.bodyMedium,
                color = theme.palette.contentSecondary,
                modifier = Modifier.weight(1f),
            )
        }
    }
}

/** "Change church" and "Remove church", at the foot of the person's own church. */
@Composable
private fun CurrentChurchFooter(
    isActing: Boolean,
    actionError: String?,
    onChangeChurch: (() -> Unit)?,
    onRemove: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val theme = LocalFaithFormTheme.current
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(top = FaithFormTokens.Spacing.sm),
        verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.sm),
    ) {
        if (onChangeChurch != null) {
            OutlinedButton(
                onClick = onChangeChurch,
                enabled = !isActing,
                border = BorderStroke(theme.borderWidth, theme.palette.borderStrong),
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 52.dp),
            ) {
                Icon(
                    Icons.Outlined.SwapHoriz,
                    contentDescription = null,
                    tint = theme.palette.contentPrimary,
                    modifier = Modifier.size(FaithFormTokens.IconSize.sizeMedium),
                )
                Spacer(Modifier.size(FaithFormTokens.Spacing.sm))
                Text(
                    stringResource(R.string.change_church),
                    style = MaterialTheme.typography.titleMedium,
                    color = theme.palette.contentPrimary,
                )
            }
        }
        TextButton(
            onClick = onRemove,
            enabled = !isActing,
            colors = ButtonDefaults.textButtonColors(contentColor = theme.palette.destructive),
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = FaithFormTokens.TouchTarget.recommended),
        ) {
            FaithFormWorkingLabel(
                text = stringResource(R.string.remove_church),
                working = isActing,
                style = MaterialTheme.typography.titleMedium,
            )
        }
        actionError?.let { ActionErrorText(it) }
    }
}

@Composable
private fun ConfirmDialog(
    title: String,
    body: String,
    confirmLabel: String,
    destructive: Boolean,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    val theme = LocalFaithFormTheme.current
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { Text(body, style = MaterialTheme.typography.bodyMedium) },
        confirmButton = {
            Button(
                onClick = onConfirm,
                colors = if (destructive) {
                    ButtonDefaults.buttonColors(
                        containerColor = theme.palette.destructive,
                        contentColor = theme.palette.destructiveContent,
                    )
                } else {
                    ButtonDefaults.buttonColors()
                },
            ) { Text(confirmLabel) }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) }
        },
    )
}

// ---------------------------------------------------------------------------
// Service times
// ---------------------------------------------------------------------------

/**
 * The next service, large, on the church's own colour: when, what, and how
 * soon. White text on a gradient deepened from the accent until white reads
 * at AA, whatever colour the church chose.
 */
@Composable
private fun NextServiceCard(
    next: NextService,
    dayName: String,
    time: String,
    campusName: String?,
    modifier: Modifier = Modifier,
) {
    val theme = LocalFaithFormTheme.current
    val base = theme.palette.brandAccent.deepenedForWhiteText()
    val deep = lerp(base, Color.Black, 0.35f)
    val glow = theme.palette.brandAccentSoft
    val relative = when (next.daysAway) {
        0 -> stringResource(R.string.today)
        1 -> stringResource(R.string.tomorrow)
        else -> stringResource(R.string.in_days, next.daysAway)
    }
    val label = stringResource(R.string.next_service)
    val whenLine = "$dayName · $time"
    val description = listOfNotNull(label, relative, whenLine, next.service.label.takeIf { it.isNotBlank() }, campusName)
        .joinToString(", ")
    val shape = RoundedCornerShape(CardRadius)

    Column(
        modifier = modifier
            .fillMaxWidth()
            .then(if (theme.usesDecorativeShadow) Modifier.shadow(8.dp, shape, spotColor = base) else Modifier)
            .clip(shape)
            .background(Brush.linearGradient(listOf(base, deep), start = Offset.Zero, end = Offset.Infinite))
            .drawBehind {
                drawRect(
                    Brush.radialGradient(
                        colors = listOf(glow.copy(alpha = 0.32f), glow.copy(alpha = 0f)),
                        center = Offset(size.width, 0f),
                        radius = size.maxDimension * 0.8f,
                    ),
                )
            }
            .padding(FaithFormTokens.Spacing.lg - FaithFormTokens.Spacing.xs)
            .clearAndSetSemantics { contentDescription = description },
        verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.xs),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier
                    .size(32.dp)
                    .background(Color.White.copy(alpha = 0.16f), CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Rounded.Schedule,
                    contentDescription = null,
                    tint = Color.White,
                    modifier = Modifier.size(FaithFormTokens.IconSize.sizeMedium - 2.dp),
                )
            }
            Text(
                label,
                style = MaterialTheme.typography.labelLarge,
                color = Color.White.copy(alpha = 0.88f),
                modifier = Modifier
                    .padding(start = FaithFormTokens.Spacing.sm)
                    .weight(1f),
            )
            Text(
                relative,
                style = MaterialTheme.typography.labelLarge,
                color = Color.White,
                modifier = Modifier
                    .background(Color.White.copy(alpha = 0.18f), RoundedCornerShape(FaithFormTokens.Radius.pill))
                    .padding(horizontal = FaithFormTokens.Spacing.md, vertical = FaithFormTokens.Spacing.xs),
            )
        }
        Spacer(Modifier.height(FaithFormTokens.Spacing.sm))
        Text(
            whenLine,
            style = MaterialTheme.typography.displayMedium.copy(fontWeight = FontWeight.Bold),
            color = Color.White,
        )
        next.service.label.takeIf { it.isNotBlank() }?.let {
            Text(it, style = MaterialTheme.typography.titleMedium, color = Color.White.copy(alpha = 0.92f))
        }
        campusName?.let {
            Text(it, style = MaterialTheme.typography.bodyMedium, color = Color.White.copy(alpha = 0.8f))
        }
    }
}

@Composable
private fun ServiceTimesCard(
    groups: List<ServiceTimeGroup>,
    dayNames: List<String>,
    formatter: DateTimeFormatter,
) {
    val theme = LocalFaithFormTheme.current
    val locale = LocalConfiguration.current.locales[0] ?: Locale.getDefault()
    InfoCard {
        groups.forEachIndexed { groupIndex, group ->
            if (groupIndex > 0) HorizontalDivider(thickness = FaithFormTokens.BorderWidth.hairline, color = theme.palette.divider)
            group.campusName?.let {
                Text(
                    it,
                    style = MaterialTheme.typography.labelLarge,
                    color = theme.mutedContent,
                    modifier = Modifier
                        .padding(
                            start = FaithFormTokens.Spacing.base,
                            end = FaithFormTokens.Spacing.base,
                            top = FaithFormTokens.Spacing.base,
                        )
                        .semantics { heading() },
                )
            }
            group.times.forEachIndexed { index, service ->
                if (index > 0) RowDivider()
                ServiceRow(service, dayNames, formatter, locale)
            }
        }
    }
}

@Composable
private fun ServiceRow(
    service: PublicServiceTime,
    dayNames: List<String>,
    formatter: DateTimeFormatter,
    locale: Locale,
) {
    val theme = LocalFaithFormTheme.current
    val day = service.dayOfWeek.coerceIn(0, 6)
    val line = "${dayNames[day]} · ${formatTime(service.startTime, formatter)}"
    val short = ServiceTimes.dayOfWeek(day).getDisplayName(TextStyle.SHORT, locale)
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 60.dp)
            .padding(horizontal = FaithFormTokens.Spacing.base, vertical = FaithFormTokens.Spacing.md)
            .clearAndSetSemantics {
                contentDescription = listOf(line, service.label).filter { it.isNotBlank() }.joinToString(", ")
            },
        horizontalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.md + 2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .size(44.dp)
                .background(theme.palette.brandAccent.copy(alpha = 0.16f), RoundedCornerShape(14.dp)),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                short.uppercase(locale),
                style = MaterialTheme.typography.labelLarge,
                color = theme.palette.brandPrimary,
                maxLines = 1,
            )
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(line, style = MaterialTheme.typography.titleMedium, color = theme.palette.contentPrimary)
            if (service.label.isNotBlank()) {
                Text(service.label, style = MaterialTheme.typography.bodyMedium, color = theme.palette.contentSecondary)
            }
        }
    }
}

// ---------------------------------------------------------------------------
// About, Connect, Links
// ---------------------------------------------------------------------------

@Composable
private fun AboutCard(text: String) {
    val theme = LocalFaithFormTheme.current
    var expanded by rememberSaveable { mutableStateOf(false) }
    var overflows by remember(text) { mutableStateOf(false) }
    InfoCard {
        Column(
            modifier = Modifier
                .padding(FaithFormTokens.Spacing.base)
                .animateContentSize(tween(theme.durationMillis(FaithFormTokens.Motion.STANDARD_MS))),
            verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.xs),
        ) {
            Text(
                text,
                style = MaterialTheme.typography.bodyLarge,
                color = theme.palette.contentPrimary,
                maxLines = if (expanded) Int.MAX_VALUE else 5,
                overflow = TextOverflow.Ellipsis,
                onTextLayout = { if (!expanded) overflows = it.hasVisualOverflow },
            )
            if (overflows || expanded) {
                TextButton(
                    onClick = { expanded = !expanded },
                    modifier = Modifier.heightIn(min = FaithFormTokens.TouchTarget.recommended),
                    contentPadding = PaddingValues(horizontal = 0.dp),
                ) {
                    Text(
                        stringResource(if (expanded) R.string.show_less else R.string.read_more),
                        style = MaterialTheme.typography.titleMedium,
                        color = theme.palette.brandPrimary,
                    )
                }
            }
        }
    }
}

/** Social profiles as a row of round, brand-coloured buttons that scrolls sideways. */
@Composable
private fun ConnectSection(socials: List<ChurchSocialLink>, onOpen: (String) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.md)) {
        SectionTitle(
            stringResource(R.string.connect_title),
            Modifier.padding(horizontal = FaithFormTokens.Layout.screenPaddingHorizontal),
        )
        LazyRow(
            contentPadding = PaddingValues(horizontal = FaithFormTokens.Layout.screenPaddingHorizontal - FaithFormTokens.Spacing.xs),
            horizontalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.sm),
        ) {
            itemsIndexed(socials, key = { index, link -> "$index|${link.url}" }) { _, link ->
                val platform = SocialPlatform.from(link.platform)
                SocialButton(platform = platform, onClick = { ChurchLinks.webUrl(link.url)?.let(onOpen) })
            }
        }
    }
}

@Composable
private fun SocialButton(platform: SocialPlatform, onClick: () -> Unit) {
    val theme = LocalFaithFormTheme.current
    val name = stringResource(platform.nameRes)
    val color = platform.brandArgb?.let { Color(it) } ?: theme.palette.brandAccent.deepenedForWhiteText(0.28f)
    Column(
        modifier = Modifier
            .clip(RoundedCornerShape(FaithFormTokens.Radius.lg))
            .clickable(role = Role.Button, onClick = onClick)
            .widthIn(min = 76.dp)
            .padding(horizontal = FaithFormTokens.Spacing.xs, vertical = FaithFormTokens.Spacing.xs),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.sm),
    ) {
        Box(
            modifier = Modifier
                .size(56.dp)
                .then(if (theme.usesDecorativeShadow) Modifier.shadow(4.dp, CircleShape, spotColor = color) else Modifier)
                .background(color, CircleShape)
                // Keeps near-black X and TikTok visible on a dark page.
                .border(1.dp, theme.palette.border, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Icon(platform.glyph, contentDescription = null, tint = Color.White, modifier = Modifier.size(26.dp))
        }
        Text(
            name,
            style = MaterialTheme.typography.labelLarge,
            color = theme.palette.contentPrimary,
            maxLines = 1,
        )
    }
}

private val SocialPlatform.nameRes: Int
    get() = when (this) {
        SocialPlatform.INSTAGRAM -> R.string.social_instagram
        SocialPlatform.FACEBOOK -> R.string.social_facebook
        SocialPlatform.YOUTUBE -> R.string.social_youtube
        SocialPlatform.TIKTOK -> R.string.social_tiktok
        SocialPlatform.X -> R.string.social_x
        SocialPlatform.PODCAST -> R.string.social_podcast
        SocialPlatform.LINK -> R.string.social_link
    }

/** System glyphs only — no trademarked logos. */
private val SocialPlatform.glyph: ImageVector
    get() = when (this) {
        SocialPlatform.INSTAGRAM -> Icons.Outlined.CameraAlt
        SocialPlatform.FACEBOOK -> Icons.Outlined.Groups
        SocialPlatform.YOUTUBE -> Icons.Outlined.SmartDisplay
        SocialPlatform.TIKTOK -> Icons.Outlined.MusicNote
        SocialPlatform.X -> Icons.Outlined.AlternateEmail
        SocialPlatform.PODCAST -> Icons.Outlined.Podcasts
        SocialPlatform.LINK -> Icons.Outlined.Link
    }

@Composable
private fun LinksCard(links: List<ChurchQuickLink>, onOpen: (String) -> Unit) {
    InfoCard {
        links.forEachIndexed { index, link ->
            if (index > 0) RowDivider()
            val url = checkNotNull(ChurchLinks.webUrl(link.url))
            ListRow(
                icon = Icons.Outlined.Link,
                title = link.label,
                subtitle = ChurchLinks.hostName(url),
                trailing = Icons.AutoMirrored.Outlined.OpenInNew,
                onClick = { onOpen(url) },
            )
        }
    }
}

/** A tappable row: an icon tile, an optional small label, the value, a trailing glyph. */
@Composable
private fun ListRow(
    icon: ImageVector,
    title: String,
    subtitle: String?,
    trailing: ImageVector?,
    onClick: () -> Unit,
    overline: String? = null,
) {
    val theme = LocalFaithFormTheme.current
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(role = Role.Button, onClick = onClick)
            .heightIn(min = 60.dp)
            .padding(horizontal = FaithFormTokens.Spacing.base, vertical = FaithFormTokens.Spacing.md),
        horizontalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.md + 2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconTile(icon)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            overline?.let {
                Text(it, style = MaterialTheme.typography.labelSmall, color = theme.mutedContent)
            }
            Text(
                title,
                style = MaterialTheme.typography.bodyLarge,
                color = theme.palette.contentPrimary,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            subtitle?.let {
                Text(
                    it,
                    style = MaterialTheme.typography.bodyMedium,
                    color = theme.palette.contentSecondary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        trailing?.let {
            Icon(
                it,
                contentDescription = null,
                tint = theme.mutedContent,
                modifier = Modifier.size(FaithFormTokens.IconSize.sizeMedium),
            )
        }
    }
}

@Composable
private fun RowDivider() {
    val theme = LocalFaithFormTheme.current
    HorizontalDivider(
        thickness = FaithFormTokens.BorderWidth.hairline,
        color = theme.palette.divider,
        modifier = Modifier.padding(start = FaithFormTokens.Spacing.base + 40.dp + FaithFormTokens.Spacing.md + 2.dp),
    )
}

// ---------------------------------------------------------------------------
// Locations and contact
// ---------------------------------------------------------------------------

@Composable
private fun CampusCard(campus: PublicCampus, onDirections: (DirectionsTarget) -> Unit) {
    val theme = LocalFaithFormTheme.current
    val directions = remember(campus) { ChurchLinks.campusDirections(campus) }
    val address = ChurchActions.addressLine(campus)
    val main = stringResource(R.string.main_campus)
    val directionsLabel = stringResource(R.string.action_directions)
    InfoCard {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .then(
                    if (directions != null) {
                        Modifier.clickable(
                            role = Role.Button,
                            onClickLabel = directionsLabel,
                            onClick = { onDirections(directions) },
                        )
                    } else {
                        Modifier
                    },
                )
                .heightIn(min = 72.dp)
                .padding(FaithFormTokens.Spacing.base)
                // One stop for TalkBack: name, "Main", address — and, when
                // there is somewhere to go, "double-tap for Directions".
                .semantics(mergeDescendants = true) {},
            horizontalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.md + 2.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconTile(Icons.Outlined.Place, size = 44.dp)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.xs)) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.sm),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        campus.name,
                        style = MaterialTheme.typography.titleMedium,
                        color = theme.palette.contentPrimary,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                    if (campus.isPrimary) Chip(main)
                }
                address?.let {
                    Text(it, style = MaterialTheme.typography.bodyMedium, color = theme.palette.contentSecondary)
                }
            }
            if (directions != null) {
                Icon(
                    Icons.Outlined.Directions,
                    contentDescription = null,
                    tint = theme.palette.brandPrimary,
                    modifier = Modifier.size(FaithFormTokens.IconSize.sizeLarge),
                )
            }
        }
    }
}

private data class ContactRow(val icon: ImageVector, val labelRes: Int, val value: String, val action: QuickAction)

private fun contactRows(profile: ChurchProfile): List<ContactRow> = listOfNotNull(
    ChurchLinks.telUri(profile.phone)?.let {
        ContactRow(Icons.Outlined.Phone, R.string.phone_label, profile.phone.orEmpty().trim(), QuickAction.Call(it))
    },
    ChurchLinks.mailtoUri(profile.email)?.let {
        ContactRow(Icons.Outlined.MailOutline, R.string.email_label, profile.email.orEmpty().trim(), QuickAction.Email(it))
    },
    ChurchLinks.websiteUrl(profile.website)?.let {
        ContactRow(Icons.Outlined.Language, R.string.website_label, ChurchLinks.hostName(it) ?: it, QuickAction.Website(it))
    },
)

@Composable
private fun ContactCard(rows: List<ContactRow>, onOpen: (QuickAction) -> Unit) {
    InfoCard {
        rows.forEachIndexed { index, row ->
            if (index > 0) RowDivider()
            ListRow(
                icon = row.icon,
                overline = stringResource(row.labelRes),
                title = row.value,
                subtitle = null,
                trailing = null,
                onClick = { onOpen(row.action) },
            )
        }
    }
}

@Composable
private fun Chip(text: String) {
    val theme = LocalFaithFormTheme.current
    Text(
        text,
        style = MaterialTheme.typography.labelLarge,
        color = theme.palette.contentSecondary,
        maxLines = 1,
        modifier = Modifier
            .background(theme.palette.surfaceSunken, RoundedCornerShape(FaithFormTokens.Radius.pill))
            .padding(horizontal = FaithFormTokens.Spacing.sm, vertical = 2.dp),
    )
}

// ---------------------------------------------------------------------------
// Formatting and handing off
// ---------------------------------------------------------------------------

@Composable
private fun dayNames(): List<String> = listOf(
    stringResource(R.string.day_sunday),
    stringResource(R.string.day_monday),
    stringResource(R.string.day_tuesday),
    stringResource(R.string.day_wednesday),
    stringResource(R.string.day_thursday),
    stringResource(R.string.day_friday),
    stringResource(R.string.day_saturday),
)

/**
 * The device locale's short time style — unless the person picked the other
 * clock in Settings, which then wins. Service times are the church's own wall
 * clock, so nothing is converted between zones.
 */
@Composable
private fun rememberServiceTimeFormatter(): DateTimeFormatter {
    val context = LocalContext.current
    val locale = LocalConfiguration.current.locales[0] ?: Locale.getDefault()
    val wants24Hour = DateFormat.is24HourFormat(context)
    return remember(locale, wants24Hour) {
        val localized = DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT).withLocale(locale)
        val pattern = runCatching {
            DateTimeFormatterBuilder.getLocalizedDateTimePattern(null, FormatStyle.SHORT, IsoChronology.INSTANCE, locale)
        }.getOrNull()
        val localeIs24Hour = pattern != null && ('H' in pattern || 'k' in pattern)
        if (pattern == null || localeIs24Hour == wants24Hour) {
            localized
        } else {
            runCatching {
                DateTimeFormatter.ofPattern(DateFormat.getBestDateTimePattern(locale, if (wants24Hour) "Hm" else "hm"), locale)
            }.getOrDefault(localized)
        }
    }
}

private fun formatTime(raw: String, formatter: DateTimeFormatter): String =
    ServiceTimes.parse(raw)?.let { runCatching { formatter.format(it) }.getOrNull() } ?: raw.take(5)

private fun Context.startSafely(intent: Intent): Boolean = try {
    startActivity(intent)
    true
} catch (_: ActivityNotFoundException) {
    false
}

private fun Context.open(action: QuickAction) {
    when (action) {
        is QuickAction.Directions -> openDirections(action.target)
        is QuickAction.Website -> openWebLink(this, action.url)
        is QuickAction.Call -> openOrExplain(Intent(Intent.ACTION_DIAL, Uri.parse(action.uri)))
        is QuickAction.Email -> openOrExplain(Intent(Intent.ACTION_SENDTO, Uri.parse(action.uri)))
    }
}

private fun Context.openOrExplain(intent: Intent) {
    if (!startSafely(intent)) {
        Toast.makeText(this, R.string.legal_link_unavailable, Toast.LENGTH_LONG).show()
    }
}

/**
 * The church's own maps link, or the maps app searching for the address, or
 * a pin at a campus's coordinates. A phone with no maps app falls back to maps
 * on the web.
 */
private fun Context.openDirections(target: DirectionsTarget) {
    when (target) {
        is DirectionsTarget.Link -> openWebLink(this, target.url)
        is DirectionsTarget.Address -> {
            val query = Uri.encode(target.query)
            if (!startSafely(Intent(Intent.ACTION_VIEW, Uri.parse("geo:0,0?q=$query")))) {
                openWebLink(this, "https://www.google.com/maps/search/?api=1&query=$query")
            }
        }
        is DirectionsTarget.Coordinates -> {
            val position = "${target.latitude},${target.longitude}"
            val pin = Uri.encode("$position(${target.label})")
            if (!startSafely(Intent(Intent.ACTION_VIEW, Uri.parse("geo:$position?q=$pin")))) {
                openWebLink(this, "https://www.google.com/maps/search/?api=1&query=${Uri.encode(position)}")
            }
        }
    }
}
