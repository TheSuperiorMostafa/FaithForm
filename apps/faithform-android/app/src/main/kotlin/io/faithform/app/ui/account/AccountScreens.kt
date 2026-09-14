package io.faithform.app.ui.account

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import io.faithform.app.DeletionPhase
import io.faithform.app.R
import io.faithform.app.contract.AccountStatus
import io.faithform.app.contract.Bootstrap
import io.faithform.app.design.FaithFormTokens
import io.faithform.app.design.LocalFaithFormTheme

/**
 * The public pages a person may need to read, on the product's own site.
 *
 * Fixed, absolute, https, and on `faithform.io` whatever this build's API
 * origin is: a staging build still points people at the policy that actually
 * applies to them. Google Play requires the privacy policy and a deletion
 * explanation to be reachable from inside the app as well as from the listing.
 */
object LegalLinks {
    const val PRIVACY_POLICY = "https://faithform.io/privacy"
    const val TERMS = "https://faithform.io/terms"
    const val ACCOUNT_DELETION = "https://faithform.io/account-deletion"
}

/**
 * Opens a web page in the person's browser.
 *
 * Never an in-app web view: a page inside the app is a page whose cookies and
 * history the app holds. Started directly rather than resolved first — no
 * package-visibility entry is needed — and a phone with no browser gets a
 * sentence instead of a crash.
 */
fun openWebLink(context: Context, url: String) {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
        .addCategory(Intent.CATEGORY_BROWSABLE)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    try {
        context.startActivity(intent)
    } catch (_: ActivityNotFoundException) {
        Toast.makeText(context, R.string.legal_link_unavailable, Toast.LENGTH_LONG).show()
    }
}

/**
 * The Account tab: who is signed in, the policies, and the two ways to leave.
 */
@Composable
fun AccountTab(
    bootstrap: Bootstrap,
    onSignOut: () -> Unit,
    onDeleteAccount: () -> Unit,
    modifier: Modifier = Modifier,
    settings: @Composable () -> Unit = {},
) {
    val theme = LocalFaithFormTheme.current

    Column(
        modifier = modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .padding(
                horizontal = FaithFormTokens.Layout.screenPaddingHorizontal,
                vertical = FaithFormTokens.Layout.screenPaddingVertical,
            )
            .widthIn(max = FaithFormTokens.Layout.contentMaxWidth),
        verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.lg),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .background(theme.palette.surface, RoundedCornerShape(FaithFormTokens.Radius.lg))
                .border(theme.borderWidth, theme.palette.border, RoundedCornerShape(FaithFormTokens.Radius.lg))
                .padding(FaithFormTokens.Spacing.base),
            verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.xs),
        ) {
            Text(
                text = bootstrap.profile.displayName ?: stringResource(R.string.account),
                style = MaterialTheme.typography.displayMedium,
                color = theme.palette.contentPrimary,
            )
            if (bootstrap.profile.status == AccountStatus.DELETION_REQUESTED) {
                Text(
                    stringResource(R.string.delete_account_requested_title),
                    style = MaterialTheme.typography.bodyMedium,
                    color = theme.palette.destructive,
                )
            }
        }

        // Settings that belong to this account on this phone — automatic
        // check-in today. Supplied by the host, so this screen holds no feature.
        settings()

        LegalLinksSection()

        AccountExitActions(onSignOut = onSignOut, onDeleteAccount = onDeleteAccount)
    }
}

/** Privacy Policy, Terms of Service, and how deletion works — each opening in the browser. */
@Composable
fun LegalLinksSection(modifier: Modifier = Modifier) {
    val context = LocalContext.current

    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.xs)) {
        for ((label, url) in listOf(
            R.string.privacy_policy to LegalLinks.PRIVACY_POLICY,
            R.string.terms_of_service to LegalLinks.TERMS,
            R.string.account_deletion_help to LegalLinks.ACCOUNT_DELETION,
        )) {
            TextButton(
                onClick = { openWebLink(context, url) },
                modifier = Modifier.fillMaxWidth().heightIn(min = FaithFormTokens.TouchTarget.recommended),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(stringResource(label), style = MaterialTheme.typography.bodyLarge)
                    Icon(
                        Icons.AutoMirrored.Outlined.OpenInNew,
                        contentDescription = null,
                        modifier = Modifier.size(FaithFormTokens.IconSize.sizeMedium),
                    )
                }
            }
        }
    }
}

/**
 * Sign out, and delete the account.
 *
 * Shown on the Account tab, on the first-run welcome, and on the offline and
 * failed screens — every signed-in state — because a person who cannot load
 * their church must still be able to leave, and Play requires that deletion is
 * reachable without first getting the rest of the app to work.
 */
@Composable
fun AccountExitActions(
    onSignOut: () -> Unit,
    onDeleteAccount: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val theme = LocalFaithFormTheme.current
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.md)) {
        OutlinedButton(
            onClick = onSignOut,
            modifier = Modifier.fillMaxWidth().heightIn(min = FaithFormTokens.TouchTarget.recommended),
        ) { Text(stringResource(R.string.sign_out)) }

        Button(
            onClick = onDeleteAccount,
            colors = ButtonDefaults.buttonColors(
                containerColor = theme.palette.destructive,
                contentColor = theme.palette.destructiveContent,
            ),
            modifier = Modifier.fillMaxWidth().heightIn(min = FaithFormTokens.TouchTarget.recommended),
        ) { Text(stringResource(R.string.delete_account)) }

        Text(
            stringResource(R.string.delete_account_hint),
            style = MaterialTheme.typography.labelSmall,
            color = theme.mutedContent,
        )
    }
}

/**
 * The confirmation that stands between a tap and a deletion request.
 *
 * Says what happens and what does not, links to the full explanation, and —
 * when the request failed — says plainly that the account was **not** deleted,
 * with the person still signed in and able to try again. Dismissing is always
 * possible except while the request is on its way.
 */
@Composable
fun DeleteAccountDialog(
    phase: DeletionPhase,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    if (phase is DeletionPhase.Idle) return
    val theme = LocalFaithFormTheme.current
    val context = LocalContext.current
    val working = phase is DeletionPhase.Working

    AlertDialog(
        onDismissRequest = { if (!working) onDismiss() },
        title = {
            Text(
                stringResource(
                    if (phase is DeletionPhase.Failed) R.string.delete_account_failed_title
                    else R.string.delete_account_confirm_title
                )
            )
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.md)) {
                Text(stringResource(R.string.delete_account_confirm_body), style = MaterialTheme.typography.bodyMedium)
                TextButton(
                    onClick = { openWebLink(context, LegalLinks.ACCOUNT_DELETION) },
                    enabled = !working,
                ) { Text(stringResource(R.string.account_deletion_help)) }
                (phase as? DeletionPhase.Failed)?.let { failed ->
                    Text(
                        // The server's own sentence when it refused; otherwise
                        // it was never reached. Either way the title above has
                        // already said the account was not deleted.
                        text = failed.message ?: stringResource(R.string.delete_account_failed_body),
                        style = MaterialTheme.typography.bodyMedium,
                        color = theme.palette.destructive,
                        // Announced as it appears: the person just pressed a
                        // button and is waiting to hear what happened.
                        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Assertive },
                    )
                }
                if (working) {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.sm),
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                    ) {
                        CircularProgressIndicator(modifier = Modifier.size(FaithFormTokens.IconSize.sizeMedium))
                        Text(stringResource(R.string.delete_account_working), style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }
        },
        confirmButton = {
            Button(
                onClick = onConfirm,
                enabled = !working,
                colors = ButtonDefaults.buttonColors(
                    containerColor = theme.palette.destructive,
                    contentColor = theme.palette.destructiveContent,
                ),
            ) { Text(stringResource(R.string.delete_account)) }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, enabled = !working) {
                // The platform's own "Cancel", already translated everywhere.
                Text(stringResource(android.R.string.cancel))
            }
        },
    )
}

/**
 * Said once, on the sign-in screen, after a deletion request was recorded:
 * the person has been signed out, and why. Without it the app would simply
 * return to its front door, which reads as a crash or as nothing having
 * happened.
 */
@Composable
fun DeletionRequestedNotice(visible: Boolean, onDismiss: () -> Unit) {
    if (!visible) return
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.delete_account_requested_title)) },
        text = { Text(stringResource(R.string.delete_account_requested_body)) },
        confirmButton = {
            TextButton(onClick = onDismiss) { Text(stringResource(android.R.string.ok)) }
        },
    )
}
