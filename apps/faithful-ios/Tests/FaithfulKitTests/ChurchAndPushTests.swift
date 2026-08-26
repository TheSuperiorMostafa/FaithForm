import Foundation
import Testing
@testable import FaithfulKit

private func envelope(_ dataJSON: String) -> Data {
    Data("""
    {"ok":true,"data":\(dataJSON),"meta":{"apiVersion":"2026-08-24","apiMajor":1,"requestId":"r-1","minimumSupportedClientBuild":1}}
    """.utf8)
}

private actor TestTokens: TokenProviding {
    func validAccessToken() async throws -> String { "test-token" }
    func invalidate() async {}
}

private func api(_ exchanges: [StubTransport.Exchange]) -> APIClient {
    APIClient(
        configuration: .init(
            environment: APIEnvironment(key: "test", baseURL: URL(string: "https://example.invalid")!),
            clientBuild: 7
        ),
        transport: StubTransport(exchanges),
        tokens: TestTokens()
    )
}

private func profileJSON(
    joinPolicy: String,
    relationship: String? = nil,
    campuses: String = "[]",
    services: String = "[]"
) -> String {
    let relationshipValue = relationship.map { "\"\($0)\"" } ?? "null"
    return """
    {"slug":"grace","name":"Grace Community","logoUrl":null,"coverImageUrl":null,
    "publicSummary":"A church downtown","tagline":"Come as you are","denomination":null,
    "address":null,"city":"Louisville","state":"KY","postalCode":"40202",
    "website":"https://grace.invalid","phone":"+15025550134","email":"hello@grace.invalid",
    "joinPolicy":"\(joinPolicy)","timezone":"America/New_York","publicProfileVersion":2,
    "campuses":\(campuses),"serviceTimes":\(services),"relationshipState":\(relationshipValue)}
    """
}

private func profile(
    joinPolicy: JoinPolicy,
    relationship: RelationshipState?
) -> ChurchProfile {
    ChurchProfile(
        slug: "grace", name: "Grace", logoUrl: nil, coverImageUrl: nil,
        publicSummary: nil, tagline: nil, denomination: nil, address: nil,
        city: nil, state: nil, postalCode: nil, website: nil, phone: nil,
        email: nil, joinPolicy: joinPolicy, timezone: "UTC",
        publicProfileVersion: 1, campuses: [], serviceTimes: [],
        relationshipState: relationship
    )
}

@Suite("Church profile")
@MainActor
struct ChurchProfileTests {

    private func partition() -> CachePartition {
        CachePartition(
            environment: "test", accountId: "account-1",
            churchSlug: "grace", authorizationVersion: 1
        )
    }

    @Test("a profile loads with campuses and service times")
    func loadsFullProfile() async {
        let body = envelope(profileJSON(
            joinPolicy: "approval_required",
            relationship: "following",
            campuses: """
            [{"slug":"east","name":"East Campus","addressLine1":"1 Main St","city":"Louisville",
            "state":"KY","postalCode":"40202","latitude":38.25,"longitude":-85.75,
            "timezone":"America/New_York","isPrimary":true}]
            """,
            services: """
            [{"campusSlug":"east","label":"Morning","dayOfWeek":0,"startTime":"10:00:00","kind":"regular"}]
            """
        ))

        let model = ChurchProfileModel(api: api([.init(status: 200, body: body)]), cache: PartitionedCache())
        await model.load(slug: "grace", partition: partition())

        guard case let .loaded(loaded) = model.phase else {
            Issue.record("expected loaded, got \(model.phase)")
            return
        }
        #expect(loaded.name == "Grace Community")
        #expect(loaded.campuses.count == 1)
        #expect(loaded.campuses[0].isPrimary)
        #expect(loaded.serviceTimes.count == 1)
        #expect(loaded.relationshipState == .following)
    }

    @Test("a hidden church and an unknown slug are indistinguishable")
    func notFoundIsOpaque() async {
        let body = Data("""
        {"ok":false,"error":{"code":"not_found","message":"Church not found.","retryable":false},"meta":{"apiVersion":"2026-08-24","apiMajor":1,"requestId":"r-2","minimumSupportedClientBuild":1}}
        """.utf8)

        let model = ChurchProfileModel(api: api([.init(status: 404, body: body)]), cache: PartitionedCache())
        await model.load(slug: "hidden", partition: partition())

        // One state for both, so the screen cannot reveal which it was.
        #expect(model.phase == .notFound)
    }

    @Test("the offered action follows the policy and the relationship")
    func actionMatrix() {
        // No relationship yet.
        #expect(ChurchProfileModel.action(for: profile(joinPolicy: .open, relationship: nil)) == .follow)
        #expect(ChurchProfileModel.action(for: profile(joinPolicy: .approvalRequired, relationship: nil)) == .follow)
        #expect(ChurchProfileModel.action(for: profile(joinPolicy: .inviteOnly, relationship: nil)) == .invitationRequired)

        // Already following: the next step depends on whether joining is offered.
        #expect(ChurchProfileModel.action(for: profile(joinPolicy: .open, relationship: .following)) == .joinImmediately)
        #expect(ChurchProfileModel.action(for: profile(joinPolicy: .approvalRequired, relationship: .following)) == .requestToJoin)
        #expect(ChurchProfileModel.action(for: profile(joinPolicy: .inviteOnly, relationship: .following)) == .invitationRequired)

        // Pending, joined, blocked.
        #expect(ChurchProfileModel.action(for: profile(joinPolicy: .approvalRequired, relationship: .pending)) == .pending)
        #expect(ChurchProfileModel.action(for: profile(joinPolicy: .open, relationship: .joined)) == .leave)
        #expect(ChurchProfileModel.action(for: profile(joinPolicy: .open, relationship: .blocked)) == .unavailable)
    }

    @Test("a service line renders the church's own day and time")
    func serviceLine() {
        let service = PublicServiceTime(
            campusSlug: "east", label: "Morning", dayOfWeek: 0,
            startTime: "10:00:00", kind: "regular"
        )
        let line = ChurchProfileView.serviceLine(service)
        #expect(line.contains("Sunday"))
        #expect(line.contains("10:00"))
        // Seconds are never meaningful here.
        #expect(!line.contains(":00:00"))
    }

    @Test("an out-of-range day index does not crash")
    func serviceLineClamps() {
        let service = PublicServiceTime(
            campusSlug: "east", label: "X", dayOfWeek: 99,
            startTime: "10:00:00", kind: "regular"
        )
        #expect(!ChurchProfileView.serviceLine(service).isEmpty)
    }

    @Test("an address line skips empty parts rather than showing stray commas")
    func addressLine() {
        let full = PublicCampus(
            slug: "east", name: "East", addressLine1: "1 Main St", city: "Louisville",
            state: "KY", postalCode: "40202", latitude: nil, longitude: nil,
            timezone: "UTC", isPrimary: true
        )
        #expect(ChurchProfileView.addressLine(full) == "1 Main St, Louisville, KY, 40202")

        let empty = PublicCampus(
            slug: "e", name: "E", addressLine1: nil, city: nil, state: nil,
            postalCode: nil, latitude: nil, longitude: nil, timezone: "UTC", isPrimary: false
        )
        #expect(ChurchProfileView.addressLine(empty) == nil)
    }

    @Test("a cached profile renders offline, and a failure does not discard it")
    func offlineUsesCache() async {
        let cache = PartitionedCache()
        let part = partition()
        let cached = try! JSONDecoder.faithful.decode(
            MobileSuccess<ChurchProfile>.self,
            from: envelope(profileJSON(joinPolicy: "open", relationship: "joined"))
        ).data
        try! await cache.store(
            CacheEntry(value: cached, etag: "\"v2\"", storedAt: Date()),
            name: "profile-grace",
            partition: part
        )

        // No queued exchange: the network fails.
        let model = ChurchProfileModel(api: api([]), cache: cache)
        await model.load(slug: "grace", partition: part)

        guard case .loaded = model.phase else {
            Issue.record("cached profile must survive a failed refresh, got \(model.phase)")
            return
        }
    }
}

@Suite("Church chooser")
@MainActor
struct ChurchChooserTests {

    private func chooser(
        _ exchanges: [StubTransport.Exchange],
        cache: PartitionedCache = PartitionedCache(),
        version: Int = 4,
        selected: String? = "grace"
    ) -> ChurchChooserModel {
        ChurchChooserModel(
            api: api(exchanges),
            cache: cache,
            environmentKey: "test",
            accountId: "account-1",
            authorizationVersion: version,
            selectedSlug: selected
        )
    }

    private let twoChurches = """
    {"items":[
      {"slug":"grace","name":"Grace","logoUrl":null,"state":"joined"},
      {"slug":"river","name":"River","logoUrl":null,"state":"following"}
    ]}
    """

    @Test("the chooser lists the churches an account belongs to")
    func loads() async {
        let model = chooser([.init(status: 200, body: envelope(twoChurches))])
        await model.load()

        guard case let .loaded(items) = model.phase else {
            Issue.record("expected loaded, got \(model.phase)")
            return
        }
        #expect(items.count == 2)
        #expect(model.selectedSlug == "grace")
    }

    @Test("a selection that is no longer available is dropped, not restored")
    func staleSelectionDropped() async {
        // The account was blocked from "grace" since it was last selected.
        let withoutGrace = """
        {"items":[{"slug":"river","name":"River","logoUrl":null,"state":"following"}]}
        """
        let model = chooser([.init(status: 200, body: envelope(withoutGrace))])
        await model.load()

        #expect(model.selectedSlug == nil, "a stale preference must not survive")
    }

    @Test("an empty account is an empty state, not an error")
    func empty() async {
        let model = chooser([.init(status: 200, body: envelope(#"{"items":[]}"#))], selected: nil)
        await model.load()
        #expect(model.phase == .empty)
    }

    @Test("no network is offline, not a fabricated list")
    func offline() async {
        let model = chooser([])
        await model.load()
        #expect(model.phase == .offline)
    }

    @Test("selecting a church switches the cache partition")
    func selectSwitchesPartition() async {
        let selectReply = envelope(#"{"selectedChurchSlug":"river","authorizationVersion":4}"#)
        let model = chooser([
            .init(status: 200, body: envelope(twoChurches)),
            .init(status: 200, body: selectReply),
        ])

        await model.load()
        let result = await model.select(slug: "river")

        let switched = try! #require(result)
        #expect(switched.selectedSlug == "river")
        #expect(switched.partition.churchSlug == "river")
        #expect(model.selectedSlug == "river")
    }

    @Test("a blocked or left church cannot be selected")
    func blockedNotSelectable() async {
        let withBlocked = """
        {"items":[
          {"slug":"grace","name":"Grace","logoUrl":null,"state":"blocked"},
          {"slug":"river","name":"River","logoUrl":null,"state":"left"}
        ]}
        """
        let model = chooser([.init(status: 200, body: envelope(withBlocked))], selected: nil)
        await model.load()

        #expect(await model.select(slug: "grace") == nil)
        #expect(await model.select(slug: "river") == nil)
    }

    @Test("a church that is not in the list cannot be selected")
    func unknownNotSelectable() async {
        let model = chooser([.init(status: 200, body: envelope(twoChurches))])
        await model.load()
        #expect(await model.select(slug: "someone-elses") == nil)
    }

    @Test("a bumped authorization version purges every cached partition")
    func versionBumpPurges() async {
        let cache = PartitionedCache()
        // Seed two churches' caches at the old version.
        for slug in ["grace", "river"] {
            try! await cache.store(
                CacheEntry(value: ["x"], etag: nil, storedAt: Date()),
                name: "feed",
                partition: CachePartition(
                    environment: "test", accountId: "account-1",
                    churchSlug: slug, authorizationVersion: 4
                )
            )
        }
        #expect(await cache.count() == 2)

        // The server reports a newer version: something was revoked.
        let bumped = envelope(#"{"selectedChurchSlug":"river","authorizationVersion":9}"#)
        let model = chooser(
            [.init(status: 200, body: envelope(twoChurches)), .init(status: 200, body: bumped)],
            cache: cache,
            version: 4
        )

        await model.load()
        let result = await model.select(slug: "river")

        #expect(model.authorizationVersion == 9)
        #expect(await cache.count() == 0, "a version bump must invalidate every partition")
        // And the new partition is keyed to the new version.
        #expect(result?.partition.authorizationVersion == 9)
    }

    @Test("a revoked relationship reloads the list rather than leaving it stale")
    func revokedReloads() async {
        let blockedReply = Data("""
        {"ok":false,"error":{"code":"blocked","message":"Blocked.","retryable":false},"meta":{"apiVersion":"2026-08-24","apiMajor":1,"requestId":"r-3","minimumSupportedClientBuild":1}}
        """.utf8)
        let afterReload = """
        {"items":[{"slug":"river","name":"River","logoUrl":null,"state":"following"}]}
        """

        let model = chooser([
            .init(status: 200, body: envelope(twoChurches)),
            .init(status: 403, body: blockedReply),
            .init(status: 200, body: envelope(afterReload)),
        ])

        await model.load()
        let result = await model.select(slug: "grace")

        #expect(result == nil)
        guard case let .loaded(items) = model.phase else {
            Issue.record("expected a reloaded list, got \(model.phase)")
            return
        }
        #expect(items.count == 1, "the revoked church must be gone after reload")
    }
}

@Suite("Push lifecycle")
@MainActor
struct PushLifecycleTests {

    actor ScriptedAuthorizer: NotificationAuthorizing {
        private let initial: NotificationAuthorization
        private let afterRequest: NotificationAuthorization
        private(set) var requestCount = 0
        private(set) var registerCount = 0

        init(
            initial: NotificationAuthorization = .notDetermined,
            afterRequest: NotificationAuthorization = .authorized
        ) {
            self.initial = initial
            self.afterRequest = afterRequest
        }

        func status() async -> NotificationAuthorization { initial }

        func requestAuthorization() async -> NotificationAuthorization {
            requestCount += 1
            return afterRequest
        }

        func registerForRemoteNotifications() async { registerCount += 1 }

        func requests() -> Int { requestCount }
        func registrations() -> Int { registerCount }
    }

    private func model(
        _ exchanges: [StubTransport.Exchange],
        authorizer: ScriptedAuthorizer
    ) -> PushLifecycleModel {
        PushLifecycleModel(
            api: api(exchanges),
            authorizer: authorizer,
            installId: "install-abcdefgh",
            clientBuild: 7
        )
    }

    @Test("the OS is never prompted before the education screen")
    func educationPrecedesPrompt() async {
        let authorizer = ScriptedAuthorizer()
        let subject = model([], authorizer: authorizer)

        await subject.refreshStatus()
        #expect(await authorizer.requests() == 0)

        await subject.beginEducation()
        #expect(subject.hasSeenEducation)
        // Education shown; still no prompt.
        #expect(await authorizer.requests() == 0)
    }

    @Test("confirming prompts once and registers for remote notifications")
    func confirmPrompts() async {
        let authorizer = ScriptedAuthorizer(afterRequest: .authorized)
        let subject = model([], authorizer: authorizer)

        await subject.beginEducation()
        await subject.confirmEnable()

        #expect(await authorizer.requests() == 1)
        #expect(await authorizer.registrations() == 1)
        #expect(subject.status == .authorized)
    }

    @Test("provisional authorization still registers — those notifications arrive")
    func provisionalRegisters() async {
        let authorizer = ScriptedAuthorizer(afterRequest: .provisional)
        let subject = model([], authorizer: authorizer)

        await subject.beginEducation()
        await subject.confirmEnable()

        #expect(await authorizer.registrations() == 1)
        #expect(NotificationPrompting.shouldRegisterForRemote(.provisional))
    }

    @Test("a denial does not register, and is not asked again")
    func denialIsFinal() async {
        let authorizer = ScriptedAuthorizer(afterRequest: .denied)
        let subject = model([], authorizer: authorizer)

        await subject.beginEducation()
        await subject.confirmEnable()

        #expect(subject.status == .denied)
        #expect(await authorizer.registrations() == 0)
        #expect(NotificationPrompting.shouldDirectToSettings(.denied))
        // A second confirmation is a no-op rather than a second prompt.
        await subject.confirmEnable()
        #expect(await authorizer.requests() == 1)
    }

    @Test("confirming without education never prompts")
    func requiresEducation() async {
        let authorizer = ScriptedAuthorizer()
        let subject = model([], authorizer: authorizer)
        await subject.confirmEnable()
        #expect(await authorizer.requests() == 0)
    }

    @Test("a token registers once and a repeat is a no-op")
    func tokenRegistrationIsIdempotent() async {
        let reply = envelope("""
        {"installId":"install-abcdefgh","platform":"ios","isEnabled":true,"lastSeenAt":"2026-08-24T10:00:00Z"}
        """)
        let subject = model([.init(status: 200, body: reply)], authorizer: ScriptedAuthorizer())

        await subject.handleToken("aabbccdd")
        #expect(subject.lastRegisteredToken == "aabbccdd")

        // Same token again: no second exchange is queued, so a request would
        // fail — the no-op is what keeps this passing.
        await subject.handleToken("aabbccdd")
        #expect(subject.registrationError == nil)
    }

    @Test("a rotated token registers again")
    func rotationRegisters() async {
        let reply = envelope("""
        {"installId":"install-abcdefgh","platform":"ios","isEnabled":true,"lastSeenAt":"2026-08-24T10:00:00Z"}
        """)
        let subject = model(
            [.init(status: 200, body: reply), .init(status: 200, body: reply)],
            authorizer: ScriptedAuthorizer()
        )

        await subject.handleToken("first-token")
        await subject.handleToken("rotated-token")
        #expect(subject.lastRegisteredToken == "rotated-token")
    }

    @Test("a failed registration never puts the token in the error")
    func failureRedacts() async {
        let failure = Data("""
        {"ok":false,"error":{"code":"invalid_request","message":"Could not register this device.","retryable":false},"meta":{"apiVersion":"2026-08-24","apiMajor":1,"requestId":"r-9","minimumSupportedClientBuild":1}}
        """.utf8)
        let subject = model([.init(status: 400, body: failure)], authorizer: ScriptedAuthorizer())

        await subject.handleToken("secret-device-token-value")

        #expect(subject.lastRegisteredToken == nil)
        let message = subject.registrationError ?? ""
        #expect(!message.contains("secret-device-token-value"))
    }

    @Test("retiring clears the local token so the next account starts clean")
    func retireClears() async {
        let reply = envelope("""
        {"installId":"install-abcdefgh","platform":"ios","isEnabled":true,"lastSeenAt":"2026-08-24T10:00:00Z"}
        """)
        let subject = model(
            [.init(status: 200, body: reply), .init(status: 200, body: envelope(#"{"retired":true}"#))],
            authorizer: ScriptedAuthorizer()
        )

        await subject.handleToken("aabb")
        await subject.retire()
        #expect(subject.lastRegisteredToken == nil)
    }

    @Test("APNs token bytes hex-encode correctly")
    func tokenHex() {
        #expect(apnsTokenHex(Data([0x00, 0x0f, 0xa0, 0xff])) == "000fa0ff")
        #expect(apnsTokenHex(Data()) == "")
    }

    @Test("a notification payload routes through the fail-closed router")
    func notificationRouting() {
        let registry = RouteRegistry(implemented: [.home, .account, .announcements(churchSlug: "")])
        let session = RouteRegistry.SessionSnapshot(
            isAuthenticated: true,
            capabilities: ["account", "announcements"],
            churchAccess: ["grace": true]
        )

        let allowed = NotificationRouting.destination(
            from: ["faithful": ["deepLink": "faithful://church/grace/announcements"]],
            registry: registry,
            session: session
        )
        #expect(allowed == .allowed(.announcements(churchSlug: "grace")))

        // A church the account has no relationship with is refused, even though
        // the notification arrived.
        let wrongChurch = NotificationRouting.destination(
            from: ["faithful": ["deepLink": "faithful://church/someone-else/announcements"]],
            registry: registry,
            session: session
        )
        #expect(wrongChurch == .rejected(.noRelationship))

        // A payload with no link, or a malformed one, fails closed.
        #expect(
            NotificationRouting.destination(from: [:], registry: registry, session: session)
                == .rejected(.notImplemented)
        )
        #expect(
            NotificationRouting.destination(
                from: ["faithful": ["deepLink": "https://evil.invalid/church/grace"]],
                registry: registry,
                session: session
            ) == .rejected(.notImplemented)
        )
    }
}
