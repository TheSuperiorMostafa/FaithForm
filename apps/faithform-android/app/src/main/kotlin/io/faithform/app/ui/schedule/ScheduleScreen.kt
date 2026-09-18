package io.faithform.app.ui.schedule

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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material.icons.outlined.WifiOff
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.faithform.app.R
import io.faithform.app.contract.FeedItem
import io.faithform.app.design.FaithFormTokens
import io.faithform.app.design.LocalFaithFormTheme
import io.faithform.app.ui.components.FeedSkeleton
import io.faithform.app.ui.components.FaithFormPillOption
import io.faithform.app.ui.components.FaithFormPillSwitcher
import io.faithform.app.ui.discovery.EmptyState
import io.faithform.app.ui.feed.AnnouncementCard
import io.faithform.app.ui.feed.FeedPhase
import io.faithform.app.ui.feed.HomeFeedScreen
import io.faithform.app.ui.feed.JoinPendingBanner
import io.faithform.app.ui.feed.OfflineBanner
import io.faithform.app.media.MediaLiveCard
import io.faithform.app.ui.media.LiveNowHero
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.YearMonth
import java.time.ZoneId
import java.time.format.TextStyle
import java.time.temporal.WeekFields
import java.util.Locale

private enum class HomeSection { FEED, SCHEDULE }

/** Feed and Schedule segments on Home, matching iOS `HomeTabView`. */
@Composable
fun HomeHostScreen(
    feedPhase: FeedPhase,
    schedulePhase: SchedulePhase,
    onPreviousMonth: () -> Unit,
    onNextMonth: () -> Unit,
    displayedMonth: YearMonth,
    churchTimezone: String,
    onOpenItem: (FeedItem) -> Unit,
    onFeedReachedEnd: () -> Unit,
    onRetrySchedule: () -> Unit = {},
    modifier: Modifier = Modifier,
    isJoinPending: Boolean = false,
    live: MediaLiveCard? = null,
    onWatchLive: () -> Unit = {},
) {
    var section by rememberSaveable { mutableStateOf(HomeSection.FEED) }

    Column(modifier = modifier.fillMaxSize()) {
        if (live?.isLive == true) {
            LiveNowHero(
                live = live,
                onWatch = onWatchLive,
                modifier = Modifier.padding(
                    horizontal = FaithFormTokens.Layout.screenPaddingHorizontal,
                    vertical = FaithFormTokens.Spacing.sm,
                ),
            )
        }

        FaithFormPillSwitcher(
            options = listOf(
                FaithFormPillOption(HomeSection.FEED, stringResource(R.string.home_segment_feed)),
                FaithFormPillOption(HomeSection.SCHEDULE, stringResource(R.string.home_segment_schedule)),
            ),
            selected = section,
            onSelect = { section = it },
            modifier = Modifier
                .fillMaxWidth()
                .padding(
                    horizontal = FaithFormTokens.Layout.screenPaddingHorizontal,
                    vertical = FaithFormTokens.Spacing.sm,
                ),
        )

        when (section) {
            HomeSection.FEED -> HomeFeedScreen(
                phase = feedPhase,
                onOpenItem = onOpenItem,
                onReachedEnd = onFeedReachedEnd,
                modifier = Modifier.fillMaxSize(),
                isJoinPending = isJoinPending,
            )
            HomeSection.SCHEDULE -> ScheduleScreen(
                phase = schedulePhase,
                displayedMonth = displayedMonth,
                churchTimezone = churchTimezone,
                onPreviousMonth = onPreviousMonth,
                onNextMonth = onNextMonth,
                onOpenItem = onOpenItem,
                onRetry = onRetrySchedule,
                modifier = Modifier.fillMaxSize(),
                isJoinPending = isJoinPending,
            )
        }
    }
}

@Composable
fun ScheduleScreen(
    phase: SchedulePhase,
    displayedMonth: YearMonth,
    churchTimezone: String,
    onPreviousMonth: () -> Unit,
    onNextMonth: () -> Unit,
    onOpenItem: (FeedItem) -> Unit,
    onRetry: () -> Unit = {},
    modifier: Modifier = Modifier,
    isJoinPending: Boolean = false,
) {
    val theme = LocalFaithFormTheme.current
    val zone = remember(churchTimezone) {
        runCatching { ZoneId.of(churchTimezone) }.getOrElse { ZoneId.of("America/New_York") }
    }
    var selectedDay by rememberSaveable(displayedMonth) {
        mutableStateOf(LocalDate.now(zone))
    }

    LazyColumn(
        modifier = modifier
            .fillMaxSize()
            .background(theme.palette.background)
            .padding(horizontal = FaithFormTokens.Layout.screenPaddingHorizontal),
        verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.lg),
    ) {
        if (isJoinPending) {
            item(key = "join-pending") {
                JoinPendingBanner()
            }
        }

        when (phase) {
            is SchedulePhase.Loading -> item { FeedSkeleton() }

            is SchedulePhase.Loaded -> {
                if (phase.isStale) {
                    item { OfflineBanner(stringResource(R.string.offline_cached)) }
                }
                item {
                    MonthCalendar(
                        month = displayedMonth,
                        zone = zone,
                        items = phase.items,
                        selectedDay = selectedDay,
                        onPrevious = onPreviousMonth,
                        onNext = onNextMonth,
                        onSelectDay = { selectedDay = it },
                    )
                }
                val dayItems = ScheduleCalendar.eventsOn(selectedDay, phase.items, zone)
                item {
                    Text(
                        stringResource(R.string.upcoming_events),
                        style = MaterialTheme.typography.titleMedium,
                        color = theme.palette.contentPrimary,
                    )
                }
                if (dayItems.isEmpty()) {
                    item {
                        Text(
                            stringResource(R.string.empty_schedule_day_body),
                            style = MaterialTheme.typography.bodyMedium,
                            color = theme.mutedContent,
                        )
                    }
                } else {
                    items(dayItems, key = { it.id }) { item ->
                        AnnouncementCard(item) { onOpenItem(item) }
                    }
                }
            }

            is SchedulePhase.Empty -> {
                item {
                    MonthCalendar(
                        month = displayedMonth,
                        zone = zone,
                        items = emptyList(),
                        selectedDay = selectedDay,
                        onPrevious = onPreviousMonth,
                        onNext = onNextMonth,
                        onSelectDay = { selectedDay = it },
                    )
                }
                item {
                    EmptyState(
                        stringResource(R.string.empty_schedule_title),
                        stringResource(R.string.empty_schedule_body),
                        icon = Icons.Outlined.CalendarMonth,
                    )
                }
            }

            is SchedulePhase.OfflineNoCache -> item {
                EmptyState(
                    stringResource(R.string.offline_title),
                    stringResource(R.string.offline_body),
                    icon = Icons.Outlined.WifiOff,
                )
            }

            is SchedulePhase.Blocked -> item {
                EmptyState(
                    stringResource(R.string.blocked_title),
                    stringResource(R.string.blocked_body),
                    icon = Icons.Outlined.Inbox,
                )
            }

            is SchedulePhase.Failed -> item {
                EmptyState(
                    stringResource(R.string.error_title),
                    phase.message,
                    icon = Icons.Outlined.WarningAmber,
                    onRetry = onRetry,
                )
            }
        }
    }
}

@Composable
private fun MonthCalendar(
    month: YearMonth,
    zone: ZoneId,
    items: List<FeedItem>,
    selectedDay: LocalDate,
    onPrevious: () -> Unit,
    onNext: () -> Unit,
    onSelectDay: (LocalDate) -> Unit,
) {
    val theme = LocalFaithFormTheme.current
    val eventDays = remember(items, zone) { ScheduleCalendar.daysWithEvents(items, zone) }
    val today = LocalDate.now(zone)
    val weekFields = WeekFields.of(Locale.getDefault())
    val firstDay = weekFields.firstDayOfWeek
    val headers = (0 until 7).map { offset ->
        DayOfWeek.of(((firstDay.value - 1 + offset) % 7) + 1)
            .getDisplayName(TextStyle.SHORT, Locale.getDefault())
    }
    val leading = ((month.atDay(1).dayOfWeek.value - firstDay.value + 7) % 7)
    val days = (1..month.lengthOfMonth()).map { month.atDay(it) }
    val selectedLabel = stringResource(R.string.schedule_selected_day)
    val hasEventsLabel = stringResource(R.string.schedule_has_events)

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(FaithFormTokens.Radius.lg))
            .background(theme.palette.surface)
            .border(
                FaithFormTokens.BorderWidth.hairline,
                theme.palette.border,
                RoundedCornerShape(FaithFormTokens.Radius.lg),
            )
            .padding(FaithFormTokens.Spacing.base),
        verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.sm),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onPrevious) {
                Icon(Icons.AutoMirrored.Outlined.KeyboardArrowLeft, stringResource(R.string.schedule_previous_month))
            }
            Text(
                ScheduleCalendar.monthTitle(month),
                modifier = Modifier.weight(1f),
                textAlign = TextAlign.Center,
                style = MaterialTheme.typography.titleLarge,
                color = theme.palette.contentPrimary,
            )
            IconButton(onClick = onNext) {
                Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, stringResource(R.string.schedule_next_month))
            }
        }

        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            for (header in headers) {
                Text(
                    header,
                    modifier = Modifier.weight(1f),
                    textAlign = TextAlign.Center,
                    style = MaterialTheme.typography.labelSmall,
                    color = theme.mutedContent,
                )
            }
        }

        val cells = buildList {
            repeat(leading) { add(null) }
            addAll(days)
        }
        val rows = cells.chunked(7)
        Column(verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.xs)) {
            for (row in rows) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.xs),
                ) {
                    for (cell in row) {
                        Box(Modifier.weight(1f)) {
                            if (cell != null) {
                                DayCell(
                                    day = cell,
                                    isSelected = cell == selectedDay,
                                    isToday = cell == today,
                                    hasEvents = eventDays.contains(cell),
                                    selectedLabel = selectedLabel,
                                    hasEventsLabel = hasEventsLabel,
                                    onSelect = { onSelectDay(cell) },
                                )
                            }
                        }
                    }
                    repeat(7 - row.size) {
                        Spacer(Modifier.weight(1f))
                    }
                }
            }
        }
    }
}

@Composable
private fun DayCell(
    day: LocalDate,
    isSelected: Boolean,
    isToday: Boolean,
    hasEvents: Boolean,
    selectedLabel: String,
    hasEventsLabel: String,
    onSelect: () -> Unit,
) {
    val theme = LocalFaithFormTheme.current
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier
            .aspectRatio(1f)
            .clip(CircleShape)
            .clickable(onClick = onSelect)
            .semantics {
                contentDescription = buildString {
                    append(day)
                    if (isSelected) append(", $selectedLabel")
                    if (hasEvents) append(", $hasEventsLabel")
                }
            },
    ) {
        Box(contentAlignment = Alignment.Center) {
            if (isSelected) {
                Box(
                    Modifier
                        .size(36.dp)
                        .background(theme.palette.brandAccent, CircleShape)
                )
            } else if (isToday) {
                Box(
                    Modifier
                        .size(36.dp)
                        .border(FaithFormTokens.BorderWidth.standard, theme.palette.brandAccent, CircleShape)
                )
            }
            Text(
                day.dayOfMonth.toString(),
                color = if (isSelected) theme.palette.contentOnAccent else theme.palette.contentPrimary,
                style = MaterialTheme.typography.labelLarge,
            )
        }
        Box(
            Modifier
                .size(6.dp)
                .clip(CircleShape)
                .background(if (hasEvents) theme.palette.brandAccent else theme.palette.background)
        )
    }
}
