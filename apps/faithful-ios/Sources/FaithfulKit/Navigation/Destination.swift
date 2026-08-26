import Foundation

/// Every place the app can go.
///
/// The full information architecture is declared here so later prompts add a
/// *screen* rather than restructuring the app root. A destination existing in
/// this enum says nothing about whether it is reachable: `RouteRegistry`
/// decides that, and anything unregistered is simply not offered.
public enum Destination: Hashable, Sendable {
    case home
    case churchDiscovery
    case church(slug: String)
    case announcements(churchSlug: String)
    case watch(churchSlug: String)
    case sermonArchive(churchSlug: String)
    case give(churchSlug: String)
    /// The check-in scanner (Prompt 8).
    ///
    /// **Arriving here starts nothing.** The screen opens idle, with the camera
    /// untouched and the typed-code field ready; the camera is requested only if
    /// the person then taps "Scan the code". A deep link that could raise a
    /// camera prompt would be a permission request triggered by whoever sent
    /// the link, which is exactly the shape this app refuses everywhere else.
    case checkIn(churchSlug: String)
    case account
    case accountPrivacy

    /// The capability key the server must report before this is reachable.
    /// Mirrors `ENABLED_CAPABILITIES` in `lib/mobile/v1/account-service.ts`.
    public var requiredCapability: String {
        switch self {
        case .home, .account, .accountPrivacy: return "account"
        case .churchDiscovery, .church: return "discovery"
        case .announcements: return "announcements"
        case .watch: return "watch"
        case .sermonArchive: return "sermons"
        case .give: return "giving"
        case .checkIn: return "attendance"
        }
    }

    public var requiresAuthentication: Bool {
        switch self {
        case .churchDiscovery, .church: return false
        default: return true
        }
    }

    /// The church this destination belongs to, if any. Used to check the
    /// relationship before navigating rather than after rendering.
    public var churchSlug: String? {
        switch self {
        case let .church(slug),
             let .announcements(slug),
             let .watch(slug),
             let .sermonArchive(slug),
             let .give(slug),
             let .checkIn(slug):
            return slug
        case .home, .churchDiscovery, .account, .accountPrivacy:
            return nil
        }
    }
}

/// Parses `faithful://` links into typed destinations.
///
/// Anything unrecognised returns nil rather than a best guess: an unknown link
/// must fail closed, because a link is untrusted input that arrives before the
/// app has decided anything about the person holding it.
public enum DeepLinkParser {
    public static let scheme = "faithful"

    private static let slugPattern = try! NSRegularExpression(
        pattern: "^[a-z0-9][a-z0-9-]{0,119}$"
    )

    public static func parse(_ url: URL) -> Destination? {
        guard url.scheme?.lowercased() == scheme else { return nil }

        // host + path, tolerating both faithful://church/x and faithful:///church/x
        var segments = [url.host, url.path]
            .compactMap { $0 }
            .joined(separator: "/")
            .split(separator: "/")
            .map(String.init)
            .filter { !$0.isEmpty }

        guard !segments.isEmpty else { return nil }
        let root = segments.removeFirst().lowercased()

        func slug() -> String? {
            guard let raw = segments.first, isValidSlug(raw) else { return nil }
            return raw
        }

        switch root {
        case "home": return segments.isEmpty ? .home : nil
        case "discover": return segments.isEmpty ? .churchDiscovery : nil
        case "account":
            if segments.isEmpty { return .account }
            return segments == ["privacy"] ? .accountPrivacy : nil
        case "church":
            guard let churchSlug = slug() else { return nil }
            let rest = Array(segments.dropFirst())
            if rest.isEmpty { return .church(slug: churchSlug) }
            guard rest.count == 1 else { return nil }
            switch rest[0].lowercased() {
            case "announcements": return .announcements(churchSlug: churchSlug)
            case "watch": return .watch(churchSlug: churchSlug)
            case "sermons": return .sermonArchive(churchSlug: churchSlug)
            case "give": return .give(churchSlug: churchSlug)
            case "check-in": return .checkIn(churchSlug: churchSlug)
            default: return nil
            }
        default:
            return nil
        }
    }

    static func isValidSlug(_ value: String) -> Bool {
        let range = NSRange(value.startIndex..., in: value)
        return slugPattern.firstMatch(in: value, range: range) != nil
    }
}
