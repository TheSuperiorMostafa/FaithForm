package io.faithform.faithful.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.faithform.faithful.AppViewModel
import io.faithform.faithful.LaunchPhase
import io.faithform.faithful.R
import io.faithform.faithful.contract.Bootstrap
import io.faithform.faithful.contract.RelationshipState
import io.faithform.faithful.design.FaithfulTokens
import io.faithform.faithful.design.LocalFaithfulTheme
import io.faithform.faithful.navigation.RouteRegistry
import io.faithform.faithful.session.AppContainer
import io.faithform.faithful.ui.auth.AuthFlow
import io.faithform.faithful.ui.auth.AuthViewModel
import io.faithform.faithful.ui.discovery.LocationProvider
import io.faithform.faithful.ui.onboarding.FindChurchFlow

/**
 * The shell: every launch phase, each a real state with a real way forward.
 *
 * Signed out shows the front door — create an account, sign in, recover a
 * password. Signed in with no church shows the first-run flow, decided by the
 * server. Ready shows exactly what the contract returns: who you are, which
 * churches you have a relationship with, and the account controls. No state
 * leaves a person with instructions and nothing to tap.
 */
@Composable
fun FaithfulApp(
    viewModel: AppViewModel,
    container: AppContainer,
    locationProvider: LocationProvider,
    registry: RouteRegistry
) {
    val theme = LocalFaithfulTheme.current
    val state by viewModel.state.collectAsStateWithLifecycle()
    val pendingInvitation by viewModel.pendingInvitationToken.collectAsStateWithLifecycle()

    val authViewModel: AuthViewModel = viewModel(key = "auth") {
        AuthViewModel(container.authClient) { session, displayName ->
            viewModel.completeAuth(session, displayName)
        }
    }

    var findChurchOpen by rememberSaveable { mutableStateOf(false) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(theme.palette.background)
    ) {
        when (val current = state) {
            is LaunchPhase.Loading -> Centered {
                CircularProgressIndicator(
                    modifier = Modifier.semantics {
                        contentDescription = "Loading your account"
                    }
                )
            }

            is LaunchPhase.SignedOut -> AuthFlow(
                viewModel = authViewModel,
                hasPendingInvitation = pendingInvitation != null
            )

            is LaunchPhase.Onboarding -> FindChurchFlow(
                appViewModel = viewModel,
                container = container,
                locationProvider = locationProvider,
                showWelcome = true,
                onSignOut = viewModel::signOut
            )

            is LaunchPhase.OfflineNoCache -> Centered {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    EmptyState(
                        title = stringResource(R.string.offline_title),
                        body = stringResource(R.string.offline_body)
                    )
                    OutlinedButton(onClick = viewModel::load) {
                        Text(stringResource(R.string.try_again))
                    }
                }
            }

            is LaunchPhase.Failed -> Centered {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    EmptyState(
                        title = stringResource(R.string.error_title),
                        body = current.message
                    )
                    OutlinedButton(onClick = viewModel::load) {
                        Text(stringResource(R.string.try_again))
                    }
                }
            }

            is LaunchPhase.Ready ->
                if (findChurchOpen) {
                    // "Add another church" reuses the exact first-run flow,
                    // minus the welcome screen; system back returns here.
                    FindChurchFlow(
                        appViewModel = viewModel,
                        container = container,
                        locationProvider = locationProvider,
                        showWelcome = false,
                        onExit = { findChurchOpen = false }
                    )
                } else {
                    ReadyContent(
                        bootstrap = current.bootstrap,
                        isStale = current.isStale,
                        onFindChurch = { findChurchOpen = true },
                        onSignOut = viewModel::signOut,
                        onRequestDeletion = viewModel::requestDeletion
                    )
                }
        }
    }
}

@Composable
private fun ReadyContent(
    bootstrap: Bootstrap,
    isStale: Boolean,
    onFindChurch: () -> Unit,
    onSignOut: () -> Unit,
    onRequestDeletion: () -> Unit
) {
    val theme = LocalFaithfulTheme.current

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(
                horizontal = FaithfulTokens.Layout.screenPaddingHorizontal,
                vertical = FaithfulTokens.Layout.screenPaddingVertical
            )
            .widthIn(max = FaithfulTokens.Layout.contentMaxWidth),
        verticalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.lg)
    ) {
        if (isStale) {
            OfflineBanner(stringResource(R.string.offline_cached))
        }

        FaithfulCard {
            Text(
                text = bootstrap.profile.displayName ?: stringResource(R.string.account),
                style = MaterialTheme.typography.displayMedium,
                color = theme.palette.contentPrimary
            )
        }

        Column(verticalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.md)) {
            Text(
                text = stringResource(R.string.your_churches),
                style = MaterialTheme.typography.labelLarge,
                color = theme.mutedContent
            )

            if (bootstrap.relationships.isEmpty()) {
                EmptyState(
                    title = stringResource(R.string.no_churches_title),
                    body = stringResource(R.string.no_churches_body)
                )
            } else {
                bootstrap.relationships.forEach { relationship ->
                    // One combined element so TalkBack reads a church as a
                    // single row rather than three disconnected fragments.
                    FaithfulCard(modifier = Modifier.semantics(mergeDescendants = true) {}) {
                        Text(
                            text = relationship.churchName,
                            style = MaterialTheme.typography.titleMedium,
                            color = theme.palette.contentPrimary
                        )
                        Spacer(Modifier.padding(top = FaithfulTokens.Spacing.xs))
                        StatusChip(stringResource(relationship.state.labelRes()))
                    }
                }
            }

            // Multi-church by design: an account is never bound to one
            // congregation, so finding the next one starts here.
            OutlinedButton(
                onClick = onFindChurch,
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = FaithfulTokens.TouchTarget.recommended)
            ) { Text(stringResource(R.string.add_another_church)) }
        }

        Column(verticalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.md)) {
            Text(
                text = stringResource(R.string.account),
                style = MaterialTheme.typography.labelLarge,
                color = theme.mutedContent
            )

            OutlinedButton(
                onClick = onSignOut,
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = FaithfulTokens.TouchTarget.recommended)
            ) { Text(stringResource(R.string.sign_out)) }

            val deleteHint = stringResource(R.string.delete_account_hint)
            Button(
                onClick = onRequestDeletion,
                colors = ButtonDefaults.buttonColors(
                    containerColor = theme.palette.destructive,
                    contentColor = theme.palette.destructiveContent
                ),
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = FaithfulTokens.TouchTarget.recommended)
                    .semantics { contentDescription = deleteHint }
            ) { Text(stringResource(R.string.delete_account)) }
        }
    }
}

private fun RelationshipState.labelRes(): Int = when (this) {
    RelationshipState.FOLLOWING -> R.string.state_following
    RelationshipState.PENDING -> R.string.state_pending
    RelationshipState.JOINED -> R.string.state_joined
    RelationshipState.LEFT -> R.string.state_left
    RelationshipState.BLOCKED -> R.string.state_blocked
    RelationshipState.UNKNOWN -> R.string.state_left
}

@Composable
private fun Centered(content: @Composable () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
        content = { content() }
    )
}

@Composable
private fun FaithfulCard(
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit
) {
    val theme = LocalFaithfulTheme.current
    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(theme.palette.surface, RoundedCornerShape(FaithfulTokens.Radius.lg))
            .border(
                theme.borderWidth,
                theme.palette.border,
                RoundedCornerShape(FaithfulTokens.Radius.lg)
            )
            .padding(FaithfulTokens.Spacing.base),
        content = { content() }
    )
}

@Composable
private fun StatusChip(text: String) {
    val theme = LocalFaithfulTheme.current
    Text(
        text = text,
        style = MaterialTheme.typography.labelLarge,
        color = theme.palette.contentSecondary,
        modifier = Modifier
            .background(theme.palette.surfaceSunken, RoundedCornerShape(FaithfulTokens.Radius.pill))
            .padding(
                horizontal = FaithfulTokens.Spacing.sm,
                vertical = FaithfulTokens.Spacing.xs
            )
    )
}

@Composable
private fun EmptyState(title: String, body: String) {
    val theme = LocalFaithfulTheme.current
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(FaithfulTokens.Spacing.xl)
            .semantics(mergeDescendants = true) {},
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.sm)
    ) {
        Text(title, style = MaterialTheme.typography.titleMedium, color = theme.palette.contentPrimary)
        Text(
            body,
            style = MaterialTheme.typography.bodyMedium,
            color = theme.palette.contentSecondary,
            textAlign = TextAlign.Center
        )
    }
}

@Composable
private fun OfflineBanner(message: String) {
    val theme = LocalFaithfulTheme.current
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(theme.palette.warning, RoundedCornerShape(FaithfulTokens.Radius.md))
            .padding(FaithfulTokens.Spacing.md)
            .clearAndSetSemantics { contentDescription = message }
    ) {
        Text(message, style = MaterialTheme.typography.bodyMedium, color = theme.palette.warningContent)
    }
}
