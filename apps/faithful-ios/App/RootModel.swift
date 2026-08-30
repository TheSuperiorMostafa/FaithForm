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
    /// The server's answer to "is this person onboarded yet". Computed there,
    /// never inferred here from an empty list, so both platforms agree.
    private(set) var onboardingState: OnboardingState?

    let onboarding: OnboardingModel
    private(set) var authModel: AuthModel!

    private let dependencies: AppDependencies

    init(dependencies: AppDependencies) {
        self.dependencies = dependencies
        self.state = AppState(environmentKey: dependencies.environment.key)
        self.onboarding = OnboardingModel(api: dependencies.api)
        self.authModel = AuthModel(auth: dependencies.auth) { [weak self] session, displayName in
            await self?.completeAuth(session, displayName: displayName)
        }
    }

    /// True exactly when the first-run flow should stand in front of the tabs.
    var needsOnboarding: Bool {
        guard case .ready = state.phase else { return false }
        return onboardingState?.needsOnboarding == true
    }

    /// A fresh sign-in or account. Adopting the session is what flips every
    /// subsequent request from anonymous to authenticated; everything after is
    /// ordinary loading.
    func completeAuth(_ session: StoredSession, displayName: String?) async {
        do {
            try await dependencies.session.adopt(session)
        } catch {
            state.apply(.signedOut)
            return
        }

        if let displayName {
            struct ProfileUpdate: Encodable, Sendable { let displayName: String }
            struct ProfileReply: Decodable, Sendable { let displayName: String? }
            // Best-effort: the name can be set again from the account screen,
            // and failing sign-in over it would be absurd.
            _ = try? await dependencies.api.send(
                "api/mobile/v1/account/profile",
                method: .patch,
                body: ProfileUpdate(displayName: displayName),
                as: ProfileReply.self
            )
        }

        // A deep-linked invitation held across sign-in is redeemed the moment
        // it can be — before the first bootstrap, so the church it grants is
        // already there when the app first renders.
        if let token = onboarding.pendingInvitationToken {
            _ = await onboarding.acceptInvitation(token)
        }

        await load()
    }

    func load() async { await load(quiet: false) }

    /// `quiet` refreshes in place after something changed — a join, an accepted
    /// invitation — without collapsing the UI back to a spinner first.
    func load(quiet: Bool) async {
        if !quiet { state.apply(.loading) }
        do {
            let response = try await dependencies.api.send(
                "api/mobile/v1/account/bootstrap",
                as: Bootstrap.self
            )
            guard let bootstrap = response.value else {
                state.apply(.offlineNoCache)
                return
            }

            // First authenticated use with no recorded policy versions: the
            // person accepted them a moment ago, on the account screen that
            // said so. Recording is stating a fact, not deciding one.
            await onboarding.recordInitialConsent(for: bootstrap)

            // The server decides whether first-run stands in front of home. A
            // failure here falls back to nil — showing home to someone who
            // could be onboarding beats a dead app over a routing hint.
            onboardingState = await onboarding.refresh()

            state.apply(.ready(bootstrap, isStale: false))
            adoptSelection(bootstrap)
        } catch let error as APIError {
            // Typed code and correlation id only — never the message, a token,
            // or anything else a person or provider wrote.
            Self.log.failure(error.code, requestId: error.requestId)
            // An expired session is signed-out, not an error: the person needs
            // to sign in, and a retry button would do nothing for them.
            state.apply(
                error.code == .unauthenticated || error.code == .sessionExpired
                    ? .signedOut
                    : .failed(message: error.displayMessage)
            )
        } catch {
            state.apply(.offlineNoCache)
        }
    }

    /// The caller's current relationship with a church, as bootstrap knows it.
    func relationshipState(for slug: String) -> RelationshipState? {
        state.bootstrap?.relationships.first(where: { $0.churchSlug == slug })?.state
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
        // The email-confirmation callback. Exchanged exactly once by
        // `AuthModel`; with a session already on the device it degrades to a
        // quiet refresh, so a replayed or duplicate link cannot corrupt state.
        if let outcome = AuthCallbackLink.parse(url) {
            Task { await handleAuthCallback(outcome) }
            return
        }

        // An invitation is a credential, not a destination. Signed out it is
        // held for after sign-in; signed in it is redeemed on the spot.
        if let token = InvitationLink.token(from: url) {
            onboarding.hold(invitationToken: token)
            if state.bootstrap != nil {
                Task {
                    if await onboarding.acceptInvitation(token) {
                        await load(quiet: true)
                    }
                }
            } else {
                // Signed out. The token cannot be spent yet, but the church it
                // belongs to can be *named* — which is what turns the front
                // door from "FaithForm" into "Join Grace Community" for someone
                // who never asked for a product, only for their church.
                Task { await onboarding.resolveChurchContext(invitationToken: token) }
            }
            return
        }

        guard let destination = DeepLinkParser.parse(url) else { return }

        guard let bootstrap = state.bootstrap else {
            // Signed out, so there is no relationship to authorize against and
            // nothing to navigate. A church link still carries meaning here —
            // it says where the person is heading — and carrying that name
            // through sign-in is the whole difference between arriving at a
            // church and arriving at a search box.
            if case let .church(slug) = destination {
                Task { await onboarding.resolveChurchContext(churchSlug: slug) }
            }
            return
        }

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

    /// One confirmation link, whatever its state.
    ///
    /// Signed in already — because the exchange succeeded moments ago, or the
    /// person signed in with their password while the email sat unread — the
    /// link is spent goodwill, not an error: refresh quietly and move on.
    /// Signed out, it goes to `AuthModel`, which owns the exchange and every
    /// sentence it can end in.
    private func handleAuthCallback(_ outcome: AuthCallbackLink.Outcome) async {
        if await dependencies.session.currentSession() != nil {
            Self.log.event("auth_callback_ignored_signed_in")
            await load(quiet: state.bootstrap != nil)
            return
        }
        await authModel.handleConfirmationCallback(outcome)
    }

    private static let log = FaithfulLog(category: "auth")

    func signOut() async {
        // The server side first, best-effort: it bumps the authorization
        // version so anything cached against the old one is unreadable
        // everywhere, not just on this device. Then everything local, across
        // every church and every partition — a sign-out that left one church's
        // cache behind would show the next person who signs in on this device
        // somebody else's church.
        struct SignOutReply: Decodable, Sendable { let signedOut: Bool }
        _ = try? await dependencies.api.send(
            "api/mobile/v1/account/sign-out",
            method: .post,
            idempotencyKey: UUID().uuidString,
            as: SignOutReply.self
        )

        await dependencies.cache.purgeAll()
        await dependencies.session.purgeEverything()
        selectedChurch = nil
        selectedTab = .home
        onboardingState = nil
        onboarding.clearPendingInvitation()
        onboarding.clearChurchContext()
        state.apply(.signedOut)
    }

    private func adoptSelection(_ bootstrap: Bootstrap) {
        // The server's stored preference wins when it still names a readable
        // church — it is the choice the person actually made, on any device.
        if let preferred = onboardingState?.selectedChurchSlug,
           let match = bootstrap.relationships.first(where: { $0.churchSlug == preferred }),
           match.canReadPublishedContent {
            selectedChurch = match
            return
        }
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
