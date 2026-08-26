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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import io.faithform.faithful.LaunchPhase
import io.faithform.faithful.R
import io.faithform.faithful.contract.Bootstrap
import io.faithform.faithful.contract.RelationshipState
import io.faithform.faithful.design.FaithfulTokens
import io.faithform.faithful.design.LocalFaithfulTheme
import io.faithform.faithful.navigation.RouteRegistry

/**
 * The authenticated shell.
 *
 * Shows exactly what the contract returns: who you are, which churches you have
 * a relationship with, and the account controls. No tab for a feature that does
 * not exist yet, and no placeholder row standing in for later content.
 */
@Composable
fun FaithfulApp(
    state: LaunchPhase,
    registry: RouteRegistry,
    onSignOut: () -> Unit,
    onRequestDeletion: () -> Unit,
    onRetry: () -> Unit
) {
    val theme = LocalFaithfulTheme.current

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(theme.palette.background)
    ) {
        when (state) {
            is LaunchPhase.Loading -> Centered {
                CircularProgressIndicator(
                    modifier = Modifier.semantics {
                        contentDescription = "Loading your account"
                    }
                )
            }

            is LaunchPhase.SignedOut -> Centered {
                EmptyState(
                    title = stringResource(R.string.sign_in_title),
                    body = stringResource(R.string.sign_in_body)
                )
            }

            is LaunchPhase.OfflineNoCache -> Centered {
                EmptyState(
                    title = stringResource(R.string.offline_title),
                    body = stringResource(R.string.offline_body)
                )
            }

            is LaunchPhase.Failed -> Centered {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    EmptyState(
                        title = stringResource(R.string.error_title),
                        body = state.message
                    )
                    OutlinedButton(onClick = onRetry) {
                        Text(stringResource(R.string.try_again))
                    }
                }
            }

            is LaunchPhase.Ready -> ReadyContent(
                bootstrap = state.bootstrap,
                isStale = state.isStale,
                onSignOut = onSignOut,
                onRequestDeletion = onRequestDeletion
            )
        }
    }
}

@Composable
private fun ReadyContent(
    bootstrap: Bootstrap,
    isStale: Boolean,
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
