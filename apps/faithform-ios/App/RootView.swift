import SwiftUI
import UIKit
import FaithFormKit

/// The visitor journey, in one place.
///
/// ## What decides a tab exists
///
/// `RouteRegistry`, and nothing else. A tab appears when a destination clears
/// four independent gates — a screen is registered for it, the **server** reports
/// its capability, the session permits it, and the church relationship allows it.
/// There is no hardcoded tab list, so a feature cannot appear because someone
/// added it to an array.
///
/// ## Five tabs, not six
///
/// With Groups enabled: Home, Groups, Check in, Watch, Give. Account opens
/// from the top bar. Otherwise Account retains its familiar bottom-tab entry.
/// Church information and changing churches remain within Home.
///
/// ## Reauthorization
///
/// Every tab reads the *current* bootstrap and the *current* relationship on
/// each render. A relationship revoked while the app is open removes the tab on
/// the next pass rather than at the next cold start, and the screen behind it
/// re-checks server-side anyway.
///
/// ## Whose data a tab shows
///
/// The selected church's, through `RootModel.features`, which is rebuilt whole
/// when the church, the account or the authorization version changes. Each
/// church tab is keyed by that container, so a switch tears the old screens
/// down — stopping a camera or a player on the way — and the next church's
/// screens start from their own models, never the previous church's rows.
struct RootView: View {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    private let dependencies: AppDependencies
    @State private var model: RootModel
    @State private var discovery: DiscoveryModel
    /// Tabs whose content has been opened at least once this launch. Unopened
    /// tabs stay a blank placeholder so Watch/Give/Check-in are not built until
    /// they are selected.
    @State private var accountOpen = false
    @State private var openedTabs: Set<RootTab> = [.home]
    /// True once this launch showed `LaunchLoadingView`. Returning visits with a
    /// snapshot never set it, so they skip the brand dwell.
    @State private var sawLoading = false
    /// Cold-load dwell is over (or Reduce Motion skipped it). Until then the
    /// lockup stays over Home so the mark has time to settle.
    @State private var launchDwellElapsed = false
    /// Returning Home fades in from the launch ground rather than popping.
    @State private var shellRevealed = false
    init(dependencies: AppDependencies) {
        self.dependencies = dependencies
        _model = State(initialValue: RootModel(dependencies: dependencies))
        _discovery = State(
            initialValue: DiscoveryModel(
                api: dependencies.api,
                location: DiscoveryLocationProvider()
            )
        )
    }

    private var selectedAppTheme: ChurchAppTheme? {
        model.selectedChurch?.appTheme
    }

    private var theme: FaithFormTheme {
        FaithFormTheme(
            colorScheme: colorScheme,
            reduceMotion: reduceMotion,
            appTheme: selectedAppTheme
        )
    }

    var body: some View {
        Group {
            switch model.state.phase {
            case .loading:
                Color.clear

            case .signedOut:
                // The front door: create an account, sign in, or recover a
                // password. Every path out of it ends in a stored session and
                // a reload of this view.
                AuthFlowView(
                    model: model.authModel,
                    onboarding: model.onboarding,
                    hasPendingInvitation: model.onboarding.pendingInvitationToken != nil,
                    churchContext: model.onboarding.churchContext,
                    onClearChurchContext: { model.onboarding.clearChurchContext() }
                )

            case .offlineNoCache:
                VStack(spacing: FaithFormTokens.Spacing.md) {
                    EmptyStateView(title: L.offlineTitle, explanation: L.offlineBody, symbol: "wifi.slash")
                    Button(L.retry) { Task { await model.load() } }
                        .buttonStyle(FaithFormButtonStyle(kind: .secondary, theme: theme))
                        .padding(.horizontal, FaithFormTokens.Layout.screenPaddingHorizontal)
                    // The session survives being offline now, so the way out has
                    // to be here too. Otherwise a person on a device that will
                    // never reach the network again could not leave it.
                    Button(L.signOut) { Task { await model.signOut() } }
                        .buttonStyle(FaithFormButtonStyle(kind: .quiet, theme: theme))
                        .padding(.horizontal, FaithFormTokens.Layout.screenPaddingHorizontal)
                }

            case let .failed(message):
                // A real failure with a session on the device. The sentence is
                // the server envelope's own, already redacted server-side, and
                // every way forward is here: try again, leave cleanly, or delete
                // the account — never a dead end that reads like the offline
                // screen. An account whose bootstrap will not load is exactly
                // the one somebody may be trying to be rid of.
                ScrollView {
                    VStack(spacing: FaithFormTokens.Spacing.md) {
                        EmptyStateView(
                            title: L.errorTitle,
                            explanation: message.isEmpty ? L.errorLoadFailedBody : message,
                            symbol: "exclamationmark.triangle"
                        )
                        Button(L.retry) { Task { await model.load() } }
                            .buttonStyle(FaithFormButtonStyle(kind: .secondary, theme: theme))
                        Button(L.signOut) { Task { await model.signOut() } }
                            .buttonStyle(FaithFormButtonStyle(kind: .quiet, theme: theme))
                        AccountDeletionControl(root: model)
                            .padding(.top, FaithFormTokens.Spacing.lg)
                    }
                    .padding(.horizontal, FaithFormTokens.Layout.screenPaddingHorizontal)
                    .padding(.vertical, FaithFormTokens.Spacing.xl)
                }

            case let .ready(bootstrap, isStale):
                Group {
                    if model.needsOnboarding {
                        // No church yet: the welcome flow stands in front of the
                        // tabs until a relationship exists, and not a launch longer.
                        OnboardingFlowView(dependencies: dependencies, root: model)
                            .transition(.asymmetric(
                                insertion: .opacity,
                                removal: .opacity.combined(with: .scale(scale: 1.04))
                            ))
                    } else {
                        tabs(bootstrap: bootstrap, isStale: isStale)
                            .transition(.asymmetric(
                                insertion: .opacity.combined(with: .scale(scale: 0.96)),
                                removal: .opacity
                            ))
                    }
                }
                .opacity(shellRevealed ? 1 : 0)
            }
        }
        // Every phase fills the screen on the page colour. `Group` takes each
        // child's own size, so a short phase — the offline and failed screens —
        // used to sit in a band of page colour with system white above and below.
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .faithformTheme(selectedAppTheme)
        .background(theme.palette.background.ignoresSafeArea())
        .overlay {
            if showsLaunchLockup {
                LaunchLoadingView()
                    .transition(.opacity)
            }
        }
        .animation(theme.animation(FaithFormTokens.Motion.standard), value: showsLaunchLockup)
        .animation(theme.animation(FaithFormTokens.Motion.standard), value: shellRevealed)
        .animation(theme.animation(FaithFormTokens.Motion.slow), value: model.needsOnboarding)
        .sheet(isPresented: Binding(get: { model.state.bootstrap != nil && model.groupInvitationToken != nil }, set: { if !$0 { model.groupInvitationToken = nil } })) {
            if let token = model.groupInvitationToken { GroupInvitationView(api: dependencies.api, token: token) { slug in
                model.groupInvitationToken = nil
                if let url = URL(string: "faithform://church/\(slug)/groups") { model.open(url) }
            } }
        }
        .task { await model.load() }
        .onChange(of: model.state.phase, initial: true) { _, phase in
            handleLaunchTiming(phase)
        }
        // Coming back to FaithForm is an execution opportunity automatic
        // check-in uses: regions are reconciled, the OS is asked whether the
        // device is inside one, and anything due is sent. It is also when a
        // permission changed in Settings shows up on screen.
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            await dependencies.push.synchronize()
            await dependencies.attendance.foreground()
            await dependencies.attendanceModel.refresh()
            await dependencies.attendanceModel.refreshHistory()
            while !Task.isCancelled {
                do { try await Task.sleep(for: .seconds(5)) }
                catch { return }
                await dependencies.attendance.foregroundTick()
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .faithformDeepLink)) { note in
            guard let url = note.userInfo?["url"] as? URL else { return }
            model.open(url)
        }
        // Said on the screen the person lands on, which is the signed-out one:
        // the request went through, and the sign-out was not a crash.
        .alert(L.deleteAccountRequestedTitle, isPresented: $model.accountDeletionRequested) {
            // The system's own OK.
        } message: {
            Text(L.deleteAccountRequestedBody)
        }
    }

    /// The lockup covers cold loads, and stays over Home until the brand dwell
    /// has run. Returning visits never set `sawLoading`, so they skip it.
    private var showsLaunchLockup: Bool {
        if case .loading = model.state.phase { return true }
        guard sawLoading, !launchDwellElapsed else { return false }
        if case .ready = model.state.phase { return true }
        return false
    }

    private func handleLaunchTiming(_ phase: LaunchPhase) {
        if case .loading = phase {
            if !sawLoading {
                sawLoading = true
                launchDwellElapsed = theme.reduceMotion
                if !theme.reduceMotion {
                    Task {
                        try? await Task.sleep(nanoseconds: LaunchLoadingView.dwellNanoseconds)
                        launchDwellElapsed = true
                        shellRevealed = true
                    }
                }
            }
            return
        }

        if case .ready = phase {
            if sawLoading {
                if launchDwellElapsed { shellRevealed = true }
            } else {
                shellRevealed = true
            }
            return
        }

        launchDwellElapsed = true
        shellRevealed = true
    }

    @ViewBuilder
    private func tabs(bootstrap: Bootstrap, isStale: Bool) -> some View {
        let available = model.availableTabs(bootstrap: bootstrap)

        TabView(selection: $model.selectedTab) {
            ForEach(available, id: \.self) { tab in
                Group {
                    if openedTabs.contains(tab) {
                        screen(for: tab, bootstrap: bootstrap, isStale: isStale)
                    } else {
                        Color.clear
                    }
                }
                    .tabItem { Label(tab.title, systemImage: tab.symbol) }
                    .tag(tab)
            }
        }
        .sheet(isPresented: $accountOpen) {
            AccountTabView(dependencies: dependencies, root: model, bootstrap: bootstrap, isStale: isStale)
                .presentationDragIndicator(.visible)
        }
        .tint(theme.palette.brandAccent)
        .toolbarBackground(theme.palette.surface, for: .tabBar)
        .toolbarBackground(.visible, for: .tabBar)
        // "Watch live" from any tab opens here, over the tab bar, and starts
        // playing — the person asked to watch, not to be taken somewhere with
        // another button on it.
        .fullScreenCover(item: $model.livePresentation) { presentation in
            if let features = model.features, features.key == presentation.featuresKey {
                LivePlayerScreen(features: features, live: presentation.live) {
                    model.closeLive()
                }
                .faithformTheme(selectedAppTheme)
            } else {
                // The church or the account changed underneath it.
                Color.black
                    .ignoresSafeArea()
                    .onAppear { model.closeLive() }
            }
        }
        .onAppear {
            openedTabs.insert(model.selectedTab)
            applyTabBarAppearance(
                surface: theme.palette.surface,
                accent: theme.palette.brandAccent,
                unselected: theme.palette.contentMuted,
                divider: theme.palette.divider
            )
        }
        .onChange(of: model.selectedTab) { _, tab in
            if tab == .account && available.contains(.groups) { accountOpen = true; model.selectedTab = .home }
            else { openedTabs.insert(tab) }
        }
        .onChange(of: theme.palette.surface) { _, newSurface in
            applyTabBarAppearance(
                surface: newSurface,
                accent: theme.palette.brandAccent,
                unselected: theme.palette.contentMuted,
                divider: theme.palette.divider
            )
        }
        .onChange(of: theme.palette.brandAccent) { _, newAccent in
            applyTabBarAppearance(
                surface: theme.palette.surface,
                accent: newAccent,
                unselected: theme.palette.contentMuted,
                divider: theme.palette.divider
            )
        }
    }

    private func applyTabBarAppearance(surface: Color, accent: Color, unselected: Color, divider: Color) {
        let appearance = UITabBarAppearance()
        appearance.configureWithOpaqueBackground()
        appearance.backgroundColor = UIColor(surface)
        appearance.shadowColor = UIColor(divider)

        let itemAppearance = UITabBarItemAppearance()
        itemAppearance.normal.iconColor = UIColor(unselected)
        itemAppearance.normal.titleTextAttributes = [.foregroundColor: UIColor(unselected)]
        itemAppearance.selected.iconColor = UIColor(accent)
        itemAppearance.selected.titleTextAttributes = [.foregroundColor: UIColor(accent)]

        appearance.stackedLayoutAppearance = itemAppearance
        appearance.inlineLayoutAppearance = itemAppearance
        appearance.compactInlineLayoutAppearance = itemAppearance

        UITabBar.appearance().standardAppearance = appearance
        UITabBar.appearance().scrollEdgeAppearance = appearance
    }

    @ViewBuilder
    private func screen(for tab: RootTab, bootstrap: Bootstrap, isStale: Bool) -> some View {
        switch tab {
        case .home:
            HomeTabView(
                dependencies: dependencies,
                root: model,
                isStale: isStale,
                discovery: discovery,
                onOpenAccount: model.availableTabs(bootstrap: bootstrap).contains(.groups)
                    ? { accountOpen = true } : nil
            )

        case .groups, .checkIn, .watch, .give:
            // Every church-scoped tab needs a church, and the registry only
            // offers one while a church is selected. The empty state covers the
            // instant between a relationship ending and the tab disappearing.
            if let features = model.features {
                churchScreen(for: tab, features: features, isStale: isStale)
                    .id(features.key)
            } else {
                NavigationStack {
                    EmptyStateView(title: L.noChurchTitle, explanation: L.noChurchBody, symbol: "building.2")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(theme.palette.background)
                        .navigationTitle(tab.title)
                }
            }

        case .account:
            AccountTabView(
                dependencies: dependencies,
                root: model,
                bootstrap: bootstrap,
                isStale: isStale
            )
        }
    }

    @ViewBuilder
    private func churchScreen(for tab: RootTab, features: ChurchFeatures, isStale: Bool) -> some View {
        switch tab {
        case .groups:
            GroupsTabView(root: model, model: features.groups, isStale: isStale)
        case .checkIn:
            CheckInTabView(
                root: model,
                dependencies: dependencies,
                features: features,
                attendance: dependencies.attendanceModel,
                isStale: isStale
            )
        case .watch:
            WatchTabView(root: model, features: features, isStale: isStale)
        case .give:
            GiveTabView(root: model, features: features, isStale: isStale)
        default:
            EmptyView()
        }
    }
}

/// The tabs the visitor journey can contain.
///
/// One case per *place a person goes*, which is deliberately not one case per
/// `Destination`: finding a church is reached from Home, sermon notes from
/// Watch, and announcements from the feed. A tab enum that mirrored the
/// destination enum would invite a sixth tab, and a sixth tab is "More".
enum RootTab: Hashable, CaseIterable {
    case home
    case groups
    case checkIn
    case watch
    case give
    case account

    var destination: Destination {
        switch self {
        case .home: return .home
        case .groups: return .groups(churchSlug: "")
        case .checkIn: return .checkIn(churchSlug: "")
        case .watch: return .watch(churchSlug: "")
        case .give: return .give(churchSlug: "")
        case .account: return .account
        }
    }

    var title: String {
        switch self {
        case .home: return L.tabHome
        case .groups: return "Groups"
        case .checkIn: return L.tabCheckIn
        case .watch: return L.tabWatch
        case .give: return L.tabGive
        case .account: return L.tabAccount
        }
    }

    var symbol: String {
        switch self {
        case .home: return "house"
        case .groups: return "person.3"
        case .checkIn: return "qrcode.viewfinder"
        case .watch: return "play.rectangle"
        case .give: return "heart"
        case .account: return "person.crop.circle"
        }
    }
}
