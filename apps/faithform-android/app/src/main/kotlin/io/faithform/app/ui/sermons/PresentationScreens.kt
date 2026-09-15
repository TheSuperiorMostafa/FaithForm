package io.faithform.app.ui.sermons

import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.FormatSize
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Slideshow
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
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
import io.faithform.app.ui.components.PresentationCardSkeleton
import io.faithform.app.ui.components.PresentationListSkeleton
import io.faithform.app.ui.components.SlideSkeleton
import io.faithform.app.ui.components.skeletonShimmer
import io.faithform.app.ui.discovery.EmptyState
import coil.compose.AsyncImage
import coil.request.ImageRequest

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
            PresentationListSkeleton(modifier = modifier.padding(FaithFormTokens.Spacing.lg))

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
                                EmptyState(
                                    title = stringResource(
                                        if (state.emptyIsSearch) {
                                            R.string.presentations_empty_search
                                        } else {
                                            R.string.presentations_empty
                                        },
                                    ),
                                    body = "",
                                    icon = if (state.emptyIsSearch) {
                                        Icons.Outlined.Search
                                    } else {
                                        Icons.Outlined.Slideshow
                                    },
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
                                PresentationCardSkeleton(Modifier.skeletonShimmer())
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
        is PresentationDetailPhase.Loading -> SlideSkeleton(modifier)

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

@OptIn(ExperimentalMaterial3Api::class)
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
    val context = LocalContext.current
    val prefs = remember { context.getSharedPreferences(TEXT_SCALE_PREFS, Context.MODE_PRIVATE) }
    var textScale by remember {
        mutableFloatStateOf(
            prefs.getFloat(TEXT_SCALE_KEY, TEXT_SCALE_DEFAULT).coerceIn(TEXT_SCALE_MIN, TEXT_SCALE_MAX),
        )
    }

    var showTextSize by remember { mutableStateOf(false) }

    Box(modifier.fillMaxSize()) {
        HorizontalPager(
            state = pagerState,
            modifier = Modifier.fillMaxSize().clipToBounds(),
        ) { index ->
            SlidePage(
                page = pages[index],
                theme = detail.theme,
                index = index,
                total = pages.size,
                textScale = textScale,
                modifier = Modifier.fillMaxSize().clipToBounds(),
            )
        }
        IconButton(
            onClick = { showTextSize = true },
            modifier = Modifier
                .align(Alignment.TopEnd)
                .padding(FaithFormTokens.Spacing.sm)
                .background(Color.Black.copy(alpha = 0.4f), CircleShape),
        ) {
            Icon(
                Icons.Outlined.FormatSize,
                contentDescription = stringResource(R.string.presentations_text_size),
                tint = Color.White,
            )
        }
        if (showTextSize) {
            ModalBottomSheet(onDismissRequest = { showTextSize = false }) {
                SlideTextSizeBar(
                    scale = textScale,
                    onScaleChange = { next ->
                        textScale = next
                        prefs.edit().putFloat(TEXT_SCALE_KEY, next).apply()
                    },
                    modifier = Modifier.padding(
                        start = FaithFormTokens.Spacing.lg,
                        end = FaithFormTokens.Spacing.lg,
                        top = FaithFormTokens.Spacing.md,
                        bottom = FaithFormTokens.Spacing.xxl,
                    ),
                )
            }
        }
    }
}

private const val TEXT_SCALE_PREFS = "faithform_ui"
private const val TEXT_SCALE_KEY = "presentation_text_scale"
private const val TEXT_SCALE_MIN = 0.7f
private const val TEXT_SCALE_MAX = 1.8f
private const val TEXT_SCALE_DEFAULT = 1f

@Composable
private fun SlideTextSizeBar(
    scale: Float,
    onScaleChange: (Float) -> Unit,
    modifier: Modifier = Modifier,
) {
    val theme = LocalFaithFormTheme.current
    val sample = stringResource(R.string.presentations_text_size_sample)
    val label = stringResource(R.string.presentations_text_size)
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.md),
    ) {
        Text(
            label,
            style = MaterialTheme.typography.titleMedium,
            color = theme.palette.contentPrimary,
        )
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.sm),
        ) {
            Text(
                sample,
                color = theme.palette.contentPrimary,
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.clearAndSetSemantics {},
            )
            Slider(
                value = scale,
                onValueChange = onScaleChange,
                valueRange = TEXT_SCALE_MIN..TEXT_SCALE_MAX,
                colors = SliderDefaults.colors(
                    thumbColor = theme.palette.brandAccent,
                    activeTrackColor = theme.palette.brandAccent,
                    inactiveTrackColor = theme.palette.border,
                ),
                modifier = Modifier
                    .weight(1f)
                    .semantics { contentDescription = label },
            )
            Text(
                sample,
                color = theme.palette.contentPrimary,
                fontSize = 20.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.clearAndSetSemantics {},
            )
        }
    }
}

/** Solid colour, or the theme photo already stored on the published deck. */
@Composable
private fun SlideDeckBackground(theme: PresentationTheme?, modifier: Modifier = Modifier) {
    val fallback = parseThemeColor(theme?.bg) ?: LocalFaithFormTheme.current.palette.brandPrimary
    val imageUrl = theme?.imageUrl?.trim().orEmpty()
    Box(modifier.clipToBounds().background(fallback)) {
        if (theme?.backgroundType == "image" && imageUrl.isNotEmpty()) {
            AsyncImage(
                model = ImageRequest.Builder(LocalContext.current)
                    .data(imageUrl)
                    .crossfade(true)
                    .build(),
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize().clipToBounds(),
            )
            if (theme?.textShadow == true) {
                Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.25f)))
            }
        }
    }
}

@Composable
private fun SlidePage(
    page: PresentationPage,
    theme: PresentationTheme?,
    index: Int,
    total: Int,
    textScale: Float,
    modifier: Modifier = Modifier,
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
        .mapNotNull { key ->
            when (key.trim()) {
                "title" -> page.title
                "scripture" -> page.scripture
                "body" -> page.body
                else -> null
            }
        }
        .map { it.trim() }
        .filter { it.isNotEmpty() }
        .ifEmpty {
            listOfNotNull(page.title, page.scripture, page.body).map { it.trim() }.filter { it.isNotEmpty() }
        }
        .joinToString(". ")

    val userScale = textScale.coerceIn(TEXT_SCALE_MIN, TEXT_SCALE_MAX)
    val titleSize = (36f * userScale).sp
    val scriptureSize = (24f * userScale).sp
    val bodySize = (22f * userScale).sp
    val bodyLineHeight = (22f * userScale * 1.35f).sp

    Box(modifier.fillMaxSize().clipToBounds()) {
        SlideDeckBackground(theme, Modifier.fillMaxSize())
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(
                    horizontal = FaithFormTokens.Spacing.xxl,
                    vertical = FaithFormTokens.Spacing.xl,
                )
                .semantics { contentDescription = reading },
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.weight(1f))

            Column(
                modifier = Modifier.fillMaxWidth(),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.lg),
            ) {
                page.title?.takeIf { it.isNotBlank() }?.let { title ->
                    Text(
                        title,
                        style = TextStyle(
                            fontSize = titleSize,
                            fontWeight = FontWeight.SemiBold,
                            color = textColor,
                            shadow = shadow,
                            textAlign = TextAlign.Center,
                        ),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }

                page.scripture?.takeIf { it.isNotBlank() }?.let { scripture ->
                    Text(
                        scripture,
                        style = TextStyle(
                            fontSize = scriptureSize,
                            fontWeight = FontWeight.Medium,
                            fontStyle = if (italicScripture) FontStyle.Italic else FontStyle.Normal,
                            color = accent,
                            shadow = shadow,
                            textAlign = TextAlign.Center,
                        ),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }

                page.body?.takeIf { it.isNotBlank() }?.let { body ->
                    Text(
                        body,
                        style = TextStyle(
                            fontSize = bodySize,
                            fontWeight = FontWeight.Normal,
                            lineHeight = bodyLineHeight,
                            color = textColor.copy(alpha = 0.94f),
                            shadow = shadow,
                            textAlign = TextAlign.Center,
                        ),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }

            Spacer(Modifier.weight(1f))

            Text(
                "${index + 1} / $total",
                style = MaterialTheme.typography.labelSmall,
                color = textColor.copy(alpha = 0.55f),
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth(),
            )
        }
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
