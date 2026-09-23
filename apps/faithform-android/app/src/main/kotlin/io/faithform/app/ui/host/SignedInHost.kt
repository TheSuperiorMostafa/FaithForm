package io.faithform.app.ui.host

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.outlined.Groups
import io.faithform.app.ui.groups.GroupsHost
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.OndemandVideo
import androidx.compose.material.icons.outlined.QrCodeScanner
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.ScaffoldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.faithform.app.AppViewModel
import io.faithform.app.R
import io.faithform.app.attendance.CameraPermissionRequester
import io.faithform.app.contract.Bootstrap
import io.faithform.app.design.FaithFormTokens
import io.faithform.app.design.LocalFaithFormTheme
import io.faithform.app.giving.RelayedPaymentSheet
import io.faithform.app.host.HostNavigation
import io.faithform.app.host.HostTab
import io.faithform.app.session.AppContainer
import io.faithform.app.ui.account.AccountTab
import io.faithform.app.ui.account.ChurchAppearanceScreen
import io.faithform.app.ui.attendance.AutomaticAttendanceIntroScreen
import io.faithform.app.ui.attendance.AutomaticCheckInEntry
import io.faithform.app.ui.attendance.CheckInTab
import io.faithform.app.ui.discovery.LocationProvider
import io.faithform.app.ui.giving.GiveTab
import io.faithform.app.ui.media.LivePlayerScreen
import io.faithform.app.ui.media.WatchTab

/**
 * The signed-in app: a bottom bar of the tabs this account may use right now,
 * and the tab it is on.
 *
 * Mirrors `RootView.tabs` on iOS. Which tabs exist is decided by
 * [HostNavigation.availableTabs] — the route registry, the server's
 * capabilities, and the selected church's relationship — and never by a list
 * written here, so a capability switched off on the server removes its tab on
 * the next bootstrap.
 *
 * ## Insets
 *
 * The app draws edge to edge. The scaffold places the tabs between the status
 * bar and the navigation bar and consumes those insets, so nothing a tab draws
 * sits under either, and nothing inside a tab pads for them a second time. The
 * keyboard is padded for on top of that, because edge-to-edge windows are not
 * resized for it.
 *
 * Each tab keeps its own saved state — its sub-page, its search text — while
 * another tab is showing.
 */
@Composable
fun SignedInHost(
    viewModel: AppViewModel,
    container: AppContainer,
    bootstrap: Bootstrap,
    isStale: Boolean,
    locationProvider: LocationProvider,
    cameraPermission: CameraPermissionRequester,
) {
    val theme = LocalFaithFormTheme.current
    val selectedSlug by viewModel.selectedChurchSlug.collectAsStateWithLifecycle()
    val selectedTab by viewModel.selectedTab.collectAsStateWithLifecycle()

    val invitationToken by viewModel.groupInvitationToken.collectAsStateWithLifecycle()
    invitationToken?.let { token -> io.faithform.app.ui.groups.GroupInvitationScreen(container.apiClient, token, viewModel::dismissGroupInvitation) { slug ->
        viewModel.dismissGroupInvitation()
        viewModel.handleDeepLink("faithform://church/$slug/groups")
    } }
    val tabs = HostNavigation.availableTabs(bootstrap, selectedSlug, viewModel.registry)
    // A tab that stopped being available — a capability switched off, a church
    // switched to one that does not allow it — falls back to the first one.
    val current = selectedTab.takeIf { it in tabs || it == HostTab.ACCOUNT } ?: tabs.firstOrNull() ?: HostTab.ACCOUNT

    val church = bootstrap.relationships.firstOrNull { it.churchSlug == selectedSlug }
    val partition = viewModel.partition(selectedSlug)
    val tabStates = rememberSaveableStateHolder()
    var recordingFullScreen by remember { mutableStateOf(false) }
    val hideChrome = recordingFullScreen && current == HostTab.WATCH

    // "Watch live" from any tab opens here, over the tabs and the bar, and
    // starts playing — the person asked to watch, not to be taken somewhere
    // with another button on it.
    val watchingLive by viewModel.watchingLive.collectAsStateWithLifecycle()
    val live = watchingLive
    if (live != null) {
        if (live.churchSlug == selectedSlug && partition != null) {
            LivePlayerScreen(
                watching = live,
                client = container.mediaClient,
                resumePositions = container.resumePositions,
                partition = partition,
                onClose = viewModel::closeLive,
                presentationClient = container.presentationClient,
            )
            return
        }
        // The church changed underneath it; nothing of the old one may play.
        LaunchedEffect(live) { viewModel.closeLive() }
    }

    Scaffold(
        containerColor = theme.palette.background,
        contentWindowInsets = if (hideChrome) WindowInsets(0, 0, 0, 0) else ScaffoldDefaults.contentWindowInsets,
        bottomBar = {
            if (!hideChrome) NavigationBar(containerColor = theme.palette.surface) {
                tabs.forEach { tab ->
                    val label = stringResource(tab.titleRes)
                    NavigationBarItem(
                        selected = tab == current,
                        onClick = { viewModel.selectTab(tab) },
                        icon = { Icon(tab.icon, contentDescription = null) },
                        label = { Text(label, maxLines = 1) },
                        colors = NavigationBarItemDefaults.colors(
                            selectedIconColor = theme.palette.brandAccent,
                            selectedTextColor = theme.palette.brandAccent,
                            indicatorColor = theme.palette.brandAccentSoft.copy(alpha = 0.22f),
                            unselectedIconColor = theme.mutedContent,
                            unselectedTextColor = theme.mutedContent,
                        ),
                    )
                }
            }
        },
    ) { inner ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(inner)
                .consumeWindowInsets(inner)
                .imePadding(),
        ) {
            if (isStale && !hideChrome) StaleBanner(stringResource(R.string.offline_cached))

            // Keep the active tab within the shell’s available content area.
            Box(Modifier.weight(1f).fillMaxWidth()) {
                tabStates.SaveableStateProvider(current.name) {
                    when (current) {
                        HostTab.HOME -> HomeTab(
                            appViewModel = viewModel,
                            container = container,
                            locationProvider = locationProvider,
                            church = church,
                            partition = partition,
                            onOpenAccount = if (HostTab.GROUPS in tabs) {
                                { viewModel.selectTab(HostTab.ACCOUNT) }
                            } else null,
                        )

                        HostTab.GROUPS -> if (church != null && partition != null) GroupsHost(container.apiClient, church.churchSlug, partition.toString(), church = church)
                        HostTab.CHECK_IN -> {
                            var showAutomaticCheckIn by rememberSaveable(selectedSlug) {
                                mutableStateOf(false)
                            }
                            val showsAutomatic = church?.automaticCheckInEnabled ?: true
                            val showsCode = church?.codeCheckInEnabled ?: true
                            if (showAutomaticCheckIn && showsAutomatic) {
                                TabScreen(
                                    title = stringResource(R.string.auto_attendance_title),
                                    onBack = { showAutomaticCheckIn = false },
                                ) { _ ->
                                    AutomaticAttendanceIntroScreen(
                                        onContinue = { showAutomaticCheckIn = false },
                                        onNotNow = { showAutomaticCheckIn = false },
                                    )
                                }
                            } else {
                                TabScreen(
                                    title = stringResource(
                                        if (showsCode) R.string.checkin_scan_title
                                        else R.string.auto_attendance_title,
                                    ),
                                ) { content ->
                                    CheckInTab(
                                        api = container.apiClient,
                                        cameraPermission = cameraPermission,
                                        showsCodeCheckIn = showsCode,
                                        automaticCheckInContent = if (showsAutomatic) {
                                            { automaticModifier ->
                                                AutomaticCheckInEntry(
                                                    enabled = container.automaticAttendance?.settings?.enabled == true,
                                                    onOpen = { showAutomaticCheckIn = true },
                                                    modifier = automaticModifier,
                                                )
                                            }
                                        } else null,
                                        modifier = content,
                                    )
                                }
                            }
                        }

                        HostTab.WATCH -> if (church != null && partition != null) {
                            WatchTab(
                                appViewModel = viewModel,
                                container = container,
                                bootstrap = bootstrap,
                                churchSlug = church.churchSlug,
                                partition = partition,
                                church = church,
                                onFullScreenChanged = { recordingFullScreen = it },
                            )
                        }

                        HostTab.GIVE -> if (church != null && partition != null) {
                            GiveTab(
                                client = container.givingClient,
                                sheet = RelayedPaymentSheet(container.paymentSheets),
                                pendingDonations = container.pendingDonations,
                                churchSlug = church.churchSlug,
                                partition = partition,
                            )
                        }

                        HostTab.ACCOUNT -> {
                            var showAutoCheckIn by rememberSaveable { mutableStateOf(false) }
                            var showChurchAppearance by rememberSaveable { mutableStateOf(false) }
                            val showsAuto =
                                "attendance" in bootstrap.enabledCapabilities &&
                                    selectedSlug != null &&
                                    (church?.automaticCheckInEnabled ?: true)
                            if (showChurchAppearance && church?.canManageBranding == true) {
                                TabScreen(
                                    title = stringResource(R.string.church_appearance_title),
                                    onBack = { showChurchAppearance = false },
                                ) { content ->
                                    ChurchAppearanceScreen(
                                        church = church,
                                        modifier = content,
                                        onSave = { primary, accent, done ->
                                            viewModel.updateChurchTheme(
                                                church.churchSlug,
                                                primary,
                                                accent,
                                            ) { ok ->
                                                done(ok)
                                                if (ok) showChurchAppearance = false
                                            }
                                        },
                                    )
                                }
                            } else if (showAutoCheckIn && showsAuto) {
                                TabScreen(
                                    title = stringResource(R.string.auto_attendance_title),
                                    onBack = { showAutoCheckIn = false },
                                ) { _ ->
                                    AutomaticAttendanceIntroScreen(
                                        onContinue = { showAutoCheckIn = false },
                                        onNotNow = { showAutoCheckIn = false },
                                    )
                                }
                            } else {
                                TabScreen(title = stringResource(R.string.tab_account)) { content ->
                                    AccountTab(
                                        bootstrap = bootstrap,
                                        onSignOut = viewModel::signOut,
                                        onDeleteAccount = viewModel::beginDeletion,
                                        modifier = content,
                                        showsAutomaticCheckIn = showsAuto,
                                        automaticCheckInEnabled = container.automaticAttendance?.settings?.enabled == true,
                                        onOpenAutomaticCheckIn = { showAutoCheckIn = true },
                                        onOpenChurchAppearance = if (church?.canManageBranding == true) {
                                            { showChurchAppearance = true }
                                        } else null,
                                        onUpdateDisplayName = viewModel::updateDisplayName,
                                        onUpdateProfilePhoto = viewModel::updateProfilePhoto,
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

private val HostTab.titleRes: Int
    get() = when (this) {
        HostTab.HOME -> R.string.tab_home
        HostTab.GROUPS -> R.string.tab_groups
        HostTab.CHECK_IN -> R.string.tab_check_in
        HostTab.WATCH -> R.string.tab_watch
        HostTab.GIVE -> R.string.tab_give
        HostTab.ACCOUNT -> R.string.tab_account
    }

/** The same glyphs iOS uses, in Material's vocabulary. */
private val HostTab.icon: ImageVector
    get() = when (this) {
        HostTab.HOME -> Icons.Outlined.Home
        HostTab.GROUPS -> Icons.Outlined.Groups
        HostTab.CHECK_IN -> Icons.Outlined.QrCodeScanner
        HostTab.WATCH -> Icons.Outlined.OndemandVideo
        HostTab.GIVE -> Icons.Outlined.FavoriteBorder
        HostTab.ACCOUNT -> Icons.Outlined.AccountCircle
    }

@Composable
private fun StaleBanner(message: String) {
    val theme = LocalFaithFormTheme.current
    Text(
        message,
        style = MaterialTheme.typography.bodyMedium,
        color = theme.palette.warningContent,
        modifier = Modifier
            .fillMaxWidth()
            .background(theme.palette.warning)
            .padding(FaithFormTokens.Spacing.md)
            .clearAndSetSemantics { contentDescription = message },
    )
}
