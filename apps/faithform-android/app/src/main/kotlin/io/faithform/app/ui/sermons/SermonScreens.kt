package io.faithform.app.ui.sermons

import android.text.format.DateFormat
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.MenuBook
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import io.faithform.app.R
import io.faithform.app.contract.SermonDetail
import io.faithform.app.contract.SermonListItem
import io.faithform.app.design.FaithFormTokens
import io.faithform.app.design.LocalFaithFormTheme
import io.faithform.app.sermons.PresentationListPhase
import io.faithform.app.sermons.PresentationScreenState
import io.faithform.app.sermons.SermonDetailPhase
import io.faithform.app.sermons.SermonHub
import io.faithform.app.sermons.SermonHubItem
import io.faithform.app.sermons.SermonListPhase
import io.faithform.app.sermons.SermonScreenState
import io.faithform.app.sermons.preachedDate
import io.faithform.app.ui.components.FaithFormSearchField
import io.faithform.app.ui.components.SermonHubCardSkeleton
import io.faithform.app.ui.components.SermonListSkeleton
import io.faithform.app.ui.components.DetailSkeleton
import io.faithform.app.ui.components.skeletonShimmer
import io.faithform.app.ui.discovery.EmptyState
import java.time.LocalDate
import java.time.YearMonth
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/**
 * The sermon-notes screens.
 *
 * Every decision about *what* to show — which empty state, whether another page
 * may be asked for, what a failure means, which day a sermon is dated by and
 * which month it is filed under — lives in `:core:sermons` and is tested there.
 * These Composables only draw the answer, in the reader's own locale.
 */

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SermonListScreen(
    state: SermonScreenState,
    presentationState: PresentationScreenState,
    onSearch: (String) -> Unit,
    onOpenNotes: (String) -> Unit,
    onOpenSlides: (String) -> Unit,
    onLoadMore: () -> Unit,
    onRetryLoadMore: () -> Unit,
    onRefresh: () -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    /** False when a title bar above already says "Sermons". */
    showTitle: Boolean = true,
) {
    val theme = LocalFaithFormTheme.current

    when (val phase = state.phase) {
        is SermonListPhase.Idle, is SermonListPhase.Loading ->
            SermonListSkeleton(
                modifier = modifier.padding(FaithFormTokens.Spacing.lg),
            )

        // The church is not available to this account. Not "removed": that is
        // what a single sermon taken down says, and nothing was.
        is SermonListPhase.Blocked ->
            SermonMessage(
                title = stringResource(R.string.media_blocked_title),
                body = stringResource(R.string.sermons_blocked_body),
            )

        is SermonListPhase.Offline ->
            SermonMessage(
                title = stringResource(R.string.sermons_offline_title),
                body = stringResource(R.string.sermons_offline_body),
                actionLabel = stringResource(R.string.sermons_retry),
                onAction = onRetry,
            )

        is SermonListPhase.Failed ->
            SermonMessage(
                title = phase.message,
                body = "",
                actionLabel = stringResource(R.string.sermons_retry),
                onAction = onRetry,
            )

        is SermonListPhase.Loaded -> {
            val slideItems = presentationState.items
            val hubs = remember(phase.items, slideItems) { SermonHub.merge(phase.items, slideItems) }
            val waitingOnSlides = hubs.isEmpty() &&
                (presentationState.phase is PresentationListPhase.Idle ||
                    presentationState.phase is PresentationListPhase.Loading)
            if (waitingOnSlides) {
                SermonListSkeleton(modifier = modifier.padding(FaithFormTokens.Spacing.lg))
            } else {
            val sections = remember(hubs) { SermonHub.monthSections(hubs) }
            val lastId = hubs.lastOrNull()?.sermonId
            val dates = rememberSermonDateFormats()
            val canLoadMore = state.canLoadMore || presentationState.canLoadMore
            val loadingMore = state.isLoadingMore || presentationState.isLoadingMore
            val loadMoreRetry = state.showsLoadMoreRetry || presentationState.showsLoadMoreRetry

            Column(
                modifier = modifier
                    .fillMaxSize()
                    .padding(FaithFormTokens.Spacing.lg),
                verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.md),
            ) {
                if (showTitle) {
                    Text(
                        stringResource(R.string.sermons_title),
                        style = MaterialTheme.typography.titleMedium,
                        color = theme.palette.contentPrimary,
                    )
                }

                FaithFormSearchField(
                    value = state.searchTerm,
                    onValueChange = onSearch,
                    placeholder = stringResource(R.string.sermons_search_label),
                    onSearch = { onSearch(state.searchTerm) },
                )

                if (phase.isStale) {
                    // A refresh could not reach the server; what was already
                    // read stays readable, and says so.
                    Text(
                        stringResource(R.string.offline_cached),
                        style = MaterialTheme.typography.bodySmall,
                        color = theme.palette.warningContent,
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(theme.palette.warning, RoundedCornerShape(FaithFormTokens.Radius.md))
                            .padding(FaithFormTokens.Spacing.sm),
                    )
                }

                PullToRefreshBox(
                    isRefreshing = state.isRefreshing,
                    onRefresh = onRefresh,
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f),
                ) {
                    // Always a scrolling list, even when empty, so an empty
                    // archive can still be pulled to refresh.
                    LazyColumn(
                        modifier = Modifier.fillMaxSize(),
                        verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.sm),
                    ) {
                        if (hubs.isEmpty()) {
                            item(key = "empty") {
                                EmptyState(
                                    title = stringResource(
                                        if (state.searchTerm.isNotBlank()) {
                                            R.string.sermons_empty_search
                                        } else {
                                            R.string.sermons_empty
                                        },
                                    ),
                                    body = "",
                                    icon = if (state.searchTerm.isNotBlank()) {
                                        Icons.Outlined.Search
                                    } else {
                                        Icons.AutoMirrored.Outlined.MenuBook
                                    },
                                )
                            }
                        }

                        for (section in sections) {
                            section.month?.let { month ->
                                item(key = section.key, contentType = "month") {
                                    SermonMonthHeader(dates.month(month))
                                }
                            }
                            items(section.items, key = { it.sermonId }, contentType = { "sermon" }) { hub ->
                                SermonHubCard(
                                    hub = hub,
                                    dateText = hub.preachedDate?.let(dates::short),
                                    onOpenNotes = { hub.notes?.let { onOpenNotes(it.sermonId) } },
                                    onOpenSlides = { hub.slides?.let { onOpenSlides(it.presentationId) } },
                                )
                                if (hub.sermonId == lastId && canLoadMore) {
                                    LaunchedEffect(hub.sermonId) { onLoadMore() }
                                }
                            }
                        }

                        if (loadingMore) {
                            item(key = "loading-more") {
                                SermonHubCardSkeleton(Modifier.skeletonShimmer())
                            }
                        }

                        if (loadMoreRetry) {
                            item(key = "load-more-failed") {
                                SermonLoadMoreRetry(onRetry = onRetryLoadMore)
                            }
                        }
                    }
                }
            }
            }
        }
    }
}

/**
 * The way into a church's sermon notes from its Home. Shown only when the
 * route registry allows them for that church; the caller decides.
 */
@Composable
fun SermonHomeEntry(onOpen: () -> Unit, modifier: Modifier = Modifier) {
    val theme = LocalFaithFormTheme.current
    val shape = RoundedCornerShape(FaithFormTokens.Radius.lg)
    Row(
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = FaithFormTokens.TouchTarget.recommended)
            .clip(shape)
            .background(theme.palette.surface)
            .border(theme.borderWidth, theme.palette.border, shape)
            .clickable(role = Role.Button, onClick = onOpen)
            .padding(FaithFormTokens.Spacing.base)
            .semantics(mergeDescendants = true) {},
        horizontalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            Icons.AutoMirrored.Outlined.MenuBook,
            contentDescription = null,
            tint = theme.palette.brandPrimary,
            modifier = Modifier.size(FaithFormTokens.IconSize.sizeLarge),
        )
        Column(verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.xs)) {
            Text(
                stringResource(R.string.sermons_title),
                style = MaterialTheme.typography.titleMedium,
                color = theme.palette.contentPrimary,
            )
            Text(
                stringResource(R.string.sermons_home_entry_body),
                style = MaterialTheme.typography.bodySmall,
                color = theme.palette.contentSecondary,
            )
        }
    }
}

@Composable
private fun SermonMonthHeader(text: String) {
    val theme = LocalFaithFormTheme.current
    Text(
        text,
        style = MaterialTheme.typography.titleSmall,
        color = theme.palette.contentSecondary,
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = FaithFormTokens.Spacing.sm)
            .semantics { heading() },
    )
}

@Composable
private fun SermonLoadMoreRetry(onRetry: () -> Unit) {
    val theme = LocalFaithFormTheme.current
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = FaithFormTokens.Spacing.sm),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.xs),
    ) {
        Text(
            stringResource(R.string.sermons_load_more_failed),
            style = MaterialTheme.typography.bodyMedium,
            color = theme.palette.contentSecondary,
        )
        TextButton(
            onClick = onRetry,
            modifier = Modifier.heightIn(min = FaithFormTokens.TouchTarget.recommended),
        ) {
            Text(stringResource(R.string.sermons_retry))
        }
    }
}

@Composable
private fun SermonHubCard(
    hub: SermonHubItem,
    dateText: String?,
    onOpenNotes: () -> Unit,
    onOpenSlides: () -> Unit,
) {
    val theme = LocalFaithFormTheme.current
    val shape = RoundedCornerShape(FaithFormTokens.Radius.md)
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(theme.palette.surface)
            .border(theme.borderWidth, theme.palette.border, shape),
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(16f / 9f)
                .clickable(
                    role = Role.Button,
                    onClick = { if (hub.hasSlides) onOpenSlides() else onOpenNotes() },
                )
                .background(theme.palette.brandPrimary),
            contentAlignment = Alignment.Center,
        ) {
            Box(
                Modifier
                    .matchParentSize()
                    .background(
                        Brush.verticalGradient(
                            listOf(Color.White.copy(alpha = 0.08f), Color.Black.copy(alpha = 0.28f)),
                        ),
                    ),
            )
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.sm),
                modifier = Modifier.padding(horizontal = FaithFormTokens.Spacing.lg),
            ) {
                Text(
                    hub.title,
                    color = Color.White,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = MaterialTheme.typography.titleMedium.fontSize,
                    textAlign = TextAlign.Center,
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis,
                )
                hub.slides?.let { slides ->
                    Text(
                        stringResource(R.string.presentations_page_count, slides.pageCount),
                        color = theme.palette.brandAccent,
                        style = MaterialTheme.typography.labelSmall,
                    )
                }
            }
        }
        Column(
            modifier = Modifier.padding(FaithFormTokens.Spacing.base),
            verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.sm),
        ) {
            val overline = listOfNotNull(dateText, hub.seriesName?.takeIf { it.isNotBlank() })
            if (overline.isNotEmpty()) {
                Text(
                    overline.joinToString(" · "),
                    style = MaterialTheme.typography.labelSmall,
                    color = theme.palette.contentSecondary,
                )
            }
            Text(hub.title, style = MaterialTheme.typography.titleSmall, color = theme.palette.contentPrimary)
            if (hub.scriptureRefs.isNotEmpty()) {
                Text(
                    hub.scriptureRefs.joinToString(" · "),
                    style = MaterialTheme.typography.labelSmall,
                    color = theme.palette.brandAccent,
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.sm)) {
                if (hub.hasNotes) {
                    SermonHubAction(
                        label = stringResource(R.string.sermons_open_notes),
                        onClick = onOpenNotes,
                        modifier = Modifier.weight(1f),
                    )
                }
                if (hub.hasSlides) {
                    SermonHubAction(
                        label = stringResource(R.string.sermons_open_slides),
                        onClick = onOpenSlides,
                        modifier = Modifier.weight(1f),
                    )
                }
            }
        }
    }
}

@Composable
private fun SermonHubAction(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val theme = LocalFaithFormTheme.current
    val shape = RoundedCornerShape(FaithFormTokens.Radius.pill)
    Text(
        label,
        style = MaterialTheme.typography.labelMedium,
        color = theme.palette.contentPrimary,
        textAlign = TextAlign.Center,
        modifier = modifier
            .clip(shape)
            .background(theme.palette.surfaceSunken)
            .border(theme.borderWidth, theme.palette.border, shape)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(vertical = FaithFormTokens.Spacing.sm)
            .heightIn(min = FaithFormTokens.TouchTarget.minimum),
    )
}

/** Dates in the reader's locale: a row's day, a detail's day, a month heading. */
private class SermonDateFormats(locale: Locale) {
    private val shortDate = DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale)
    private val longDate = DateTimeFormatter.ofLocalizedDate(FormatStyle.LONG).withLocale(locale)

    // "September 2026" in English, "2026年9月" in Japanese: the locale's own
    // month-and-year skeleton, not an English pattern with the words translated.
    private val monthYear = runCatching {
        DateTimeFormatter.ofPattern(DateFormat.getBestDateTimePattern(locale, "yMMMM"), locale)
    }.getOrElse { DateTimeFormatter.ofPattern("LLLL yyyy", locale) }

    fun short(date: LocalDate): String = shortDate.format(date)
    fun long(date: LocalDate): String = longDate.format(date)
    fun month(month: YearMonth): String = monthYear.format(month)
}

@Composable
private fun rememberSermonDateFormats(): SermonDateFormats {
    val locale = LocalConfiguration.current.locales[0]
    return remember(locale) { SermonDateFormats(locale) }
}

@Composable
fun SermonDetailScreen(phase: SermonDetailPhase, onRetry: () -> Unit) {
    when (phase) {
        is SermonDetailPhase.Loading ->
            DetailSkeleton(modifier = Modifier.padding(FaithFormTokens.Spacing.lg))

        is SermonDetailPhase.Unavailable ->
            SermonMessage(
                title = stringResource(R.string.sermons_unavailable_title),
                body = stringResource(R.string.sermons_unavailable_body),
            )

        is SermonDetailPhase.Offline ->
            SermonMessage(
                title = stringResource(R.string.sermons_offline_title),
                body = stringResource(R.string.sermons_offline_body),
                actionLabel = stringResource(R.string.sermons_retry),
                onAction = onRetry,
            )

        is SermonDetailPhase.Failed -> SermonMessage(title = phase.message, body = "")

        is SermonDetailPhase.Loaded -> SermonBody(phase.detail)
    }
}

@Composable
private fun SermonBody(detail: SermonDetail) {
    val theme = LocalFaithFormTheme.current
    val dates = rememberSermonDateFormats()
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(FaithFormTokens.Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.md),
    ) {
        detail.seriesName?.takeIf { it.isNotBlank() }?.let {
            Text(it, style = MaterialTheme.typography.labelSmall, color = theme.palette.contentSecondary)
        }
        Text(detail.title, style = MaterialTheme.typography.titleLarge, color = theme.palette.contentPrimary)
        // The day it was preached, or published when the church recorded none:
        // the same day the archive files it under.
        detail.preachedDate?.let {
            Text(dates.long(it), style = MaterialTheme.typography.labelLarge, color = theme.palette.contentSecondary)
        }

        detail.summary?.takeIf { it.isNotBlank() }?.let {
            Text(it, style = MaterialTheme.typography.bodyMedium, color = theme.palette.contentSecondary)
        }

        if (detail.scriptureRefs.isNotEmpty()) {
            SermonSection(stringResource(R.string.sermons_scripture_label)) {
                Text(
                    detail.scriptureRefs.joinToString(" · "),
                    style = MaterialTheme.typography.bodyMedium,
                    color = theme.palette.contentPrimary,
                )
            }
        }

        val outline = detail.outline
        if (outline == null) {
            Text(
                stringResource(R.string.sermons_notes_only),
                style = MaterialTheme.typography.bodySmall,
                color = theme.palette.contentSecondary,
            )
        } else {
            SermonSection(stringResource(R.string.sermons_outline_label)) {
                Column(verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.sm)) {
                    outline.intro?.takeIf { it.isNotBlank() }?.let {
                        Text(it, style = MaterialTheme.typography.bodyMedium, color = theme.palette.contentSecondary)
                    }

                    outline.points.forEachIndexed { index, point ->
                        Column(verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.xs)) {
                            // Numbered because an outline *is* ordered.
                            Text(
                                "${index + 1}. ${point.title}",
                                style = MaterialTheme.typography.titleSmall,
                                color = theme.palette.contentPrimary,
                            )
                            if (point.summary.isNotBlank()) {
                                Text(
                                    point.summary,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = theme.palette.contentSecondary,
                                )
                            }
                            point.scripture?.takeIf { it.isNotBlank() }?.let {
                                Text(
                                    it,
                                    style = MaterialTheme.typography.labelSmall,
                                    color = theme.palette.contentSecondary,
                                )
                            }
                        }
                    }

                    outline.application?.takeIf { it.isNotBlank() }?.let {
                        Column(verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.xs)) {
                            Text(
                                stringResource(R.string.sermons_application_label),
                                style = MaterialTheme.typography.labelSmall,
                                color = theme.palette.contentSecondary,
                            )
                            Text(it, style = MaterialTheme.typography.bodyMedium, color = theme.palette.contentPrimary)
                        }
                    }

                    outline.closing?.takeIf { it.isNotBlank() }?.let {
                        Text(it, style = MaterialTheme.typography.bodyMedium, color = theme.palette.contentSecondary)
                    }
                }
            }
        }

        if (detail.discussionQuestions.isNotEmpty()) {
            SermonSection(stringResource(R.string.sermons_questions_label)) {
                Column(verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.xs)) {
                    detail.discussionQuestions.forEach {
                        Text(
                            "• ${it.question}",
                            style = MaterialTheme.typography.bodyMedium,
                            color = theme.palette.contentPrimary,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun SermonSection(title: String, content: @Composable () -> Unit) {
    val theme = LocalFaithFormTheme.current
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.xs),
    ) {
        Text(title, style = MaterialTheme.typography.labelSmall, color = theme.palette.contentSecondary)
        content()
    }
}

@Composable
private fun SermonMessage(
    title: String,
    body: String,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
) {
    val theme = LocalFaithFormTheme.current
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(FaithFormTokens.Spacing.xl)
            .semantics(mergeDescendants = true) {},
        verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.sm),
    ) {
        Text(title, style = MaterialTheme.typography.titleMedium, color = theme.palette.contentPrimary)
        if (body.isNotEmpty()) {
            Text(body, style = MaterialTheme.typography.bodyMedium, color = theme.palette.contentSecondary)
        }
        if (actionLabel != null && onAction != null) {
            Text(
                actionLabel,
                style = MaterialTheme.typography.labelLarge,
                color = theme.palette.contentPrimary,
                modifier = Modifier.clickable(onClick = onAction),
            )
        }
    }
}
