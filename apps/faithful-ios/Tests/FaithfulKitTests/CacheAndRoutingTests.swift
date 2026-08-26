import Foundation
import Testing
@testable import FaithfulKit

@Suite("Cache partitioning")
struct CacheTests {
    private struct Payload: Codable, Sendable, Equatable { let value: String }

    private func partition(
        environment: String = "production",
        account: String? = "account-1",
        church: String? = nil,
        version: Int = 1
    ) -> CachePartition {
        CachePartition(
            environment: environment,
            accountId: account,
            churchSlug: church,
            authorizationVersion: version
        )
    }

    private func entry(_ value: String, storedAt: Date = Date()) -> CacheEntry<Payload> {
        CacheEntry(value: Payload(value: value), etag: "\"tag\"", storedAt: storedAt)
    }

    @Test("a value stored in one partition is invisible in another")
    func partitionsAreIsolated() async throws {
        let cache = PartitionedCache()
        try await cache.store(entry("mine"), name: "bootstrap", partition: partition())

        // Different account
        #expect(await cache.load(Payload.self, name: "bootstrap", partition: partition(account: "account-2")) == nil)
        // Different environment
        #expect(await cache.load(Payload.self, name: "bootstrap", partition: partition(environment: "staging")) == nil)
        // Different church
        #expect(await cache.load(Payload.self, name: "bootstrap", partition: partition(church: "grace")) == nil)
        // Different authorization version — this is what makes revocation bite
        #expect(await cache.load(Payload.self, name: "bootstrap", partition: partition(version: 2)) == nil)
        // Same partition still reads
        #expect(await cache.load(Payload.self, name: "bootstrap", partition: partition())?.value.value == "mine")
    }

    @Test("public and private data never share a partition")
    func publicIsolation() async throws {
        let cache = PartitionedCache()
        let anonymous = CachePartition.publicPartition(environment: "production")
        try await cache.store(entry("public"), name: "churches", partition: anonymous)
        try await cache.store(entry("private"), name: "churches", partition: partition())

        #expect(anonymous.isPublic)
        #expect(!partition().isPublic)
        #expect(await cache.load(Payload.self, name: "churches", partition: anonymous)?.value.value == "public")
        #expect(await cache.load(Payload.self, name: "churches", partition: partition())?.value.value == "private")
    }

    @Test("revoking one church leaves other churches intact")
    func revokeOneChurch() async throws {
        let cache = PartitionedCache()
        let grace = partition(church: "grace")
        let river = partition(church: "river")
        try await cache.store(entry("g"), name: "feed", partition: grace)
        try await cache.store(entry("r"), name: "feed", partition: river)

        await cache.purge(partition: grace)
        #expect(await cache.load(Payload.self, name: "feed", partition: grace) == nil)
        #expect(await cache.load(Payload.self, name: "feed", partition: river)?.value.value == "r")
    }

    @Test("sign-out clears every partition for that account across churches and versions")
    func signOutPurgesAccount() async throws {
        let cache = PartitionedCache()
        try await cache.store(entry("a"), name: "x", partition: partition(church: "grace", version: 1))
        try await cache.store(entry("b"), name: "x", partition: partition(church: "river", version: 4))
        try await cache.store(entry("other"), name: "x", partition: partition(account: "account-2"))
        try await cache.store(entry("public"), name: "x", partition: .publicPartition(environment: "production"))

        await cache.purgeAccount(environment: "production", accountId: "account-1")

        #expect(await cache.load(Payload.self, name: "x", partition: partition(church: "grace", version: 1)) == nil)
        #expect(await cache.load(Payload.self, name: "x", partition: partition(church: "river", version: 4)) == nil)
        // Another account and the anonymous partition are untouched.
        #expect(await cache.load(Payload.self, name: "x", partition: partition(account: "account-2")) != nil)
        #expect(await cache.load(Payload.self, name: "x", partition: .publicPartition(environment: "production")) != nil)
    }

    @Test("switching account leaves nothing private behind")
    func purgeAllPrivate() async throws {
        let cache = PartitionedCache()
        try await cache.store(entry("a"), name: "x", partition: partition())
        try await cache.store(entry("b"), name: "x", partition: partition(account: "account-2"))
        try await cache.store(entry("public"), name: "x", partition: .publicPartition(environment: "production"))

        await cache.purgeAllPrivate()
        #expect(await cache.count() == 1)
        #expect(await cache.load(Payload.self, name: "x", partition: .publicPartition(environment: "production")) != nil)
    }

    @Test("freshness distinguishes fresh, stale and expired")
    func freshness() {
        let now = Date()
        let ttl: TimeInterval = 300

        #expect(entry("a", storedAt: now.addingTimeInterval(-60)).freshness(now: now, ttl: ttl) == .fresh)

        let stale = entry("a", storedAt: now.addingTimeInterval(-600)).freshness(now: now, ttl: ttl)
        if case .stale = stale {} else { Issue.record("expected stale, got \(stale)") }

        // Beyond the hard limit it is not shown at all, even labelled.
        #expect(entry("a", storedAt: now.addingTimeInterval(-4000)).freshness(now: now, ttl: ttl) == .expired)
    }

    @Test("eviction is deterministic: oldest first")
    func eviction() async throws {
        let cache = PartitionedCache(maxEntries: 3)
        let base = Date()
        for index in 0..<5 {
            try await cache.store(
                entry("v\(index)", storedAt: base.addingTimeInterval(Double(index))),
                name: "item-\(index)",
                partition: partition()
            )
        }
        #expect(await cache.count() == 3)
        #expect(await cache.load(Payload.self, name: "item-0", partition: partition()) == nil)
        #expect(await cache.load(Payload.self, name: "item-4", partition: partition()) != nil)
    }
}

@Suite("Deep links and routing")
struct RoutingTests {

    private let registry = RouteRegistry()

    private func snapshot(
        authenticated: Bool = true,
        capabilities: Set<String> = ["account"],
        access: [String: Bool] = [:],
        blocked: Set<String> = []
    ) -> RouteRegistry.SessionSnapshot {
        .init(
            isAuthenticated: authenticated,
            capabilities: capabilities,
            churchAccess: access,
            blockedChurches: blocked
        )
    }

    @Test("valid links parse to typed destinations")
    func parsesKnownLinks() {
        #expect(DeepLinkParser.parse(URL(string: "faithful://home")!) == .home)
        #expect(DeepLinkParser.parse(URL(string: "faithful://account")!) == .account)
        #expect(DeepLinkParser.parse(URL(string: "faithful://account/privacy")!) == .accountPrivacy)
        #expect(DeepLinkParser.parse(URL(string: "faithful://discover")!) == .churchDiscovery)
        #expect(DeepLinkParser.parse(URL(string: "faithful://church/grace-community")!) == .church(slug: "grace-community"))
        #expect(DeepLinkParser.parse(URL(string: "faithful://church/grace/watch")!) == .watch(churchSlug: "grace"))
        #expect(DeepLinkParser.parse(URL(string: "faithful://church/grace/give")!) == .give(churchSlug: "grace"))
    }

    @Test("unknown, malformed and hostile links fail closed")
    func rejectsUnknownLinks() {
        let bad = [
            "https://faithform.io/church/grace",   // wrong scheme
            "faithful://",                          // nothing
            "faithful://nope",                      // unknown root
            "faithful://church",                    // missing slug
            "faithful://church/GRACE",              // uppercase is not a valid slug
            "faithful://church/../../etc/passwd",   // traversal
            "faithful://church/grace/unknown",      // unknown leaf
            "faithful://church/grace/watch/extra",  // trailing junk
            "faithful://account/privacy/extra",
        ]
        for raw in bad {
            guard let url = URL(string: raw) else { continue }
            #expect(DeepLinkParser.parse(url) == nil, "should reject \(raw)")
        }
    }

    @Test("an unimplemented destination is never offered")
    func unimplementedIsRejected() {
        // Prompt 4 implements home and account only.
        #expect(registry.resolve(.home, session: snapshot()) == .allowed(.home))
        #expect(registry.resolve(.account, session: snapshot()) == .allowed(.account))

        for destination: Destination in [
            .churchDiscovery,
            .announcements(churchSlug: "grace"),
            .watch(churchSlug: "grace"),
            .sermonArchive(churchSlug: "grace"),
            .give(churchSlug: "grace"),
        ] {
            #expect(
                registry.resolve(destination, session: snapshot()) == .rejected(.notImplemented),
                "\(destination) must not be reachable yet"
            )
        }
    }

    @Test("an authenticated destination is refused when signed out")
    func requiresSignIn() {
        #expect(
            registry.resolve(.account, session: snapshot(authenticated: false))
                == .rejected(.requiresSignIn)
        )
    }

    @Test("a destination is refused when the server does not report its capability")
    func capabilityGate() {
        #expect(
            registry.resolve(.home, session: snapshot(capabilities: []))
                == .rejected(.capabilityUnavailable)
        )
    }

    @Test("a church destination requires a real relationship with that church")
    func wrongChurchDeepLink() {
        // A registry where the church screen exists, to isolate the
        // relationship gate from the not-implemented gate.
        let full = RouteRegistry(implemented: [.home, .account, .church(slug: "")])
        let session = snapshot(
            capabilities: ["account", "discovery"],
            access: ["grace": true]
        )

        #expect(full.resolve(.church(slug: "grace"), session: session) == .allowed(.church(slug: "grace")))
        #expect(full.resolve(.church(slug: "someone-elses"), session: session) == .rejected(.noRelationship))
    }

    @Test("a blocked church is refused even if a link is otherwise valid")
    func blockedChurch() {
        let full = RouteRegistry(implemented: [.home, .account, .church(slug: "")])
        let session = snapshot(
            capabilities: ["account", "discovery"],
            access: ["grace": false],
            blocked: ["grace"]
        )
        #expect(full.resolve(.church(slug: "grace"), session: session) == .rejected(.blocked))
    }

    @Test("a link is authorized before anything is mutated")
    func urlResolution() {
        let url = URL(string: "faithful://church/grace/give")!
        // Parsing succeeds, authorization does not — and the caller receives a
        // rejection rather than a half-navigated state.
        #expect(DeepLinkParser.parse(url) != nil)
        #expect(registry.resolve(url: url, session: snapshot()) == .rejected(.notImplemented))
    }
}
