import Foundation
import Observation
import FaithfulKit

/// What the root knows.
///
/// Owns the selected church, the tab, and the one decision that matters here:
/// **which tabs exist right now**. Everything else is delegated to the feature
/// models, which already own their own loading and their own failures.
@MainActor
@Observable
final class RootModel {
    private(set) var state = AppState(environmentKey: "")
    var selectedTab: RootTab = .home
    private(set) var selectedChurch: ChurchRelationship?

    private let dependencies: AppDependencies

    init(dependencies: AppDependencies) {
        self.dependencies = dependencies
        self.state = AppState(environmentKey: dependencies.environment.key)
    }

    func load() async {
        state.apply(.loading)
        do {
            let response = try await dependencies.api.send(
                "api/mobile/v1/account/bootstrap",
                as: Bootstrap.self
            )
            guard let bootstrap = response.value else {
                state.apply(.offlineNoCache)
                return
            }
            state.apply(.ready(bootstrap, isStale: false))
            adoptSelection(bootstrap)
        } catch let error as APIError {
            // An expired session is signed-out, not an error: the person needs
            // to sign in, and a retry button would do nothing for them.
            state.apply(
                error.code == .unauthenticated || error.code == .sessionExpired
                    ? .signedOut
                    : .failed(message: error.message)
            )
        } catch {
            state.apply(.offlineNoCache)
        }
    }

    /// The tabs available *right now*.
    ///
    /// Every one is resolved through `RouteRegistry`, against the current
    /// bootstrap and the current relationship. A capability the server switched
    /// off, a relationship that was revoked, or a screen this platform does not
    /// implement all remove the tab on the next pass — which is why a tab list
    /// is computed rather than stored.
    func availableTabs(bootstrap: Bootstrap) -> [RootTab] {
        let registry = dependencies.registry(for: bootstrap)
        let snapshot = RouteRegistry.SessionSnapshot(
            isAuthenticated: true,
            capabilities: Set(bootstrap.enabledCapabilities),
            // `canReadPublishedContent` is the server's own answer, not a
            // state string this app re-interprets. Deriving it here would be a
            // second copy of an authorization rule.
            churchAccess: Dictionary(
                uniqueKeysWithValues: bootstrap.relationships.map {
                    ($0.churchSlug, $0.canReadPublishedContent)
                }
            ),
            blockedChurches: Set(
                bootstrap.relationships
                    .filter { $0.state == .blocked }
                    .map(\.churchSlug)
            )
        )

        return RootTab.allCases.filter { tab in
            // Church-scoped tabs are resolved against the *selected* church, so
            // a tab cannot survive a switch to a church that does not allow it.
            let destination = Self.scoped(tab.destination, to: selectedChurch?.churchSlug)
            if case .allowed = registry.resolve(destination, session: snapshot) { return true }
            return false
        }
    }

    func selectChurch(_ relationship: ChurchRelationship) {
        selectedChurch = relationship
        // A church switch changes the cache partition. Nothing from the previous
        // church can be read afterwards, because the key no longer matches.
        Task {
            await dependencies.cache.purge(
                partition: dependencies.partition(
                    for: state.bootstrap,
                    accountId: nil,
                    churchSlug: relationship.churchSlug
                )
            )
        }
    }

    func select(_ tab: RootTab) { selectedTab = tab }

    /// Opens a `faithful://` link, or does nothing.
    ///
    /// Parsed, then resolved through the same registry the tabs use. An unknown
    /// link, a link to an unimplemented feature, and a link to a church this
    /// account has no relationship with all do **nothing at all** — no error
    /// screen, no partial navigation, no prompt.
    func open(_ url: URL) {
        guard let destination = DeepLinkParser.parse(url),
              let bootstrap = state.bootstrap else { return }

        if let slug = destination.churchSlug {
            guard let match = bootstrap.relationships.first(where: { $0.churchSlug == slug }),
                  match.canReadPublishedContent
            else { return }
            selectedChurch = match
        }

        let registry = dependencies.registry(for: bootstrap)
        let snapshot = RouteRegistry.SessionSnapshot(
            isAuthenticated: true,
            capabilities: Set(bootstrap.enabledCapabilities),
            churchAccess: Dictionary(
                uniqueKeysWithValues: bootstrap.relationships.map {
                    ($0.churchSlug, $0.canReadPublishedContent)
                }
            ),
            blockedChurches: Set(
                bootstrap.relationships.filter { $0.state == .blocked }.map(\.churchSlug)
            )
        )
        guard case .allowed = registry.resolve(destination, session: snapshot) else { return }

        if let tab = Self.tab(for: destination) { selectedTab = tab }
    }

    func signOut() async {
        // Everything, across every church and every partition. A sign-out that
        // left one church's cache behind would show the next person who signs in
        // on this device somebody else's church.
        await dependencies.cache.purgeAll()
        await dependencies.session.purgeEverything()
        selectedChurch = nil
        selectedTab = .home
        state.apply(.signedOut)
    }

    private func adoptSelection(_ bootstrap: Bootstrap) {
        if let current = selectedChurch,
           let refreshed = bootstrap.relationships.first(where: { $0.churchSlug == current.churchSlug }),
           refreshed.canReadPublishedContent {
            selectedChurch = refreshed
            return
        }
        // The previously selected church is gone, blocked, or was left. Falling
        // back to the first usable one is better than leaving a stale selection
        // that every church-scoped tab would then refuse.
        selectedChurch = bootstrap.relationships.first(where: \.canReadPublishedContent)
    }

    nonisolated static func scoped(_ destination: Destination, to slug: String?) -> Destination {
        guard let slug else { return destination }
        switch destination {
        case .checkIn: return .checkIn(churchSlug: slug)
        case .watch: return .watch(churchSlug: slug)
        case .give: return .give(churchSlug: slug)
        case .announcements: return .announcements(churchSlug: slug)
        case .church: return .church(slug: slug)
        default: return destination
        }
    }

    nonisolated static func tab(for destination: Destination) -> RootTab? {
        switch destination {
        case .home: return .home
        case .churchDiscovery, .church: return .church
        case .checkIn: return .checkIn
        case .watch: return .watch
        case .give: return .give
        case .account, .accountPrivacy: return .account
        // No tab. The destination exists and no screen does.
        case .announcements, .sermonArchive: return nil
        }
    }
}
