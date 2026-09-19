import Foundation
import Testing
@testable import FaithFormKit

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
    api(transport: StubTransport(exchanges))
}

private func api(transport: StubTransport) -> APIClient {
    APIClient(
        configuration: .init(
            environment: APIEnvironment(key: "test", baseURL: URL(string: "https://example.invalid")!),
            clientBuild: 7
        ),
        transport: transport,
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

    @Test("the page offers exactly one action, first match wins")
    func actionTable() {
        func action(_ policy: JoinPolicy, _ state: RelationshipState?, other: Bool) -> ChurchAction {
            ChurchProfileModel.action(for: profile(joinPolicy: policy, relationship: state), hasOtherChurch: other)
        }

        // Blocked beats everything, including an invitation and another church.
        for policy in [JoinPolicy.open, .approvalRequired, .inviteOnly] {
            for other in [false, true] {
                #expect(action(policy, .blocked, other: other) == .unavailable)
            }
        }

        // Following, pending and joined are all "your church" — no follow,
        // join or leave any more — whatever the policy.
        for state in [RelationshipState.following, .pending, .joined] {
            for policy in [JoinPolicy.open, .approvalRequired, .inviteOnly] {
                #expect(action(policy, state, other: false) == .current)
                #expect(action(policy, state, other: true) == .current)
            }
        }

        // No relationship: left, an unrecognised state, and none at all.
        for state in [RelationshipState.left, .unknown("archived"), nil] {
            #expect(action(.inviteOnly, state, other: false) == .invitationRequired)
            #expect(action(.inviteOnly, state, other: true) == .invitationRequired)
            #expect(action(.open, state, other: false) == .add)
            #expect(action(.approvalRequired, state, other: false) == .add)
            #expect(action(.unknown("new_policy"), state, other: false) == .add)
            #expect(action(.open, state, other: true) == .replace)
            #expect(action(.approvalRequired, state, other: true) == .replace)
        }
    }

    @Test("adding a church posts once, then re-reads the profile")
    func addPostsAndRefreshes() async throws {
        let transport = StubTransport([
            .init(status: 200, body: envelope(#"{"churchSlug":"grace","state":"following"}"#)),
            .init(status: 200, body: envelope(profileJSON(joinPolicy: "open", relationship: "following"))),
        ])
        let model = ChurchProfileModel(api: api(transport: transport), cache: PartitionedCache())

        let added = await model.add(slug: "grace")

        #expect(added)
        #expect(model.actionError == nil)
        #expect(!model.isActing)
        let sent = await transport.received
        #expect(sent.count == 2)
        #expect(sent.first?.httpMethod == "POST")
        #expect(sent.first?.url?.path == "/api/mobile/v1/churches/grace/follow")
        #expect(sent.contains { $0.url?.path.hasSuffix("/join") == true } == false)
        guard case let .loaded(loaded) = model.phase else {
            Issue.record("expected the re-read profile, got \(model.phase)")
            return
        }
        #expect(loaded.relationshipState == .following)
    }

    @Test("removing a church deletes it and does not re-read a page that may be gone")
    func removeDeletes() async {
        let transport = StubTransport([
            .init(status: 200, body: envelope(#"{"churchSlug":"grace","state":"left"}"#)),
        ])
        let model = ChurchProfileModel(api: api(transport: transport), cache: PartitionedCache())

        #expect(await model.remove(slug: "grace"))
        let sent = await transport.received
        #expect(sent.count == 1)
        #expect(sent.first?.httpMethod == "DELETE")
        #expect(sent.first?.url?.path == "/api/mobile/v1/churches/grace/follow")
    }

    @Test("a refused add reports the server's sentence and returns false")
    func addFailureIsInline() async {
        let refused = Data("""
        {"ok":false,"error":{"code":"blocked","message":"This church is not available to you.","retryable":false},"meta":{"apiVersion":"2026-08-24","apiMajor":1,"requestId":"r-9","minimumSupportedClientBuild":1}}
        """.utf8)
        let model = ChurchProfileModel(api: api([.init(status: 403, body: refused)]), cache: PartitionedCache())

        #expect(await model.add(slug: "grace") == false)
        #expect(model.actionError != nil)
        #expect(!model.isActing)
    }

    @Test("the new profile fields decode, and older payloads without them still do")
    func decodesChurchInfoFields() throws {
        let withInfo = """
        {"slug":"grace","name":"Grace","logoUrl":null,"coverImageUrl":null,"publicSummary":null,
        "tagline":null,"denomination":null,"address":null,"city":null,"state":null,"postalCode":null,
        "website":null,"phone":null,"email":null,"joinPolicy":"open","timezone":"UTC",
        "publicProfileVersion":3,"campuses":[],"serviceTimes":[],"relationshipState":null,
        "about":"We gather downtown.","mapsUrl":"https://maps.example/grace",
        "socialLinks":[{"platform":"instagram","url":"https://instagram.com/grace"}],
        "quickLinks":[{"label":"Plan a visit","url":"https://grace.example/visit"}]}
        """
        let decoded = try JSONDecoder.faithform.decode(
            MobileSuccess<ChurchProfile>.self, from: envelope(withInfo)
        ).data
        #expect(decoded.about == "We gather downtown.")
        #expect(decoded.socialLinks?.first?.platform == "instagram")
        #expect(decoded.quickLinks?.first?.label == "Plan a visit")

        let older = try JSONDecoder.faithform.decode(
            MobileSuccess<ChurchProfile>.self, from: envelope(profileJSON(joinPolicy: "open"))
        ).data
        #expect(older.socialLinks == nil)
        #expect(older.about == nil)
    }

    @Test("a cached profile renders offline, and a failure does not discard it")
    func offlineUsesCache() async {
        let cache = PartitionedCache()
        let part = partition()
        let cached = try! JSONDecoder.faithform.decode(
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

@Suite("Church info page rules")
struct ChurchInfoRuleTests {

    private func service(
        _ day: Int, _ time: String, _ label: String = "Worship", campus: String = ""
    ) -> PublicServiceTime {
        PublicServiceTime(campusSlug: campus, label: label, dayOfWeek: day, startTime: time, kind: "regular")
    }

    private func campus(
        _ slug: String, _ name: String, primary: Bool = false,
        address: String? = nil, latitude: Double? = nil, longitude: Double? = nil
    ) -> PublicCampus {
        PublicCampus(
            slug: slug, name: name, addressLine1: address, city: address == nil ? nil : "Louisville",
            state: address == nil ? nil : "KY", postalCode: nil,
            latitude: latitude, longitude: longitude, timezone: "America/New_York", isPrimary: primary
        )
    }

    private func info(
        campuses: [PublicCampus] = [],
        services: [PublicServiceTime] = [],
        address: String? = nil,
        website: String? = nil,
        phone: String? = nil,
        email: String? = nil,
        about: String? = nil,
        summary: String? = nil,
        mapsUrl: String? = nil,
        social: [ChurchSocialLink]? = nil,
        links: [ChurchQuickLink]? = nil,
        denomination: String? = nil,
        city: String? = nil,
        state: String? = nil
    ) -> ChurchProfile {
        ChurchProfile(
            slug: "grace", name: "Grace", publicSummary: summary, denomination: denomination,
            address: address, city: city, state: state, postalCode: nil,
            website: website, phone: phone, email: email, joinPolicy: .open,
            timezone: "America/New_York", publicProfileVersion: 1,
            campuses: campuses, serviceTimes: services,
            about: about, mapsUrl: mapsUrl, socialLinks: social, quickLinks: links
        )
    }

    /// The system writes "9:00 AM" with a narrow no-break space.
    private func plain(_ text: String) -> String {
        text.replacingOccurrences(of: "\u{202F}", with: " ").replacingOccurrences(of: "\u{00A0}", with: " ")
    }

    // MARK: Times

    @Test("service times follow the reader's clock style without converting zones")
    func timeFormatting() {
        let us = Locale(identifier: "en_US")
        let uk = Locale(identifier: "en_GB")
        #expect(plain(ChurchInfo.formattedTime("09:00:00", locale: us)) == "9:00 AM")
        #expect(plain(ChurchInfo.formattedTime("18:30", locale: us)) == "6:30 PM")
        #expect(ChurchInfo.formattedTime("09:00:00", locale: uk) == "09:00")
        #expect(ChurchInfo.formattedTime("18:30", locale: uk) == "18:30")
        // Whatever the device's own zone, midnight stays midnight.
        #expect(ChurchInfo.formattedTime("00:00", locale: uk) == "00:00")
        // Nonsense is shown as sent rather than dropped or guessed at.
        #expect(ChurchInfo.formattedTime("soon", locale: us) == "soon")
        #expect(ChurchInfo.formattedTime("25:00", locale: us) == "25:00")
    }

    @Test("a service line names the day and the time, and clamps a bad day")
    func serviceLine() {
        let line = plain(ChurchInfo.serviceLine(service(0, "10:00:00"), locale: Locale(identifier: "en_US")))
        #expect(line == "Sunday · 10:00 AM")
        #expect(ChurchInfo.serviceLine(service(99, "10:00"), locale: Locale(identifier: "en_GB")) == "Saturday · 10:00")
        #expect(ChurchInfo.serviceLine(service(-3, "10:00"), locale: Locale(identifier: "en_GB")) == "Sunday · 10:00")
    }

    @Test("church-wide times come first; more than one campus groups the rest")
    func serviceGroups() {
        let east = campus("east", "East")
        let west = campus("west", "West")
        let services = [
            service(0, "11:00", campus: "west"),
            service(3, "19:00", "Midweek"),
            service(0, "09:00", campus: "east"),
            service(0, "08:00", "Prayer", campus: "gone"), // a campus no longer listed
        ]

        let grouped = ChurchInfo.serviceGroups(info(campuses: [east, west], services: services))
        #expect(grouped.map(\.title) == [nil, "East", "West"])
        #expect(grouped[0].services.map(\.label) == ["Prayer", "Midweek"], "church-wide, by day then time")
        #expect(grouped[1].services.map(\.startTime) == ["09:00"])
        #expect(grouped[2].services.map(\.startTime) == ["11:00"])

        // One campus: a heading would only repeat the church.
        let single = ChurchInfo.serviceGroups(info(campuses: [east], services: [
            service(0, "09:00", campus: "east"), service(3, "19:00", "Midweek"),
        ]))
        #expect(single.count == 1)
        #expect(single[0].title == nil)
        #expect(single[0].services.map(\.label) == ["Midweek", "Worship"])

        #expect(ChurchInfo.serviceGroups(info()).isEmpty)
    }

    // MARK: Next service

    private let newYork = TimeZone(identifier: "America/New_York")!

    /// A wall-clock moment in New York.
    private func newYorkTime(_ year: Int, _ month: Int, _ day: Int, _ hour: Int, _ minute: Int = 0) -> Date {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = newYork
        return calendar.date(from: DateComponents(year: year, month: month, day: day, hour: hour, minute: minute))!
    }

    @Test("the next service is the soonest one that has not started, in the church's zone")
    func nextService() throws {
        // Sunday 7 September 2025, 08:00 in New York.
        let sundayMorning = newYorkTime(2025, 9, 7, 8)
        let services = [
            service(3, "19:00", "Midweek"),
            service(0, "10:00", "Morning"),
            service(0, "07:00", "Early"),
        ]

        let next = try #require(ChurchInfo.nextService(services, timeZone: newYork, now: sundayMorning))
        #expect(next.service.label == "Morning")
        #expect(next.daysUntil == 0)
        #expect(next.startsAt == newYorkTime(2025, 9, 7, 10))

        // After the last Sunday service: Wednesday, in three days.
        let sundayNight = newYorkTime(2025, 9, 7, 21)
        let midweek = try #require(ChurchInfo.nextService(services, timeZone: newYork, now: sundayNight))
        #expect(midweek.service.label == "Midweek")
        #expect(midweek.daysUntil == 3)

        // Tuesday evening: Wednesday is tomorrow.
        let tuesday = newYorkTime(2025, 9, 9, 20)
        #expect(ChurchInfo.nextService(services, timeZone: newYork, now: tuesday)?.daysUntil == 1)

        // A single weekly service that already started today is next week's.
        let onlySunday = [service(0, "10:00")]
        let afterIt = newYorkTime(2025, 9, 7, 10, 30)
        #expect(ChurchInfo.nextService(onlySunday, timeZone: newYork, now: afterIt)?.daysUntil == 7)
    }

    @Test("today is the church's today, not the reader's")
    func nextServiceUsesChurchZone() throws {
        // Saturday 22:00 in New York is already Sunday 02:00 in UTC.
        let saturdayNight = newYorkTime(2025, 9, 6, 22)
        let sunday = [service(0, "09:00")]

        let inChurchZone = try #require(ChurchInfo.nextService(sunday, timeZone: newYork, now: saturdayNight))
        #expect(inChurchZone.daysUntil == 1)
        #expect(inChurchZone.startsAt == newYorkTime(2025, 9, 7, 9))

        let utc = TimeZone(identifier: "UTC")!
        #expect(ChurchInfo.nextService(sunday, timeZone: utc, now: saturdayNight)?.daysUntil == 0)
    }

    @Test("no parseable service means no next service")
    func nextServiceNeedsData() {
        #expect(ChurchInfo.nextService([], timeZone: newYork, now: Date()) == nil)
        #expect(ChurchInfo.nextService([service(9, "10:00"), service(0, "later")], timeZone: newYork, now: Date()) == nil)
    }

    @Test("relative days read naturally")
    func relativeDays() {
        #expect(ChurchInfo.relativeDay(0) == "Today")
        #expect(ChurchInfo.relativeDay(1) == "Tomorrow")
        #expect(ChurchInfo.relativeDay(3) == "In 3 days")
        #expect(ChurchInfo.relativeDay(7) == "In 7 days")
    }

    // MARK: Quick actions and links

    @Test("quick actions appear only with data, in a fixed order")
    func quickActions() {
        #expect(ChurchInfo.quickActions(info()).isEmpty)

        let everything = ChurchInfo.quickActions(info(
            address: "1 Main St", website: "https://grace.example",
            phone: "+1 (502) 555-0134", email: "hello@grace.example"
        ))
        #expect(everything.map(\.kind) == [.directions, .call, .email, .website])
        #expect(everything[1].url.absoluteString == "tel:+15025550134")
        #expect(everything[2].url.absoluteString == "mailto:hello@grace.example")
        #expect(everything[3].url.absoluteString == "https://grace.example")

        let phoneOnly = ChurchInfo.quickActions(info(phone: "502.555.0134"))
        #expect(phoneOnly.map(\.kind) == [.call])
        #expect(phoneOnly[0].url.absoluteString == "tel:5025550134")
    }

    @Test("directions prefer the church's own maps link, then its address, then a campus")
    func directions() throws {
        let chosen = ChurchInfo.directionsURL(info(address: "1 Main St", mapsUrl: "https://maps.example/grace"))
        #expect(chosen?.absoluteString == "https://maps.example/grace")

        let address = try #require(ChurchInfo.directionsURL(info(address: "1 Main St & 2nd", city: "Louisville", state: "KY")))
        #expect(address.absoluteString == "https://maps.apple.com/?q=1%20Main%20St%20%26%202nd%2C%20Louisville%2C%20KY")

        // No church address: the main campus, by coordinates when it has them.
        let viaCampus = ChurchInfo.directionsURL(info(campuses: [
            campus("west", "West", address: "9 Oak Ave"),
            campus("east", "East Campus", primary: true, latitude: 38.25, longitude: -85.75),
        ]))
        #expect(viaCampus?.absoluteString == "https://maps.apple.com/?ll=38.25,-85.75&q=East%20Campus")

        // A campus with neither address nor coordinates gives nothing to open.
        #expect(ChurchInfo.directionsURL(info(campuses: [campus("x", "X")])) == nil)
        // A town alone is not an address to navigate to.
        #expect(ChurchInfo.directionsURL(info(city: "Louisville", state: "KY")) == nil)
    }

    @Test("only web addresses the app understands are ever opened")
    func urlSafety() {
        #expect(ChurchInfo.webURL("javascript:alert(1)") == nil)
        #expect(ChurchInfo.webURL("ftp://grace.example") == nil)
        #expect(ChurchInfo.webURL("faithform://church/grace") == nil)
        #expect(ChurchInfo.webURL("mailto:x@y.example") == nil)
        #expect(ChurchInfo.webURL("https://user:secret@grace.example") == nil)
        #expect(ChurchInfo.webURL("https://") == nil)
        #expect(ChurchInfo.webURL("   ") == nil)
        #expect(ChurchInfo.webURL("grace.example")?.absoluteString == "https://grace.example")
        #expect(ChurchInfo.webURL("http://grace.example/a")?.absoluteString == "http://grace.example/a")
        #expect(ChurchInfo.phoneURL("call us") == nil)
        #expect(ChurchInfo.emailURL("not-an-email") == nil)
        #expect(ChurchInfo.emailURL("a@b.example?bcc=x@y.example") == nil)
    }

    @Test("social profiles map to a name, a system glyph and a colour; the rest are links")
    func socialStyles() {
        let expected: [(String, String, String, String?)] = [
            ("instagram", "Instagram", "camera", "#E1306C"),
            ("facebook", "Facebook", "person.2.fill", "#1877F2"),
            ("youtube", "YouTube", "play.rectangle.fill", "#FF0000"),
            ("tiktok", "TikTok", "music.note", "#111111"),
            ("x", "X", "at", "#111111"),
            ("podcast", "Podcast", "mic.fill", "#8E44EF"),
            ("mastodon", "Link", "link", nil),
            ("", "Link", "link", nil),
        ]
        for (platform, title, symbol, color) in expected {
            let style = ChurchInfo.socialStyle(platform)
            #expect(style.title == title, "\(platform)")
            #expect(style.symbol == symbol, "\(platform)")
            #expect(style.colorHex == color, "\(platform)")
        }

        let items = ChurchInfo.socialItems(info(social: [
            ChurchSocialLink(platform: "youtube", url: "https://youtube.com/@grace"),
            ChurchSocialLink(platform: "instagram", url: "javascript:void(0)"),
            ChurchSocialLink(platform: "facebook", url: "https://facebook.com/grace"),
        ]))
        #expect(items.map(\.style.title) == ["YouTube", "Facebook"], "the church's order, unsafe links dropped")
    }

    @Test("quick links show the host people recognise")
    func quickLinks() {
        let items = ChurchInfo.quickLinkItems(info(links: [
            ChurchQuickLink(label: "Plan a visit", url: "https://www.grace.example/visit"),
            ChurchQuickLink(label: "  ", url: "https://grace.example/blank"),
            ChurchQuickLink(label: "Bad", url: "mailto:x@y.example"),
        ]))
        #expect(items.count == 1)
        #expect(items[0].label == "Plan a visit")
        #expect(items[0].host == "grace.example")
    }

    @Test("contact rows list phone, email and website, each tappable")
    func contactRows() {
        let rows = ChurchInfo.contactRows(info(
            website: "https://www.grace.example/", phone: "(502) 555-0134", email: "hello@grace.example"
        ))
        #expect(rows.map(\.label) == [L.phoneLabel, L.emailLabel, L.websiteLabel])
        #expect(rows[0].value == "(502) 555-0134")
        #expect(rows[0].url.absoluteString == "tel:5025550134")
        #expect(rows[2].value == "grace.example")
        #expect(ChurchInfo.contactRows(info()).isEmpty)
    }

    // MARK: Identity

    @Test("about falls back to the summary, and blank is nothing")
    func aboutText() {
        #expect(ChurchInfo.aboutText(info(about: "Long story", summary: "Short")) == "Long story")
        #expect(ChurchInfo.aboutText(info(about: "  ", summary: "Short")) == "Short")
        #expect(ChurchInfo.aboutText(info(about: nil, summary: "")) == nil)
    }

    @Test("the place line leaves out whatever is missing")
    func placeLine() {
        #expect(ChurchInfo.placeLine(info(denomination: "Baptist", city: "Louisville", state: "KY")) == "Baptist · Louisville, KY")
        #expect(ChurchInfo.placeLine(info(city: "Louisville")) == "Louisville")
        #expect(ChurchInfo.placeLine(info(denomination: "Baptist")) == "Baptist")
        #expect(ChurchInfo.placeLine(info()) == nil)
    }

    @Test("an address line skips empty parts rather than showing stray commas")
    func addressLine() {
        let full = PublicCampus(
            slug: "east", name: "East", addressLine1: "1 Main St", city: "Louisville",
            state: "KY", postalCode: "40202", latitude: nil, longitude: nil,
            timezone: "UTC", isPrimary: true
        )
        #expect(ChurchInfo.addressLine(full) == "1 Main St, Louisville, KY, 40202")

        let empty = PublicCampus(
            slug: "e", name: "E", addressLine1: nil, city: "", state: nil,
            postalCode: nil, latitude: nil, longitude: nil, timezone: "UTC", isPrimary: false
        )
        #expect(ChurchInfo.addressLine(empty) == nil)
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
            from: ["faithform": ["deepLink": "faithform://church/grace/announcements"]],
            registry: registry,
            session: session
        )
        #expect(allowed == .allowed(.announcements(churchSlug: "grace")))

        // A church the account has no relationship with is refused, even though
        // the notification arrived.
        let wrongChurch = NotificationRouting.destination(
            from: ["faithform": ["deepLink": "faithform://church/someone-else/announcements"]],
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
                from: ["faithform": ["deepLink": "https://evil.invalid/church/grace"]],
                registry: registry,
                session: session
            ) == .rejected(.notImplemented)
        )
    }
}
