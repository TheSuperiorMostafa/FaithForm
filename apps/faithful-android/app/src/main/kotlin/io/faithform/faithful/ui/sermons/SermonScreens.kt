package io.faithform.faithful.ui.sermons

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import io.faithform.faithful.R
import io.faithform.faithful.contract.SermonDetail
import io.faithform.faithful.contract.SermonListItem
import io.faithform.faithful.design.FaithfulTokens
import io.faithform.faithful.design.LocalFaithfulTheme
import io.faithform.faithful.sermons.SermonDetailPhase
import io.faithform.faithful.sermons.SermonListPhase
import io.faithform.faithful.sermons.SermonScreenState

/**
 * The sermon-notes screens.
 *
 * Every decision about *what* to show — which empty state, whether another page
 * may be asked for, what a failure means — lives in `:core:sermons` and is
 * tested there. These Composables only draw the answer.
 */

@Composable
fun SermonListScreen(
    state: SermonScreenState,
    onSearch: (String) -> Unit,
    onOpen: (SermonListItem) -> Unit,
    onLoadMore: () -> Unit,
    onRetry: () -> Unit,
) {
    val theme = LocalFaithfulTheme.current

    when (val phase = state.phase) {
        is SermonListPhase.Idle, is SermonListPhase.Loading ->
            CircularProgressIndicator(
                modifier = Modifier.semantics {},
            )

        is SermonListPhase.Blocked ->
            SermonMessage(
                title = stringResource(R.string.media_blocked_title),
                body = stringResource(R.string.sermons_unavailable_body),
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

        is SermonListPhase.Loaded ->
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(FaithfulTokens.Spacing.lg),
                verticalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.md),
            ) {
                Text(
                    stringResource(R.string.sermons_title),
                    style = MaterialTheme.typography.titleMedium,
                    color = theme.palette.contentPrimary,
                )

                OutlinedTextField(
                    value = state.searchTerm,
                    onValueChange = onSearch,
                    label = { Text(stringResource(R.string.sermons_search_label)) },
                    modifier = Modifier.fillMaxWidth(),
                )

                if (state.showsEmptyState) {
                    // Two different empties, and they do not read the same.
                    Text(
                        stringResource(
                            if (state.emptyIsSearch) {
                                R.string.sermons_empty_search
                            } else {
                                R.string.sermons_empty
                            },
                        ),
                        style = MaterialTheme.typography.bodyMedium,
                        color = theme.palette.contentSecondary,
                    )
                } else {
                    LazyColumn(
                        verticalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.sm),
                    ) {
                        items(phase.items, key = { it.sermonId }) { item ->
                            SermonCard(item = item, onClick = { onOpen(item) })
                            if (item.sermonId == phase.items.lastOrNull()?.sermonId &&
                                state.canLoadMore
                            ) {
                                onLoadMore()
                            }
                        }
                    }
                }
            }
    }
}

@Composable
private fun SermonCard(item: SermonListItem, onClick: () -> Unit) {
    val theme = LocalFaithfulTheme.current
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(FaithfulTokens.Spacing.md)
            .semantics(mergeDescendants = true) {},
        verticalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.xs),
    ) {
        item.seriesName?.takeIf { it.isNotBlank() }?.let {
            Text(it, style = MaterialTheme.typography.labelSmall, color = theme.palette.contentSecondary)
        }
        Text(item.title, style = MaterialTheme.typography.titleSmall, color = theme.palette.contentPrimary)
        item.summary?.takeIf { it.isNotBlank() }?.let {
            Text(
                it,
                style = MaterialTheme.typography.bodySmall,
                color = theme.palette.contentSecondary,
                maxLines = 3,
            )
        }
        if (item.scriptureRefs.isNotEmpty()) {
            Text(
                item.scriptureRefs.joinToString(" · "),
                style = MaterialTheme.typography.labelSmall,
                color = theme.palette.contentSecondary,
            )
        }
    }
}

@Composable
fun SermonDetailScreen(phase: SermonDetailPhase, onRetry: () -> Unit) {
    when (phase) {
        is SermonDetailPhase.Loading -> CircularProgressIndicator()

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
    val theme = LocalFaithfulTheme.current
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(FaithfulTokens.Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.md),
    ) {
        detail.seriesName?.takeIf { it.isNotBlank() }?.let {
            Text(it, style = MaterialTheme.typography.labelSmall, color = theme.palette.contentSecondary)
        }
        Text(detail.title, style = MaterialTheme.typography.titleLarge, color = theme.palette.contentPrimary)

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
                Column(verticalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.sm)) {
                    outline.intro?.takeIf { it.isNotBlank() }?.let {
                        Text(it, style = MaterialTheme.typography.bodyMedium, color = theme.palette.contentSecondary)
                    }

                    outline.points.forEachIndexed { index, point ->
                        Column(verticalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.xs)) {
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
                        Column(verticalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.xs)) {
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
                Column(verticalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.xs)) {
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
    val theme = LocalFaithfulTheme.current
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.xs),
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
    val theme = LocalFaithfulTheme.current
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(FaithfulTokens.Spacing.xl)
            .semantics(mergeDescendants = true) {},
        verticalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.sm),
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
