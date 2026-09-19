package io.faithform.app.ui.onboarding

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
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
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.faithform.app.AppViewModel
import io.faithform.app.InvitationPhase
import io.faithform.app.R
import io.faithform.app.contract.MobileErrorCode
import io.faithform.app.design.FaithFormTokens
import io.faithform.app.design.LocalFaithFormTheme
import io.faithform.app.session.AppContainer
import io.faithform.app.ui.church.ChurchInfoHost
import io.faithform.app.ui.discovery.DiscoveryScreen
import io.faithform.app.ui.discovery.DiscoveryViewModel
import io.faithform.app.ui.discovery.LocationAuthorization
import io.faithform.app.ui.discovery.LocationEducationScreen
import io.faithform.app.ui.discovery.LocationProvider
import io.faithform.app.ui.discovery.WelcomeScreen
import io.faithform.app.ui.components.FaithFormWorkingLabel
import io.faithform.app.ui.host.TabScreen
import kotlinx.coroutines.launch

/**
 * The find-a-church journey: welcome (first run only) → search or invitation →
 * the church's page → add it (replacing any church they had), or redeem.
 *
 * One flow serves both entrances — first run, and "Change church" / "Find your
 * church" from Home later — so the two cannot drift. Navigation is
 * Android-native: system back walks the route stack, and signing out stays
 * reachable the whole way through first run, because a flow a person cannot
 * leave is a dead end with extra steps.
 */
private sealed interface FindChurchRoute {
    data object Welcome : FindChurchRoute
    data object Search : FindChurchRoute
    data object Education : FindChurchRoute
    data class Church(val slug: String) : FindChurchRoute
    data object Invitation : FindChurchRoute

    companion object {
        /** A route as a string, so it survives a configuration change and a process restore. */
        val Saver: Saver<FindChurchRoute, String> = Saver(
            save = { route ->
                when (route) {
                    Welcome -> "welcome"
                    Search -> "search"
                    Education -> "education"
                    Invitation -> "invitation"
                    is Church -> "church:${route.slug}"
                }
            },
            restore = { saved ->
                when {
                    saved == "welcome" -> Welcome
                    saved == "search" -> Search
                    saved == "education" -> Education
                    saved == "invitation" -> Invitation
                    saved.startsWith("church:") -> Church(saved.removePrefix("church:"))
                    else -> null
                }
            },
        )
    }
}

@Composable
fun FindChurchFlow(
    appViewModel: AppViewModel,
    container: AppContainer,
    locationProvider: LocationProvider,
    showWelcome: Boolean,
    onSignOut: (() -> Unit)? = null,
    /**
     * Opens the account-deletion confirmation. Offered on the welcome screen
     * because a person who signed up and found no church must still be able to
     * delete the account without first joining one — Google Play requires
     * deletion to be reachable from inside the app, not only from a tab.
     */
    onDeleteAccount: (() -> Unit)? = null,
    /** Back from the first screen. */
    onExit: (() -> Unit)? = null,
    /**
     * Inside the tabs: the title of the bar drawn over search, with a back
     * arrow. First run draws no bar.
     */
    embeddedTitle: String? = null,
    /**
     * A church was added (or an invitation accepted) and bootstrap reflects
     * it. Inside the tabs this leaves the flow for Home; first run needs
     * nothing, because the shell swaps to the tabs by itself.
     */
    onChurchAdded: (() -> Unit)? = null,
) {
    val start: FindChurchRoute =
        if (showWelcome) FindChurchRoute.Welcome else FindChurchRoute.Search
    // Saved, not just remembered: rotating the phone on the location dialog
    // used to drop the person back on the welcome screen, with the answer to
    // the dialog they had just given going nowhere visible.
    var route by rememberSaveable(stateSaver = FindChurchRoute.Saver) { mutableStateOf(start) }
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
    val goBack: () -> Unit = { if (atRoot) onExit?.invoke() else back() }
    BackHandler(enabled = !atRoot || onExit != null, onBack = goBack)

    // Inside the tabs, search and invitation entry sit under a bar with a back
    // arrow. The church's page draws its own, over its cover.
    @Composable
    fun Chrome(content: @Composable (Modifier) -> Unit) {
        if (embeddedTitle != null) {
            TabScreen(title = embeddedTitle, onBack = goBack) { inner -> content(inner) }
        } else {
            content(Modifier.fillMaxSize())
        }
    }

    when (val current = route) {
        FindChurchRoute.Welcome -> Box(Modifier.fillMaxSize()) {
            WelcomeScreen(
                onFindChurch = { route = FindChurchRoute.Search },
                onHaveInvitation = { route = FindChurchRoute.Invitation }
            )
            if (onSignOut != null || onDeleteAccount != null) {
                Row(
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .safeDrawingPadding()
                        .padding(FaithFormTokens.Spacing.sm)
                ) {
                    onSignOut?.let {
                        TextButton(onClick = it) { Text(stringResource(R.string.sign_out)) }
                    }
                    onDeleteAccount?.let {
                        TextButton(onClick = it) { Text(stringResource(R.string.delete_account)) }
                    }
                }
            }
        }

        FindChurchRoute.Search -> Chrome { inner ->
            val phase by discovery.phase.collectAsStateWithLifecycle()
            val query by discovery.query.collectAsStateWithLifecycle()

            Column(inner.fillMaxSize().safeDrawingPadding()) {
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

        FindChurchRoute.Education -> Chrome { inner ->
            Box(inner) {
                LocationEducationScreen(
                    onContinue = {
                        route = FindChurchRoute.Search
                        discovery.confirmNearby()
                    },
                    onSkip = {
                        // Declining is a first-class outcome: straight back to
                        // the search that needs no permission at all.
                        route = FindChurchRoute.Search
                        discovery.search()
                    }
                )
            }
        }

        is FindChurchRoute.Church -> ChurchInfoHost(
            slug = current.slug,
            appViewModel = appViewModel,
            container = container,
            onBack = ::back,
            onHaveInvitation = { route = FindChurchRoute.Invitation },
            // Already searching: "Change church" is a step back to the results.
            onChangeChurch = { route = FindChurchRoute.Search },
            onChurchAdded = onChurchAdded,
        )

        FindChurchRoute.Invitation -> Chrome { inner ->
            Box(inner) {
                InvitationEntryScreen(appViewModel, onAccepted = onChurchAdded)
            }
        }
    }
}

/**
 * Redeeming an invitation — pasted, or carried in by a deep link. The field is
 * prefilled with a held token so a deep-linked person confirms rather than
 * hunts for something to paste.
 */
@Composable
fun InvitationEntryScreen(appViewModel: AppViewModel, onAccepted: (() -> Unit)? = null) {
    val theme = LocalFaithFormTheme.current
    val invitationPhase by appViewModel.invitationPhase.collectAsStateWithLifecycle()
    val pendingToken by appViewModel.pendingInvitationToken.collectAsStateWithLifecycle()
    var raw by remember { mutableStateOf(pendingToken ?: "") }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(theme.palette.background)
            .safeDrawingPadding()
            .verticalScroll(rememberScrollState())
            .padding(FaithFormTokens.Layout.screenPaddingHorizontal),
        verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.lg)
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

        Column(verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.xs)) {
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
                shape = RoundedCornerShape(FaithFormTokens.Radius.md),
                colors = TextFieldDefaults.colors(
                    focusedContainerColor = theme.palette.surfaceSunken,
                    unfocusedContainerColor = theme.palette.surfaceSunken,
                    focusedIndicatorColor = Color.Transparent,
                    unfocusedIndicatorColor = Color.Transparent
                ),
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = FaithFormTokens.TouchTarget.recommended)
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
            onClick = { appViewModel.acceptInvitation(raw, onAccepted) },
            enabled = invitationPhase != InvitationPhase.Working && raw.trim().isNotEmpty(),
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = FaithFormTokens.TouchTarget.recommended)
        ) {
            FaithFormWorkingLabel(
                text = stringResource(R.string.accept_invitation),
                working = invitationPhase == InvitationPhase.Working,
            )
        }
    }
}

private fun MobileErrorCode?.invitationMessageRes(): Int = when (this) {
    MobileErrorCode.INVITATION_EXPIRED -> R.string.invitation_error_expired
    MobileErrorCode.BLOCKED -> R.string.blocked_body
    MobileErrorCode.UNAVAILABLE -> R.string.auth_error_offline
    else -> R.string.invitation_error_invalid
}
