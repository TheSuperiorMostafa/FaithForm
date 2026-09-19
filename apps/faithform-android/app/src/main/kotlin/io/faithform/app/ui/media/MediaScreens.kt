package io.faithform.app.ui.media

import androidx.compose.foundation.background
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.foundation.clickable
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.shape.RoundedCornerShape
import io.faithform.app.R
import io.faithform.app.design.FaithFormTokens
import io.faithform.app.design.LocalFaithFormTheme
import io.faithform.app.ui.components.FaithFormSearchField
import io.faithform.app.ui.components.DetailSkeleton
import io.faithform.app.ui.components.MediaCardSkeleton
import io.faithform.app.ui.components.MediaListSkeleton
import io.faithform.app.ui.components.skeletonShimmer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Movie
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.VideocamOff
import io.faithform.app.ui.discovery.EmptyState
import io.faithform.app.media.MediaArchiveCard
import io.faithform.app.media.MediaDetailState
import io.faithform.app.media.MediaLiveCard
import io.faithform.app.media.MediaListPhase
import io.faithform.app.media.MediaScreenState
import io.faithform.app.media.PlayerFailure

/**
 * The Watch experience.
 *
 * Behavioural parity with the SwiftUI screens — same states, same hierarchy,
 * same rule that a live area exists only when there is something live — with
 * Android's own controls. Every decision about which affordance appears lives
 * in [MediaScreenState] and [MediaDetailState], in `:core:media`, where it is
 * tested.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MediaScreen(
    state: MediaScreenState,
    onSearchChange: (String) -> Unit,
    onOpen: (MediaArchiveCard) -> Unit,
    onWatchLive: (MediaLiveCard) -> Unit,
    onRetry: () -> Unit,
    onLoadMore: () -> Unit,
    modifier: Modifier = Modifier,
    isRefreshing: Boolean = false,
    onRefresh: () -> Unit = {},
    onOpenRecording: (String) -> Unit = {},
) {
    // Pull down to ask again — including whether the church has gone live.
    PullToRefreshBox(
        isRefreshing = isRefreshing,
        onRefresh = onRefresh,
        modifier = modifier.fillMaxWidth(),
    ) {
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(FaithFormTokens.Spacing.lg),
            verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.lg),
        ) {
            when (state.phase) {
                is MediaListPhase.Idle, is MediaListPhase.Loading -> item {
                    MediaListSkeleton()
                }

                is MediaListPhase.Blocked -> item {
                    MediaMessage(
                        title = stringResource(R.string.media_blocked_title),
                        message = stringResource(R.string.media_unavailable_body),
                    )
                }

                is MediaListPhase.Offline -> item {
                    MediaMessage(
                        title = stringResource(R.string.media_offline_title),
                        message = stringResource(R.string.media_offline_body),
                        actionLabel = stringResource(R.string.media_retry),
                        onAction = onRetry,
                    )
                }

                is MediaListPhase.Failed -> item {
                    MediaMessage(
                        title = (state.phase as MediaListPhase.Failed).message,
                        message = "",
                        actionLabel = stringResource(R.string.media_retry),
                        onAction = onRetry,
                    )
                }

                is MediaListPhase.Loaded -> {
                    state.liveCard?.let { live ->
                        item {
                            LiveNowHero(
                                live = live,
                                onWatch = { onWatchLive(live) },
                                onWatchReplay = onOpenRecording,
                            )
                        }
                    }

                    val searching = state.searchTerm.isNotBlank()
                    val nothingPublished = state.emptyReason == MediaScreenState.EmptyReason.NOTHING_PUBLISHED
                    val noLive = state.liveCard == null

                    if (noLive && nothingPublished && !searching) {
                        item {
                            EmptyState(
                                title = stringResource(R.string.media_services_empty_title),
                                body = stringResource(R.string.media_services_empty_body),
                                icon = Icons.Outlined.VideocamOff,
                            )
                        }
                    } else {
                        item {
                            Text(
                                text = stringResource(R.string.media_archive_title),
                                style = MaterialTheme.typography.titleMedium,
                            )
                        }

                        item {
                            FaithFormSearchField(
                                value = state.searchTerm,
                                onValueChange = onSearchChange,
                                placeholder = stringResource(R.string.media_search_label),
                                onSearch = { onSearchChange(state.searchTerm) },
                            )
                        }

                        state.emptyReason?.let { reason ->
                            item {
                                EmptyState(
                                    title = stringResource(
                                        when (reason) {
                                            MediaScreenState.EmptyReason.NO_MATCHES ->
                                                R.string.media_archive_empty_search
                                            MediaScreenState.EmptyReason.NOTHING_PUBLISHED ->
                                                R.string.media_archive_empty
                                        },
                                    ),
                                    body = if (reason == MediaScreenState.EmptyReason.NOTHING_PUBLISHED) {
                                        stringResource(R.string.media_archive_empty_body)
                                    } else {
                                        ""
                                    },
                                    icon = if (reason == MediaScreenState.EmptyReason.NO_MATCHES) {
                                        Icons.Outlined.Search
                                    } else {
                                        Icons.Outlined.Movie
                                    },
                                )
                            }
                        }

                        items(state.items, key = { it.mediaId }) { item ->
                            ArchiveCard(item = item, onOpen = { onOpen(item) })
                        }

                        if (state.hasMore) {
                            item {
                                OutlinedButton(onClick = onLoadMore, modifier = Modifier.fillMaxWidth()) {
                                    Text(stringResource(R.string.media_archive_title))
                                }
                            }
                        }

                        if (state.isLoadingMore) item { MediaCardSkeleton(Modifier.skeletonShimmer()) }
                    }
                }
            }
        }
    }
}

/**
 * The service card at the top of Home and Watch when something is on — one
 * picture of the service (the frame FaithForm captured from the stream) with
 * its state laid over it, and one obvious action: watch live, or the replay.
 */
@Composable
fun LiveNowHero(
    live: MediaLiveCard,
    onWatch: () -> Unit,
    modifier: Modifier = Modifier,
    onWatchReplay: ((String) -> Unit)? = null,
) {
    val theme = LocalFaithFormTheme.current
    val palette = theme.palette
    val offersReplay = live.offersReplay && onWatchReplay != null
    val stateLabel = when {
        live.isLive -> stringResource(R.string.media_live_now_badge)
        live.isUpcoming -> stringResource(R.string.media_live_upcoming)
        offersReplay -> stringResource(R.string.media_replay_available)
        else -> stringResource(R.string.media_live_ended)
    }
    val subtitle = when {
        live.isLive -> "${stringResource(R.string.media_watching_live)} · ${live.churchName}"
        live.hasEnded && !offersReplay -> stringResource(R.string.media_live_ended_body)
        else -> live.churchName
    }
    val actionLabel = when {
        live.offersWatch -> stringResource(R.string.media_watch_live)
        offersReplay -> stringResource(R.string.media_watch_replay)
        else -> null
    }
    val onClick: (() -> Unit)? = when {
        live.offersWatch -> onWatch
        offersReplay -> { { onWatchReplay?.invoke(live.replayMediaId!!) } }
        else -> null
    }

    val shape = RoundedCornerShape(FaithFormTokens.Radius.xl)
    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(shape)
            .background(palette.surface)
            .border(1.dp, palette.border, shape)
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            // One node to TalkBack: a card read as five fragments is a card
            // nobody listens to twice.
            .semantics(mergeDescendants = true) {
                contentDescription = listOfNotNull(stateLabel, live.title, subtitle, actionLabel).joinToString(". ")
            },
    ) {
        Box {
            StreamThumbnail(url = live.posterUrl)
            Box(
                Modifier
                    .matchParentSize()
                    .background(Brush.verticalGradient(0.5f to Color.Transparent, 1f to Color.Black.copy(alpha = 0.35f))),
            )
            Box(Modifier.padding(FaithFormTokens.Spacing.md).align(Alignment.TopStart)) {
                if (live.isLive) LiveBadge() else StateBadge(stateLabel)
            }
            if (onClick != null) PlayGlyph(modifier = Modifier.align(Alignment.Center), size = 60.dp)
        }
        Column(
            modifier = Modifier.padding(FaithFormTokens.Spacing.base),
            verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.xs),
        ) {
            Text(
                text = live.title,
                style = MaterialTheme.typography.titleLarge,
                color = palette.contentPrimary,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = subtitle,
                style = MaterialTheme.typography.bodyMedium,
                color = palette.contentSecondary,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            if (actionLabel != null) {
                Text(
                    text = actionLabel,
                    style = MaterialTheme.typography.labelLarge,
                    color = if (live.isLive) palette.live else palette.brandPrimary,
                    modifier = Modifier.padding(top = FaithFormTokens.Spacing.xs),
                )
            }
        }
    }
}

/** One past service: its thumbnail, then what it is. */
@Composable
private fun ArchiveCard(item: MediaArchiveCard, onOpen: () -> Unit) {
    val palette = LocalFaithFormTheme.current.palette
    val metadata = buildList {
        formatDay(item.recordedAt, item.churchTimezone)?.let { add(it) }
        if (item.speakers.isNotEmpty()) add(item.speakers.joinToString(", "))
        item.seriesName?.let { add(it) }
    }.joinToString(" · ")
    val spoken = listOfNotNull(
        item.title,
        metadata.ifEmpty { null },
        item.durationSeconds?.takeIf { it > 0 }?.let { formatDuration(it) },
    ).joinToString(". ")

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onOpen)
            .semantics(mergeDescendants = true) { contentDescription = spoken },
        verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.sm),
    ) {
        Box(Modifier.clip(RoundedCornerShape(FaithFormTokens.Radius.lg))) {
            StreamThumbnail(url = item.posterUrl)
            item.durationSeconds?.takeIf { it > 0 }?.let { seconds ->
                Text(
                    formatClock(seconds * 1000L),
                    color = Color.White,
                    style = MaterialTheme.typography.labelSmall,
                    modifier = Modifier
                        .align(Alignment.BottomEnd)
                        .padding(FaithFormTokens.Spacing.sm)
                        .background(Color.Black.copy(alpha = 0.72f), RoundedCornerShape(5.dp))
                        .padding(horizontal = 6.dp, vertical = 3.dp),
                )
            }
        }
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                text = item.title,
                style = MaterialTheme.typography.titleMedium,
                color = palette.contentPrimary,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            if (metadata.isNotEmpty()) {
                Text(
                    text = metadata,
                    style = MaterialTheme.typography.bodyMedium,
                    color = palette.contentSecondary,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

/** "Sunday, Sep 20" in the church's zone, or null when the instant is unreadable. */
internal fun formatDay(instant: String, timezone: String): String? = try {
    val zone = java.time.ZoneId.of(timezone)
    java.time.Instant.parse(instant).atZone(zone).format(
        java.time.format.DateTimeFormatter.ofPattern("EEEE, MMM d", java.util.Locale.getDefault()),
    )
} catch (_: Exception) {
    null
}

/**
 * A past service's details, beneath its player. The player itself — play,
 * scrubbing, full screen — is [RecordingStage], laid above this by the host.
 */
@Composable
fun MediaDetailScreen(
    state: MediaDetailState,
    modifier: Modifier = Modifier,
) {
    val palette = LocalFaithFormTheme.current.palette
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = FaithFormTokens.Layout.screenPaddingHorizontal, vertical = FaithFormTokens.Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.md),
    ) {
        when {
            state.isUnavailable -> MediaMessage(
                title = stringResource(R.string.media_unavailable_title),
                message = stringResource(R.string.media_unavailable_body),
            )

            state.isOffline -> MediaMessage(
                title = stringResource(R.string.media_offline_title),
                message = stringResource(R.string.media_offline_body),
            )

            state.detail != null -> {
                val detail = state.detail!!
                Text(text = detail.title, style = MaterialTheme.typography.headlineSmall, color = palette.contentPrimary)
                val metadata = buildList {
                    formatDay(detail.recordedAt, detail.churchTimezone)?.let { add(it) }
                    detail.durationSeconds?.takeIf { it > 0 }?.let { add(formatDuration(it)) }
                    if (detail.speakers.isNotEmpty()) add(detail.speakers.joinToString(", "))
                }.joinToString(" · ")
                if (metadata.isNotEmpty()) {
                    Text(text = metadata, style = MaterialTheme.typography.bodyMedium, color = palette.contentSecondary)
                }
                detail.seriesName?.let {
                    Text(
                        text = it,
                        style = MaterialTheme.typography.labelLarge,
                        color = palette.brandPrimary,
                        modifier = Modifier
                            .background(palette.brandAccentSoft, RoundedCornerShape(50))
                            .padding(horizontal = FaithFormTokens.Spacing.md, vertical = 6.dp),
                    )
                }
                detail.summary?.takeIf { it.isNotBlank() }?.let {
                    Text(text = it, style = MaterialTheme.typography.bodyLarge, color = palette.contentPrimary)
                }
            }

            else -> DetailSkeleton()
        }
    }
}

/** Never a URL, a status code, or a Media3 error name. */
internal fun failureMessage(failure: PlayerFailure): Int = when (failure) {
    PlayerFailure.NETWORK -> R.string.media_error_network
    PlayerFailure.UNAVAILABLE -> R.string.media_error_unavailable
    PlayerFailure.UNSUPPORTED -> R.string.media_error_unsupported
    PlayerFailure.UNKNOWN -> R.string.media_error_unknown
}

internal fun formatDuration(seconds: Int): String {
    val hours = seconds / 3600
    val minutes = (seconds % 3600) / 60
    return if (hours > 0) "${hours}h ${minutes}m" else "${maxOf(1, minutes)}m"
}

@Composable
private fun MediaMessage(
    title: String,
    message: String,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.padding(FaithFormTokens.Spacing.lg),
            verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.md),
        ) {
            Text(text = title, style = MaterialTheme.typography.titleMedium)
            if (message.isNotEmpty()) {
                Text(text = message, style = MaterialTheme.typography.bodyMedium)
            }
            if (actionLabel != null && onAction != null) {
                OutlinedButton(onClick = onAction, modifier = Modifier.fillMaxWidth()) {
                    Text(actionLabel)
                }
            }
        }
    }
}
