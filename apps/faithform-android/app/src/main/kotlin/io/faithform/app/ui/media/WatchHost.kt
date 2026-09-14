package io.faithform.app.ui.media

import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
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
import io.faithform.app.R
import io.faithform.app.media.Media3PlayerAdapter
import io.faithform.app.media.MediaArchiveCard
import io.faithform.app.media.MediaClient
import io.faithform.app.media.MediaDetailModel
import io.faithform.app.media.MediaListModel
import io.faithform.app.media.MediaPlaybackCoordinator
import io.faithform.app.media.MediaPlaybackKind
import io.faithform.app.media.ResumePositionStore
import io.faithform.app.storage.CachePartition
import io.faithform.app.ui.host.TabScreen
import io.faithform.app.ui.host.rememberSessionModel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive

/**
 * The Watch tab: the live hero and the archive, and one recording's page with
 * a real player behind it.
 *
 * The list and the detail are both session models, so a rotation keeps the
 * list's place and keeps a sermon playing. The player itself is released when
 * the person leaves the detail page, when the app goes to the background
 * (after saving the position), and when the session scope is cleared.
 */
@Composable
fun WatchTab(
    client: MediaClient,
    resumePositions: ResumePositionStore,
    churchSlug: String,
    partition: CachePartition,
    modifier: Modifier = Modifier,
) {
    // "recording:<id>" or "live:<id>"; null is the list.
    var opened by rememberSaveable(partition.storageKey) { mutableStateOf<String?>(null) }
    var liveCard by rememberSaveable(partition.storageKey) { mutableStateOf<String?>(null) }

    val list = rememberSessionModel("media-list|${partition.storageKey}") {
        MediaListModel(client, churchSlug, partition)
    }
    LaunchedEffect(list) { list.launchOnce("load") { load() } }

    val route = opened
    if (route == null) {
        val state by list.value.state.collectAsStateWithLifecycle()
        TabScreen(title = stringResource(R.string.tab_watch), modifier = modifier) { content ->
            MediaScreen(
                state = state,
                onSearchChange = { term ->
                    list.value.updateSearchTerm(term)
                    list.launch { search(term) }
                },
                onOpen = { card -> opened = "recording:${card.mediaId}" },
                onWatchLive = { live ->
                    liveCard = live.title
                    opened = "live:${live.mediaId}"
                },
                onRetry = { list.launch { refresh() } },
                onLoadMore = { list.launch { loadMore() } },
                modifier = content,
            )
        }
        return
    }

    val kind = if (route.startsWith("live:")) MediaPlaybackKind.LIVE else MediaPlaybackKind.RECORDING
    val mediaId = route.substringAfter(':')
    MediaDetailHost(
        client = client,
        resumePositions = resumePositions,
        churchSlug = churchSlug,
        partition = partition,
        mediaId = mediaId,
        kind = kind,
        liveTitle = liveCard,
        onClose = { opened = null },
        modifier = modifier,
    )
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

    // Leaving the page stops playback and releases the player; the position
    // is saved first by the coordinator.
    val close = {
        holder.launch { first.stop() }
        onClose()
    }

    // No background audio without a media notification: the position is saved
    // and playback paused when the app leaves the screen, and a capability
    // that lapsed meanwhile is renewed before anything else on return.
    LifecycleEventEffect(Lifecycle.Event.ON_STOP) {
        holder.launch {
            if (first.state.value.isPlaying) first.pause()
            first.enterBackground()
        }
    }
    LifecycleEventEffect(Lifecycle.Event.ON_START) { holder.launch { first.enterForeground() } }

    // Renews the capability ahead of expiry during a long sermon.
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
