package io.faithform.app.ui.account

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material.icons.outlined.LocationOn
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Palette
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.graphics.Color
import coil.compose.AsyncImage
import coil.request.ImageRequest
import io.faithform.app.DeletionPhase
import io.faithform.app.R
import io.faithform.app.ui.components.FaithFormWorkingLabel
import io.faithform.app.contract.AccountStatus
import io.faithform.app.contract.Bootstrap
import io.faithform.app.contract.ChurchRelationship
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
 * The Account tab: who is signed in, preferences, policies, and the two ways to leave.
 */
@Composable
fun AccountTab(
    bootstrap: Bootstrap,
    onSignOut: () -> Unit,
    onDeleteAccount: () -> Unit,
    modifier: Modifier = Modifier,
    showsAutomaticCheckIn: Boolean = false,
    automaticCheckInEnabled: Boolean = false,
    onOpenAutomaticCheckIn: (() -> Unit)? = null,
    onOpenChurchAppearance: (() -> Unit)? = null,
    onUpdateDisplayName: ((String, (Boolean) -> Unit) -> Unit)? = null,
) {
    val theme = LocalFaithFormTheme.current
    val displayName = bootstrap.profile.displayName
    val title = displayName ?: stringResource(R.string.your_account)
    val avatarSize = FaithFormTokens.TouchTarget.recommended + FaithFormTokens.Spacing.base
    var draftName by remember(displayName) { mutableStateOf(displayName.orEmpty()) }
    var savingName by remember { mutableStateOf(false) }
    var nameSaveFailed by remember { mutableStateOf(false) }

    Column(
        modifier = modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .padding(
                horizontal = FaithFormTokens.Layout.screenPaddingHorizontal,
                vertical = FaithFormTokens.Layout.screenPaddingVertical,
            )
            .widthIn(max = FaithFormTokens.Layout.contentMaxWidth),
        verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.xl),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(theme.palette.surface, RoundedCornerShape(FaithFormTokens.Radius.lg))
                .border(theme.borderWidth, theme.palette.border, RoundedCornerShape(FaithFormTokens.Radius.lg))
                .padding(FaithFormTokens.Spacing.base),
            horizontalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.base),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                modifier = Modifier
                    .size(avatarSize)
                    .clip(CircleShape)
                    .background(theme.palette.surfaceSunken)
                    .border(theme.borderWidth, theme.palette.border, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                val avatarUrl = bootstrap.profile.avatarUrl
                if (!avatarUrl.isNullOrBlank()) {
                    AsyncImage(
                        model = ImageRequest.Builder(LocalContext.current)
                            .data(avatarUrl)
                            .crossfade(true)
                            .build(),
                        contentDescription = null,
                        contentScale = ContentScale.Crop,
                        modifier = Modifier.fillMaxSize(),
                    )
                } else if (!displayName.isNullOrBlank()) {
                    Text(
                        accountInitials(displayName),
                        style = MaterialTheme.typography.titleMedium,
                        color = theme.palette.brandPrimary,
                    )
                } else {
                    Icon(
                        Icons.Outlined.Person,
                        contentDescription = null,
                        tint = theme.palette.brandPrimary,
                        modifier = Modifier.size(FaithFormTokens.IconSize.sizeLarge),
                    )
                }
            }
            Column(verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.xs)) {
                Text(
                    text = title,
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
        }

        if (displayName.isNullOrBlank() && onUpdateDisplayName != null) {
            val shape = RoundedCornerShape(FaithFormTokens.Radius.control)
            Column(verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.sm)) {
                Text(
                    stringResource(R.string.account_add_name_hint),
                    style = MaterialTheme.typography.bodyMedium,
                    color = theme.palette.contentSecondary,
                )
                Column(verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.xs)) {
                    Text(
                        stringResource(R.string.auth_name_label),
                        style = MaterialTheme.typography.labelLarge,
                        color = theme.mutedContent,
                    )
                    TextField(
                        value = draftName,
                        onValueChange = {
                            draftName = it
                            nameSaveFailed = false
                        },
                        singleLine = true,
                        shape = shape,
                        colors = TextFieldDefaults.colors(
                            focusedContainerColor = theme.palette.surface,
                            unfocusedContainerColor = theme.palette.surface,
                            disabledContainerColor = theme.palette.surface,
                            focusedIndicatorColor = theme.palette.brandAccent,
                            unfocusedIndicatorColor = theme.palette.border,
                            cursorColor = theme.palette.brandPrimary,
                        ),
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(min = FaithFormTokens.TouchTarget.recommended)
                            .border(theme.borderWidth, theme.palette.border, shape),
                    )
                }
                if (nameSaveFailed) {
                    Text(
                        stringResource(R.string.error_title),
                        style = MaterialTheme.typography.bodyMedium,
                        color = theme.palette.destructive,
                        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                    )
                }
                Button(
                    onClick = {
                        savingName = true
                        nameSaveFailed = false
                        onUpdateDisplayName(draftName) { ok ->
                            savingName = false
                            if (!ok) nameSaveFailed = true
                        }
                    },
                    enabled = !savingName && draftName.trim().isNotEmpty(),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = theme.palette.brandAccent,
                        contentColor = theme.palette.contentOnAccent,
                    ),
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = FaithFormTokens.TouchTarget.recommended),
                ) {
                    FaithFormWorkingLabel(
                        text = stringResource(R.string.account_save_name),
                        working = savingName,
                    )
                }
            }
        }

        if (showsAutomaticCheckIn && onOpenAutomaticCheckIn != null) {
            Column(verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.sm)) {
                Text(
                    stringResource(R.string.preferences_section),
                    style = MaterialTheme.typography.labelLarge,
                    color = theme.mutedContent,
                )
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(theme.palette.surface, RoundedCornerShape(FaithFormTokens.Radius.lg))
                        .border(theme.borderWidth, theme.palette.border, RoundedCornerShape(FaithFormTokens.Radius.lg))
                        .clickable(onClick = onOpenAutomaticCheckIn)
                        .padding(FaithFormTokens.Spacing.base)
                        .heightIn(min = FaithFormTokens.TouchTarget.recommended),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.md),
                ) {
                    Icon(
                        Icons.Outlined.LocationOn,
                        contentDescription = null,
                        tint = theme.palette.brandPrimary,
                    )
                    Text(
                        stringResource(R.string.auto_attendance_title),
                        style = MaterialTheme.typography.bodyLarge,
                        color = theme.palette.contentPrimary,
                        modifier = Modifier.weight(1f),
                    )
                    Text(
                        stringResource(
                            if (automaticCheckInEnabled) R.string.auto_attendance_on
                            else R.string.auto_attendance_off,
                        ),
                        style = MaterialTheme.typography.labelLarge,
                        color = theme.palette.contentSecondary,
                    )
                }
            }
        }

        if (onOpenChurchAppearance != null) {
            Column(verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.sm)) {
                Text(
                    stringResource(R.string.church_tools_section),
                    style = MaterialTheme.typography.labelLarge,
                    color = theme.mutedContent,
                )
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(theme.palette.surface, RoundedCornerShape(FaithFormTokens.Radius.lg))
                        .border(theme.borderWidth, theme.palette.border, RoundedCornerShape(FaithFormTokens.Radius.lg))
                        .clickable(onClick = onOpenChurchAppearance)
                        .padding(FaithFormTokens.Spacing.base)
                        .heightIn(min = FaithFormTokens.TouchTarget.recommended),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.md),
                ) {
                    Icon(Icons.Outlined.Palette, contentDescription = null, tint = theme.palette.brandPrimary)
                    Column(Modifier.weight(1f)) {
                        Text(stringResource(R.string.church_appearance_title), color = theme.palette.contentPrimary)
                        Text(
                            stringResource(R.string.church_appearance_row_body),
                            style = MaterialTheme.typography.labelSmall,
                            color = theme.palette.contentSecondary,
                        )
                    }
                }
            }
        }

        Column(verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.sm)) {
            Text(
                stringResource(R.string.legal_section),
                style = MaterialTheme.typography.labelLarge,
                color = theme.mutedContent,
            )
            LegalLinksSection()
        }

        AccountExitActions(onSignOut = onSignOut, onDeleteAccount = onDeleteAccount)
    }
}

private data class AppearancePreset(
    val name: String,
    val primary: String,
    val accent: String,
)

@Composable
fun ChurchAppearanceScreen(
    church: ChurchRelationship,
    onSave: (String, String, (Boolean) -> Unit) -> Unit,
    modifier: Modifier = Modifier,
) {
    val theme = LocalFaithFormTheme.current
    val presets = remember {
        listOf(
            AppearancePreset("Classic", "#1A2B4B", "#C19A6B"),
            AppearancePreset("Ocean", "#164E63", "#22D3EE"),
            AppearancePreset("Hope", "#365314", "#A3E635"),
            AppearancePreset("Grace", "#581C87", "#D8B4FE"),
            AppearancePreset("Warm", "#7C2D12", "#FDBA74"),
            AppearancePreset("Modern", "#111827", "#60A5FA"),
        )
    }
    var primary by remember(church.churchSlug) {
        mutableStateOf(church.appTheme?.light?.primary ?: "#1A2B4B")
    }
    var accent by remember(church.churchSlug) {
        mutableStateOf(church.appTheme?.light?.accent ?: "#C19A6B")
    }
    var saving by remember { mutableStateOf(false) }
    var failed by remember { mutableStateOf(false) }
    val valid = HEX_COLOR.matches(primary.trim()) && HEX_COLOR.matches(accent.trim())

    Column(
        modifier = modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .padding(FaithFormTokens.Layout.screenPaddingHorizontal),
        verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.lg),
    ) {
        Text(
            stringResource(R.string.church_appearance_body),
            color = theme.palette.contentSecondary,
        )
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .background(theme.palette.surface, RoundedCornerShape(FaithFormTokens.Radius.lg))
                .padding(FaithFormTokens.Spacing.lg),
            verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.sm),
        ) {
            Text(
                church.churchName,
                style = MaterialTheme.typography.titleLarge,
                color = colorFromHex(primary, theme.palette.brandPrimary),
            )
            Text(stringResource(R.string.church_appearance_preview), color = theme.palette.contentSecondary)
            Button(
                onClick = {},
                colors = ButtonDefaults.buttonColors(
                    containerColor = colorFromHex(accent, theme.palette.brandAccent),
                    contentColor = colorFromHex(primary, theme.palette.contentOnAccent),
                ),
            ) { Text(stringResource(R.string.church_appearance_button)) }
        }

        Text(stringResource(R.string.church_appearance_presets), style = MaterialTheme.typography.titleMedium)
        presets.chunked(2).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.sm)) {
                row.forEach { preset ->
                    OutlinedButton(
                        onClick = {
                            primary = preset.primary
                            accent = preset.accent
                            failed = false
                        },
                        modifier = Modifier.weight(1f),
                    ) {
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                            Box(Modifier.size(18.dp).background(colorFromHex(preset.primary, Color.Black), CircleShape))
                            Box(Modifier.size(18.dp).background(colorFromHex(preset.accent, Color.White), CircleShape))
                            Text(preset.name)
                        }
                    }
                }
            }
        }

        Text(stringResource(R.string.church_appearance_custom), style = MaterialTheme.typography.titleMedium)
        TextField(value = primary, onValueChange = { primary = it.uppercase(); failed = false }, label = { Text("Primary · #1A2B4B") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        TextField(value = accent, onValueChange = { accent = it.uppercase(); failed = false }, label = { Text("Accent · #C19A6B") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        if (failed) {
            Text(stringResource(R.string.church_appearance_error), color = theme.palette.destructive)
        }
        Button(
            onClick = {
                saving = true
                onSave(primary.trim().uppercase(), accent.trim().uppercase()) { ok ->
                    saving = false
                    failed = !ok
                }
            },
            enabled = valid && !saving,
            modifier = Modifier.fillMaxWidth().heightIn(min = FaithFormTokens.TouchTarget.recommended),
        ) {
            FaithFormWorkingLabel(stringResource(R.string.church_appearance_save), saving)
        }
    }
}

private val HEX_COLOR = Regex("^#[0-9A-Fa-f]{6}$")

private fun colorFromHex(value: String, fallback: Color): Color =
    runCatching { Color((0xFF000000L or value.removePrefix("#").toLong(16)).toInt()) }.getOrDefault(fallback)

private fun accountInitials(name: String): String {
    val parts = name.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }.take(2)
    return if (parts.isEmpty()) "?" else parts.mapNotNull { it.firstOrNull()?.uppercaseChar() }.joinToString("")
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
                    FaithFormWorkingLabel(
                        text = stringResource(R.string.delete_account_working),
                        working = true,
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                    )
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
