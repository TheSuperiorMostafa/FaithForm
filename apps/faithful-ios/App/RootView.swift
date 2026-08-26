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

    init(dependencies: AppDependencies) {
        self.dependencies = dependencies
        _model = State(initialValue: RootModel(dependencies: dependencies))
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
                // Honest: there is no sign-in flow yet on either platform. This
                // says what is true rather than showing a form that cannot work.
                EmptyStateView(title: L.signInTitle, explanation: L.signInBody)

            case .offlineNoCache:
                EmptyStateView(title: L.offlineTitle, explanation: L.offlineBody)

            case .failed:
                VStack(spacing: FaithfulTokens.Spacing.md) {
                    EmptyStateView(title: L.errorTitle, explanation: L.offlineBody)
                    Button(L.retry) { Task { await model.load() } }
                        .buttonStyle(FaithfulButtonStyle(kind: .secondary, theme: theme))
                }

            case let .ready(bootstrap, isStale):
                tabs(bootstrap: bootstrap, isStale: isStale)
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
                ChurchSwitcherView(
                    relationships: bootstrap.relationships,
                    selectedSlug: model.selectedChurch?.churchSlug,
                    onSelect: { model.selectChurch($0) }
                )
                .padding(FaithfulTokens.Spacing.lg)
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
