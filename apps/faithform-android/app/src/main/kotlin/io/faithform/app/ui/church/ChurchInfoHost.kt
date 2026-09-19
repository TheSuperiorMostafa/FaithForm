package io.faithform.app.ui.church

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.faithform.app.AppViewModel
import io.faithform.app.LaunchPhase
import io.faithform.app.session.AppContainer
import io.faithform.app.storage.CachePartition

/**
 * The Church info page for [slug], wired to the account.
 *
 * The one host behind both doors — search (someone deciding) and Home's
 * "Church info" button (their own church) — so the two cannot drift. It works
 * out whether another church is already theirs, adds or removes through
 * [ChurchProfileViewModel], and after either waits for bootstrap to catch up
 * before handing back, so Home is already about the new church (or first run
 * has already taken over) when the person lands there.
 */
@Composable
fun ChurchInfoHost(
    slug: String,
    appViewModel: AppViewModel,
    container: AppContainer,
    onBack: (() -> Unit)?,
    onHaveInvitation: () -> Unit,
    onChangeChurch: (() -> Unit)?,
    /** After this church became theirs and bootstrap reflects it. Null when the shell moves on by itself. */
    onChurchAdded: (() -> Unit)? = null,
    /** After the church was removed and bootstrap reflects it. */
    onChurchRemoved: (() -> Unit)? = null,
    modifier: Modifier = Modifier,
) {
    val profile: ChurchProfileViewModel = viewModel(key = "church-profile-$slug") {
        ChurchProfileViewModel(
            api = container.apiClient,
            cache = container.projections,
            slug = slug,
            partition = appViewModel.partition(slug)
                ?: CachePartition.publicPartition(container.environmentKey),
        )
    }
    LaunchedEffect(slug) { profile.load() }

    val phase by profile.phase.collectAsStateWithLifecycle()
    val isActing by profile.isActing.collectAsStateWithLifecycle()
    val isRefreshing by profile.isRefreshing.collectAsStateWithLifecycle()
    val actionError by profile.actionError.collectAsStateWithLifecycle()
    val selectedSlug by appViewModel.selectedChurchSlug.collectAsStateWithLifecycle()
    val launch by appViewModel.state.collectAsStateWithLifecycle()

    val bootstrap = when (val current = launch) {
        is LaunchPhase.Ready -> current.bootstrap
        is LaunchPhase.Onboarding -> current.bootstrap
        else -> null
    }
    val currentChurch = bootstrap?.relationships?.firstOrNull { it.churchSlug == selectedSlug }

    // Held from the reply until the new bootstrap is in, so the button does
    // not flicker back to life in between.
    var finishing by remember { mutableStateOf(false) }
    val haptics = LocalHapticFeedback.current
    val added by rememberUpdatedState(onChurchAdded)
    val removed by rememberUpdatedState(onChurchRemoved)
    LaunchedEffect(profile) {
        profile.events.collect { event ->
            haptics.performHapticFeedback(HapticFeedbackType.LongPress)
            finishing = true
            when (event) {
                ChurchProfileEvent.Added -> appViewModel.reloadQuietly(preferring = slug) {
                    finishing = false
                    added?.invoke()
                }
                ChurchProfileEvent.Removed -> appViewModel.reloadQuietly {
                    finishing = false
                    removed?.invoke()
                }
            }
        }
    }

    ChurchInfoScreen(
        phase = phase,
        hasOtherChurch = ChurchActions.hasOtherChurch(currentChurch?.churchSlug, slug),
        currentChurchName = currentChurch?.churchName,
        isActing = isActing || finishing,
        actionError = actionError,
        isRefreshing = isRefreshing,
        onRefresh = profile::pullToRefresh,
        onRetry = profile::load,
        onBack = onBack,
        onAdd = profile::add,
        onHaveInvitation = onHaveInvitation,
        onChangeChurch = onChangeChurch,
        onRemove = profile::remove,
        modifier = modifier,
    )
}
