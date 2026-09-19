package io.faithform.app.ui.host

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Church
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.faithform.app.AppViewModel
import io.faithform.app.R
import io.faithform.app.contract.ChurchRelationship
import io.faithform.app.design.FaithFormTokens
import io.faithform.app.media.MediaListModel
import io.faithform.app.session.AppContainer
import io.faithform.app.storage.CachePartition
import io.faithform.app.ui.church.ChurchInfoHost
import io.faithform.app.ui.discovery.EmptyState
import io.faithform.app.ui.discovery.LocationProvider
import io.faithform.app.ui.feed.AnnouncementDetailScreen
import io.faithform.app.ui.feed.FeedModel
import io.faithform.app.ui.feed.FeedPhase
import io.faithform.app.ui.media.PollLiveStatus
import io.faithform.app.ui.onboarding.FindChurchFlow
import io.faithform.app.ui.schedule.HomeHostScreen
import io.faithform.app.ui.schedule.ScheduleModel
import io.faithform.app.ui.schedule.SchedulePhase
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch

/** Where Home is: the feed, the church's page, or the search for a church. */
private enum class HomeRoute { FEED, CHURCH_INFO, FIND }

/**
 * Home: what the account's church has published, newest and pinned first —
 * and, behind the "Church info" button in its bar, that church's page.
 *
 * A person has exactly one church, so there is no church tab and no switcher.
 * The church's page, and finding a different church from it ("Change church"),
 * live under Home, exactly as on iOS. Adding a church from the search returns
 * here, already showing the new church.
 *
 * With no church there is nothing to show, and the honest thing is to say so —
 * with the way to find one — rather than render an empty feed.
 */
@Composable
fun HomeTab(
    appViewModel: AppViewModel,
    container: AppContainer,
    locationProvider: LocationProvider,
    church: ChurchRelationship?,
    partition: CachePartition?,
    modifier: Modifier = Modifier,
) {
    var route by rememberSaveable { mutableStateOf(HomeRoute.FEED) }
    // Back from the search returns to whichever page opened it.
    var findReturnsTo by rememberSaveable { mutableStateOf(HomeRoute.FEED) }
    val openFind: (HomeRoute) -> Unit = { from ->
        findReturnsTo = from
        route = HomeRoute.FIND
    }

    // A church that went away takes its page with it.
    LaunchedEffect(church == null, route) {
        if (church == null && route == HomeRoute.CHURCH_INFO) route = HomeRoute.FEED
    }

    when {
        route == HomeRoute.FIND -> FindChurchFlow(
            appViewModel = appViewModel,
            container = container,
            locationProvider = locationProvider,
            showWelcome = false,
            onExit = { route = findReturnsTo },
            embeddedTitle = stringResource(if (church != null) R.string.change_church else R.string.find_a_church),
            onChurchAdded = { route = HomeRoute.FEED },
        )

        route == HomeRoute.CHURCH_INFO && church != null -> ChurchInfoHost(
            slug = church.churchSlug,
            appViewModel = appViewModel,
            container = container,
            onBack = { route = HomeRoute.FEED },
            // Their own church is never invitation-only to them; if the server
            // ever says otherwise, the search is where invitations are entered.
            onHaveInvitation = { openFind(HomeRoute.CHURCH_INFO) },
            onChangeChurch = { openFind(HomeRoute.CHURCH_INFO) },
            onChurchAdded = { route = HomeRoute.FEED },
            onChurchRemoved = { route = HomeRoute.FEED },
            modifier = modifier,
        )

        church == null || partition == null -> NoChurchHome(
            onFindChurch = { openFind(HomeRoute.FEED) },
            modifier = modifier,
        )

        else -> HomeFeed(
            appViewModel = appViewModel,
            container = container,
            church = church,
            partition = partition,
            onOpenChurchInfo = { route = HomeRoute.CHURCH_INFO },
            modifier = modifier,
        )
    }
}

@Composable
private fun NoChurchHome(onFindChurch: () -> Unit, modifier: Modifier = Modifier) {
    TabScreen(title = stringResource(R.string.tab_home), modifier = modifier) { content ->
        Column(
            modifier = content
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(FaithFormTokens.Layout.screenPaddingHorizontal),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.base),
        ) {
            EmptyState(
                title = stringResource(R.string.no_church_title),
                body = stringResource(R.string.no_church_body),
                icon = Icons.Outlined.Church,
            )
            Button(
                onClick = onFindChurch,
                modifier = Modifier
                    .widthIn(max = FaithFormTokens.Layout.contentMaxWidth)
                    .fillMaxWidth()
                    .heightIn(min = FaithFormTokens.TouchTarget.recommended),
            ) {
                Icon(
                    Icons.Outlined.Search,
                    contentDescription = null,
                    modifier = Modifier.size(FaithFormTokens.IconSize.sizeMedium),
                )
                Spacer(Modifier.size(FaithFormTokens.Spacing.sm))
                Text(stringResource(R.string.find_a_church))
            }
        }
    }
}

@Composable
private fun HomeFeed(
    appViewModel: AppViewModel,
    container: AppContainer,
    church: ChurchRelationship,
    partition: CachePartition,
    onOpenChurchInfo: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val api = container.apiClient
    val projections = container.projections
    val feed = rememberSessionModel("feed|${partition.storageKey}") {
        FeedModel(api, projections, church.churchSlug, partition)
    }
    val schedule = rememberSessionModel("schedule|${partition.storageKey}") {
        ScheduleModel(api, projections, church.churchSlug, partition)
    }
    val media = rememberSessionModel("home-media|${partition.storageKey}") {
        MediaListModel(container.mediaClient, church.churchSlug, partition)
    }
    LaunchedEffect(feed, schedule, media) {
        feed.launchOnce("load") { load() }
        schedule.launchOnce("load") { load() }
        media.launch { refresh() }
    }
    LifecycleResumeEffect(media) {
        media.launch { refresh() }
        onPauseOrDispose { }
    }
    // A service usually starts with the app already open on Home.
    PollLiveStatus(media)

    var refreshing by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val refreshAll: () -> Unit = {
        scope.launch {
            refreshing = true
            try {
                coroutineScope {
                    launch { feed.value.refresh() }
                    launch { schedule.value.refresh() }
                    launch { media.value.refreshLive() }
                }
            } finally {
                refreshing = false
            }
        }
    }

    val phase by feed.value.phase.collectAsStateWithLifecycle()
    val schedulePhase by schedule.value.phase.collectAsStateWithLifecycle()
    val displayedMonth by schedule.value.displayedMonth.collectAsStateWithLifecycle()
    val churchTimezone by schedule.value.churchTimezone.collectAsStateWithLifecycle()
    val mediaState by media.value.state.collectAsStateWithLifecycle()
    var openedId by rememberSaveable(partition.storageKey) { mutableStateOf<String?>(null) }

    val opened = (phase as? FeedPhase.Loaded)?.items?.firstOrNull { it.id == openedId }
        ?: (schedulePhase as? SchedulePhase.Loaded)?.items?.firstOrNull { it.id == openedId }
    if (opened != null) {
        BackHandler { openedId = null }
        // Its own bar, floating over the banner, rather than the tab's.
        AnnouncementDetailScreen(item = opened, onBack = { openedId = null }, modifier = modifier)
        return
    }

    TabScreen(
        title = church.churchName,
        logoUrl = church.logoUrl,
        showChurchAvatar = true,
        modifier = modifier,
        actions = {
            IconButton(onClick = onOpenChurchInfo) {
                Icon(Icons.Outlined.Info, contentDescription = stringResource(R.string.church_info))
            }
        },
    ) { content ->
        HomeHostScreen(
            feedPhase = phase,
            schedulePhase = schedulePhase,
            displayedMonth = displayedMonth,
            churchTimezone = churchTimezone,
            onPreviousMonth = { schedule.launch { showPreviousMonth() } },
            onNextMonth = { schedule.launch { showNextMonth() } },
            onOpenItem = { openedId = it.id },
            onFeedReachedEnd = { feed.launch { loadMore() } },
            onRetrySchedule = { schedule.launch { refresh() } },
            modifier = content,
            // There is no membership to wait for any more: a church is added
            // at once, so Home never shows a "waiting for your church" banner.
            isJoinPending = false,
            live = mediaState.liveCard,
            onWatchLive = appViewModel::watchLive,
            isRefreshing = refreshing,
            onRefresh = refreshAll,
        )
    }
}
