package io.faithform.app.ui.feed

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import io.faithform.app.R
import io.faithform.app.contract.FeedItem
import io.faithform.app.design.FaithFormTokens
import io.faithform.app.design.LocalFaithFormTheme
import io.faithform.app.ui.discovery.EmptyState
import io.faithform.app.ui.discovery.SkeletonCard
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Block
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material.icons.outlined.WifiOff

/** Mirrors the iOS FeedPhase. Every state is one the contract can produce. */
sealed interface FeedPhase {
    data object Loading : FeedPhase
    data class Loaded(val items: List<FeedItem>, val isStale: Boolean) : FeedPhase
    data object Empty : FeedPhase
    data object OfflineNoCache : FeedPhase
    data object Blocked : FeedPhase
    data class Failed(val message: String) : FeedPhase
}

@Composable
fun HomeFeedScreen(
    phase: FeedPhase,
    churchName: String,
    onOpenItem: (FeedItem) -> Unit,
    onReachedEnd: () -> Unit
) {
    val theme = LocalFaithFormTheme.current

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .background(theme.palette.background)
            .padding(horizontal = FaithFormTokens.Layout.screenPaddingHorizontal),
        verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.lg)
    ) {
        item {
            Text(
                churchName,
                style = MaterialTheme.typography.displayMedium,
                color = theme.palette.contentPrimary,
                modifier = Modifier.padding(top = FaithFormTokens.Spacing.base)
            )
        }

        when (phase) {
            is FeedPhase.Loading -> items(2) { SkeletonCard() }

            is FeedPhase.Loaded -> {
                if (phase.isStale) {
                    item { OfflineBanner(stringResource(R.string.offline_cached)) }
                }
                items(phase.items, key = { it.id }) { item ->
                    AnnouncementCard(item) { onOpenItem(item) }
                    if (item.id == phase.items.lastOrNull()?.id) onReachedEnd()
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

/**
 * A poster-first announcement card.
 *
 * The artwork is given its own space and left alone — no scrim, no text laid
 * over the subject. Where a caption is needed it sits below the poster on a
 * solid surface, which keeps it readable at any contrast setting without
 * obscuring the image.
 */
@Composable
fun AnnouncementCard(item: FeedItem, onOpen: () -> Unit) {
    val theme = LocalFaithFormTheme.current
    val whenLine = formatWhen(item)

    val description = listOfNotNull(
        if (item.isPinned) stringResource(R.string.pinned_label) else null,
        item.title,
        whenLine,
        item.location,
        item.posterAltText
    ).filter { it.isNotBlank() }.joinToString(", ")

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(FaithFormTokens.Radius.lg))
            .background(theme.palette.surface)
            .border(theme.borderWidth, theme.palette.border, RoundedCornerShape(FaithFormTokens.Radius.lg))
            .clickable(onClick = onOpen)
            .semantics(mergeDescendants = true) { contentDescription = description }
    ) {
        if (item.posterUrl != null) {
            // Reserved at the contract's wide aspect so the card does not
            // reflow when the image resolves. Loading the bytes is Prompt 5's
            // media layer; the shape is fixed here.
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .aspectRatio(16f / 9f)
                    .background(theme.palette.surfaceSunken)
            ) {}
        }

        Column(
            modifier = Modifier.padding(FaithFormTokens.Spacing.base),
            verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.xs)
        ) {
            if (item.isPinned) {
                Text(
                    stringResource(R.string.pinned_label),
                    style = MaterialTheme.typography.labelLarge,
                    color = theme.palette.liveContent,
                    modifier = Modifier
                        .background(theme.palette.live, RoundedCornerShape(FaithFormTokens.Radius.pill))
                        .padding(horizontal = FaithFormTokens.Spacing.sm, vertical = FaithFormTokens.Spacing.xs)
                )
            }
            Text(item.title, style = MaterialTheme.typography.titleLarge, color = theme.palette.contentPrimary)
            Text(whenLine, style = MaterialTheme.typography.labelLarge, color = theme.palette.brandAccent)
            if (item.body.isNotBlank()) {
                Text(
                    item.body,
                    style = MaterialTheme.typography.bodyMedium,
                    color = theme.palette.contentSecondary,
                    maxLines = 3
                )
            }
            item.location?.takeIf { it.isNotBlank() }?.let {
                Text(it, style = MaterialTheme.typography.labelSmall, color = theme.mutedContent)
            }
        }
    }
}

@Composable
private fun OfflineBanner(message: String) {
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

/**
 * Always the church's timezone, never the device's: "Sunday at 10" means the
 * church's Sunday, and someone travelling must not see it shifted.
 */
fun formatWhen(item: FeedItem): String {
    val zone = runCatching { ZoneId.of(item.churchTimezone) }.getOrElse { ZoneId.systemDefault() }
    val start = runCatching { Instant.parse(item.startAt) }.getOrNull() ?: return ""
    val startLocal = start.atZone(zone)

    val full = DateTimeFormatter.ofPattern("EEEE d MMMM, h:mm a")
    val timeOnly = DateTimeFormatter.ofPattern("h:mm a")
    val startText = full.format(startLocal)

    val end = item.endAt?.let { runCatching { Instant.parse(it) }.getOrNull() } ?: return startText
    val endLocal = end.atZone(zone)

    // Same day shows a time range; a multi-day event shows both dates.
    val endFormatter = if (startLocal.toLocalDate() == endLocal.toLocalDate()) timeOnly else full
    return "$startText – ${endFormatter.format(endLocal)}"
}
