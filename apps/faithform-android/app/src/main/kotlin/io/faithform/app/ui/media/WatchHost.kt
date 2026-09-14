package io.faithform.app.ui.media

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.media3.ui.PlayerView
import io.faithform.app.AppViewModel
import io.faithform.app.R
import io.faithform.app.contract.Bootstrap
import io.faithform.app.design.FaithFormTokens
import io.faithform.app.host.HostNavigation
import io.faithform.app.media.Media3PlayerAdapter
import io.faithform.app.media.MediaArchiveCard
import io.faithform.app.media.MediaClient
import io.faithform.app.media.MediaDetailModel
import io.faithform.app.media.MediaListModel
import io.faithform.app.media.MediaPlaybackCoordinator
import io.faithform.app.media.MediaPlaybackKind
import io.faithform.app.media.ResumePositionStore
import io.faithform.app.sermons.PresentationClient
import io.faithform.app.sermons.PresentationDetailModel
import io.faithform.app.sermons.PresentationListModel
import io.faithform.app.sermons.SermonClient
import io.faithform.app.sermons.SermonDetailModel
import io.faithform.app.sermons.SermonListModel
import io.faithform.app.session.AppContainer
import io.faithform.app.storage.CachePartition
import io.faithform.app.ui.host.TabScreen
import io.faithform.app.ui.host.rememberSessionModel
import io.faithform.app.ui.sermons.PresentationDetailScreen
import io.faithform.app.ui.sermons.PresentationListScreen
import io.faithform.app.ui.sermons.SermonDetailScreen
import io.faithform.app.ui.sermons.SermonListScreen
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive

/**
 * Services: live and past recordings, and the messages (notes/slides) that go
 * with them — matching iOS `WatchTabView`.
 *
 * A segmented control appears only when both halves are allowed. A
 * `…/sermons` link or Home entry asks for Messages via [AppViewModel.sermonsRequested].
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WatchTab(
    appViewModel: AppViewModel,
    container: AppContainer,
    bootstrap: Bootstrap,
    churchSlug: String,
    partition: CachePartition,
    modifier: Modifier = Modifier,
) {
    val showsMedia = HostNavigation.mediaAllowed(bootstrap, churchSlug, appViewModel.registry)
    val showsSermons = HostNavigation.sermonsAllowed(bootstrap, churchSlug, appViewModel.registry)

    var preferMessages by rememberSaveable(partition.storageKey) { mutableStateOf(false) }
    val sermonsRequested by appViewModel.sermonsRequested.collectAsStateWithLifecycle()
    LaunchedEffect(sermonsRequested) {
        if (sermonsRequested) {
            preferMessages = true
            appViewModel.consumeSermonsRequest()
        }
    }

    val showMessages = HostNavigation.showMessagesSection(preferMessages, showsMedia, showsSermons)

    // Detail routes: null = list; "recording:id" / "live:id" / "sermon:id"
    var opened by rememberSaveable(partition.storageKey) { mutableStateOf<String?>(null) }
    var liveCard by rememberSaveable(partition.storageKey) { mutableStateOf<String?>(null) }

    val route = opened
    if (route != null) {
        when {
            route.startsWith("sermon:") -> {
                val sermonId = route.substringAfter(':')
                SermonDetailHost(
                    client = container.sermonClient,
                    churchSlug = churchSlug,
                    partition = partition,
                    sermonId = sermonId,
                    onClose = { opened = null },
                    modifier = modifier,
                )
            }
            route.startsWith("presentation:") -> {
                val presentationId = route.substringAfter(':')
                PresentationDetailHost(
                    client = container.presentationClient,
                    churchSlug = churchSlug,
                    partition = partition,
                    presentationId = presentationId,
                    onClose = { opened = null },
                    modifier = modifier,
                )
            }
            else -> {
                val kind = if (route.startsWith("live:")) MediaPlaybackKind.LIVE else MediaPlaybackKind.RECORDING
                val mediaId = route.substringAfter(':')
                MediaDetailHost(
                    client = container.mediaClient,
                    resumePositions = container.resumePositions,
                    churchSlug = churchSlug,
                    partition = partition,
                    mediaId = mediaId,
                    kind = kind,
                    liveTitle = liveCard,
                    onClose = { opened = null },
                    modifier = modifier,
                )
            }
        }
        return
    }

    TabScreen(title = stringResource(R.string.tab_watch), modifier = modifier) { content ->
        Column(content) {
            if (showsMedia && showsSermons) {
                SingleChoiceSegmentedButtonRow(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(
                            horizontal = FaithFormTokens.Layout.screenPaddingHorizontal,
                            vertical = FaithFormTokens.Spacing.sm,
                        ),
                ) {
                    SegmentedButton(
                        selected = !showMessages,
                        onClick = { preferMessages = false },
                        shape = SegmentedButtonDefaults.itemShape(index = 0, count = 2),
                        label = { Text(stringResource(R.string.media_tab_title)) },
                    )
                    SegmentedButton(
                        selected = showMessages,
                        onClick = { preferMessages = true },
                        shape = SegmentedButtonDefaults.itemShape(index = 1, count = 2),
                        label = { Text(stringResource(R.string.sermons_title)) },
                    )
                }
            }

            if (showMessages && showsSermons) {
                var messagesKind by rememberSaveable(partition.storageKey) { mutableStateOf(0) } // 0 notes, 1 slides
                SingleChoiceSegmentedButtonRow(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(
                            horizontal = FaithFormTokens.Layout.screenPaddingHorizontal,
                            vertical = FaithFormTokens.Spacing.sm,
                        ),
                ) {
                    SegmentedButton(
                        selected = messagesKind == 0,
                        onClick = { messagesKind = 0 },
                        shape = SegmentedButtonDefaults.itemShape(index = 0, count = 2),
                        label = { Text(stringResource(R.string.messages_notes_segment)) },
                    )
                    SegmentedButton(
                        selected = messagesKind == 1,
                        onClick = { messagesKind = 1 },
                        shape = SegmentedButtonDefaults.itemShape(index = 1, count = 2),
                        label = { Text(stringResource(R.string.messages_slides_segment)) },
                    )
                }
                if (messagesKind == 0) {
                    MessagesHalf(
                        client = container.sermonClient,
                        churchSlug = churchSlug,
                        partition = partition,
                        onOpen = { opened = "sermon:$it" },
                        modifier = Modifier.weight(1f).fillMaxWidth(),
                    )
                } else {
                    SlidesHalf(
                        client = container.presentationClient,
                        churchSlug = churchSlug,
                        partition = partition,
                        onOpen = { opened = "presentation:$it" },
                        modifier = Modifier.weight(1f).fillMaxWidth(),
                    )
                }
            } else if (showsMedia) {
                MediaHalf(
                    client = container.mediaClient,
                    churchSlug = churchSlug,
                    partition = partition,
                    onOpen = { opened = "recording:${it.mediaId}" },
                    onWatchLive = { live ->
                        liveCard = live.title
                        opened = "live:${live.mediaId}"
                    },
                    modifier = Modifier.weight(1f).fillMaxWidth(),
                )
            }
        }
    }
}

@Composable
private fun MediaHalf(
    client: MediaClient,
    churchSlug: String,
    partition: CachePartition,
    onOpen: (MediaArchiveCard) -> Unit,
    onWatchLive: (io.faithform.app.media.MediaLiveCard) -> Unit,
    modifier: Modifier = Modifier,
) {
    val list = rememberSessionModel("media-list|${partition.storageKey}") {
        MediaListModel(client, churchSlug, partition)
    }
    LaunchedEffect(list) { list.launchOnce("load") { load() } }
    val state by list.value.state.collectAsStateWithLifecycle()
    MediaScreen(
        state = state,
        onSearchChange = { term ->
            list.value.updateSearchTerm(term)
            list.launch { search(term) }
        },
        onOpen = onOpen,
        onWatchLive = onWatchLive,
        onRetry = { list.launch { refresh() } },
        onLoadMore = { list.launch { loadMore() } },
        modifier = modifier,
    )
}

@Composable
private fun MessagesHalf(
    client: SermonClient,
    churchSlug: String,
    partition: CachePartition,
    onOpen: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val list = rememberSessionModel("sermons|${partition.storageKey}") {
        SermonListModel(client, churchSlug, partition)
    }
    LaunchedEffect(list) {
        list.launchOnce("search") { observeSearch() }
        list.launch { refreshIfStale() }
    }
    val state by list.value.state.collectAsStateWithLifecycle()
    SermonListScreen(
        state = state,
        onSearch = { term -> list.value.search(term) },
        onOpen = { onOpen(it.sermonId) },
        onLoadMore = { list.launch { loadMore() } },
        onRetryLoadMore = { list.launch { retryLoadMore() } },
        onRefresh = { list.launch { refresh() } },
        onRetry = { list.launch { refresh() } },
        modifier = modifier,
        showTitle = false,
    )
}
@Composable
private fun SlidesHalf(
    client: PresentationClient,
    churchSlug: String,
    partition: CachePartition,
    onOpen: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val list = rememberSessionModel("presentations|${partition.storageKey}") {
        PresentationListModel(client, churchSlug, partition)
    }
    LaunchedEffect(list) {
        list.launchOnce("search") { observeSearch() }
        list.launch { refreshIfStale() }
    }
    val state by list.value.state.collectAsStateWithLifecycle()
    PresentationListScreen(
        state = state,
        onSearch = { term -> list.value.search(term) },
        onOpen = { onOpen(it.presentationId) },
        onLoadMore = { list.launch { loadMore() } },
        onRetryLoadMore = { list.launch { retryLoadMore() } },
        onRefresh = { list.launch { refresh() } },
        onRetry = { list.launch { refresh() } },
        modifier = modifier,
        showTitle = false,
    )
}

@Composable
private fun PresentationDetailHost(
    client: PresentationClient,
    churchSlug: String,
    partition: CachePartition,
    presentationId: String,
    onClose: () -> Unit,
    modifier: Modifier,
) {
    val detail = rememberSessionModel("presentation|${partition.storageKey}|$presentationId") {
        PresentationDetailModel(client, churchSlug, presentationId, partition)
    }
    LaunchedEffect(detail) { detail.launchOnce("load") { load() } }
    val phase by detail.value.phase.collectAsStateWithLifecycle()
    TabScreen(title = stringResource(R.string.presentations_title), onBack = onClose, modifier = modifier) { content ->
        androidx.compose.foundation.layout.Box(content) {
            PresentationDetailScreen(
                phase = phase,
                onRetry = { detail.launch { load() } },
            )
        }
    }
}

@Composable
private fun SermonDetailHost(
    client: SermonClient,
    churchSlug: String,
    partition: CachePartition,
    sermonId: String,
    onClose: () -> Unit,
    modifier: Modifier,
) {
    val detail = rememberSessionModel("sermon|${partition.storageKey}|$sermonId") {
        SermonDetailModel(client, churchSlug, sermonId, partition)
    }
    LaunchedEffect(detail) { detail.launchOnce("load") { load() } }
    val phase by detail.value.phase.collectAsStateWithLifecycle()
    TabScreen(title = stringResource(R.string.sermons_title), onBack = onClose, modifier = modifier) { content ->
        androidx.compose.foundation.layout.Box(content) {
            SermonDetailScreen(phase = phase, onRetry = { detail.launch { load() } })
        }
    }
}

@Composable
private fun MediaDetailHost(
    client: MediaClient,
    resumePositions: ResumePositionStore,
    churchSlug: String,
    partition: CachePartition,
    mediaId: String,
    kind: MediaPlaybackKind,
    liveTitle: String?,
    onClose: () -> Unit,
    modifier: Modifier,
) {
    val appContext = LocalContext.current.applicationContext

    val holder = rememberSessionModel(
        key = "media-detail|${partition.storageKey}|${kind.wire}|$mediaId",
        release = { pair: Pair<MediaDetailModel, Media3PlayerAdapter> -> pair.second.release() },
    ) {
        val adapter = Media3PlayerAdapter(appContext)
        val model = MediaDetailModel(
            client = client,
            coordinator = MediaPlaybackCoordinator(client, adapter, resumePositions),
            churchSlug = churchSlug,
            mediaId = mediaId,
            kind = kind,
            partition = partition,
            knownCard = if (kind == MediaPlaybackKind.LIVE) {
                MediaArchiveCard(mediaId, liveTitle.orEmpty(), null, "", null, null, null, emptyList(), "UTC")
            } else {
                null
            },
        )
        model to adapter
    }
    val model = holder.value.first
    val adapter = holder.value.second

    LaunchedEffect(holder) {
        adapter.setEventHandler { event -> holder.launch { first.handle(event) } }
        holder.launchOnce("load") { first.load() }
    }

    val state by model.state.collectAsStateWithLifecycle()

    val close = {
        holder.launch { first.stop() }
        onClose()
    }

    LifecycleEventEffect(Lifecycle.Event.ON_STOP) {
        holder.launch {
            if (first.state.value.isPlaying) first.pause()
            first.enterBackground()
        }
    }
    LifecycleEventEffect(Lifecycle.Event.ON_START) { holder.launch { first.enterForeground() } }

    LaunchedEffect(state.isPlaying) {
        while (isActive && state.isPlaying) {
            delay(15_000)
            holder.launch { first.tick() }
        }
    }

    TabScreen(
        title = state.detail?.title ?: stringResource(R.string.tab_watch),
        onBack = { close() },
        modifier = modifier,
    ) { content ->
        MediaDetailScreen(
            state = state,
            onPlay = { holder.launch { first.play() } },
            onPause = { holder.launch { first.pause() } },
            modifier = content,
            videoSurface = {
                AndroidView(
                    factory = { context -> PlayerView(context).apply { useController = false } },
                    update = { view -> view.player = adapter.videoPlayer },
                    onRelease = { view -> view.player = null },
                    modifier = Modifier.fillMaxWidth().aspectRatio(16f / 9f),
                )
            },
        )
    }
}
