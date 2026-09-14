package io.faithform.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material.icons.outlined.WifiOff
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.LocalViewModelStoreOwner
import androidx.lifecycle.viewmodel.compose.viewModel
import io.faithform.app.AppViewModel
import io.faithform.app.LaunchPhase
import io.faithform.app.R
import io.faithform.app.attendance.CameraPermissionRequester
import io.faithform.app.design.FaithFormTokens
import io.faithform.app.design.LocalFaithFormTheme
import io.faithform.app.session.AppContainer
import io.faithform.app.ui.account.AccountExitActions
import io.faithform.app.ui.account.DeleteAccountDialog
import io.faithform.app.ui.account.DeletionRequestedNotice
import io.faithform.app.ui.auth.AuthFlow
import io.faithform.app.ui.auth.AuthViewModel
import io.faithform.app.ui.discovery.EmptyState
import io.faithform.app.ui.discovery.LocationProvider
import io.faithform.app.ui.host.SessionScopeViewModel
import io.faithform.app.ui.host.SignedInHost
import io.faithform.app.ui.onboarding.FindChurchFlow

/**
 * The shell: every launch phase, each a real state with a real way forward.
 *
 * Signed out shows the front door — create an account, sign in, recover a
 * password. Signed in with no church shows the first-run flow, decided by the
 * server. Ready shows the tabs the server's capabilities allow. Offline and
 * failed say what happened and offer a retry, a sign-out and account deletion,
 * because a person who cannot load their church must still be able to leave.
 * No state leaves a person with instructions and nothing to tap.
 *
 * The deletion confirmation is drawn here, above every phase, so it can be
 * opened from the Account tab, the first-run welcome, or an error screen alike.
 *
 * ## Insets
 *
 * Every phase except Ready is padded for the system bars and the keyboard at
 * this level, over a background that runs edge to edge. Ready's scaffold does
 * its own, around the bottom bar.
 */
@Composable
fun FaithFormApp(
    viewModel: AppViewModel,
    container: AppContainer,
    locationProvider: LocationProvider,
    cameraPermission: CameraPermissionRequester,
) {
    val theme = LocalFaithFormTheme.current
    val state by viewModel.state.collectAsStateWithLifecycle()
    val pendingInvitation by viewModel.pendingInvitationToken.collectAsStateWithLifecycle()
    val confirmationPhase by viewModel.confirmationPhase.collectAsStateWithLifecycle()
    val churchContext by viewModel.churchContext.collectAsStateWithLifecycle()
    val deletion by viewModel.deletion.collectAsStateWithLifecycle()
    val deletionRequested by viewModel.deletionRequested.collectAsStateWithLifecycle()

    // The view model is retained, so after a rotation this lambda still hands
    // a new session to the same AppViewModel the screen is observing.
    val authViewModel: AuthViewModel = viewModel(key = "auth") {
        AuthViewModel(container.authClient) { session, displayName ->
            viewModel.completeAuth(session, displayName)
        }
    }

    // Feature models belong to one account at one authorization version. A
    // different one — or signing out — empties them all at once.
    val sessionScope: SessionScopeViewModel = viewModel(key = "session-scope")
    val current = state
    // Bound *before* the host composes, never after: a store cleared after its
    // first models were created would cancel them mid-load. Transient phases
    // (loading, offline) leave the binding alone, so a retry does not throw
    // away a gift that is waiting for the server.
    when (current) {
        is LaunchPhase.SignedOut -> remember(current) { sessionScope.bindTo(null); current }
        is LaunchPhase.Ready -> {
            val key = viewModel.partition(null)?.let { "${it.accountId}|${it.authorizationVersion}" }
            remember(key) { sessionScope.bindTo(key); key }
        }
        else -> Unit
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(theme.palette.background)
    ) {
        if (current is LaunchPhase.Ready) {
            CompositionLocalProvider(LocalViewModelStoreOwner provides sessionScope) {
                SignedInHost(
                    viewModel = viewModel,
                    container = container,
                    bootstrap = current.bootstrap,
                    isStale = current.isStale,
                    locationProvider = locationProvider,
                    cameraPermission = cameraPermission,
                )
            }
        } else {
            Box(Modifier.fillMaxSize().safeDrawingPadding()) {
                when (current) {
                    is LaunchPhase.Loading -> Centered {
                        CircularProgressIndicator(
                            modifier = Modifier.semantics {
                                contentDescription = "Loading your account"
                            }
                        )
                    }

                    is LaunchPhase.SignedOut -> AuthFlow(
                        viewModel = authViewModel,
                        hasPendingInvitation = pendingInvitation != null,
                        confirmationPhase = confirmationPhase,
                        churchContext = churchContext,
                        onClearChurchContext = viewModel::clearChurchContext
                    )

                    is LaunchPhase.Onboarding -> FindChurchFlow(
                        appViewModel = viewModel,
                        container = container,
                        locationProvider = locationProvider,
                        showWelcome = true,
                        onSignOut = viewModel::signOut,
                        onDeleteAccount = viewModel::beginDeletion
                    )

                    is LaunchPhase.OfflineNoCache -> TroubleScreen(
                        title = stringResource(R.string.offline_title),
                        body = stringResource(R.string.offline_body),
                        isOffline = true,
                        onRetry = viewModel::load,
                        onSignOut = viewModel::signOut,
                        onDeleteAccount = viewModel::beginDeletion
                    )

                    // A real failure with a session on the device. The sentence
                    // is the server envelope's own, already redacted
                    // server-side.
                    is LaunchPhase.Failed -> TroubleScreen(
                        title = stringResource(R.string.error_title),
                        body = current.message.ifBlank { stringResource(R.string.error_load_failed_body) },
                        isOffline = false,
                        onRetry = viewModel::load,
                        onSignOut = viewModel::signOut,
                        onDeleteAccount = viewModel::beginDeletion
                    )

                    is LaunchPhase.Ready -> Unit
                }
            }
        }

        DeleteAccountDialog(
            phase = deletion,
            onConfirm = viewModel::confirmDeletion,
            onDismiss = viewModel::cancelDeletion
        )
        DeletionRequestedNotice(
            visible = deletionRequested && current is LaunchPhase.SignedOut,
            onDismiss = viewModel::dismissDeletionNotice
        )
    }
}

/**
 * Offline or failed, with a session on the device: what happened, a retry, and
 * the two ways to leave. Retry comes first because it is usually what works.
 */
@Composable
private fun TroubleScreen(
    title: String,
    body: String,
    isOffline: Boolean,
    onRetry: () -> Unit,
    onSignOut: () -> Unit,
    onDeleteAccount: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(FaithFormTokens.Layout.screenPaddingHorizontal),
        verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.md, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        EmptyState(
            title = title,
            body = body,
            icon = if (isOffline) Icons.Outlined.WifiOff else Icons.Outlined.WarningAmber,
        )
        OutlinedButton(onClick = onRetry) {
            Text(stringResource(R.string.try_again))
        }
        AccountExitActions(
            onSignOut = onSignOut,
            onDeleteAccount = onDeleteAccount,
            modifier = Modifier
                .widthIn(max = FaithFormTokens.Layout.contentMaxWidth)
                .padding(top = FaithFormTokens.Spacing.xl)
        )
    }
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
