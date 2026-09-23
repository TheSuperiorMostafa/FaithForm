package io.faithform.app.ui.account

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.Toast
import android.os.Build
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Badge
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.LocationOn
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Photo
import androidx.compose.material.icons.outlined.Palette
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
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
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.graphics.Color
import coil.compose.AsyncImage
import coil.request.ImageRequest
import io.faithform.app.ui.groups.GroupPanel
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
 *
 * Laid out as the rest of the app now is — a hero washed in the person's own
 * photo, then panels — so Account stops being the one screen that still looks
 * like a settings form.
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
    onUpdateProfilePhoto: ((ByteArray?, (String?) -> Unit) -> Unit)? = null,
    onUpdateDisplayName: ((String, (Boolean) -> Unit) -> Unit)? = null,
) {
    val theme = LocalFaithFormTheme.current
    val displayName = bootstrap.profile.displayName
    val avatarUrl = bootstrap.profile.avatarUrl
    var editingName by remember { mutableStateOf(false) }

    Box(modifier.fillMaxSize().background(theme.palette.background)) {
        // The wash is the person's own photo, blurred past recognition, so the
        // header reads as one surface from the status bar down.
        ProfileAvatarWash(avatarUrl, Modifier.fillMaxWidth().height(340.dp).align(Alignment.TopCenter))

        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(bottom = FaithFormTokens.Spacing.xxl),
            verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.lg),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            ProfileHero(
                displayName = displayName,
                avatarUrl = avatarUrl,
                subtitle = bootstrap.relationships.firstOrNull {
                    it.churchSlug == bootstrap.profile.selectedChurchSlug
                }?.churchName ?: stringResource(R.string.your_account),
                deletionRequested = bootstrap.profile.status == AccountStatus.DELETION_REQUESTED,
                onUpdateProfilePhoto = onUpdateProfilePhoto,
            )

            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .widthIn(max = FaithFormTokens.Layout.contentMaxWidth)
                    .padding(horizontal = FaithFormTokens.Layout.screenPaddingHorizontal),
                verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.lg),
            ) {
                if (onUpdateDisplayName != null) {
                    GroupPanel("Your details") {
                        AccountRow(
                            icon = Icons.Outlined.Badge,
                            title = stringResource(R.string.auth_name_label),
                            subtitle = displayName ?: stringResource(R.string.account_add_name_hint),
                            trailing = if (displayName == null) "Add" else "Edit",
                            onClick = { editingName = true },
                        )
                    }
                }

                GroupPanel(stringResource(R.string.preferences_section)) {
                    AppearanceChooser()
                    if (showsAutomaticCheckIn && onOpenAutomaticCheckIn != null) {
                        HorizontalDivider(color = theme.palette.divider)
                        AccountRow(
                            icon = Icons.Outlined.LocationOn,
                            title = stringResource(R.string.auto_attendance_title),
                            subtitle = null,
                            trailing = stringResource(
                                if (automaticCheckInEnabled) R.string.auto_attendance_on
                                else R.string.auto_attendance_off,
                            ),
                            onClick = onOpenAutomaticCheckIn,
                        )
                    }
                }

                if (onOpenChurchAppearance != null) {
                    GroupPanel(stringResource(R.string.church_tools_section)) {
                        AccountRow(
                            icon = Icons.Outlined.Palette,
                            title = stringResource(R.string.church_appearance_title),
                            subtitle = stringResource(R.string.church_appearance_row_body),
                            trailing = null,
                            onClick = onOpenChurchAppearance,
                        )
                    }
                }

                GroupPanel(stringResource(R.string.legal_section)) { LegalLinksSection() }

                AccountExitActions(onSignOut = onSignOut, onDeleteAccount = onDeleteAccount)
            }
        }
    }

    if (editingName && onUpdateDisplayName != null) {
        NameEditorSheet(
            current = displayName.orEmpty(),
            onDismiss = { editingName = false },
            onSave = onUpdateDisplayName,
        )
    }
}

/**
 * The header: the photo, the name, and the one tap that changes either.
 *
 * The avatar *is* the control. A row of "Change photo / Remove" buttons under a
 * picture is the shape of a settings form; tapping the picture is the shape of
 * every app people already use, and it leaves the header to be a header.
 */
@Composable
private fun ProfileHero(
    displayName: String?,
    avatarUrl: String?,
    subtitle: String,
    deletionRequested: Boolean,
    onUpdateProfilePhoto: ((ByteArray?, (String?) -> Unit) -> Unit)?,
) {
    val theme = LocalFaithFormTheme.current
    var menuOpen by remember { mutableStateOf(false) }
    var confirmRemoval by remember { mutableStateOf(false) }
    var removing by remember { mutableStateOf(false) }
    var removeFailure by remember { mutableStateOf<String?>(null) }
    val hasPhoto = !avatarUrl.isNullOrBlank()

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = FaithFormTokens.Spacing.base, bottom = FaithFormTokens.Spacing.xs)
            .padding(horizontal = FaithFormTokens.Layout.screenPaddingHorizontal),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.md),
    ) {
        if (onUpdateProfilePhoto == null) {
            ProfileAvatar(avatarUrl, displayName, 112.dp)
        } else {
            ProfilePhotoPicker(onUpdateProfilePhoto) { openPicker, pickerBusy, pickerFailed ->
                val busy = pickerBusy || removing
                Box {
                    Box(
                        modifier = Modifier
                            .clip(CircleShape)
                            .clickable(enabled = !busy) { menuOpen = true }
                            .semantics {
                                contentDescription =
                                    if (hasPhoto) "Profile photo. Opens choices for changing it."
                                    else "Add a profile photo."
                            },
                        contentAlignment = Alignment.Center,
                    ) {
                        ProfileAvatar(avatarUrl, displayName, 112.dp, dimmed = busy)
                        // The badge says the picture is a button without a caption.
                        Box(
                            modifier = Modifier
                                .align(Alignment.BottomEnd)
                                .size(34.dp)
                                .border(3.dp, theme.palette.background, CircleShape)
                                .padding(3.dp)
                                .background(theme.palette.brandAccent, CircleShape),
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(
                                if (hasPhoto) Icons.Outlined.Edit else Icons.Outlined.Add,
                                contentDescription = null,
                                tint = theme.palette.brandPrimary,
                                modifier = Modifier.size(FaithFormTokens.IconSize.sizeSmall),
                            )
                        }
                        if (busy) CircularProgressIndicator(color = theme.palette.brandAccent)
                    }

                    DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                        DropdownMenuItem(
                            text = { Text(if (hasPhoto) "Choose a new photo" else "Choose a photo") },
                            leadingIcon = { Icon(Icons.Outlined.Photo, contentDescription = null) },
                            onClick = { menuOpen = false; removeFailure = null; openPicker() },
                        )
                        if (hasPhoto) {
                            DropdownMenuItem(
                                text = { Text("Remove photo", color = theme.palette.destructive) },
                                leadingIcon = {
                                    Icon(Icons.Outlined.Delete, contentDescription = null, tint = theme.palette.destructive)
                                },
                                onClick = { menuOpen = false; confirmRemoval = true },
                            )
                        }
                    }
                }

                val problem = removeFailure
                    ?: if (pickerFailed) stringResource(R.string.error_title) else null
                if (problem != null) {
                    Text(
                        problem,
                        style = MaterialTheme.typography.labelSmall,
                        color = theme.palette.destructive,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                    )
                }

                if (confirmRemoval) {
                    AlertDialog(
                        onDismissRequest = { confirmRemoval = false },
                        title = { Text("Remove profile photo?") },
                        confirmButton = {
                            TextButton(onClick = {
                                confirmRemoval = false
                                removing = true
                                removeFailure = null
                                onUpdateProfilePhoto(null) { reason ->
                                    removing = false
                                    removeFailure = reason
                                }
                            }) { Text("Remove photo") }
                        },
                        dismissButton = {
                            TextButton(onClick = { confirmRemoval = false }) {
                                Text(stringResource(android.R.string.cancel))
                            }
                        },
                    )
                }
            }
        }

        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.xs),
        ) {
            Text(
                text = displayName ?: stringResource(R.string.your_account),
                style = MaterialTheme.typography.displayMedium,
                color = theme.palette.contentPrimary,
                textAlign = TextAlign.Center,
            )
            Text(
                text = subtitle,
                style = MaterialTheme.typography.bodyMedium,
                color = theme.palette.contentSecondary,
                textAlign = TextAlign.Center,
            )
            if (deletionRequested) {
                Text(
                    stringResource(R.string.delete_account_requested_title),
                    style = MaterialTheme.typography.bodyMedium,
                    color = theme.palette.destructive,
                )
            }
        }
    }
}

/**
 * The person's photo, or their initials on the brand wash. Circular everywhere —
 * a face is not a logo, and the square treatment the Groups screens use for
 * church and group artwork would crop it like one.
 */
@Composable
fun ProfileAvatar(url: String?, name: String?, size: Dp = 112.dp, dimmed: Boolean = false) {
    val theme = LocalFaithFormTheme.current
    Box(
        modifier = Modifier
            .size(size)
            .clip(CircleShape)
            .alpha(if (dimmed) 0.5f else 1f)
            .background(
                Brush.linearGradient(
                    listOf(
                        theme.palette.brandAccent.copy(alpha = 0.34f),
                        theme.palette.brandAccentSoft.copy(alpha = 0.18f),
                    ),
                ),
            )
            .border(theme.borderWidth, theme.palette.border, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        if (!name.isNullOrBlank()) {
            Text(
                accountInitials(name),
                style = if (size >= 72.dp) MaterialTheme.typography.headlineMedium else MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                color = theme.palette.contentPrimary.copy(alpha = 0.78f),
            )
        } else {
            Icon(
                Icons.Outlined.Person,
                contentDescription = null,
                tint = theme.palette.contentPrimary.copy(alpha = 0.55f),
                modifier = Modifier.size(size * 0.36f),
            )
        }
        if (!url.isNullOrBlank()) {
            AsyncImage(
                model = ImageRequest.Builder(LocalContext.current).data(url).crossfade(true).build(),
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
        }
    }
}

/**
 * The same photo, blurred far past recognition, so the header carries the
 * person's own colour without stretching a face into a banner. Blur needs API
 * 31, so older devices get the brand wash instead of an unblurred photo.
 */
@Composable
private fun ProfileAvatarWash(url: String?, modifier: Modifier = Modifier) {
    val theme = LocalFaithFormTheme.current
    Box(modifier.background(theme.palette.background)) {
        if (!url.isNullOrBlank() && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            AsyncImage(
                model = url,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.matchParentSize().blur(52.dp).alpha(0.34f),
            )
        } else {
            Box(
                Modifier.matchParentSize().background(
                    Brush.verticalGradient(
                        listOf(theme.palette.brandAccent.copy(alpha = 0.18f), theme.palette.background),
                    ),
                ),
            )
        }
        Box(
            Modifier.matchParentSize().background(
                Brush.verticalGradient(
                    listOf(theme.palette.background.copy(alpha = 0.1f), theme.palette.background),
                ),
            ),
        )
    }
}

/** One row inside a panel: icon, what it is, and where it goes. */
@Composable
private fun AccountRow(
    icon: ImageVector,
    title: String,
    subtitle: String?,
    trailing: String?,
    onClick: () -> Unit,
) {
    val theme = LocalFaithFormTheme.current
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(FaithFormTokens.Radius.md))
            .clickable(onClick = onClick)
            .heightIn(min = FaithFormTokens.TouchTarget.recommended),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.md),
    ) {
        Icon(
            icon,
            contentDescription = null,
            tint = theme.palette.brandAccent,
            modifier = Modifier.size(FaithFormTokens.IconSize.sizeMedium),
        )
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, style = MaterialTheme.typography.bodyLarge, color = theme.palette.contentPrimary)
            if (subtitle != null) {
                Text(
                    subtitle,
                    style = MaterialTheme.typography.labelSmall,
                    color = theme.palette.contentSecondary,
                )
            }
        }
        if (trailing != null) {
            Text(trailing, style = MaterialTheme.typography.labelLarge, color = theme.palette.brandAccent)
        }
        Icon(
            Icons.AutoMirrored.Outlined.KeyboardArrowRight,
            contentDescription = null,
            tint = theme.palette.contentSecondary,
            modifier = Modifier.size(FaithFormTokens.IconSize.sizeMedium),
        )
    }
}

/** System, Light or Dark — a segmented row, not three stacked buttons. */
@Composable
private fun AppearanceChooser() {
    val theme = LocalFaithFormTheme.current
    val context = LocalContext.current
    val prefs = remember { context.getSharedPreferences("faithform_prefs", Context.MODE_PRIVATE) }
    var current by remember { mutableStateOf(prefs.getString("appearance", "system") ?: "system") }

    Column(verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.sm)) {
        Text(
            "Appearance",
            style = MaterialTheme.typography.bodyMedium,
            color = theme.palette.contentSecondary,
        )
        SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
            val options = listOf("system" to "System", "light" to "Light", "dark" to "Dark")
            options.forEachIndexed { index, (key, label) ->
                SegmentedButton(
                    selected = current == key,
                    onClick = {
                        current = key
                        prefs.edit().putString("appearance", key).apply()
                    },
                    shape = SegmentedButtonDefaults.itemShape(index, options.size),
                    colors = SegmentedButtonDefaults.colors(
                        activeContainerColor = theme.palette.brandAccent,
                        activeContentColor = theme.palette.contentOnAccent,
                        inactiveContainerColor = Color.Transparent,
                        inactiveContentColor = theme.palette.contentPrimary,
                        activeBorderColor = theme.palette.brandAccent,
                        inactiveBorderColor = theme.palette.border,
                    ),
                ) { Text(label, maxLines = 1) }
            }
        }
    }
}

/**
 * Changing the name other people see.
 *
 * A sheet rather than a field wired into the page, because the name is now
 * editable whenever — the old screen only offered it while it was still blank,
 * which left no way to fix a typo short of deleting the account.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun NameEditorSheet(
    current: String,
    onDismiss: () -> Unit,
    onSave: (String, (Boolean) -> Unit) -> Unit,
) {
    val theme = LocalFaithFormTheme.current
    var draft by remember { mutableStateOf(current) }
    var saving by remember { mutableStateOf(false) }
    var failed by remember { mutableStateOf(false) }
    val shape = RoundedCornerShape(FaithFormTokens.Radius.control)
    val trimmed = draft.trim()

    ModalBottomSheet(onDismissRequest = { if (!saving) onDismiss() }, containerColor = theme.palette.background) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = FaithFormTokens.Layout.screenPaddingHorizontal)
                .padding(bottom = FaithFormTokens.Spacing.xl),
            verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.base),
        ) {
            Text(
                "Your name",
                style = MaterialTheme.typography.titleLarge,
                color = theme.palette.contentPrimary,
            )
            Text(
                stringResource(R.string.account_add_name_hint),
                style = MaterialTheme.typography.bodyMedium,
                color = theme.palette.contentSecondary,
            )
            TextField(
                value = draft,
                onValueChange = { draft = it; failed = false },
                singleLine = true,
                shape = shape,
                label = { Text(stringResource(R.string.auth_name_label)) },
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
                    .heightIn(min = FaithFormTokens.TouchTarget.recommended),
            )
            if (failed) {
                Text(
                    stringResource(R.string.error_title),
                    style = MaterialTheme.typography.bodyMedium,
                    color = theme.palette.destructive,
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                )
            }
            Button(
                onClick = {
                    saving = true
                    failed = false
                    onSave(trimmed) { ok ->
                        saving = false
                        if (ok) onDismiss() else failed = true
                    }
                },
                enabled = !saving && trimmed.isNotEmpty() && trimmed != current,
                colors = ButtonDefaults.buttonColors(
                    containerColor = theme.palette.brandAccent,
                    contentColor = theme.palette.contentOnAccent,
                ),
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = FaithFormTokens.TouchTarget.recommended),
            ) {
                FaithFormWorkingLabel(text = stringResource(R.string.account_save_name), working = saving)
            }
        }
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
            AppearancePreset("Classic", "#002D5F", "#C5A059"),
            AppearancePreset("Ocean", "#164E63", "#22D3EE"),
            AppearancePreset("Hope", "#365314", "#A3E635"),
            AppearancePreset("Grace", "#581C87", "#D8B4FE"),
            AppearancePreset("Warm", "#7C2D12", "#FDBA74"),
            AppearancePreset("Modern", "#111827", "#60A5FA"),
        )
    }
    var primary by remember(church.churchSlug) {
        mutableStateOf(church.appTheme?.light?.primary ?: "#002D5F")
    }
    var accent by remember(church.churchSlug) {
        mutableStateOf(church.appTheme?.light?.accent ?: "#C5A059")
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
        TextField(value = primary, onValueChange = { primary = it.uppercase(); failed = false }, label = { Text("Primary · #002D5F") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        TextField(value = accent, onValueChange = { accent = it.uppercase(); failed = false }, label = { Text("Accent · #C5A059") }, singleLine = true, modifier = Modifier.fillMaxWidth())
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
