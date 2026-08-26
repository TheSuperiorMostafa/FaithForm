import Foundation
import Testing
@testable import FaithfulKit

/// A location provider that answers exactly what a test tells it to, and
/// records whether it was asked at all — which is how "manual search never
/// requests permission" becomes an assertion rather than a claim.
actor ScriptedLocation: LocationProviding {
    private let status: LocationAuthorization
    private let afterRequest: LocationAuthorization
    private let coordinate: (Double, Double)?
    private(set) var requestCount = 0
    private(set) var fixCount = 0

    init(
        status: LocationAuthorization = .notDetermined,
        afterRequest: LocationAuthorization = .authorizedWhenInUse,
        coordinate: (Double, Double)? = (38.2527, -85.7585)
    ) {
        self.status = status
        self.afterRequest = afterRequest
        self.coordinate = coordinate
    }

    func authorizationStatus() async -> LocationAuthorization { status }

    func requestWhenInUseAuthorization() async -> LocationAuthorization {
        requestCount += 1
        return afterRequest
    }

    func currentCoordinate() async throws -> (latitude: Double, longitude: Double) {
        fixCount += 1
        guard let coordinate else { throw APIError.offline }
        return (coordinate.0, coordinate.1)
    }

    func requests() -> Int { requestCount }
    func fixes() -> Int { fixCount }
}

private func envelope(_ dataJSON: String) -> Data {
    Data("""
    {"ok":true,"data":\(dataJSON),"meta":{"apiVersion":"2026-08-24","apiMajor":1,"requestId":"r-1","minimumSupportedClientBuild":1}}
    """.utf8)
}

private let oneChurch = """
{"items":[{"slug":"grace","name":"Grace Community","logoUrl":null,"publicSummary":"A church downtown","denomination":null,"city":"Louisville","state":"KY","postalCode":null,"joinPolicy":"open","publicProfileVersion":1,"distanceKm":null,"campusName":null}],"nextCursor":null}
"""

private let nearbyChurch = """
{"items":[{"slug":"grace","name":"Grace Community","logoUrl":null,"publicSummary":null,"denomination":null,"city":"Louisville","state":"KY","postalCode":null,"joinPolicy":"open","publicProfileVersion":1,"distanceKm":2.4,"campusName":"East"}],"nextCursor":null}
"""

/// A token provider that always succeeds. The feed is an authenticated
/// surface, so a client without one would fail before reaching the behaviour
/// under test.
private actor AlwaysValidTokens: TokenProviding {
    func validAccessToken() async throws -> String { "test-token" }
    func invalidate() async {}
}

private func client(
    _ exchanges: [StubTransport.Exchange],
    authenticated: Bool = true
) -> APIClient {
    APIClient(
        configuration: .init(
            environment: APIEnvironment(key: "test", baseURL: URL(string: "https://example.invalid")!),
            clientBuild: 1
        ),
        transport: StubTransport(exchanges),
        tokens: authenticated ? AlwaysValidTokens() : nil
    )
}

@Suite("Discovery and onboarding")
@MainActor
struct DiscoveryTests {

    @Test("manual search never asks for location permission")
    func manualSearchNeedsNoPermission() async {
        let location = ScriptedLocation()
        let model = DiscoveryModel(
            api: client([.init(status: 200, body: envelope(oneChurch))]),
            location: location
        )

        model.query = "grace"
        await model.search()

        // The whole point: someone who will never grant location must still be
        // able to find their church.
        #expect(await location.requests() == 0)
        #expect(await location.fixes() == 0)

        guard case let .results(churches, usedLocation) = model.phase else {
            Issue.record("expected results, got \(model.phase)")
            return
        }
        #expect(churches.count == 1)
        #expect(usedLocation == false)
    }

    @Test("the OS is never asked before the education screen is shown")
    func educationPrecedesPrompt() async {
        let location = ScriptedLocation()
        let model = DiscoveryModel(api: client([]), location: location)

        #expect(model.hasSeenLocationEducation == false)
        await model.beginNearbyFlow()

        // Education shown, and still no OS prompt.
        #expect(model.hasSeenLocationEducation)
        #expect(await location.requests() == 0)
    }

    @Test("nearby runs only after an explicit confirmation")
    func nearbyAfterConfirmation() async {
        let location = ScriptedLocation(afterRequest: .authorizedWhenInUse)
        let model = DiscoveryModel(
            api: client([.init(status: 200, body: envelope(nearbyChurch))]),
            location: location
        )

        await model.beginNearbyFlow()
        await model.confirmNearby()

        #expect(await location.requests() == 1)
        #expect(await location.fixes() == 1)

        guard case let .results(churches, usedLocation) = model.phase else {
            Issue.record("expected results, got \(model.phase)")
            return
        }
        #expect(usedLocation)
        #expect(churches.first?.distanceKm == 2.4)
    }

    @Test("declining location falls back to manual search rather than a dead end")
    func deniedFallsBack() async {
        let location = ScriptedLocation(afterRequest: .denied)
        let model = DiscoveryModel(
            api: client([.init(status: 200, body: envelope(oneChurch))]),
            location: location
        )

        await model.beginNearbyFlow()
        await model.confirmNearby()

        #expect(model.locationAuthorization == .denied)
        // No fix was taken, and the person still gets results.
        #expect(await location.fixes() == 0)
        guard case let .results(_, usedLocation) = model.phase else {
            Issue.record("expected fallback results, got \(model.phase)")
            return
        }
        #expect(usedLocation == false)
    }

    @Test("restricted and unavailable also fall back without taking a fix")
    func restrictedAndUnavailable() async {
        for status in [LocationAuthorization.restricted, .unavailable] {
            let location = ScriptedLocation(afterRequest: status)
            let model = DiscoveryModel(
                api: client([.init(status: 200, body: envelope(oneChurch))]),
                location: location
            )
            await model.beginNearbyFlow()
            await model.confirmNearby()

            #expect(model.locationAuthorization == status)
            #expect(await location.fixes() == 0, "\(status) must not take a fix")
        }
    }

    @Test("an empty result is an empty state, never invented churches")
    func emptyResults() async {
        let model = DiscoveryModel(
            api: client([.init(status: 200, body: envelope(#"{"items":[],"nextCursor":null}"#))]),
            location: ScriptedLocation()
        )
        await model.search()
        #expect(model.phase == .empty)
    }

    @Test("a transport failure becomes offline, not a fabricated list")
    func offline() async {
        let model = DiscoveryModel(api: client([]), location: ScriptedLocation())
        await model.search()
        #expect(model.phase == .offline)
    }
}

@Suite("Home feed")
@MainActor
struct FeedTests {

    private func feedEnvelope(_ items: String, version: Int = 3) -> Data {
        envelope("""
        {"items":\(items),"nextCursor":null,"feedVersion":\(version)}
        """)
    }

    private var oneItem: String {
        """
        [{"id":"a-1","title":"Sunday service","body":"Doors at nine","startAt":"2026-08-30T14:00:00Z","endAt":null,"location":"Main hall","posterUrl":null,"posterAltText":null,"isPinned":true,"visibility":"followers","publicationVersion":3,"publishedAt":"2026-08-24T10:00:00Z","isEvent":false,"churchSlug":"grace","churchName":"Grace Community","churchTimezone":"America/New_York"}]
        """
    }

    private func partition(version: Int = 1, church: String = "grace") -> CachePartition {
        CachePartition(
            environment: "test",
            accountId: "account-1",
            churchSlug: church,
            authorizationVersion: version
        )
    }

    @Test("a loaded feed renders what the contract returned")
    func loads() async {
        let cache = PartitionedCache()
        let model = FeedModel(api: client([.init(status: 200, body: feedEnvelope(oneItem))]), cache: cache)

        await model.load(churchSlug: "grace", partition: partition())

        guard case let .loaded(items, isStale) = model.phase else {
            Issue.record("expected loaded, got \(model.phase)")
            return
        }
        #expect(items.count == 1)
        #expect(items[0].isPinned)
        #expect(isStale == false)
    }

    @Test("an empty feed says so rather than showing sample content")
    func empty() async {
        let model = FeedModel(
            api: client([.init(status: 200, body: feedEnvelope("[]"))]),
            cache: PartitionedCache()
        )
        await model.load(churchSlug: "grace", partition: partition())
        #expect(model.phase == .empty)
    }

    @Test("cached content is shown offline and labelled stale")
    func offlineShowsLabelledCache() async {
        let cache = PartitionedCache()
        let part = partition()

        // Seed a cache entry older than its freshness window.
        let items = try! JSONDecoder.faithful.decode(
            MobileSuccess<FeedPage>.self, from: feedEnvelope(oneItem)
        ).data.items
        try! await cache.store(
            CacheEntry(value: items, etag: "\"v3\"", storedAt: Date().addingTimeInterval(-600)),
            name: "feed",
            partition: part
        )

        // No queued exchange: the network fails.
        let model = FeedModel(api: client([]), cache: cache)
        await model.load(churchSlug: "grace", partition: part)

        guard case let .loaded(cached, isStale) = model.phase else {
            Issue.record("expected cached load, got \(model.phase)")
            return
        }
        #expect(cached.count == 1)
        #expect(isStale, "offline cached content must be labelled")
    }

    @Test("no cache and no network is an honest empty state")
    func offlineNoCache() async {
        let model = FeedModel(api: client([]), cache: PartitionedCache())
        await model.load(churchSlug: "grace", partition: partition())
        #expect(model.phase == .offlineNoCache)
    }

    @Test("a 304 promotes cached content out of stale without refetching")
    func notModified() async {
        let cache = PartitionedCache()
        let part = partition()
        let items = try! JSONDecoder.faithful.decode(
            MobileSuccess<FeedPage>.self, from: feedEnvelope(oneItem)
        ).data.items
        try! await cache.store(
            CacheEntry(value: items, etag: "\"v3\"", storedAt: Date().addingTimeInterval(-600)),
            name: "feed",
            partition: part
        )

        let model = FeedModel(
            api: client([.init(status: 304, headers: ["ETag": "\"v3\""])]),
            cache: cache
        )
        await model.load(churchSlug: "grace", partition: part)

        guard case let .loaded(_, isStale) = model.phase else {
            Issue.record("expected loaded, got \(model.phase)")
            return
        }
        #expect(isStale == false, "a 304 confirms the cache is current")
    }

    @Test("being blocked purges the cached feed rather than leaving it readable")
    func blockedPurges() async {
        let cache = PartitionedCache()
        let part = partition()
        try! await cache.store(
            CacheEntry(value: [String](), etag: nil, storedAt: Date()),
            name: "feed",
            partition: part
        )

        let blockedBody = Data("""
        {"ok":false,"error":{"code":"blocked","message":"This account is blocked by the church.","retryable":false},"meta":{"apiVersion":"2026-08-24","apiMajor":1,"requestId":"r-2","minimumSupportedClientBuild":1}}
        """.utf8)

        let model = FeedModel(api: client([.init(status: 403, body: blockedBody)]), cache: cache)
        // The real sequence: load establishes the partition, then the refresh
        // inside it discovers the block.
        await model.load(churchSlug: "grace", partition: part)

        #expect(model.phase == .blocked)
        #expect(await cache.count() == 0, "a block must not leave content readable offline")
    }

    @Test("switching church cannot show the previous church's content")
    func churchPartitionIsolation() async {
        let cache = PartitionedCache()
        let items = try! JSONDecoder.faithful.decode(
            MobileSuccess<FeedPage>.self, from: feedEnvelope(oneItem)
        ).data.items
        try! await cache.store(
            CacheEntry(value: items, etag: nil, storedAt: Date()),
            name: "feed",
            partition: partition(church: "grace")
        )

        // A different church is a different partition; nothing is visible.
        let other = await cache.load([FeedItem].self, name: "feed", partition: partition(church: "river"))
        #expect(other == nil)
    }

    @Test("a bumped authorization version makes cached content unreadable")
    func revocationInvalidatesCache() async {
        let cache = PartitionedCache()
        try! await cache.store(
            CacheEntry(value: [String](), etag: nil, storedAt: Date()),
            name: "feed",
            partition: partition(version: 1)
        )
        let afterRevocation = await cache.load(
            [String].self, name: "feed", partition: partition(version: 2)
        )
        #expect(afterRevocation == nil)
    }
}

@Suite("Feed formatting")
struct FeedFormattingTests {

    private func item(
        startAt: String,
        endAt: String? = nil,
        isEvent: Bool = false,
        timezone: String = "America/New_York"
    ) -> FeedItem {
        FeedItem(
            id: "a", title: "T", body: "", startAt: startAt, endAt: endAt,
            location: nil, posterUrl: nil, posterAltText: nil, isPinned: false,
            visibility: .followers, publicationVersion: 1, publishedAt: nil,
            isEvent: isEvent, churchSlug: "grace", churchName: "Grace",
            churchTimezone: timezone
        )
    }

    @Test("times render in the church's zone, not the device's")
    func churchTimezone() {
        // 14:00 UTC is 10:00 in New York and 07:00 in Los Angeles.
        let eastern = FeedFormatting.whenLine(item(startAt: "2026-08-30T14:00:00Z"))
        let pacific = FeedFormatting.whenLine(
            item(startAt: "2026-08-30T14:00:00Z", timezone: "America/Los_Angeles")
        )
        #expect(eastern.contains("10:00"))
        #expect(pacific.contains("7:00"))
        #expect(eastern != pacific)
    }

    @Test("a same-day event shows a time range")
    func sameDayRange() {
        let line = FeedFormatting.whenLine(
            item(startAt: "2026-08-30T14:00:00Z", endAt: "2026-08-30T16:00:00Z", isEvent: true)
        )
        #expect(line.contains("–"))
        #expect(line.contains("10:00"))
        #expect(line.contains("12:00"))
    }

    @Test("a multi-day event shows both dates")
    func multiDayRange() {
        let line = FeedFormatting.whenLine(
            item(startAt: "2026-08-30T14:00:00Z", endAt: "2026-09-01T16:00:00Z", isEvent: true)
        )
        #expect(line.contains("August"))
        #expect(line.contains("September"))
    }

    @Test("an announcement with no end time shows a single moment")
    func announcementSingleTime() {
        let line = FeedFormatting.whenLine(item(startAt: "2026-08-30T14:00:00Z"))
        #expect(!line.contains("–"))
    }

    @Test("both instant forms parse, with and without fractional seconds")
    func instantParsing() {
        #expect(FaithfulInstant.parse("2026-08-30T14:00:00Z") != nil)
        #expect(FaithfulInstant.parse("2026-08-30T14:00:00.123Z") != nil)
        #expect(FaithfulInstant.parse("not a date") == nil)
    }

    @Test("an unknown timezone falls back rather than dropping the item")
    func unknownTimezone() {
        let line = FeedFormatting.whenLine(
            item(startAt: "2026-08-30T14:00:00Z", timezone: "Not/AZone")
        )
        #expect(!line.isEmpty)
    }
}
