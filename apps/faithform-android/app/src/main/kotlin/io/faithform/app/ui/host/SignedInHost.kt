package io.faithform.app.ui.host

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material.icons.outlined.Church
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
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.LifecycleStartEffect
import androidx.lifecycle.viewmodel.compose.viewModel
import io.faithform.app.ui.attendance.AutomaticAttendanceFlow
import io.faithform.app.ui.attendance.AutomaticAttendanceModel
import io.faithform.app.ui.attendance.AutomaticAttendanceSummaryCard
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
import io.faithform.app.ui.attendance.CheckInTab
import io.faithform.app.ui.discovery.LocationProvider
import io.faithform.app.ui.giving.GiveTab
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

    val tabs = HostNavigation.availableTabs(bootstrap, selectedSlug, viewModel.registry)
    // A tab that stopped being available — a capability switched off, a church
    // switched to one that does not allow it — falls back to the first one.
    val current = selectedTab.takeIf { it in tabs } ?: tabs.firstOrNull() ?: HostTab.ACCOUNT

    val church = bootstrap.relationships.firstOrNull { it.churchSlug == selectedSlug }
    val partition = viewModel.partition(selectedSlug)
    val tabStates = rememberSaveableStateHolder()

    // Automatic check-in. Scoped to this session like every feature model, and
    // told about every bootstrap, church switch and return to the foreground —
    // the lifecycle triggers that reconcile what the phone is watching. None
    // of them asks for a permission; only the screens do, after a tap.
    val context = LocalContext.current
    val automatic: AutomaticAttendanceModel = viewModel(key = "automatic-attendance") {
        AutomaticAttendanceModel(
            context = context.applicationContext,
            runtime = container.automaticAttendance,
            notificationDialog = container.notificationPermission,
            environmentKey = container.environmentKey,
            accountId = { container.sessionStore.current()?.accountId },
            onAuthorizationChanged = viewModel::reloadQuietly,
        )
    }
    var automaticOpen by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(bootstrap, selectedSlug) { automatic.onShell(bootstrap, selectedSlug) }
    LifecycleStartEffect(automatic) {
        automatic.onForeground()
        onStopOrDispose { }
    }

    Scaffold(
        containerColor = theme.palette.background,
        bottomBar = {
            NavigationBar(containerColor = theme.palette.surface) {
                tabs.forEach { tab ->
                    val label = stringResource(tab.titleRes)
                    NavigationBarItem(
                        selected = tab == current,
                        onClick = { viewModel.selectTab(tab) },
                        icon = { Icon(tab.icon, contentDescription = null) },
                        label = { Text(label, maxLines = 1) },
                        colors = NavigationBarItemDefaults.colors(
                            selectedIconColor = theme.palette.brandPrimary,
                            selectedTextColor = theme.palette.brandPrimary,
                            indicatorColor = theme.palette.brandAccentSoft,
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
            if (isStale) StaleBanner(stringResource(R.string.offline_cached))

            tabStates.SaveableStateProvider(current.name) {
                when (current) {
                    HostTab.HOME -> HomeTab(
                        api = container.apiClient,
                        projections = container.projections,
                        church = church,
                        partition = partition,
                        onOpenSermons = selectedSlug
                            ?.takeIf { HostNavigation.sermonsAllowed(bootstrap, it, viewModel.registry) }
                            ?.let { slug -> { viewModel.openSermons(slug) } },
                    )

                    HostTab.CHURCH -> ChurchTab(
                        appViewModel = viewModel,
                        container = container,
                        locationProvider = locationProvider,
                        bootstrap = bootstrap,
                        selectedSlug = selectedSlug,
                        partition = partition,
                    )

                    HostTab.CHECK_IN -> if (automaticOpen) {
                        TabScreen(
                            title = stringResource(R.string.auto_attendance_title),
                            onBack = {
                                automaticOpen = false
                                automatic.leaveSetup()
                            },
                        ) { content ->
                            AutomaticAttendanceFlow(model = automatic, modifier = content)
                        }
                    } else {
                        TabScreen(title = stringResource(R.string.checkin_scan_title)) { content ->
                            CheckInTab(
                                api = container.apiClient,
                                cameraPermission = cameraPermission,
                                modifier = content,
                                header = {
                                    AutomaticAttendanceSummaryCard(
                                        model = automatic,
                                        onOpen = { automaticOpen = true },
                                    )
                                },
                            )
                        }
                    }

                    HostTab.WATCH -> if (church != null && partition != null) {
                        WatchTab(
                            client = container.mediaClient,
                            resumePositions = container.resumePositions,
                            churchSlug = church.churchSlug,
                            partition = partition,
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

                    HostTab.ACCOUNT -> TabScreen(title = stringResource(R.string.tab_account)) { content ->
                        AccountTab(
                            bootstrap = bootstrap,
                            onSignOut = viewModel::signOut,
                            onDeleteAccount = viewModel::beginDeletion,
                            modifier = content,
                            settings = {
                                // Only where the Check in tab exists to open it in.
                                if (HostTab.CHECK_IN in tabs) {
                                    AutomaticAttendanceSummaryCard(
                                        model = automatic,
                                        onOpen = {
                                            automaticOpen = true
                                            viewModel.selectTab(HostTab.CHECK_IN)
                                        },
                                    )
                                }
                            },
                        )
                    }
                }
            }
        }
    }
}

private val HostTab.titleRes: Int
    get() = when (this) {
        HostTab.HOME -> R.string.tab_home
        HostTab.CHURCH -> R.string.tab_church
        HostTab.CHECK_IN -> R.string.tab_check_in
        HostTab.WATCH -> R.string.tab_watch
        HostTab.GIVE -> R.string.tab_give
        HostTab.ACCOUNT -> R.string.tab_account
    }

/** The same glyphs iOS uses, in Material's vocabulary. */
private val HostTab.icon: ImageVector
    get() = when (this) {
        HostTab.HOME -> Icons.Outlined.Home
        HostTab.CHURCH -> Icons.Outlined.Church
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
