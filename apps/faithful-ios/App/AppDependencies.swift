import Foundation
import FaithfulKit

/// The object graph, built once at launch.
///
/// No dependency-injection framework and no global accessor: everything is
/// constructed here, from the environment, and handed down. That is what makes
/// the environment a build-time fact rather than something a screen can reach
/// around and change.
@MainActor
final class AppDependencies {
    let environment: APIEnvironment
    let api: APIClient
    let cache: PartitionedCache
    let session: SessionManager
    let media: MediaClient
    let giving: GivingClient
    let allowsDebugControls: Bool
    /// Creates sessions. Nil when this build has no identity provider
    /// configured — the sign-in screen still renders, and submitting explains
    /// what is missing instead of spinning.
    let auth: SessionAuthenticating?

    init(
        environment: APIEnvironment,
        clientBuild: Int,
        allowsDebugControls: Bool,
        session: SessionManager,
        auth: SessionAuthenticating?
    ) {
        self.environment = environment
        self.allowsDebugControls = allowsDebugControls
        self.session = session
        self.auth = auth

        self.api = APIClient(
            configuration: APIClient.Configuration(
                environment: environment,
                clientBuild: clientBuild
            ),
            transport: URLSessionTransport(),
            tokens: session
        )
        // Every partition this app builds starts with the environment key, so a
        // build pointed somewhere new cannot read the previous environment's
        // data. The cache itself is environment-agnostic; the *keys* are not.
        self.cache = PartitionedCache()
        self.media = MediaClient(api: api, cache: cache)
        self.giving = GivingClient(api: api, cache: cache)
    }

    /// The registry for the capabilities the server currently reports.
    ///
    /// **Intersected with what this platform actually implements.** A server
    /// that turns on a capability iOS has no screen for must not produce a tab
    /// that opens nothing, and a screen this app has must not be reachable
    /// because it exists — the server still has to say so.
    func registry(for bootstrap: Bootstrap?) -> RouteRegistry {
        _ = bootstrap
        return RouteRegistry(implemented: Self.implementedDestinations)
    }

    /// The partition for the current account and church.
    ///
    /// Environment first, then account, then church, then authorization
    /// version — so a sign-out, a church switch, or a revoked relationship all
    /// change the key and none of them can read what came before.
    func partition(
        for bootstrap: Bootstrap?,
        accountId: String?,
        churchSlug: String? = nil
    ) -> CachePartition {
        guard let bootstrap else {
            return CachePartition.publicPartition(environment: environment.key)
        }
        return CachePartition(
            environment: environment.key,
            // The account is identified by the session, not by the bootstrap:
            // the profile deliberately carries no account id, so a cache key
            // cannot be reconstructed from a response somebody intercepted.
            accountId: accountId,
            churchSlug: churchSlug,
            authorizationVersion: bootstrap.profile.authorizationVersion
        )
    }

    /// Every destination with a real screen behind it on iOS.
    ///
    /// `sermonArchive` is **absent**: Prompt 10 was never built. The destination
    /// exists in the enum, the capability key exists, and there is no screen —
    /// so the registry resolves it to `.notImplemented` and nothing offers it.
    /// Listing it here to "finish the set" would produce a tab that opens a
    /// blank page.
    static let implementedDestinations: Set<Destination> = [
        .home,
        .account,
        .accountPrivacy,
        .churchDiscovery,
        .church(slug: ""),
        .announcements(churchSlug: ""),
        .watch(churchSlug: ""),
        .give(churchSlug: ""),
        .checkIn(churchSlug: ""),
    ]
}
