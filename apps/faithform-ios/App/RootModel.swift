import Foundation
import Observation
import FaithFormKit

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

    /// The signed-in account, from the stored session.
    ///
    /// Read once per successful load rather than from the bootstrap, which
    /// deliberately carries no account id. It keys every cache partition, so a
    /// second account on the same phone can never read the first one's rows.
    private(set) var accountId: String?

    /// The selected church's feature models — see `ChurchFeatures`. Replaced
    /// whole whenever the church, the account or the authorization version
    /// changes, and nil with no church selected.
    private(set) var features: ChurchFeatures?

    /// Videos or sermon notes, on the Watch tab. Here rather than in the tab so
    /// a sermons link can choose it.
    var watchSection: WatchSection = .media

    /// The account-deletion request. Rebuilt on sign-out so the next account on
    /// this phone starts with a fresh idempotency key.
    private(set) var deletion: AccountDeletionModel

    /// Set once a deletion request has been accepted and the device signed out,
    /// so the signed-out screen can say what just happened.
    var accountDeletionRequested = false

    let onboarding: OnboardingModel
    private(set) var authModel: AuthModel!

    private let dependencies: AppDependencies

    init(dependencies: AppDependencies) {
        self.dependencies = dependencies
        self.state = AppState(environmentKey: dependencies.environment.key)
        self.onboarding = OnboardingModel(api: dependencies.api)
        self.deletion = AccountDeletionModel(api: dependencies.api)
        self.authModel = AuthModel(auth: dependencies.auth) { [weak self] session, displayName in
            await self?.completeAuth(session, displayName: displayName)
        }
        if let session = dependencies.peekSession() {
            accountId = session.accountId
            if let snapshot = dependencies.snapshots.load(
                environment: dependencies.environment.key,
                accountId: session.accountId
            ) {
                adoptCached(snapshot)
            }
        } else {
            state.apply(.signedOut)
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

    /// Sets the visitor display name from Account, then refreshes bootstrap so
    /// the header shows the name that was just saved.
    @discardableResult
    func updateDisplayName(_ raw: String) async -> Bool {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return false }
        struct ProfileUpdate: Encodable, Sendable { let displayName: String }
        struct ProfileReply: Decodable, Sendable { let displayName: String? }
        do {
            _ = try await dependencies.api.send(
                "api/mobile/v1/account/profile",
                method: .patch,
                body: ProfileUpdate(displayName: trimmed),
                as: ProfileReply.self
            )
            await load(quiet: true)
            return true
        } catch {
            return false
        }
    }

    /// Saves branding through the same server authority as the dashboard, then
    /// reloads bootstrap so the entire app adopts the new palette immediately.
    func updateChurchTheme(primaryColor: String?, accentColor: String?) async -> Bool {
        guard let church = selectedChurch, church.canManageBranding == true else { return false }
        do {
            _ = try await dependencies.api.send(
                "api/mobile/v1/churches/\(church.churchSlug)/theme",
                method: .put,
                body: UpdateChurchThemeRequest(
                    primaryColor: primaryColor,
                    accentColor: accentColor
                ),
                idempotencyKey: UUID().uuidString,
                as: ChurchThemeSettings.self
            )
            await load(quiet: true)
            return true
        } catch {
            return false
        }
    }

    func load() async { await load(quiet: false) }

    /// `quiet` refreshes in place after something changed — a join, an accepted
    /// invitation — without collapsing the UI back to a spinner first.
    func load(quiet: Bool) async {
        guard let session = await dependencies.session.currentSession() else {
            state.apply(.signedOut)
            return
        }
        accountId = session.accountId

        if !quiet {
            switch state.phase {
            case .ready:
                break
            default:
                if let snapshot = dependencies.snapshots.load(
                    environment: dependencies.environment.key,
                    accountId: session.accountId
                ) {
                    adoptCached(snapshot)
                } else {
                    // The brand dwell lives in `RootView`, not here: a returning
                    // visit must still restore Home before the network answers.
                    state.apply(.loading)
                }
            }
        }
        // Captured before anything can fail, so an offline reload still has
        // something honest to show: the last account this device loaded,
        // labelled stale, rather than a blank "you're offline".
        let previous = lastBootstrap
            ?? dependencies.snapshots.load(
                environment: dependencies.environment.key,
                accountId: session.accountId
            )?.bootstrap
        do {
            let response = try await dependencies.api.send(
                "api/mobile/v1/account/bootstrap",
                as: Bootstrap.self
            )
            guard let bootstrap = response.value else {
                showOffline(previous)
                return
            }
            lastBootstrap = bootstrap

            // First authenticated use with no recorded policy versions: the
            // person accepted them a moment ago, on the account screen that
            // said so. Recording is stating a fact, not deciding one.
            await onboarding.recordInitialConsent(for: bootstrap)

            // The server decides whether first-run stands in front of home. A
            // failure here falls back to nil — showing home to someone who
            // could be onboarding beats a dead app over a routing hint.
            onboardingState = await onboarding.refresh()

            if let accountId {
                dependencies.snapshots.store(
                    AccountSnapshot(bootstrap: bootstrap, onboarding: onboardingState),
                    environment: dependencies.environment.key,
                    accountId: accountId
                )
            }

            state.apply(.ready(bootstrap, isStale: false))
            adoptSelection(bootstrap)
            syncAttendance(bootstrap)
        } catch let error as APIError {
            if error.isCancellation {
                if !quiet, let previous { state.apply(.ready(previous, isStale: false)) }
                return
            }
            // Typed code and correlation id only — never the message, a token,
            // or anything else a person or provider wrote.
            Self.log.failure(error.code, requestId: error.requestId)
            switch error.code {
            case .unauthenticated, .sessionExpired:
                // An expired session is signed-out, not an error: the person
                // needs to sign in, and a retry button would do nothing for them.
                // `SessionManager` only reaches this when the identity provider
                // refused the refresh token itself.
                state.apply(.signedOut)
            case .unavailable where error.requestId == nil:
                // Never reached FaithForm: no network, or a refresh that could
                // not reach the identity provider. **The session is still on the
                // device**, so this is offline, not signed out — and the next
                // retry on a better connection picks up exactly where it was.
                showOffline(previous)
            default:
                state.apply(.failed(message: error.displayMessage))
            }
        } catch {
            if error.isCancellation {
                if !quiet, let previous { state.apply(.ready(previous, isStale: false)) }
                return
            }
            showOffline(previous)
        }
    }

    /// The last bootstrap this device loaded successfully.
    ///
    /// Persisted across launches via `AccountSnapshotStore`. In memory it also
    /// covers a reload that fails offline — pull to refresh on a train, a quiet
    /// reload after the access token lapsed — so the person keeps what they
    /// were already looking at instead of a blank.
    private var lastBootstrap: Bootstrap?

    private func adoptCached(_ snapshot: AccountSnapshot) {
        lastBootstrap = snapshot.bootstrap
        onboardingState = snapshot.onboarding
        state.apply(.ready(snapshot.bootstrap, isStale: false))
        adoptSelection(snapshot.bootstrap)
        syncAttendance(snapshot.bootstrap)
    }

    /// Automatic check-in follows the account: who is signed in, which
    /// churches they belong to, and whether consent still holds. Not awaited:
    /// nothing on screen waits for regions to be registered.
    private func syncAttendance(_ bootstrap: Bootstrap) {
        guard let accountId else { return }
        let attendance = dependencies.attendance
        let version = bootstrap.profile.authorizationVersion
        let consent = bootstrap.profile.autoAttendanceConsent.rawValue
        let churches = AppDependencies.attendanceChurches(in: bootstrap)
        Task {
            await attendance.updateAccount(
                accountId: accountId,
                authorizationVersion: version,
                serverConsent: consent,
                churches: churches
            )
        }
    }

    private func showOffline(_ previous: Bootstrap?) {
        if let previous {
            state.apply(.ready(previous, isStale: true))
        } else {
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
        RootTab.allCases.filter { tab in
            switch tab {
            case .watch:
                // Watch holds two things — recordings and sermon notes — and is
                // worth a tab if either is on.
                return isAllowed(tab.destination, in: bootstrap)
                    || isAllowed(.sermonArchive(churchSlug: ""), in: bootstrap)
            default:
                return isAllowed(tab.destination, in: bootstrap)
            }
        }
    }

    /// Whether a destination resolves as allowed against the current bootstrap.
    ///
    /// Church-scoped destinations are resolved against the *selected* church,
    /// so nothing survives a switch to a church that does not allow it.
    func isAllowed(_ destination: Destination) -> Bool {
        guard let bootstrap = state.bootstrap else { return false }
        return isAllowed(destination, in: bootstrap)
    }

    private func isAllowed(_ destination: Destination, in bootstrap: Bootstrap) -> Bool {
        let scoped = Self.scoped(destination, to: selectedChurch?.churchSlug)
        let resolution = dependencies.registry(for: bootstrap)
            .resolve(scoped, session: Self.snapshot(bootstrap))
        if case .allowed = resolution { return true }
        return false
    }

    /// The registry's view of this account.
    ///
    /// `canReadPublishedContent` is the server's own answer, not a state string
    /// this app re-interprets. Deriving it here would be a second copy of an
    /// authorization rule.
    nonisolated static func snapshot(_ bootstrap: Bootstrap) -> RouteRegistry.SessionSnapshot {
        RouteRegistry.SessionSnapshot(
            isAuthenticated: true,
            capabilities: Set(bootstrap.enabledCapabilities),
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
    }

    func selectChurch(_ relationship: ChurchRelationship) {
        selectedChurch = relationship
        // A church switch changes the cache partition, and with it the whole
        // feature container. Nothing from the previous church can be read
        // afterwards, because neither the key nor the models are the same.
        //
        // The new church's cached rows are deliberately **kept**: they belong
        // to this account and this church, and are what lets a switch back
        // render at once instead of starting from a spinner.
        refreshFeatures()
    }

    /// Rebuilds `features` if, and only if, what it is keyed by changed.
    ///
    /// Called after every selection change and every load. A quiet reload that
    /// changes nothing keeps the same models — and with them a scan in
    /// progress, a gift being confirmed, and a sermon's playback.
    private func refreshFeatures() {
        guard let church = selectedChurch else {
            features = nil
            return
        }
        guard let bootstrap = state.bootstrap else { return }
        let key = ChurchFeatures.Key(
            accountId: accountId,
            churchSlug: church.churchSlug,
            authorizationVersion: bootstrap.profile.authorizationVersion
        )
        guard features?.key != key else { return }
        features = ChurchFeatures(
            key: key,
            partition: dependencies.partition(
                for: bootstrap,
                accountId: accountId,
                churchSlug: church.churchSlug
            ),
            dependencies: dependencies
        )
    }

    func select(_ tab: RootTab) { selectedTab = tab }

    /// Opens a `faithform://` link, or does nothing.
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
            refreshFeatures()
        }

        let registry = dependencies.registry(for: bootstrap)
        guard case .allowed = registry.resolve(destination, session: Self.snapshot(bootstrap)) else {
            return
        }

        switch destination {
        case .sermonArchive: watchSection = .sermons
        case .watch: watchSection = .media
        default: break
        }

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

    private static let log = FaithFormLog(category: "auth")

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

        // Automatic check-in stops before anything else: every region, any
        // unsent arrival, every pending notification and the stored choice. A
        // region left registered would wake the app for someone signed out.
        await dependencies.attendance.signedOut()
        await dependencies.attendanceConfiguration.purge()
        await dependencies.cache.purgeAll()
        if let accountId {
            dependencies.snapshots.purge(
                environment: dependencies.environment.key,
                accountId: accountId
            )
        }
        await dependencies.session.purgeEverything()
        lastBootstrap = nil
        selectedChurch = nil
        features = nil
        accountId = nil
        watchSection = .media
        deletion = AccountDeletionModel(api: dependencies.api)
        selectedTab = .home
        onboardingState = nil
        onboarding.clearPendingInvitation()
        onboarding.clearChurchContext()
        state.apply(.signedOut)
    }

    /// Asks the server to delete this account, and signs out if it agreed.
    ///
    /// A failure leaves everything as it was — still signed in, the reason on
    /// `deletion.phase`, and the same request ready to retry under the same
    /// idempotency key. Only an accepted request signs out, and then
    /// `accountDeletionRequested` lets the signed-out screen say so.
    func deleteAccount() async {
        guard await deletion.requestDeletion() else { return }
        await signOut()
        accountDeletionRequested = true
    }

    private func adoptSelection(_ bootstrap: Bootstrap) {
        selectedChurch = Self.selection(
            in: bootstrap,
            preferred: onboardingState?.selectedChurchSlug,
            current: selectedChurch?.churchSlug
        )
        refreshFeatures()
    }

    /// Which church to show after a load.
    ///
    /// The server's stored preference wins when it still names a readable
    /// church — it is the choice the person actually made, on any device. Then
    /// the church already on screen, if it is still readable. Otherwise the
    /// first usable one: the previously selected church is gone, blocked, or was
    /// left, and a stale selection would be refused by every church tab.
    nonisolated static func selection(
        in bootstrap: Bootstrap,
        preferred: String?,
        current: String?
    ) -> ChurchRelationship? {
        for slug in [preferred, current].compactMap({ $0 }) {
            if let match = bootstrap.relationships.first(where: { $0.churchSlug == slug }),
               match.canReadPublishedContent {
                return match
            }
        }
        return bootstrap.relationships.first(where: \.canReadPublishedContent)
    }

    nonisolated static func scoped(_ destination: Destination, to slug: String?) -> Destination {
        guard let slug else { return destination }
        switch destination {
        case .checkIn: return .checkIn(churchSlug: slug)
        case .watch: return .watch(churchSlug: slug)
        case .give: return .give(churchSlug: slug)
        case .announcements: return .announcements(churchSlug: slug)
        case .sermonArchive: return .sermonArchive(churchSlug: slug)
        case .church: return .church(slug: slug)
        default: return destination
        }
    }

    nonisolated static func tab(for destination: Destination) -> RootTab? {
        switch destination {
        case .home: return .home
        // Finding and switching churches lives on Home now — see `HomeTabView`.
        case .churchDiscovery, .church: return .home
        case .checkIn: return .checkIn
        // Sermon notes are the other half of Watch; `open` picks the section.
        case .watch, .sermonArchive: return .watch
        case .give: return .give
        case .account, .accountPrivacy: return .account
        // No tab. Announcements are reachable by link and have no screen of
        // their own; sending them to Home would be a guess about intent.
        case .announcements: return nil
        }
    }
}
