import Foundation

/// Why a destination could not be opened. Each case has a distinct, honest
/// response — an unimplemented feature is not the same as a refused one.
public enum RouteRejection: Equatable, Sendable {
    case notImplemented
    case requiresSignIn
    case capabilityUnavailable
    case noRelationship
    case blocked
}

public enum RouteResolution: Equatable, Sendable {
    case allowed(Destination)
    case rejected(RouteRejection)
}

/// Decides what is actually reachable right now.
///
/// A destination must clear four independent gates: a screen is registered for
/// it, the server reports its capability, the session state permits it, and —
/// for church-scoped destinations — the account holds a usable relationship
/// with that church. This is what keeps an unfinished feature from appearing
/// and what stops a crafted deep link from opening something it should not.
public struct RouteRegistry: Sendable {
    public struct SessionSnapshot: Sendable {
        public let isAuthenticated: Bool
        public let capabilities: Set<String>
        /// Church slug → whether that relationship currently permits reading.
        public let churchAccess: [String: Bool]
        public let blockedChurches: Set<String>

        public init(
            isAuthenticated: Bool,
            capabilities: Set<String>,
            churchAccess: [String: Bool] = [:],
            blockedChurches: Set<String> = []
        ) {
            self.isAuthenticated = isAuthenticated
            self.capabilities = capabilities
            self.churchAccess = churchAccess
            self.blockedChurches = blockedChurches
        }
    }

    private let implemented: Set<String>

    /// Prompt 4 implements exactly two screens. Later prompts register theirs;
    /// until then, those destinations resolve to `.notImplemented` and the UI
    /// never offers them.
    public init(implemented: Set<Destination> = [.home, .account]) {
        self.implemented = Set(implemented.map(Self.identity))
    }

    static func identity(_ destination: Destination) -> String {
        switch destination {
        case .home: return "home"
        case .churchDiscovery: return "discover"
        case .church: return "church"
        case .announcements: return "announcements"
        case .watch: return "watch"
        case .sermonArchive: return "sermons"
        case .give: return "give"
        case .checkIn: return "checkIn"
        case .account: return "account"
        case .accountPrivacy: return "accountPrivacy"
        }
    }

    public func resolve(
        _ destination: Destination,
        session: SessionSnapshot
    ) -> RouteResolution {
        guard implemented.contains(Self.identity(destination)) else {
            return .rejected(.notImplemented)
        }
        if destination.requiresAuthentication && !session.isAuthenticated {
            return .rejected(.requiresSignIn)
        }
        guard session.capabilities.contains(destination.requiredCapability) else {
            return .rejected(.capabilityUnavailable)
        }
        if let slug = destination.churchSlug {
            if session.blockedChurches.contains(slug) { return .rejected(.blocked) }
            guard session.churchAccess[slug] == true else {
                return .rejected(.noRelationship)
            }
        }
        return .allowed(destination)
    }

    /// A deep link is parsed and authorized in one step, before any state
    /// changes, so an unauthorized link never half-navigates.
    public func resolve(url: URL, session: SessionSnapshot) -> RouteResolution {
        guard let destination = DeepLinkParser.parse(url) else {
            return .rejected(.notImplemented)
        }
        return resolve(destination, session: session)
    }
}
