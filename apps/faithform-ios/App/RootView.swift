import SwiftUI
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
/// Home, Check in, Watch, Give and Account. An iPhone tab bar shows five; a
/// sixth folds the last two into "More", which would have put Account — and
/// with it sign-out and account deletion — behind a generic label. The old
/// Church tab was the one that was not a destination, so switching and finding
/// churches moved onto Home, beside the feed they change (see `HomeTabView`),
/// and sermon notes joined recordings on Watch rather than taking a tab of their
/// own (see `WatchTabView`).
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
    @Environment(\.faithformTheme) private var theme
    @Environment(\.scenePhase) private var scenePhase
    private let dependencies: AppDependencies
    @State private var model: RootModel
    @State private var discovery: DiscoveryModel

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

    var body: some View {
        Group {
            switch model.state.phase {
            case .loading:
                LaunchLoadingView()

            case .signedOut:
                // The front door: create an account, sign in, or recover a
                // password. Every path out of it ends in a stored session and
                // a reload of this view.
                AuthFlowView(
                    model: model.authModel,
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
                if model.needsOnboarding {
                    // No church yet: the welcome flow stands in front of the
                    // tabs until a relationship exists, and not a launch longer.
                    OnboardingFlowView(dependencies: dependencies, root: model)
                } else {
                    tabs(bootstrap: bootstrap, isStale: isStale)
                }
            }
        }
        // Every phase fills the screen on the page colour. `Group` takes each
        // child's own size, so a short phase — the offline and failed screens —
        // used to sit in a band of page colour with system white above and below.
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(theme.palette.background.ignoresSafeArea())
        .task { await model.load() }
        // Coming back to FaithForm is an execution opportunity automatic
        // check-in uses: regions are reconciled, the OS is asked whether the
        // device is inside one, and anything due is sent. It is also when a
        // permission changed in Settings shows up on screen.
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active else { return }
            let attendance = dependencies.attendance
            let attendanceModel = dependencies.attendanceModel
            Task {
                await attendance.foreground()
                await attendanceModel.refresh()
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

    @ViewBuilder
    private func tabs(bootstrap: Bootstrap, isStale: Bool) -> some View {
        let available = model.availableTabs(bootstrap: bootstrap)

        TabView(selection: $model.selectedTab) {
            ForEach(available, id: \.self) { tab in
                screen(for: tab, bootstrap: bootstrap, isStale: isStale)
                    .tabItem { Label(tab.title, systemImage: tab.symbol) }
                    .tag(tab)
            }
        }
    }

    @ViewBuilder
    private func screen(for tab: RootTab, bootstrap: Bootstrap, isStale: Bool) -> some View {
        switch tab {
        case .home:
            HomeTabView(
                dependencies: dependencies,
                root: model,
                bootstrap: bootstrap,
                isStale: isStale,
                discovery: discovery
            )

        case .checkIn, .watch, .give:
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
        case .checkIn:
            CheckInTabView(
                root: model,
                features: features,
                attendance: dependencies.attendanceModel,
                isStale: isStale
            )
        case .watch:
            WatchTabView(root: model, features: features, isStale: isStale)
        case .give:
            GiveTabView(features: features, isStale: isStale)
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
    case checkIn
    case watch
    case give
    case account

    var destination: Destination {
        switch self {
        case .home: return .home
        case .checkIn: return .checkIn(churchSlug: "")
        case .watch: return .watch(churchSlug: "")
        case .give: return .give(churchSlug: "")
        case .account: return .account
        }
    }

    var title: String {
        switch self {
        case .home: return L.tabHome
        case .checkIn: return L.tabCheckIn
        case .watch: return L.tabWatch
        case .give: return L.tabGive
        case .account: return L.tabAccount
        }
    }

    var symbol: String {
        switch self {
        case .home: return "house"
        case .checkIn: return "qrcode.viewfinder"
        case .watch: return "play.rectangle"
        case .give: return "heart"
        case .account: return "person.crop.circle"
        }
    }
}
