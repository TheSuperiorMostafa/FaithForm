import SwiftUI
import FaithfulKit

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
/// That is why `Sermons` is not here: Prompt 10 was never built, the destination
/// is unregistered, and the registry resolves it to `.notImplemented`.
///
/// ## Reauthorization
///
/// Every tab reads the *current* bootstrap and the *current* relationship on
/// each render. A relationship revoked while the app is open removes the tab on
/// the next pass rather than at the next cold start, and the screen behind it
/// re-checks server-side anyway.
struct RootView: View {
    @Environment(\.faithfulTheme) private var theme
    private let dependencies: AppDependencies
    @State private var model: RootModel
    @State private var churchTabDiscovery: DiscoveryModel

    init(dependencies: AppDependencies) {
        self.dependencies = dependencies
        _model = State(initialValue: RootModel(dependencies: dependencies))
        _churchTabDiscovery = State(
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
                ProgressView()
                    .controlSize(.large)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .accessibilityLabel(Text(L.loadingAccount))

            case .signedOut:
                // The front door: create an account, sign in, or recover a
                // password. Every path out of it ends in a stored session and
                // a reload of this view.
                AuthFlowView(
                    model: model.authModel,
                    hasPendingInvitation: model.onboarding.pendingInvitationToken != nil
                )

            case .offlineNoCache:
                VStack(spacing: FaithfulTokens.Spacing.md) {
                    EmptyStateView(title: L.offlineTitle, explanation: L.offlineBody)
                    Button(L.retry) { Task { await model.load() } }
                        .buttonStyle(FaithfulButtonStyle(kind: .secondary, theme: theme))
                        .padding(.horizontal, FaithfulTokens.Layout.screenPaddingHorizontal)
                }

            case let .failed(message):
                // A real failure with a session on the device. The sentence is
                // the server envelope's own, already redacted server-side, and
                // both ways forward are here: try again, or leave cleanly —
                // never a dead end that reads like the offline screen.
                VStack(spacing: FaithfulTokens.Spacing.md) {
                    EmptyStateView(
                        title: L.errorTitle,
                        explanation: message.isEmpty ? L.errorLoadFailedBody : message
                    )
                    Button(L.retry) { Task { await model.load() } }
                        .buttonStyle(FaithfulButtonStyle(kind: .secondary, theme: theme))
                        .padding(.horizontal, FaithfulTokens.Layout.screenPaddingHorizontal)
                    Button(L.signOut) { Task { await model.signOut() } }
                        .buttonStyle(FaithfulButtonStyle(kind: .quiet, theme: theme))
                        .padding(.horizontal, FaithfulTokens.Layout.screenPaddingHorizontal)
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
        .background(theme.palette.background)
        .task { await model.load() }
        .onReceive(NotificationCenter.default.publisher(for: .faithfulDeepLink)) { note in
            guard let url = note.userInfo?["url"] as? URL else { return }
            model.open(url)
        }
    }

    @ViewBuilder
    private func tabs(bootstrap: Bootstrap, isStale: Bool) -> some View {
        let available = model.availableTabs(bootstrap: bootstrap)

        TabView(selection: $model.selectedTab) {
            ForEach(available, id: \.self) { tab in
                NavigationStack {
                    VStack(spacing: 0) {
                        if isStale { OfflineBanner(message: L.offlineCached) }
                        screen(for: tab, bootstrap: bootstrap)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                    .background(theme.palette.background)
                    .navigationTitle(tab.title)
                }
                .tabItem { Label(tab.title, systemImage: tab.symbol) }
                .tag(tab)
            }
        }
    }

    @ViewBuilder
    private func screen(for tab: RootTab, bootstrap: Bootstrap) -> some View {
        switch tab {
        case .home:
            ScrollView {
                HomeView(
                    bootstrap: bootstrap,
                    selectedChurch: model.selectedChurch,
                    onOpen: { model.select($0) }
                )
                .padding(FaithfulTokens.Spacing.lg)
            }

        case .church:
            ScrollView {
                VStack(spacing: FaithfulTokens.Spacing.lg) {
                    ChurchSwitcherView(
                        relationships: bootstrap.relationships,
                        selectedSlug: model.selectedChurch?.churchSlug,
                        onSelect: { model.selectChurch($0) }
                    )
                    // Multi-church by design: an account is never bound to one
                    // congregation, so finding the next one starts here.
                    NavigationLink(value: ChurchTabRoute.search) {
                        Text(L.addAnotherChurch)
                    }
                    .buttonStyle(FaithfulButtonStyle(kind: .secondary, theme: theme))
                }
                .padding(FaithfulTokens.Spacing.lg)
            }
            .navigationDestination(for: ChurchTabRoute.self) { route in
                switch route {
                case .search:
                    DiscoverySearchView(
                        dependencies: dependencies,
                        root: model,
                        discovery: churchTabDiscovery
                    )
                }
            }

        case .checkIn, .watch, .give:
            // Every church-scoped tab needs a church. Without one the honest
            // thing is to say so and point at the switcher, not to render an
            // empty feature.
            if let church = model.selectedChurch {
                churchScreen(for: tab, church: church)
            } else {
                EmptyStateView(title: L.noChurchTitle, explanation: L.noChurchBody)
            }

        case .account:
            ScrollView {
                AccountView(
                    bootstrap: bootstrap,
                    environmentKey: dependencies.environment.key,
                    onSignOut: { Task { await model.signOut() } }
                )
                .padding(FaithfulTokens.Spacing.lg)
            }
        }
    }

    @ViewBuilder
    private func churchScreen(for tab: RootTab, church: ChurchRelationship) -> some View {
        switch tab {
        case .checkIn:
            ScrollView {
                CheckInEntryView(churchName: church.churchName)
                    .padding(FaithfulTokens.Spacing.lg)
            }
        case .watch:
            ScrollView {
                MediaEntryView(churchName: church.churchName)
                    .padding(FaithfulTokens.Spacing.lg)
            }
        case .give:
            ScrollView {
                GivingEntryView(churchName: church.churchName)
                    .padding(FaithfulTokens.Spacing.lg)
            }
        default:
            EmptyView()
        }
    }
}

/// Where the church tab can go beyond its root: finding another church. The
/// profile push below it belongs to `DiscoverySearchView`.
enum ChurchTabRoute: Hashable {
    case search
}

/// The tabs the visitor journey can contain.
///
/// One case per *destination that has a screen*. Deliberately not one case per
/// `Destination`: `sermonArchive` has no screen, and a tab enum that mirrored
/// the destination enum would invite someone to add it.
enum RootTab: Hashable, CaseIterable {
    case home
    case church
    case checkIn
    case watch
    case give
    case account

    var destination: Destination {
        switch self {
        case .home: return .home
        case .church: return .churchDiscovery
        case .checkIn: return .checkIn(churchSlug: "")
        case .watch: return .watch(churchSlug: "")
        case .give: return .give(churchSlug: "")
        case .account: return .account
        }
    }

    var title: String {
        switch self {
        case .home: return L.tabHome
        case .church: return L.tabChurch
        case .checkIn: return L.tabCheckIn
        case .watch: return L.tabWatch
        case .give: return L.tabGive
        case .account: return L.tabAccount
        }
    }

    var symbol: String {
        switch self {
        case .home: return "house"
        case .church: return "building.2"
        case .checkIn: return "qrcode.viewfinder"
        case .watch: return "play.rectangle"
        case .give: return "heart"
        case .account: return "person.crop.circle"
        }
    }
}
