import Foundation

/// The rules behind the church info page, kept free of SwiftUI so each one is
/// a plain function a test can call.
///
/// Everything here reads only the approved public projection (`ChurchProfile`)
/// and never invents data: a row, tile or card exists only when the church
/// supplied what it needs.
enum ChurchInfo {

    // MARK: - Identity

    /// The longer about text, falling back to the one-line summary.
    static func aboutText(_ profile: ChurchProfile) -> String? {
        nonBlank(profile.about) ?? nonBlank(profile.publicSummary)
    }

    /// "Baptist · Louisville, KY", leaving out whichever half is missing.
    static func placeLine(_ profile: ChurchProfile) -> String? {
        let place = [nonBlank(profile.city), nonBlank(profile.state)]
            .compactMap { $0 }
            .joined(separator: ", ")
        let parts = [nonBlank(profile.denomination), nonBlank(place)].compactMap { $0 }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    /// A campus address on one line, skipping empty parts rather than showing
    /// stray commas.
    static func addressLine(_ campus: PublicCampus) -> String? {
        let parts = [campus.addressLine1, campus.city, campus.state, campus.postalCode]
            .compactMap(nonBlank)
        return parts.isEmpty ? nil : parts.joined(separator: ", ")
    }

    /// The church's own street address, when it has one, with its town.
    static func churchAddress(_ profile: ChurchProfile) -> String? {
        guard let street = nonBlank(profile.address) else { return nil }
        return [street, profile.city, profile.state, profile.postalCode]
            .compactMap(nonBlank)
            .joined(separator: ", ")
    }

    // MARK: - Service times

    /// `dayOfWeek` is 0-based from Sunday, matching `church_service_times`.
    /// Out-of-range values are clamped rather than trusted as an index.
    static func dayName(_ dayOfWeek: Int) -> String {
        let days = [
            L.sunday, L.monday, L.tuesday, L.wednesday,
            L.thursday, L.friday, L.saturday,
        ]
        return days[min(max(dayOfWeek, 0), 6)]
    }

    /// `HH:mm` or `HH:mm:ss` as hours and minutes, or nil for anything else.
    static func clockTime(_ startTime: String) -> (hour: Int, minute: Int)? {
        let parts = startTime.split(separator: ":", omittingEmptySubsequences: false)
        guard parts.count == 2 || parts.count == 3,
              let hour = Int(parts[0]), let minute = Int(parts[1]),
              (0..<24).contains(hour), (0..<60).contains(minute)
        else { return nil }
        return (hour, minute)
    }

    /// A service time in the reader's own clock style — "9:00 AM" or "09:00".
    ///
    /// The time is the church's wall-clock time, so it is **not** converted:
    /// it is read and written in one fixed zone, and only the formatting
    /// follows the device locale. A value that does not parse is shown as sent
    /// rather than dropped.
    static func formattedTime(_ startTime: String, locale: Locale = .current) -> String {
        guard let clock = clockTime(startTime) else { return startTime }
        let utc = TimeZone(identifier: "UTC") ?? TimeZone(secondsFromGMT: 0)!
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = utc
        guard let date = calendar.date(
            from: DateComponents(year: 2001, month: 1, day: 1, hour: clock.hour, minute: clock.minute)
        ) else { return startTime }

        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = utc
        formatter.dateStyle = .none
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }

    /// "Sunday · 9:00 AM".
    static func serviceLine(_ service: PublicServiceTime, locale: Locale = .current) -> String {
        "\(dayName(service.dayOfWeek)) · \(formattedTime(service.startTime, locale: locale))"
    }

    struct ServiceGroup: Equatable {
        /// The campus name, or nil for times with no heading.
        let title: String?
        let services: [PublicServiceTime]
    }

    /// Service times as the page lists them.
    ///
    /// Church-wide times — no campus, or a campus the profile does not list —
    /// come first with no heading. With more than one campus the rest are
    /// grouped under each campus's name, in the church's campus order; with
    /// one campus a heading would only repeat the church, so they follow on.
    /// Within a group, by day of the week and then time.
    static func serviceGroups(_ profile: ChurchProfile) -> [ServiceGroup] {
        let campusSlugs = Set(profile.campuses.map(\.slug))
        let sorted = profile.serviceTimes.sorted {
            ($0.dayOfWeek, $0.startTime) < ($1.dayOfWeek, $1.startTime)
        }
        let isChurchWide: (PublicServiceTime) -> Bool = {
            $0.campusSlug.isEmpty || !campusSlugs.contains($0.campusSlug)
        }
        let churchWide = sorted.filter(isChurchWide)
        let byCampus = sorted.filter { !isChurchWide($0) }

        if profile.campuses.count > 1 {
            var groups: [ServiceGroup] = churchWide.isEmpty
                ? []
                : [ServiceGroup(title: nil, services: churchWide)]
            for campus in profile.campuses {
                let services = byCampus.filter { $0.campusSlug == campus.slug }
                if !services.isEmpty {
                    groups.append(ServiceGroup(title: campus.name, services: services))
                }
            }
            return groups
        }

        let all = churchWide + byCampus
        return all.isEmpty ? [] : [ServiceGroup(title: nil, services: all)]
    }

    struct NextService: Equatable {
        let service: PublicServiceTime
        /// The next start, as an instant.
        let startsAt: Date
        /// Whole calendar days from today to that start, counted in the
        /// church's own zone: 0 is today, 1 tomorrow.
        let daysUntil: Int
    }

    /// The soonest service that has not started yet.
    ///
    /// Service times are wall-clock times in the church's zone, so "today" and
    /// the day of the week are that zone's, not the reader's. A service that
    /// already started today is next week's. Ties go to the one listed first.
    static func nextService(
        _ services: [PublicServiceTime],
        timeZone: TimeZone,
        now: Date
    ) -> NextService? {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let today = calendar.startOfDay(for: now)
        let todayIndex = calendar.component(.weekday, from: now) - 1 // 0 = Sunday

        var best: NextService?
        for service in services {
            guard (0...6).contains(service.dayOfWeek),
                  let clock = clockTime(service.startTime)
            else { continue }

            func start(daysAhead: Int) -> Date? {
                guard let day = calendar.date(byAdding: .day, value: daysAhead, to: today) else {
                    return nil
                }
                return calendar.date(bySettingHour: clock.hour, minute: clock.minute, second: 0, of: day)
            }

            var daysAhead = (service.dayOfWeek - todayIndex + 7) % 7
            guard var startsAt = start(daysAhead: daysAhead) else { continue }
            if startsAt <= now {
                daysAhead += 7
                guard let nextWeek = start(daysAhead: daysAhead) else { continue }
                startsAt = nextWeek
            }
            if best.map({ startsAt < $0.startsAt }) ?? true {
                best = NextService(service: service, startsAt: startsAt, daysUntil: daysAhead)
            }
        }
        return best
    }

    /// "Today", "Tomorrow", "In 3 days".
    static func relativeDay(_ daysUntil: Int) -> String {
        switch daysUntil {
        case ..<1: return L.today
        case 1: return L.tomorrow
        default: return String(format: L.inDays, daysUntil)
        }
    }

    // MARK: - Links the page opens
    //
    // Only schemes this file builds itself are ever opened: http(s) from the
    // server, and tel, mailto and Apple Maps constructed here.

    /// A server-supplied web address, if it really is one.
    ///
    /// The server sends absolute http(s) URLs; an older record with no scheme
    /// at all is read as https. Anything else — `javascript:`, `mailto:`, a
    /// custom scheme, credentials in the address, no host — is refused.
    static func webURL(_ raw: String?) -> URL? {
        guard var value = nonBlank(raw) else { return nil }
        let hasScheme = value.range(of: #"^[A-Za-z][A-Za-z0-9+.\-]*:"#, options: .regularExpression) != nil
        if !hasScheme { value = "https://" + value }
        guard let url = URL(string: value),
              let scheme = url.scheme?.lowercased(),
              scheme == "https" || scheme == "http",
              let host = url.host, !host.isEmpty,
              url.user == nil, url.password == nil
        else { return nil }
        return url
    }

    /// `tel:` with digits and a leading-or-anywhere `+` only.
    static func phoneURL(_ phone: String?) -> URL? {
        guard let phone else { return nil }
        let dialable = phone.filter { $0.isASCII && ($0.isNumber || $0 == "+") }
        guard dialable.contains(where: \.isNumber) else { return nil }
        return URL(string: "tel:\(dialable)")
    }

    static func emailURL(_ email: String?) -> URL? {
        guard let email = nonBlank(email),
              email.contains("@"),
              !email.contains(where: { $0.isWhitespace || $0 == "?" || $0 == "&" })
        else { return nil }
        return URL(string: "mailto:\(email)")
    }

    /// Apple Maps, searching for an address.
    static func mapsURL(query: String) -> URL? {
        URL(string: "https://maps.apple.com/?q=\(encoded(query))")
    }

    /// Directions to a campus: its coordinates when it has them, labelled with
    /// its name; otherwise its address.
    static func directionsURL(for campus: PublicCampus) -> URL? {
        if let latitude = campus.latitude, let longitude = campus.longitude,
           latitude.isFinite, longitude.isFinite {
            return URL(
                string: "https://maps.apple.com/?ll=\(latitude),\(longitude)&q=\(encoded(campus.name))"
            )
        }
        return addressLine(campus).flatMap(mapsURL(query:))
    }

    /// Directions to the church: the church's own maps link first, then its
    /// address, then its main campus, then any campus that can be found.
    static func directionsURL(_ profile: ChurchProfile) -> URL? {
        if let chosen = webURL(profile.mapsUrl) { return chosen }
        if let address = churchAddress(profile), let url = mapsURL(query: address) { return url }
        let campuses = profile.campuses.filter(\.isPrimary) + profile.campuses.filter { !$0.isPrimary }
        return campuses.lazy.compactMap(directionsURL(for:)).first
    }

    // MARK: - Quick actions

    enum QuickActionKind: String, CaseIterable, Sendable {
        case directions, call, email, website

        var title: String {
            switch self {
            case .directions: return L.actionDirections
            case .call: return L.actionCall
            case .email: return L.actionEmail
            case .website: return L.actionWebsite
            }
        }

        var symbol: String {
            switch self {
            case .directions: return "arrow.triangle.turn.up.right.diamond.fill"
            case .call: return "phone.fill"
            case .email: return "envelope.fill"
            case .website: return "safari.fill"
            }
        }
    }

    struct QuickAction: Equatable, Identifiable {
        let kind: QuickActionKind
        let url: URL
        var id: QuickActionKind { kind }
    }

    /// Up to four, in a fixed order, each only when the church has the data.
    static func quickActions(_ profile: ChurchProfile) -> [QuickAction] {
        [
            directionsURL(profile).map { QuickAction(kind: .directions, url: $0) },
            phoneURL(profile.phone).map { QuickAction(kind: .call, url: $0) },
            emailURL(profile.email).map { QuickAction(kind: .email, url: $0) },
            webURL(profile.website).map { QuickAction(kind: .website, url: $0) },
        ].compactMap { $0 }
    }

    // MARK: - Contact

    struct ContactRow: Equatable, Identifiable {
        let label: String
        let value: String
        let symbol: String
        let url: URL
        var id: String { symbol }
    }

    static func contactRows(_ profile: ChurchProfile) -> [ContactRow] {
        var rows: [ContactRow] = []
        if let phone = nonBlank(profile.phone), let url = phoneURL(phone) {
            rows.append(ContactRow(label: L.phoneLabel, value: phone, symbol: "phone.fill", url: url))
        }
        if let email = nonBlank(profile.email), let url = emailURL(email) {
            rows.append(ContactRow(label: L.emailLabel, value: email, symbol: "envelope.fill", url: url))
        }
        if let url = webURL(profile.website) {
            rows.append(
                ContactRow(label: L.websiteLabel, value: displayAddress(url), symbol: "globe", url: url)
            )
        }
        return rows
    }

    /// "grace.org/visit" rather than "https://www.grace.org/visit/".
    static func displayAddress(_ url: URL) -> String {
        var path = url.path
        while path.hasSuffix("/") { path.removeLast() }
        return host(of: url) + path
    }

    /// The host people recognise, without a leading "www.".
    static func host(of url: URL) -> String {
        let host = url.host ?? url.absoluteString
        return host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
    }

    // MARK: - Social profiles and links

    struct SocialStyle: Equatable {
        let title: String
        /// A system glyph — never a trademarked logo asset.
        let symbol: String
        /// The platform's colour; nil means the church's own accent.
        let colorHex: String?
    }

    static func socialStyle(_ platform: String) -> SocialStyle {
        switch platform.lowercased() {
        case "instagram": return SocialStyle(title: L.socialInstagram, symbol: "camera", colorHex: "#E1306C")
        case "facebook": return SocialStyle(title: L.socialFacebook, symbol: "person.2.fill", colorHex: "#1877F2")
        case "youtube": return SocialStyle(title: L.socialYoutube, symbol: "play.rectangle.fill", colorHex: "#FF0000")
        case "tiktok": return SocialStyle(title: L.socialTiktok, symbol: "music.note", colorHex: "#111111")
        case "x": return SocialStyle(title: L.socialX, symbol: "at", colorHex: "#111111")
        case "podcast": return SocialStyle(title: L.socialPodcast, symbol: "mic.fill", colorHex: "#8E44EF")
        default: return SocialStyle(title: L.socialLink, symbol: "link", colorHex: nil)
        }
    }

    struct SocialItem: Equatable, Identifiable {
        let style: SocialStyle
        let url: URL
        let index: Int
        var id: Int { index }
    }

    /// The church's order, keeping only links that are real web addresses.
    static func socialItems(_ profile: ChurchProfile) -> [SocialItem] {
        (profile.socialLinks ?? []).enumerated().compactMap { index, link in
            webURL(link.url).map { SocialItem(style: socialStyle(link.platform), url: $0, index: index) }
        }
    }

    struct QuickLinkItem: Equatable, Identifiable {
        let label: String
        let host: String
        let url: URL
        let index: Int
        var id: Int { index }
    }

    static func quickLinkItems(_ profile: ChurchProfile) -> [QuickLinkItem] {
        (profile.quickLinks ?? []).enumerated().compactMap { index, link in
            guard let label = nonBlank(link.label), let url = webURL(link.url) else { return nil }
            return QuickLinkItem(label: label, host: host(of: url), url: url, index: index)
        }
    }

    // MARK: -

    static func nonBlank(_ value: String?) -> String? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines),
              !trimmed.isEmpty
        else { return nil }
        return trimmed
    }

    /// Percent-encodes a query value with the unreserved set only, so `+`,
    /// `&` and `#` in an address cannot change what Maps is asked.
    private static func encoded(_ value: String) -> String {
        let unreserved = CharacterSet(
            charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
        )
        return value.addingPercentEncoding(withAllowedCharacters: unreserved) ?? ""
    }
}
