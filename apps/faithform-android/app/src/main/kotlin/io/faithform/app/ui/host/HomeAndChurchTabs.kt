package io.faithform.app.ui.host

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Church
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.faithform.app.AppViewModel
import io.faithform.app.R
import io.faithform.app.contract.Bootstrap
import io.faithform.app.contract.ChurchRelationship
import io.faithform.app.contract.RelationshipState
import io.faithform.app.network.ApiClient
import io.faithform.app.network.ProjectionCache
import io.faithform.app.session.AppContainer
import io.faithform.app.storage.CachePartition
import io.faithform.app.ui.church.ChurchChooserScreen
import io.faithform.app.ui.church.chooserPhaseFor
import io.faithform.app.ui.discovery.EmptyState
import io.faithform.app.ui.discovery.LocationProvider
import io.faithform.app.ui.feed.AnnouncementDetailScreen
import io.faithform.app.ui.feed.FeedModel
import io.faithform.app.ui.feed.FeedPhase
import io.faithform.app.ui.onboarding.FindChurchFlow
import io.faithform.app.ui.schedule.HomeHostScreen
import io.faithform.app.ui.schedule.ScheduleModel
import io.faithform.app.ui.schedule.SchedulePhase

/**
 * Home: what the selected church has published, newest and pinned first.
 *
 * With no church selected there is nothing to show, and the honest thing is to
 * say so rather than render an empty feed.
 */
@Composable
fun HomeTab(
    api: ApiClient,
    projections: ProjectionCache,
    church: ChurchRelationship?,
    partition: CachePartition?,
    modifier: Modifier = Modifier,
) {
    if (church == null || partition == null) {
        TabScreen(title = stringResource(R.string.tab_home), modifier = modifier) { content ->
            EmptyState(
                title = stringResource(R.string.no_church_title),
                body = stringResource(R.string.no_church_body),
                icon = Icons.Outlined.Church,
                modifier = content,
            )
        }
        return
    }

    val feed = rememberSessionModel("feed|${partition.storageKey}") {
        FeedModel(api, projections, church.churchSlug, partition)
    }
    val schedule = rememberSessionModel("schedule|${partition.storageKey}") {
        ScheduleModel(api, projections, church.churchSlug, partition)
    }
    LaunchedEffect(feed, schedule) {
        feed.launchOnce("load") { load() }
        schedule.launchOnce("load") { load() }
    }
    val phase by feed.value.phase.collectAsStateWithLifecycle()
    val schedulePhase by schedule.value.phase.collectAsStateWithLifecycle()
    val displayedMonth by schedule.value.displayedMonth.collectAsStateWithLifecycle()
    val churchTimezone by schedule.value.churchTimezone.collectAsStateWithLifecycle()
    var openedId by rememberSaveable(partition.storageKey) { mutableStateOf<String?>(null) }

    val opened = (phase as? FeedPhase.Loaded)?.items?.firstOrNull { it.id == openedId }
    if (opened != null) {
        TabScreen(title = church.churchName, onBack = { openedId = null }, modifier = modifier) { content ->
            AnnouncementDetailScreen(item = opened, modifier = content)
        }
        return
    }

    TabScreen(title = church.churchName, modifier = modifier) { content ->
        HomeHostScreen(
            feedPhase = phase,
            schedulePhase = schedulePhase,
            displayedMonth = displayedMonth,
            churchTimezone = churchTimezone,
            onPreviousMonth = { schedule.launch { showPreviousMonth() } },
            onNextMonth = { schedule.launch { showNextMonth() } },
            onOpenItem = { openedId = it.id },
            onFeedReachedEnd = { feed.launch { loadMore() } },
            modifier = content,
            isJoinPending = church.state == RelationshipState.PENDING,
        )
    }
}

private enum class ChurchRoute { ROOT, FIND }

/**
 * Church: which church the other tabs are about, and finding another.
 *
 * Rows are the account's relationships from bootstrap; tapping a readable one
 * selects it for every church-scoped tab. "Add another church" runs the same
 * find-a-church flow as first run, without the welcome. Sermons live under
 * Services, not here.
 */
@Composable
fun ChurchTab(
    appViewModel: AppViewModel,
    container: AppContainer,
    locationProvider: LocationProvider,
    bootstrap: Bootstrap,
    selectedSlug: String?,
    partition: CachePartition?,
    modifier: Modifier = Modifier,
) {
    var route by rememberSaveable { mutableStateOf(ChurchRoute.ROOT) }

    when {
        route == ChurchRoute.FIND -> TabScreen(
            title = stringResource(R.string.add_another_church),
            onBack = { route = ChurchRoute.ROOT },
            modifier = modifier,
        ) { content ->
            androidx.compose.foundation.layout.Box(content) {
                FindChurchFlow(
                    appViewModel = appViewModel,
                    container = container,
                    locationProvider = locationProvider,
                    showWelcome = false,
                    onExit = { route = ChurchRoute.ROOT },
                )
            }
        }

        else -> TabScreen(title = stringResource(R.string.tab_church), modifier = modifier) { content ->
            ChurchChooserScreen(
                phase = chooserPhaseFor(bootstrap.relationships),
                selectedSlug = selectedSlug,
                onSelect = appViewModel::selectChurch,
                onAddAnother = { route = ChurchRoute.FIND },
                modifier = content,
                showTitle = false,
            )
        }
    }
}
