import SwiftUI
import FaithFormKit

/// The shared find-a-church journey: search (or nearby) → the church's page →
/// add it, make it your church in place of the one you have, or redeem an
/// invitation.
///
/// Used from two places — the first-run flow when an account has no church
/// yet, and "Change church" on the church info page afterwards — so both walk
/// the same path and neither can drift.

// MARK: - Search

/// Hosts `DiscoveryView` and owns what the library deliberately does not: the
/// education-before-prompt choreography, and where a result leads.
struct DiscoverySearchView: View {
    /// Wrapped so `navigationDestination(item:)` can drive the push.
    private struct OpenedChurch: Identifiable, Hashable {
        let slug: String
        var id: String { slug }
    }

    @Environment(\.faithformTheme) private var theme
    let dependencies: AppDependencies
    let root: RootModel
    @Bindable var discovery: DiscoveryModel
    /// After the account's church changed from a page opened here, and the
    /// account reloaded. Home returns to its feed; first run needs nothing,
    /// because the tabs replace it.
    var onChurchChanged: @MainActor () -> Void = {}

    @State private var educationShown = false
    @State private var opened: OpenedChurch?

    var body: some View {
        DiscoveryView(
            model: discovery,
            onOpenChurch: { opened = OpenedChurch(slug: $0) },
            onNearby: { Task { await beginNearby() } }
        )
        .sheet(isPresented: $educationShown) {
            LocationEducationView(
                onContinue: {
                    educationShown = false
                    Task { await discovery.confirmNearby() }
                },
                onSkip: {
                    // Declining is a first-class outcome: straight back to the
                    // search that needs no permission at all.
                    educationShown = false
                    Task { await discovery.search() }
                }
            )
            .presentationDetents([.medium])
        }
        .navigationDestination(item: $opened) { church in
            ChurchProfileHostView(
                slug: church.slug,
                dependencies: dependencies,
                root: root,
                onChurchChanged: {
                    opened = nil
                    onChurchChanged()
                },
                // Someone who opened their own church from search is already
                // choosing: "Change church" takes them back to the results.
                onChangeChurch: { opened = nil }
            )
        }
    }

    private func beginNearby() async {
        await discovery.beginNearbyFlow()
        if discovery.locationAuthorization == .notDetermined {
            // Education first, always. The OS prompt is raised only from the
            // education screen's affirmative button.
            educationShown = true
        } else {
            await discovery.confirmNearby()
        }
    }
}

// MARK: - Church profile host

/// Loads one church's page and wires what the host decides: which church the
/// account has now, and where to go once that changes.
///
/// Every change — adding a church, replacing one, removing it, or redeeming an
/// invitation — ends the same way: the account is reloaded quietly, so the
/// selected church is the one the server now names, and then
/// `onChurchChanged` moves the navigation on.
struct ChurchProfileHostView: View {
    let slug: String
    let dependencies: AppDependencies
    let root: RootModel
    var onChurchChanged: @MainActor () -> Void = {}
    /// "Change church", on the account's own church. Nil leaves it out.
    var onChangeChurch: (@MainActor () -> Void)?

    @State private var model: ChurchProfileModel
    @State private var invitationShown = false

    init(
        slug: String,
        dependencies: AppDependencies,
        root: RootModel,
        onChurchChanged: @escaping @MainActor () -> Void = {},
        onChangeChurch: (@MainActor () -> Void)? = nil
    ) {
        self.slug = slug
        self.dependencies = dependencies
        self.root = root
        self.onChurchChanged = onChurchChanged
        self.onChangeChurch = onChangeChurch
        _model = State(
            initialValue: ChurchProfileModel(api: dependencies.api, cache: dependencies.cache)
        )
    }

    /// The account already has a church, and it is not this one — so adding
    /// this one replaces it.
    private var hasOtherChurch: Bool {
        guard let current = root.selectedChurch else { return false }
        return current.churchSlug != slug
    }

    var body: some View {
        ChurchProfileView(
            model: model,
            slug: slug,
            hasOtherChurch: hasOtherChurch,
            currentChurchName: root.selectedChurch?.churchName,
            onChurchAdded: { await churchChanged() },
            onChurchRemoved: { await churchChanged() },
            onChangeChurch: onChangeChurch,
            onAcceptInvitation: { invitationShown = true }
        )
        .task {
            let accountId = await dependencies.session.currentSession()?.accountId
            await model.load(
                slug: slug,
                partition: dependencies.partition(
                    for: root.state.bootstrap,
                    accountId: accountId,
                    churchSlug: slug
                )
            )
        }
        .navigationDestination(isPresented: $invitationShown) {
            InvitationEntryView(model: root.onboarding) {
                invitationShown = false
                // Accepting an invitation makes that church the only one,
                // exactly like adding it.
                Task { await churchChanged() }
            }
        }
    }

    private func churchChanged() async {
        await root.load(quiet: true)
        onChurchChanged()
    }
}

// MARK: - First-run flow

/// What stands in front of the tabs while the account has no church: the
/// welcome screen's two doors, then discovery or invitation entry.
///
/// Signing out **and deleting the account** stay reachable the whole way
/// through, behind the Account button — a first-run flow a person cannot leave
/// is a dead end with extra steps, and someone who created an account and then
/// thought better of it has no church to find first.
struct OnboardingFlowView: View {
    enum Route: Hashable {
        case search
        case invitation
        /// One church, opened directly — the destination a `faithform://church/`
        /// link resolved to before the person had an account.
        case church(String)
        /// Sign out, delete the account, and the legal pages.
        case account
    }

    @Environment(\.faithformTheme) private var theme
    let dependencies: AppDependencies
    let root: RootModel

    @State private var path: [Route] = []
    @State private var discovery: DiscoveryModel

    init(dependencies: AppDependencies, root: RootModel) {
        self.dependencies = dependencies
        self.root = root
        _discovery = State(
            initialValue: DiscoveryModel(
                api: dependencies.api,
                location: DiscoveryLocationProvider()
            )
        )
    }

    var body: some View {
        NavigationStack(path: $path) {
            WelcomeView(
                onFindChurch: { path.append(.search) },
                onHaveInvitation: { path.append(.invitation) }
            )
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(L.account) { path.append(.account) }
                        .font(theme.font(FaithFormTokens.Text.label))
                }
            }
            .navigationDestination(for: Route.self) { route in
                switch route {
                case .search:
                    DiscoverySearchView(
                        dependencies: dependencies,
                        root: root,
                        discovery: discovery
                    )
                case .invitation:
                    InvitationEntryView(model: root.onboarding) {
                        Task { await root.load(quiet: true) }
                    }
                case let .church(slug):
                    ChurchProfileHostView(slug: slug, dependencies: dependencies, root: root)
                case .account:
                    ScrollView {
                        AccountView(
                            dependencies: dependencies,
                            root: root,
                            displayName: root.state.bootstrap?.profile.displayName
                        )
                        .padding(FaithFormTokens.Spacing.lg)
                    }
                    .background(theme.palette.background)
                    .navigationTitle(L.account)
                }
            }
        }
        .task {
            guard path.isEmpty else { return }

            // A church link named where this person was heading. Open that
            // church, not a search box — but stop at its page rather than
            // adding it for them. A link is an address, not consent, and the
            // button is right there on the screen it opens.
            if let context = root.onboarding.churchContext, !context.isInvitation {
                path = [.church(context.churchSlug)]
                return
            }

            // An invitation that arrived by deep link goes straight to entry —
            // nobody should search for a church they were already invited to.
            if root.onboarding.pendingInvitationToken != nil {
                path = [.invitation]
            }
        }
    }
}
