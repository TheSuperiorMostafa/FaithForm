package io.faithform.faithful.ui.media

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import io.faithform.faithful.R
import io.faithform.faithful.design.FaithfulTokens
import io.faithform.faithful.media.MediaArchiveCard
import io.faithform.faithful.media.MediaDetailState
import io.faithform.faithful.media.MediaLiveCard
import io.faithform.faithful.media.MediaListPhase
import io.faithform.faithful.media.MediaScreenState
import io.faithform.faithful.media.PlayerFailure

/**
 * The Watch experience.
 *
 * Behavioural parity with the SwiftUI screens — same states, same hierarchy,
 * same rule that a live area exists only when there is something live — with
 * Android's own controls. Every decision about which affordance appears lives
 * in [MediaScreenState] and [MediaDetailState], in `:core:media`, where it is
 * tested.
 */
@Composable
fun MediaScreen(
    state: MediaScreenState,
    onSearchChange: (String) -> Unit,
    onOpen: (MediaArchiveCard) -> Unit,
    onWatchLive: (MediaLiveCard) -> Unit,
    onRetry: () -> Unit,
    onLoadMore: () -> Unit,
    modifier: Modifier = Modifier,
) {
    LazyColumn(
        modifier = modifier.fillMaxWidth().padding(FaithfulTokens.Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.lg),
    ) {
        when (state.phase) {
            is MediaListPhase.Idle, is MediaListPhase.Loading -> item {
                Loading()
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
                // **Only when there is something live.** No placeholder, no
                // grey box, no "not live right now" strip on a Tuesday.
                state.liveCard?.let { live ->
                    item { LiveNowHero(live = live, onWatch = { onWatchLive(live) }) }
                }

                item {
                    Text(
                        text = stringResource(R.string.media_archive_title),
                        style = MaterialTheme.typography.titleMedium,
                    )
                }

                item {
                    OutlinedTextField(
                        value = state.searchTerm,
                        onValueChange = onSearchChange,
                        label = { Text(stringResource(R.string.media_search_label)) },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }

                state.emptyReason?.let { reason ->
                    item {
                        Text(
                            text = stringResource(
                                when (reason) {
                                    MediaScreenState.EmptyReason.NO_MATCHES ->
                                        R.string.media_archive_empty_search
                                    MediaScreenState.EmptyReason.NOTHING_PUBLISHED ->
                                        R.string.media_archive_empty
                                },
                            ),
                            style = MaterialTheme.typography.bodyMedium,
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

                if (state.isLoadingMore) item { Loading() }
            }
        }
    }
}

@Composable
private fun LiveNowHero(live: MediaLiveCard, onWatch: () -> Unit) {
    val badge = when {
        live.isLive -> stringResource(R.string.media_live_now_badge)
        live.isUpcoming -> stringResource(R.string.media_live_upcoming)
        else -> stringResource(R.string.media_live_ended)
    }
    val subtitle = if (live.hasEnded) {
        stringResource(R.string.media_live_ended_body)
    } else {
        live.churchName
    }

    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier
                .padding(FaithfulTokens.Spacing.lg)
                // One node to TalkBack: a card read as five fragments is a card
                // nobody listens to twice.
                .semantics(mergeDescendants = true) {
                    contentDescription = "$badge. ${live.title}. $subtitle"
                },
            verticalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.md),
        ) {
            Text(text = badge, style = MaterialTheme.typography.labelMedium)
            Text(text = live.title, style = MaterialTheme.typography.headlineSmall)
            Text(text = subtitle, style = MaterialTheme.typography.bodyMedium)

            if (live.offersWatch) {
                Button(onClick = onWatch, modifier = Modifier.fillMaxWidth()) {
                    Text(stringResource(R.string.media_watch_live))
                }
            }
        }
    }
}

@Composable
private fun ArchiveCard(item: MediaArchiveCard, onOpen: () -> Unit) {
    val metadata = buildList {
        item.durationSeconds?.takeIf { it > 0 }?.let { add(formatDuration(it)) }
        if (item.speakers.isNotEmpty()) add(item.speakers.joinToString(", "))
    }.joinToString(" · ")

    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(FaithfulTokens.Spacing.lg)
                .semantics(mergeDescendants = true) {
                    contentDescription = "${item.title}. $metadata"
                },
            verticalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.sm),
        ) {
            Text(text = item.title, style = MaterialTheme.typography.titleMedium)
            item.seriesName?.let {
                Text(text = it, style = MaterialTheme.typography.labelMedium)
            }
            if (metadata.isNotEmpty()) {
                Text(text = metadata, style = MaterialTheme.typography.bodySmall)
            }
            OutlinedButton(onClick = onOpen, modifier = Modifier.fillMaxWidth()) {
                Text(stringResource(R.string.media_play))
            }
        }
    }
}

@Composable
fun MediaDetailScreen(
    state: MediaDetailState,
    onPlay: () -> Unit,
    onPause: () -> Unit,
    modifier: Modifier = Modifier,
    videoSurface: @Composable () -> Unit = {},
) {
    Column(
        modifier = modifier.fillMaxWidth().padding(FaithfulTokens.Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.lg),
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
                Text(text = state.detail!!.title, style = MaterialTheme.typography.headlineSmall)
                state.detail!!.summary?.let {
                    Text(text = it, style = MaterialTheme.typography.bodyMedium)
                }

                videoSurface()

                state.failure?.let { failure ->
                    Text(
                        text = stringResource(failureMessage(failure)),
                        style = MaterialTheme.typography.bodyMedium,
                        // Announced as soon as it appears: someone whose sermon
                        // just stopped is not looking at the screen.
                        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Assertive },
                    )
                }

                if (state.isBuffering) {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.sm),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        CircularProgressIndicator(modifier = Modifier.size(20.dp))
                        Text(stringResource(R.string.media_buffering))
                    }
                }

                if (state.offersPlay) {
                    Button(onClick = onPlay, modifier = Modifier.fillMaxWidth()) {
                        Text(stringResource(R.string.media_play))
                    }
                }
                if (state.offersPause) {
                    Button(onClick = onPause, modifier = Modifier.fillMaxWidth()) {
                        Text(stringResource(R.string.media_pause))
                    }
                }
            }

            else -> Loading()
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
private fun Loading() {
    val label = stringResource(R.string.media_loading)
    Box(
        modifier = Modifier.fillMaxWidth().clearAndSetSemantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        CircularProgressIndicator()
    }
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
            modifier = Modifier.padding(FaithfulTokens.Spacing.lg),
            verticalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.md),
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
