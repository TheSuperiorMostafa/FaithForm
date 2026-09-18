package io.faithform.app.ui.media

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.media3.ui.PlayerView
import io.faithform.app.AppViewModel
import io.faithform.app.R
import io.faithform.app.contract.Bootstrap
import io.faithform.app.contract.ChurchRelationship
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
import io.faithform.app.ui.components.FaithFormPillOption
import io.faithform.app.ui.components.FaithFormPillSwitcher
import io.faithform.app.ui.sermons.PresentationDetailScreen
import io.faithform.app.ui.sermons.SermonDetailScreen
import io.faithform.app.ui.sermons.SermonListScreen
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * Services: live and past recordings, sermons, and slides — matching iOS
 * `WatchTabView`.
 *
 * One row of destinations appears when more than one pane is allowed. A
 * `…/sermons` link asks for sermons via [AppViewModel.sermonsRequested].
 */
@Composable
fun WatchTab(
    appViewModel: AppViewModel,
    container: AppContainer,
    bootstrap: Bootstrap,
    churchSlug: String,
    partition: CachePartition,
    modifier: Modifier = Modifier,
    church: ChurchRelationship? = null,
) {
    val showsMedia = HostNavigation.mediaAllowed(bootstrap, churchSlug, appViewModel.registry)
    val showsSermons = HostNavigation.sermonsAllowed(bootstrap, churchSlug, appViewModel.registry)

    var requestedOrdinal by rememberSaveable(partition.storageKey) { mutableIntStateOf(0) }
    val sermonsRequested by appViewModel.sermonsRequested.collectAsStateWithLifecycle()
    LaunchedEffect(sermonsRequested) {
        if (sermonsRequested) {
            requestedOrdinal = HostNavigation.WatchPane.SERMONS.ordinal
            appViewModel.consumeSermonsRequest()
        }
    }

    val requestedPane = HostNavigation.WatchPane.entries.getOrElse(requestedOrdinal) {
        HostNavigation.WatchPane.MEDIA
    }
    val pane = HostNavigation.effectiveWatchPane(requestedPane, showsMedia, showsSermons)

    // Detail routes: null = list; "recording:id" / "sermon:id" / "presentation:id".
    // A live service is not a route: it opens full screen over the tabs.
    var opened by rememberSaveable(partition.storageKey) { mutableStateOf<String?>(null) }

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
                val mediaId = route.substringAfter(':')
                MediaDetailHost(
                    client = container.mediaClient,
                    resumePositions = container.resumePositions,
                    churchSlug = churchSlug,
                    partition = partition,
                    mediaId = mediaId,
                    onClose = { opened = null },
                    modifier = modifier,
                )
            }
        }
        return
    }

    val watchTitle = church?.churchName ?: stringResource(R.string.tab_watch)
    TabScreen(
        title = watchTitle,
        logoUrl = church?.logoUrl,
        showChurchAvatar = church != null,
        modifier = modifier,
    ) { content ->
        Column(content) {
            if (showsMedia && showsSermons) {
                WatchPaneRow(
                    panes = listOf(
                        HostNavigation.WatchPane.MEDIA,
                        HostNavigation.WatchPane.SERMONS,
                    ),
                    selected = pane,
                    onSelect = { requestedOrdinal = it.ordinal },
                )
            }

            when {
                pane == HostNavigation.WatchPane.SERMONS && showsSermons -> {
                    SermonsHalf(
                        sermonClient = container.sermonClient,
                        presentationClient = container.presentationClient,
                        churchSlug = churchSlug,
                        partition = partition,
                        onOpenNotes = { opened = "sermon:$it" },
                        onOpenSlides = { opened = "presentation:$it" },
                        modifier = Modifier.weight(1f).fillMaxWidth(),
                    )
                }
                showsMedia -> {
                    MediaHalf(
                        client = container.mediaClient,
                        churchSlug = churchSlug,
                        partition = partition,
                        onOpen = { opened = "recording:${it.mediaId}" },
                        // Full screen and playing, exactly as from Home.
                        onWatchLive = appViewModel::watchLive,
                        modifier = Modifier.weight(1f).fillMaxWidth(),
                    )
                }
            }
        }
    }
}

@Composable
private fun WatchPaneRow(
    panes: List<HostNavigation.WatchPane>,
    selected: HostNavigation.WatchPane,
    onSelect: (HostNavigation.WatchPane) -> Unit,
) {
    FaithFormPillSwitcher(
        options = panes.map { pane ->
            FaithFormPillOption(
                pane,
                stringResource(
                    when (pane) {
                        HostNavigation.WatchPane.MEDIA -> R.string.media_tab_title
                        HostNavigation.WatchPane.SERMONS -> R.string.sermons_title
                        HostNavigation.WatchPane.SLIDES -> R.string.presentations_title
                    },
                ),
            )
        },
        selected = selected,
        onSelect = onSelect,
        modifier = Modifier
            .fillMaxWidth()
            .padding(
                horizontal = FaithFormTokens.Layout.screenPaddingHorizontal,
                vertical = FaithFormTokens.Spacing.sm,
            ),
    )
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
    LifecycleResumeEffect(list) {
        list.launch { refresh() }
        onPauseOrDispose { }
    }
    PollLiveStatus(list)

    var refreshing by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
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
        isRefreshing = refreshing,
        onRefresh = {
            scope.launch {
                refreshing = true
                try {
                    list.value.refresh()
                } finally {
                    refreshing = false
                }
            }
        },
    )
}

@Composable
private fun SermonsHalf(
    sermonClient: SermonClient,
    presentationClient: PresentationClient,
    churchSlug: String,
    partition: CachePartition,
    onOpenNotes: (String) -> Unit,
    onOpenSlides: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val sermons = rememberSessionModel("sermons|${partition.storageKey}") {
        SermonListModel(sermonClient, churchSlug, partition)
    }
    val presentations = rememberSessionModel("presentations|${partition.storageKey}") {
        PresentationListModel(presentationClient, churchSlug, partition)
    }
    LaunchedEffect(sermons) {
        sermons.launchOnce("search") { observeSearch() }
        sermons.launch { refreshIfStale() }
    }
    LaunchedEffect(presentations) {
        presentations.launchOnce("search") { observeSearch() }
        presentations.launch { refreshIfStale() }
    }
    val sermonState by sermons.value.state.collectAsStateWithLifecycle()
    val presentationState by presentations.value.state.collectAsStateWithLifecycle()
    SermonListScreen(
        state = sermonState,
        presentationState = presentationState,
        onSearch = { term ->
            sermons.value.search(term)
            presentations.value.search(term)
        },
        onOpenNotes = onOpenNotes,
        onOpenSlides = onOpenSlides,
        onLoadMore = {
            sermons.launch { loadMore() }
            presentations.launch { loadMore() }
        },
        onRetryLoadMore = {
            sermons.launch { retryLoadMore() }
            presentations.launch { retryLoadMore() }
        },
        onRefresh = {
            sermons.launch { refresh() }
            presentations.launch { refresh() }
        },
        onRetry = {
            sermons.launch { refresh() }
            presentations.launch { refresh() }
        },
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
    onClose: () -> Unit,
    modifier: Modifier,
) {
    val appContext = LocalContext.current.applicationContext
    val kind = MediaPlaybackKind.RECORDING

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
    // Followed, not read once: the player is created by the first Play, after
    // this screen — and its surface — already exist.
    val player by adapter.videoPlayerState.collectAsStateWithLifecycle()

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
                    update = { view -> view.player = player },
                    onRelease = { view -> view.player = null },
                    modifier = Modifier.fillMaxWidth().aspectRatio(16f / 9f),
                )
            },
        )
    }
}
