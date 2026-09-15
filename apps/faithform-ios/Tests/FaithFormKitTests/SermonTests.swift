import Foundation
import Testing
@testable import FaithFormKit

// ---------------------------------------------------------------------------
// Doubles and builders
// ---------------------------------------------------------------------------

private actor SermonTokens: TokenProviding {
    func validAccessToken() async throws -> String { "test-token" }
    func invalidate() async {}
}

/// Holds every request until the test answers it, so two overlapping list
/// requests can be finished in the order that exposes a stale overwrite.
private actor GatedTransport: HTTPTransport {
    private(set) var requests: [URLRequest] = []
    private var pending: [Int: CheckedContinuation<(Data, HTTPURLResponse), Error>] = [:]
    private var arrivalWaiters: [(count: Int, continuation: CheckedContinuation<Void, Never>)] = []

    func perform(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        try await withCheckedThrowingContinuation { continuation in
            pending[requests.count] = continuation
            requests.append(request)
            let arrived = requests.count
            let ready = arrivalWaiters.filter { $0.count <= arrived }
            arrivalWaiters.removeAll { $0.count <= arrived }
            for waiter in ready { waiter.continuation.resume() }
        }
    }

    /// Suspends until `count` requests have reached the transport.
    func waitForRequests(_ count: Int) async {
        if requests.count >= count { return }
        await withCheckedContinuation { arrivalWaiters.append((count, $0)) }
    }

    func respond(to index: Int, body: Data) {
        guard let continuation = pending.removeValue(forKey: index) else { return }
        let response = HTTPURLResponse(
            url: requests[index].url!, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: [:]
        )!
        continuation.resume(returning: (body, response))
    }
}

private actor CancelAfterFirstTransport: HTTPTransport {
    private let first: Data
    private var count = 0

    init(first: Data) { self.first = first }

    func perform(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        count += 1
        if count == 1 {
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: [:]
            )!
            return (first, response)
        }
        throw URLError(.cancelled)
    }
}

private let sermonPartition = CachePartition(
    environment: "test", accountId: "account-a", churchSlug: "grace", authorizationVersion: 1
)

@MainActor
private func sermonModel(
    _ transport: some HTTPTransport,
    now: @escaping () -> Date = Date.init
) -> SermonModel {
    let api = APIClient(
        configuration: .init(
            environment: APIEnvironment(key: "test", baseURL: URL(string: "https://example.invalid")!),
            clientBuild: 7
        ),
        transport: transport,
        tokens: SermonTokens()
    )
    return SermonModel(
        client: SermonClient(api: api, cache: PartitionedCache()),
        churchSlug: "grace",
        partition: sermonPartition,
        now: now
    )
}

private let meta = """
{"apiVersion":"2026-08-24","apiMajor":1,"requestId":"r-1","minimumSupportedClientBuild":1}
"""

private func page(_ ids: [String], next: String? = nil) -> Data {
    let items = ids.map { id in
        """
        {"sermonId":"\(id)","title":"Sermon \(id)","summary":null,
         "publishedAt":"2026-09-13T14:03:22.123456+00:00","preachedOn":"2026-09-13",
         "scriptureRefs":["John 1:1"],"seriesName":null,"publicationVersion":1,
         "churchSlug":"grace","churchName":"Grace","churchTimezone":"America/New_York"}
        """
    }
    let cursor = next.map { "\"\($0)\"" } ?? "null"
    return Data("""
    {"ok":true,"data":{"items":[\(items.joined(separator: ","))],"nextCursor":\(cursor),"sermonVersion":1},"meta":\(meta)}
    """.utf8)
}

private let unavailable = StubTransport.Exchange(
    status: 503,
    body: Data("""
    {"ok":false,"error":{"code":"unavailable","message":"Try again shortly.","retryable":true},"meta":\(meta)}
    """.utf8)
)

private func query(_ request: URLRequest) -> [String: String] {
    let items = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems ?? []
    return Dictionary(uniqueKeysWithValues: items.map { ($0.name, $0.value ?? "") })
}

private func item(
    _ id: String,
    preachedOn: String?,
    publishedAt: String = "2026-09-13T14:03:22Z",
    timezone: String = "America/New_York"
) -> SermonListItem {
    SermonListItem(
        sermonId: id, title: id, publishedAt: publishedAt, preachedOn: preachedOn,
        scriptureRefs: [], publicationVersion: 1, churchSlug: "grace",
        churchName: "Grace", churchTimezone: timezone
    )
}

private let enUS = Locale(identifier: "en_US")

/// 2026-09-13T14:03:22Z, built without the parser under test.
private let base: Date = {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "UTC")!
    return calendar.date(from: DateComponents(year: 2026, month: 9, day: 13, hour: 14, minute: 3, second: 22))!
}()

private func close(_ date: Date?, _ expected: Date) -> Bool {
    guard let date else { return false }
    return abs(date.timeIntervalSince(expected)) < 0.000_5
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

@Suite("Sermon dates")
struct SermonDateTests {

    @Test("RFC 3339 with a Z and milliseconds")
    func zuluMilliseconds() {
        #expect(close(SermonDates.instant("2026-09-13T14:03:22.123Z"), base.addingTimeInterval(0.123)))
        #expect(close(SermonDates.instant("2026-09-13T14:03:22Z"), base))
    }

    @Test("Postgres style: microseconds and +00:00 instead of Z")
    func postgresMicroseconds() {
        #expect(close(SermonDates.instant("2026-09-13T14:03:22.123456+00:00"), base.addingTimeInterval(0.123456)))
        #expect(close(SermonDates.instant("2026-09-13T14:03:22+00:00"), base))
        #expect(close(SermonDates.instant("2026-09-13 14:03:22.5+00"), base.addingTimeInterval(0.5)))
    }

    @Test("a non-UTC offset is applied, in either direction and either spelling")
    func offsets() {
        #expect(close(SermonDates.instant("2026-09-13T10:03:22-04:00"), base))
        #expect(close(SermonDates.instant("2026-09-13T19:33:22+0530"), base))
        #expect(close(SermonDates.instant("2026-09-13T10:03:22.1-04:00"), base.addingTimeInterval(0.1)))
    }

    @Test("anything that is not an instant is nil rather than a guess")
    func refusals() {
        #expect(SermonDates.instant("") == nil)
        #expect(SermonDates.instant("2026-09-13") == nil)
        #expect(SermonDates.instant("2026-09-13T14:03:22") == nil, "no zone is not UTC")
        #expect(SermonDates.instant("2026-02-30T14:03:22Z") == nil)
        #expect(SermonDates.instant("2026-09-13T14:03:22.Z") == nil)
        #expect(SermonDates.instant("2026-09-13T14:03:22Zjunk") == nil)
        #expect(SermonDates.instant("Sunday") == nil)
    }

    @Test("preachedOn is a calendar day and never drifts to the day before")
    func preachedOnDoesNotShift() {
        let day = SermonDates.calendarDay("2026-09-13")
        #expect(day == SermonDay(year: 2026, month: 9, day: 13))

        // A church far west of UTC still preached on the 13th. Reading the
        // string as UTC midnight and drawing it in Honolulu would say the 12th.
        let west = SermonDates.displayDay(
            preachedOn: "2026-09-13",
            publishedAt: "2026-09-15T09:00:00Z",
            churchTimezone: "Pacific/Honolulu"
        )
        #expect(west == SermonDay(year: 2026, month: 9, day: 13))
        #expect(SermonDates.format(west!, style: .long, locale: enUS) == "September 13, 2026")
        #expect(SermonDates.format(west!, style: .abbreviated, locale: enUS) == "Sep 13, 2026")

        #expect(SermonDates.calendarDay("2026-02-30") == nil)
        #expect(SermonDates.calendarDay("2026-9-13") == nil)
        #expect(SermonDates.calendarDay("2026-09-13T00:00:00Z") == SermonDay(year: 2026, month: 9, day: 13))
    }

    @Test("without preachedOn, the published instant's day in the church's zone")
    func publishedFallback() {
        // 02:30 UTC on the 14th is still Sunday evening the 13th in Los Angeles.
        #expect(
            SermonDates.displayDay(
                preachedOn: nil,
                publishedAt: "2026-09-14T02:30:00.123456+00:00",
                churchTimezone: "America/Los_Angeles"
            ) == SermonDay(year: 2026, month: 9, day: 13)
        )
        // An unreadable preachedOn falls back rather than hiding the date.
        #expect(
            SermonDates.displayDay(preachedOn: "", publishedAt: "2026-09-14T02:30:00Z", churchTimezone: "UTC")
                == SermonDay(year: 2026, month: 9, day: 14)
        )
        #expect(SermonDates.displayDay(preachedOn: nil, publishedAt: "garbage", churchTimezone: "UTC") == nil)
    }

    @Test("the history groups into consecutive months, in order, with locale titles")
    func monthGrouping() {
        let items = [
            item("a", preachedOn: "2026-09-13"),
            item("b", preachedOn: "2026-09-06"),
            item("c", preachedOn: nil, publishedAt: "2026-09-01T02:00:00Z", timezone: "America/New_York"),
            item("d", preachedOn: nil, publishedAt: "not a date"),
            item("e", preachedOn: "2026-07-05"),
        ]

        let groups = SermonDates.groupedByMonth(items, locale: enUS)
        #expect(groups.map(\.title) == ["September 2026", "August 2026", nil, "July 2026"])
        #expect(groups.map { $0.items.map(\.sermonId) } == [["a", "b"], ["c"], ["d"], ["e"]])
        #expect(Set(groups.map(\.id)).count == groups.count)
        #expect(SermonDates.groupedByMonth([], locale: enUS).isEmpty)
    }

    @Test("a next page that carries on a month joins it; a month seen again later does not merge back")
    func groupingAcrossPages() {
        let firstPage = [item("a", preachedOn: "2026-09-13"), item("b", preachedOn: "2026-08-30")]
        let secondPage = [item("c", preachedOn: "2026-08-23"), item("d", preachedOn: "2026-09-01")]

        let groups = SermonDates.groupedByMonth(firstPage + secondPage, locale: enUS)
        #expect(groups.map { $0.items.map(\.sermonId) } == [["a"], ["b", "c"], ["d"]])
        // Earlier groups keep their identity as pages append.
        #expect(SermonDates.groupedByMonth(firstPage, locale: enUS).map(\.id) == Array(groups.map(\.id).prefix(2)))
    }
}

// ---------------------------------------------------------------------------
// The list model
// ---------------------------------------------------------------------------

@Suite("Sermon list")
@MainActor
struct SermonListModelTests {

    @Test("the first page loads unfiltered")
    func firstPage() async {
        let transport = StubTransport([.init(body: page(["s1", "s2"], next: "c2"))])
        let model = sermonModel(transport)

        await model.load()

        #expect(model.phase.items.map(\.sermonId) == ["s1", "s2"])
        #expect(model.nextCursor == "c2")
        let requests = await transport.received
        #expect(query(requests[0]).isEmpty)
    }

    @Test("a server failure is offline, not an empty church")
    func unavailableIsOffline() async {
        let model = sermonModel(StubTransport([unavailable]))
        await model.load()
        #expect(model.phase == .offline)
    }

    @Test("a failed next page keeps its cursor, stops retrying on its own, and retries on a tap")
    func loadMoreFailure() async {
        let transport = StubTransport([
            .init(body: page(["s1", "s2"], next: "c2")),
            unavailable,
            .init(body: page(["s3"])),
        ])
        let model = sermonModel(transport)
        await model.load()

        await model.loadMore()
        #expect(model.loadMoreFailed)
        #expect(model.nextCursor == "c2", "the rest of the list still exists")
        #expect(model.phase.items.map(\.sermonId) == ["s1", "s2"], "what was on screen stays")

        // The last row reappearing must not hammer a failing server.
        await model.loadMore()
        #expect(await transport.requestCount() == 2)

        await model.retryLoadMore()
        #expect(model.loadMoreFailed == false)
        #expect(model.phase.items.map(\.sermonId) == ["s1", "s2", "s3"])
        #expect(model.nextCursor == nil)
        let requests = await transport.received
        #expect(requests.count == 3)
        #expect(query(requests[2])["cursor"] == "c2")
    }

    @Test("clearing the search box brings back the whole list")
    func clearingSearchRestores() async {
        let transport = StubTransport([
            .init(body: page(["s1", "s2", "s3"])),
            .init(body: page(["s2"])),
            .init(body: page(["s1", "s2", "s3"])),
        ])
        let model = sermonModel(transport)
        await model.load()

        model.searchTerm = "hope"
        await model.search(model.searchTerm)
        #expect(model.phase.items.map(\.sermonId) == ["s2"])
        #expect(model.submittedQuery == "hope")

        // Typing more without submitting fetches nothing.
        model.searchTerm = "hop"
        await model.searchTextChanged()
        #expect(await transport.requestCount() == 2)

        model.searchTerm = ""
        await model.searchTextChanged()
        #expect(model.phase.items.map(\.sermonId) == ["s1", "s2", "s3"])
        #expect(model.submittedQuery.isEmpty)
        let requests = await transport.received
        #expect(requests.count == 3)
        #expect(query(requests[1])["q"] == "hope")
        #expect(query(requests[2])["q"] == nil)
    }

    @Test("the next page follows the search that ran, not what has been typed since")
    func loadMoreUsesSubmittedQuery() async {
        let transport = StubTransport([
            .init(body: page(["s1", "s2"], next: "all-2")),
            .init(body: page(["s2"], next: "hope-2")),
            .init(body: page(["s9"])),
        ])
        let model = sermonModel(transport)
        await model.load()
        await model.search("hope")

        model.searchTerm = "hopeful, still typing"
        await model.loadMore()

        #expect(model.phase.items.map(\.sermonId) == ["s2", "s9"])
        let requests = await transport.received
        #expect(query(requests[2]) == ["q": "hope", "cursor": "hope-2"])
    }

    @Test("a slow search answered after it was cleared does not replace the full list")
    func staleSearchIsDropped() async {
        let transport = GatedTransport()
        let model = sermonModel(transport)

        let slowSearch = Task { await model.search("hope") }
        await transport.waitForRequests(1)

        model.searchTerm = ""
        let cleared = Task { await model.searchTextChanged() }
        await transport.waitForRequests(2)

        await transport.respond(to: 1, body: page(["s1", "s2", "s3"]))
        await cleared.value
        await transport.respond(to: 0, body: page(["s2"], next: "hope-2"))
        await slowSearch.value

        #expect(model.phase.items.map(\.sermonId) == ["s1", "s2", "s3"])
        #expect(model.nextCursor == nil, "the stale answer's cursor must not be adopted either")
        #expect(model.submittedQuery.isEmpty)
    }

    @Test("coming back to a fresh list does not ask the server again")
    func loadSkipsWhenFresh() async {
        let transport = StubTransport([
            .init(body: page(["s1"])),
            .init(body: page(["s2"])),
        ])
        let model = sermonModel(transport)
        await model.load()
        await model.load()
        #expect(model.phase.items.map(\.sermonId) == ["s1"])
        #expect(await transport.requestCount() == 1)
    }

    @Test("a list older than five minutes is asked for again")
    func loadRefetchesWhenStale() async {
        var now = Date()
        let transport = StubTransport([
            .init(body: page(["s1"])),
            .init(body: page(["s1", "s0"])),
        ])
        let model = sermonModel(transport, now: { now })
        await model.load()

        now = now.addingTimeInterval(SermonModel.staleAfter)
        await model.load()
        #expect(model.phase.items.map(\.sermonId) == ["s1", "s0"])
        #expect(await transport.requestCount() == 2)
    }

    @Test("a refresh that cannot reach the server keeps the list, marked stale")
    func refreshKeepsListWhenOffline() async {
        let transport = StubTransport([.init(body: page(["s1"]))])
        let model = sermonModel(transport)
        await model.load()
        await model.refresh()
        #expect(model.phase.items.map(\.sermonId) == ["s1"])
        #expect(model.phase.isStale)
    }

    @Test("leaving a screen does not replace a loaded list with offline")
    func cancelledRefreshKeepsList() async {
        let transport = CancelAfterFirstTransport(first: page(["s1"]))
        let model = sermonModel(transport)
        await model.load()
        await model.refresh()
        #expect(model.phase.items.map(\.sermonId) == ["s1"])
        #expect(model.phase != .offline)
        #expect(model.phase.isStale == false)
    }
}

@Suite("Sermon hubs")
struct SermonHubTests {
    @Test("notes and slides for the same sermon become one row")
    func joinsBySermonId() {
        let notes = item("a", preachedOn: "2026-09-13")
        let deck = deck("p1", sermonId: "a", publishedAt: "2026-09-13T15:00:00Z")
        let hubs = SermonHub.merge(notes: [notes], slides: [deck])
        #expect(hubs.count == 1)
        #expect(hubs[0].hasNotes)
        #expect(hubs[0].hasSlides)
        #expect(hubs[0].slides?.presentationId == "p1")
    }

    @Test("a deck without notes still appears")
    func slidesOnly() {
        let deck = deck("p2", sermonId: "b", publishedAt: "2026-09-06T15:00:00Z")
        let hubs = SermonHub.merge(notes: [], slides: [deck])
        #expect(hubs.map(\.sermonId) == ["b"])
        #expect(hubs[0].hasNotes == false)
        #expect(hubs[0].hasSlides)
    }
}

private func deck(
    _ id: String,
    sermonId: String,
    publishedAt: String
) -> PresentationListItem {
    PresentationListItem(
        presentationId: id,
        sermonId: sermonId,
        version: 1,
        title: sermonId,
        publishedAt: publishedAt,
        pageCount: 8,
        contentHash: "h",
        scriptureRefs: [],
        churchSlug: "grace",
        churchName: "Grace",
        churchTimezone: "America/New_York"
    )
}
