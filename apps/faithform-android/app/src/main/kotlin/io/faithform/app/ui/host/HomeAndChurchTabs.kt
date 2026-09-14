package io.faithform.app.ui.host

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Church
import androidx.compose.material.icons.automirrored.outlined.MenuBook
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.size
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.faithform.app.AppViewModel
import io.faithform.app.R
import io.faithform.app.contract.Bootstrap
import io.faithform.app.contract.ChurchRelationship
import io.faithform.app.design.FaithFormTokens
import io.faithform.app.navigation.Destination
import io.faithform.app.navigation.RouteResolution
import io.faithform.app.network.ApiClient
import io.faithform.app.network.ProjectionCache
import io.faithform.app.session.AppContainer
import io.faithform.app.sermons.SermonDetailModel
import io.faithform.app.sermons.SermonListModel
import io.faithform.app.storage.CachePartition
import io.faithform.app.ui.church.ChurchChooserScreen
import io.faithform.app.ui.church.chooserPhaseFor
import io.faithform.app.ui.discovery.EmptyState
import io.faithform.app.ui.discovery.LocationProvider
import io.faithform.app.ui.feed.AnnouncementDetailScreen
import io.faithform.app.ui.feed.FeedModel
import io.faithform.app.ui.feed.FeedPhase
import io.faithform.app.ui.feed.HomeFeedScreen
import io.faithform.app.ui.onboarding.FindChurchFlow
import io.faithform.app.ui.sermons.SermonDetailScreen
import io.faithform.app.ui.sermons.SermonListScreen

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
    LaunchedEffect(feed) { feed.launchOnce("load") { load() } }
    val phase by feed.value.phase.collectAsStateWithLifecycle()
    var openedId by rememberSaveable(partition.storageKey) { mutableStateOf<String?>(null) }

    val opened = (phase as? FeedPhase.Loaded)?.items?.firstOrNull { it.id == openedId }
    if (opened != null) {
        TabScreen(title = church.churchName, onBack = { openedId = null }, modifier = modifier) { content ->
            AnnouncementDetailScreen(item = opened, modifier = content)
        }
        return
    }

    TabScreen(title = stringResource(R.string.tab_home), modifier = modifier) { content ->
        HomeFeedScreen(
            phase = phase,
            churchName = church.churchName,
            onOpenItem = { openedId = it.id },
            onReachedEnd = { feed.launch { loadMore() } },
            modifier = content,
        )
    }
}

private enum class ChurchRoute { ROOT, FIND, SERMONS }

/**
 * Church: which church the other tabs are about, finding another, and that
 * church's sermon notes.
 *
 * Rows are the account's relationships from bootstrap; tapping a readable one
 * selects it for every church-scoped tab. "Add another church" runs the same
 * find-a-church flow as first run, without the welcome. Sermon notes appear
 * only when the route registry allows them for the selected church — the same
 * gate a deep link to them passes.
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
    var sermonId by rememberSaveable(partition?.storageKey) { mutableStateOf<String?>(null) }

    val sermonsAllowed = selectedSlug != null && appViewModel.registry.resolve(
        Destination.SermonArchive(selectedSlug),
        io.faithform.app.host.HostNavigation.snapshot(bootstrap),
    ) is RouteResolution.Allowed

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

        route == ChurchRoute.SERMONS && sermonsAllowed && partition != null ->
            SermonsRoute(
                container = container,
                churchSlug = selectedSlug,
                partition = partition,
                sermonId = sermonId,
                onOpen = { sermonId = it },
                onCloseSermon = { sermonId = null },
                onClose = { route = ChurchRoute.ROOT },
                modifier = modifier,
            )

        else -> TabScreen(title = stringResource(R.string.tab_church), modifier = modifier) { content ->
            ChurchChooserScreen(
                phase = chooserPhaseFor(bootstrap.relationships),
                selectedSlug = selectedSlug,
                onSelect = appViewModel::selectChurch,
                onAddAnother = { route = ChurchRoute.FIND },
                modifier = content,
                showTitle = false,
                footer = {
                    if (sermonsAllowed) {
                        OutlinedButton(
                            onClick = { route = ChurchRoute.SERMONS },
                            modifier = Modifier
                                .fillMaxWidth()
                                .heightIn(min = FaithFormTokens.TouchTarget.recommended),
                        ) {
                            Icon(
                                Icons.AutoMirrored.Outlined.MenuBook,
                                contentDescription = null,
                                modifier = Modifier.size(FaithFormTokens.IconSize.sizeMedium),
                            )
                            Spacer(Modifier.size(FaithFormTokens.Spacing.sm))
                            Text(stringResource(R.string.sermons_title))
                        }
                    }
                },
            )
        }
    }
}

@Composable
private fun SermonsRoute(
    container: AppContainer,
    churchSlug: String,
    partition: CachePartition,
    sermonId: String?,
    onOpen: (String) -> Unit,
    onCloseSermon: () -> Unit,
    onClose: () -> Unit,
    modifier: Modifier,
) {
    if (sermonId != null) {
        val detail = rememberSessionModel("sermon|${partition.storageKey}|$sermonId") {
            SermonDetailModel(container.sermonClient, churchSlug, sermonId, partition)
        }
        LaunchedEffect(detail) { detail.launchOnce("load") { load() } }
        val phase by detail.value.phase.collectAsStateWithLifecycle()
        TabScreen(title = stringResource(R.string.sermons_title), onBack = onCloseSermon, modifier = modifier) { content ->
            androidx.compose.foundation.layout.Box(content) {
                SermonDetailScreen(phase = phase, onRetry = { detail.launch { load() } })
            }
        }
        return
    }

    val list = rememberSessionModel("sermons|${partition.storageKey}") {
        SermonListModel(container.sermonClient, churchSlug, partition)
    }
    LaunchedEffect(list) { list.launchOnce("load") { load() } }
    val state by list.value.state.collectAsStateWithLifecycle()

    TabScreen(title = stringResource(R.string.sermons_title), onBack = onClose, modifier = modifier) { content ->
        SermonListScreen(
            state = state,
            onSearch = { term ->
                list.value.updateSearchTerm(term)
                list.launch { search(term) }
            },
            onOpen = { onOpen(it.sermonId) },
            onLoadMore = { list.launch { loadMore() } },
            onRetry = { list.launch { refresh() } },
            modifier = content,
            showTitle = false,
        )
    }
}
