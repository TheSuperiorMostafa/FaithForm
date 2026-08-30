import SwiftUI
import FaithfulKit

/// The shared find-a-church journey: search (or nearby) → church profile →
/// follow, join, or redeem an invitation.
///
/// Used from two places — the first-run flow when an account has no church
/// yet, and "Add another church" afterwards — so both walk the same path and
/// neither can drift.

// MARK: - Search

/// Hosts `DiscoveryView` and owns what the library deliberately does not: the
/// education-before-prompt choreography, and where a result leads.
struct DiscoverySearchView: View {
    /// Wrapped so `navigationDestination(item:)` can drive the push.
    private struct OpenedChurch: Identifiable, Hashable {
        let slug: String
        var id: String { slug }
    }

    @Environment(\.faithfulTheme) private var theme
    let dependencies: AppDependencies
    let root: RootModel
    @Bindable var discovery: DiscoveryModel

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
            ChurchProfileHostView(slug: church.slug, dependencies: dependencies, root: root)
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

/// Loads one church's public profile and reacts when the person's relationship
/// with it changes — a follow, a join, an accepted invitation — by refreshing
/// the app's own account state, which is what moves first-run forward.
struct ChurchProfileHostView: View {
    let slug: String
    let dependencies: AppDependencies
    let root: RootModel

    @State private var model: ChurchProfileModel
    @State private var invitationShown = false

    init(slug: String, dependencies: AppDependencies, root: RootModel) {
        self.slug = slug
        self.dependencies = dependencies
        self.root = root
        _model = State(
            initialValue: ChurchProfileModel(api: dependencies.api, cache: dependencies.cache)
        )
    }

    var body: some View {
        ChurchProfileView(
            model: model,
            slug: slug,
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
        .onChange(of: model.phase) { _, phase in
            guard case let .loaded(profile) = phase,
                  let relationship = profile.relationshipState,
                  relationship != .left
            else { return }
            // Bootstrap does not know this relationship yet: it was created
            // just now, on this screen. Refresh quietly so home reflects it —
            // and so first-run ends the moment a church exists.
            if root.relationshipState(for: slug) != relationship {
                Task { await root.load(quiet: true) }
            }
        }
        .navigationDestination(isPresented: $invitationShown) {
            InvitationEntryView(model: root.onboarding) {
                invitationShown = false
                Task { await root.load(quiet: true) }
            }
        }
    }
}

// MARK: - First-run flow

/// What stands in front of the tabs while the account has no church: the
/// welcome screen's two doors, then discovery or invitation entry.
///
/// Signing out stays reachable the whole way through — a first-run flow a
/// person cannot leave is a dead end with extra steps.
struct OnboardingFlowView: View {
    enum Route: Hashable {
        case search
        case invitation
        /// One church, opened directly — the destination a `faithful://church/`
        /// link resolved to before the person had an account.
        case church(String)
    }

    @Environment(\.faithfulTheme) private var theme
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
                    Button(L.signOut) { Task { await root.signOut() } }
                        .font(theme.font(FaithfulTokens.Text.label))
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
                }
            }
        }
        .task {
            guard path.isEmpty else { return }

            // A church link named where this person was heading. Open that
            // church, not a search box — but stop at its profile rather than
            // joining for them. A link is an address, not consent, and the join
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
