package io.faithform.app.ui.sermons

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import io.faithform.app.R
import io.faithform.app.contract.PresentationDetail
import io.faithform.app.contract.PresentationListItem
import io.faithform.app.contract.PresentationPage
import io.faithform.app.contract.PresentationTheme
import io.faithform.app.design.FaithFormTokens
import io.faithform.app.design.LocalFaithFormTheme
import io.faithform.app.sermons.PresentationDetailPhase
import io.faithform.app.sermons.PresentationListPhase
import io.faithform.app.sermons.PresentationScreenState
import io.faithform.app.ui.components.FaithFormSearchField

/**
 * Slide-deck list and full-screen pager, mirroring iOS `PresentationListView`
 * / `PresentationViewer`. Semantic text pages only for v1.
 */

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PresentationListScreen(
    state: PresentationScreenState,
    onSearch: (String) -> Unit,
    onOpen: (PresentationListItem) -> Unit,
    onLoadMore: () -> Unit,
    onRetryLoadMore: () -> Unit,
    onRefresh: () -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    showTitle: Boolean = true,
) {
    val theme = LocalFaithFormTheme.current

    when (val phase = state.phase) {
        is PresentationListPhase.Idle, is PresentationListPhase.Loading ->
            CircularProgressIndicator(modifier = Modifier.semantics {})

        is PresentationListPhase.Blocked ->
            PresentationMessage(
                title = stringResource(R.string.presentations_blocked_title),
                body = stringResource(R.string.presentations_blocked_body),
            )

        is PresentationListPhase.Offline ->
            PresentationMessage(
                title = stringResource(R.string.presentations_offline_title),
                body = stringResource(R.string.presentations_offline_body),
                actionLabel = stringResource(R.string.presentations_retry),
                onAction = onRetry,
            )

        is PresentationListPhase.Failed ->
            PresentationMessage(
                title = phase.message,
                body = "",
                actionLabel = stringResource(R.string.presentations_retry),
                onAction = onRetry,
            )

        is PresentationListPhase.Loaded -> {
            val lastId = phase.items.lastOrNull()?.presentationId

            Column(
                modifier = modifier
                    .fillMaxSize()
                    .padding(FaithFormTokens.Spacing.lg),
                verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.md),
            ) {
                if (showTitle) {
                    Text(
                        stringResource(R.string.presentations_title),
                        style = MaterialTheme.typography.titleMedium,
                        color = theme.palette.contentPrimary,
                    )
                }

                FaithFormSearchField(
                    value = state.searchTerm,
                    onValueChange = onSearch,
                    placeholder = stringResource(R.string.presentations_search_label),
                    onSearch = { onSearch(state.searchTerm) },
                )

                if (phase.isStale) {
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
                    LazyColumn(
                        modifier = Modifier.fillMaxSize(),
                        verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.sm),
                    ) {
                        if (state.showsEmptyState) {
                            item(key = "empty") {
                                Text(
                                    stringResource(
                                        if (state.emptyIsSearch) {
                                            R.string.presentations_empty_search
                                        } else {
                                            R.string.presentations_empty
                                        },
                                    ),
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = theme.palette.contentSecondary,
                                )
                            }
                        }

                        items(phase.items, key = { it.presentationId }) { item ->
                            PresentationCard(item = item, onClick = { onOpen(item) })
                            if (item.presentationId == lastId && state.canLoadMore) {
                                LaunchedEffect(item.presentationId) { onLoadMore() }
                            }
                        }

                        if (state.isLoadingMore) {
                            item(key = "loading-more") {
                                Box(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(FaithFormTokens.Spacing.md),
                                    contentAlignment = Alignment.Center,
                                ) {
                                    CircularProgressIndicator()
                                }
                            }
                        } else if (state.showsLoadMoreRetry) {
                            item(key = "load-more-retry") {
                                Column(verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.xs)) {
                                    Text(
                                        stringResource(R.string.presentations_load_more_failed),
                                        style = MaterialTheme.typography.bodySmall,
                                        color = theme.palette.contentSecondary,
                                    )
                                    TextButton(onClick = onRetryLoadMore) {
                                        Text(stringResource(R.string.presentations_retry))
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun PresentationCard(item: PresentationListItem, onClick: () -> Unit) {
    val theme = LocalFaithFormTheme.current
    val meta = listOfNotNull(
        item.seriesName?.takeIf { it.isNotBlank() },
        stringResource(R.string.presentations_page_count, item.pageCount),
    ).joinToString(" · ")

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(FaithFormTokens.Radius.md))
            .background(theme.palette.surface)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(FaithFormTokens.Spacing.md)
            .semantics(mergeDescendants = true) {},
        verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.xs),
    ) {
        if (meta.isNotBlank()) {
            Text(meta, style = MaterialTheme.typography.labelSmall, color = theme.palette.contentSecondary)
        }
        Text(
            item.title,
            style = MaterialTheme.typography.titleMedium,
            color = theme.palette.contentPrimary,
        )
        if (item.scriptureRefs.isNotEmpty()) {
            Text(
                item.scriptureRefs.joinToString(" · "),
                style = MaterialTheme.typography.bodySmall,
                color = theme.palette.brandAccent,
            )
        }
    }
}

@Composable
fun PresentationDetailScreen(
    phase: PresentationDetailPhase,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    when (phase) {
        is PresentationDetailPhase.Loading ->
            Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }

        is PresentationDetailPhase.Unavailable ->
            PresentationMessage(
                title = stringResource(R.string.presentations_unavailable_title),
                body = stringResource(R.string.presentations_unavailable_body),
                modifier = modifier,
            )

        is PresentationDetailPhase.Offline ->
            PresentationMessage(
                title = stringResource(R.string.presentations_offline_title),
                body = stringResource(R.string.presentations_offline_body),
                actionLabel = stringResource(R.string.presentations_retry),
                onAction = onRetry,
                modifier = modifier,
            )

        is PresentationDetailPhase.Failed ->
            PresentationMessage(
                title = phase.message,
                body = "",
                actionLabel = stringResource(R.string.presentations_retry),
                onAction = onRetry,
                modifier = modifier,
            )

        is PresentationDetailPhase.Loaded ->
            PresentationPager(detail = phase.detail, modifier = modifier)
    }
}

@Composable
private fun PresentationPager(detail: PresentationDetail, modifier: Modifier = Modifier) {
    val pages = detail.pages
    if (pages.isEmpty()) {
        PresentationMessage(
            title = stringResource(R.string.presentations_empty),
            body = "",
            modifier = modifier,
        )
        return
    }

    val pagerState = rememberPagerState(pageCount = { pages.size })
    val background = parseThemeColor(detail.theme?.bg) ?: LocalFaithFormTheme.current.palette.brandPrimary

    HorizontalPager(
        state = pagerState,
        modifier = modifier
            .fillMaxSize()
            .background(background),
    ) { index ->
        SlidePage(
            page = pages[index],
            theme = detail.theme,
            index = index,
            total = pages.size,
        )
    }
}

@Composable
private fun SlidePage(
    page: PresentationPage,
    theme: PresentationTheme?,
    index: Int,
    total: Int,
) {
    val textColor = parseThemeColor(theme?.text) ?: Color.White
    val accent = parseThemeColor(theme?.accent) ?: Color(0xFFC4A15A)
    val italicScripture = theme?.italicRef ?: true
    val shadow = if (theme?.textShadow == true) {
        Shadow(color = Color.Black.copy(alpha = 0.35f), blurRadius = 4f)
    } else {
        null
    }
    val reading = page.readingOrder
        .map { it.trim() }
        .filter { it.isNotEmpty() }
        .ifEmpty {
            listOfNotNull(page.title, page.scripture, page.body).map { it.trim() }.filter { it.isNotEmpty() }
        }
        .joinToString(". ")

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(FaithFormTokens.Spacing.xl)
            .semantics { contentDescription = reading },
        verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.lg),
    ) {
        Spacer(Modifier.height(FaithFormTokens.Spacing.xl))

        page.title?.takeIf { it.isNotBlank() }?.let { title ->
            Text(
                title,
                style = TextStyle(
                    fontSize = 28.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = textColor,
                    shadow = shadow,
                ),
            )
        }

        page.scripture?.takeIf { it.isNotBlank() }?.let { scripture ->
            Text(
                scripture,
                style = TextStyle(
                    fontSize = 18.sp,
                    fontWeight = FontWeight.Medium,
                    fontStyle = if (italicScripture) FontStyle.Italic else FontStyle.Normal,
                    color = accent,
                ),
            )
        }

        page.body?.takeIf { it.isNotBlank() }?.let { body ->
            Text(
                body,
                style = TextStyle(
                    fontSize = 20.sp,
                    fontWeight = FontWeight.Normal,
                    color = textColor.copy(alpha = 0.92f),
                ),
            )
        }

        Spacer(Modifier.weight(1f))

        Text(
            "${index + 1} / $total",
            style = MaterialTheme.typography.labelSmall,
            color = textColor.copy(alpha = 0.6f),
        )
    }
}

@Composable
private fun PresentationMessage(
    title: String,
    body: String,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
    modifier: Modifier = Modifier,
) {
    val theme = LocalFaithFormTheme.current
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(FaithFormTokens.Spacing.xl)
            .semantics(mergeDescendants = true) {},
        verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.sm),
    ) {
        Text(
            title,
            style = MaterialTheme.typography.titleMedium,
            color = theme.palette.contentPrimary,
            modifier = Modifier.semantics { heading() },
        )
        if (body.isNotEmpty()) {
            Text(body, style = MaterialTheme.typography.bodyMedium, color = theme.palette.contentSecondary)
        }
        if (actionLabel != null && onAction != null) {
            TextButton(onClick = onAction) { Text(actionLabel) }
        }
    }
}

/** Accepts `#RRGGBB` / `RRGGBB` / `#AARRGGBB` theme wire values. */
internal fun parseThemeColor(raw: String?): Color? {
    val hex = raw?.trim()?.removePrefix("#")?.takeIf { it.isNotEmpty() } ?: return null
    val value = hex.toLongOrNull(16) ?: return null
    return when (hex.length) {
        6 -> Color(
            red = ((value shr 16) and 0xFF) / 255f,
            green = ((value shr 8) and 0xFF) / 255f,
            blue = (value and 0xFF) / 255f,
        )
        8 -> Color(
            alpha = ((value shr 24) and 0xFF) / 255f,
            red = ((value shr 16) and 0xFF) / 255f,
            green = ((value shr 8) and 0xFF) / 255f,
            blue = (value and 0xFF) / 255f,
        )
        else -> null
    }
}
