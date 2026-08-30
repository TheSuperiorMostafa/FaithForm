package io.faithform.faithful.ui.onboarding

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.faithform.faithful.AppViewModel
import io.faithform.faithful.InvitationPhase
import io.faithform.faithful.R
import io.faithform.faithful.contract.MobileErrorCode
import io.faithform.faithful.design.FaithfulTokens
import io.faithform.faithful.design.LocalFaithfulTheme
import io.faithform.faithful.session.AppContainer
import io.faithform.faithful.ui.church.ChurchProfileScreen
import io.faithform.faithful.ui.church.ChurchProfileViewModel
import io.faithform.faithful.ui.discovery.DiscoveryScreen
import io.faithform.faithful.ui.discovery.DiscoveryViewModel
import io.faithform.faithful.ui.discovery.LocationAuthorization
import io.faithform.faithful.ui.discovery.LocationEducationScreen
import io.faithform.faithful.ui.discovery.LocationProvider
import io.faithform.faithful.ui.discovery.WelcomeScreen
import kotlinx.coroutines.launch

/**
 * The find-a-church journey: welcome (first run only) → search or invitation →
 * church profile → follow, join, or redeem.
 *
 * One flow serves both entrances — first run, and "add another church" later —
 * so the two cannot drift. Navigation is Android-native: system back walks the
 * route stack, and signing out stays reachable the whole way through first
 * run, because a flow a person cannot leave is a dead end with extra steps.
 */
private sealed interface FindChurchRoute {
    data object Welcome : FindChurchRoute
    data object Search : FindChurchRoute
    data object Education : FindChurchRoute
    data class Church(val slug: String) : FindChurchRoute
    data object Invitation : FindChurchRoute
}

@Composable
fun FindChurchFlow(
    appViewModel: AppViewModel,
    container: AppContainer,
    locationProvider: LocationProvider,
    showWelcome: Boolean,
    onSignOut: (() -> Unit)? = null,
    onExit: (() -> Unit)? = null
) {
    val start: FindChurchRoute =
        if (showWelcome) FindChurchRoute.Welcome else FindChurchRoute.Search
    var route by remember { mutableStateOf(start) }
    val scope = rememberCoroutineScope()

    val discovery: DiscoveryViewModel = viewModel(key = "find-church-discovery") {
        DiscoveryViewModel(container.apiClient, locationProvider)
    }

    val pendingToken by appViewModel.pendingInvitationToken.collectAsStateWithLifecycle()
    val churchContext by appViewModel.churchContext.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) {
        if (!showWelcome) return@LaunchedEffect

        // A church link named where this person was heading. Open that church,
        // not a search box — but stop at its profile rather than joining for
        // them. A link is an address, not consent, and the join button is right
        // there on the screen it opens.
        val context = churchContext
        if (context != null && !context.isInvitation) {
            route = FindChurchRoute.Church(context.churchSlug)
            return@LaunchedEffect
        }

        // A deep-linked invitation goes straight to entry — nobody should
        // search for a church they were already invited to.
        if (pendingToken != null) route = FindChurchRoute.Invitation
    }

    fun back() {
        route = when (route) {
            is FindChurchRoute.Church -> FindChurchRoute.Search
            FindChurchRoute.Education -> FindChurchRoute.Search
            FindChurchRoute.Search, FindChurchRoute.Invitation ->
                if (showWelcome) FindChurchRoute.Welcome else FindChurchRoute.Search
            FindChurchRoute.Welcome -> FindChurchRoute.Welcome
        }
    }

    val atRoot = route == start
    BackHandler(enabled = !atRoot || onExit != null) {
        if (atRoot) onExit?.invoke() else back()
    }

    when (val current = route) {
        FindChurchRoute.Welcome -> Box(Modifier.fillMaxSize()) {
            WelcomeScreen(
                onFindChurch = { route = FindChurchRoute.Search },
                onHaveInvitation = { route = FindChurchRoute.Invitation }
            )
            if (onSignOut != null) {
                TextButton(
                    onClick = onSignOut,
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .safeDrawingPadding()
                        .padding(FaithfulTokens.Spacing.sm)
                ) { Text(stringResource(R.string.sign_out)) }
            }
        }

        FindChurchRoute.Search -> {
            val phase by discovery.phase.collectAsStateWithLifecycle()
            val query by discovery.query.collectAsStateWithLifecycle()

            Column(Modifier.fillMaxSize().safeDrawingPadding()) {
                DiscoveryScreen(
                    phase = phase,
                    query = query,
                    onQueryChange = discovery::updateQuery,
                    onSearch = discovery::search,
                    onNearby = {
                        scope.launch {
                            // Education first, always: the OS dialog is raised
                            // only from the education screen's affirmative tap.
                            discovery.beginNearbyFlow()
                            if (discovery.locationAuthorization.value ==
                                LocationAuthorization.AUTHORIZED_WHEN_IN_USE
                            ) {
                                discovery.confirmNearby()
                            } else {
                                route = FindChurchRoute.Education
                            }
                        }
                    },
                    onOpenChurch = { slug -> route = FindChurchRoute.Church(slug) }
                )
            }
        }

        FindChurchRoute.Education -> LocationEducationScreen(
            onContinue = {
                route = FindChurchRoute.Search
                discovery.confirmNearby()
            },
            onSkip = {
                // Declining is a first-class outcome: straight back to the
                // search that needs no permission at all.
                route = FindChurchRoute.Search
                discovery.search()
            }
        )

        is FindChurchRoute.Church -> ChurchProfileHost(
            slug = current.slug,
            appViewModel = appViewModel,
            container = container,
            onAcceptInvitation = { route = FindChurchRoute.Invitation }
        )

        FindChurchRoute.Invitation -> InvitationEntryScreen(appViewModel)
    }
}

@Composable
private fun ChurchProfileHost(
    slug: String,
    appViewModel: AppViewModel,
    container: AppContainer,
    onAcceptInvitation: () -> Unit
) {
    val profile: ChurchProfileViewModel = viewModel(key = "church-profile-$slug") {
        ChurchProfileViewModel(container.apiClient, slug)
    }
    LaunchedEffect(slug) { profile.load() }

    val phase by profile.phase.collectAsStateWithLifecycle()
    val isActing by profile.isActing.collectAsStateWithLifecycle()
    val actionError by profile.actionError.collectAsStateWithLifecycle()

    // A relationship created on this screen is not in bootstrap yet. Refresh
    // quietly so home reflects it — and so first-run ends the moment a church
    // exists.
    LaunchedEffect(phase) {
        val loaded = phase as? io.faithform.faithful.ui.church.ChurchProfilePhase.Loaded
            ?: return@LaunchedEffect
        val state = loaded.profile.relationshipState ?: return@LaunchedEffect
        if (state != io.faithform.faithful.contract.RelationshipState.LEFT) {
            appViewModel.reloadQuietly()
        }
    }

    Column(Modifier.fillMaxSize().safeDrawingPadding()) {
        ChurchProfileScreen(
            phase = phase,
            isActing = isActing,
            actionError = actionError,
            onFollow = profile::follow,
            onRequestJoin = profile::requestJoin,
            onLeave = profile::leave,
            onAcceptInvitation = onAcceptInvitation,
            onRetry = profile::load
        )
    }
}

/**
 * Redeeming an invitation — pasted, or carried in by a deep link. The field is
 * prefilled with a held token so a deep-linked person confirms rather than
 * hunts for something to paste.
 */
@Composable
fun InvitationEntryScreen(appViewModel: AppViewModel) {
    val theme = LocalFaithfulTheme.current
    val invitationPhase by appViewModel.invitationPhase.collectAsStateWithLifecycle()
    val pendingToken by appViewModel.pendingInvitationToken.collectAsStateWithLifecycle()
    var raw by remember { mutableStateOf(pendingToken ?: "") }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(theme.palette.background)
            .safeDrawingPadding()
            .verticalScroll(rememberScrollState())
            .padding(FaithfulTokens.Layout.screenPaddingHorizontal),
        verticalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.lg)
    ) {
        Text(
            stringResource(R.string.invitation_title),
            style = MaterialTheme.typography.displayMedium,
            color = theme.palette.contentPrimary
        )
        Text(
            stringResource(R.string.invitation_body),
            style = MaterialTheme.typography.bodyLarge,
            color = theme.palette.contentSecondary
        )

        Column(verticalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.xs)) {
            Text(
                stringResource(R.string.invitation_field_label),
                style = MaterialTheme.typography.labelLarge,
                color = theme.mutedContent
            )
            TextField(
                value = raw,
                onValueChange = {
                    raw = it
                    appViewModel.clearInvitationError()
                },
                singleLine = true,
                shape = RoundedCornerShape(FaithfulTokens.Radius.md),
                colors = TextFieldDefaults.colors(
                    focusedContainerColor = theme.palette.surfaceSunken,
                    unfocusedContainerColor = theme.palette.surfaceSunken,
                    focusedIndicatorColor = Color.Transparent,
                    unfocusedIndicatorColor = Color.Transparent
                ),
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = FaithfulTokens.TouchTarget.recommended)
            )
        }

        (invitationPhase as? InvitationPhase.Failed)?.let { failed ->
            Text(
                stringResource(failed.code.invitationMessageRes()),
                style = MaterialTheme.typography.bodyMedium,
                color = theme.palette.destructive
            )
        }

        Button(
            onClick = { appViewModel.acceptInvitation(raw) },
            enabled = invitationPhase != InvitationPhase.Working && raw.trim().isNotEmpty(),
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = FaithfulTokens.TouchTarget.recommended)
        ) {
            if (invitationPhase == InvitationPhase.Working) {
                CircularProgressIndicator(
                    modifier = Modifier.heightIn(max = FaithfulTokens.Spacing.lg)
                )
            } else {
                Text(stringResource(R.string.accept_invitation))
            }
        }
    }
}

private fun MobileErrorCode?.invitationMessageRes(): Int = when (this) {
    MobileErrorCode.INVITATION_EXPIRED -> R.string.invitation_error_expired
    MobileErrorCode.BLOCKED -> R.string.blocked_body
    MobileErrorCode.UNAVAILABLE -> R.string.auth_error_offline
    else -> R.string.invitation_error_invalid
}
