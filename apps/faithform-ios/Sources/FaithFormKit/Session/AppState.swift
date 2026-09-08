import Foundation
import Observation

/// What the shell is currently showing. Each case is a real, honest state —
/// there is no case that renders invented content.
public enum LaunchPhase: Equatable, Sendable {
    case loading
    case signedOut
    /// Bootstrap succeeded. `isStale` marks a cached bootstrap shown offline.
    case ready(Bootstrap, isStale: Bool)
    /// No network and nothing cached. The app says so rather than inventing rows.
    case offlineNoCache
    case failed(message: String)
}

/// The composition root's observable state.
///
/// Deliberately small: it holds the session, the bootstrap, and the derived
/// route snapshot. Feature state belongs to features, which later prompts add.
@Observable
@MainActor
public final class AppState {
    public private(set) var phase: LaunchPhase = .loading
    public private(set) var environmentKey: String

    public init(environmentKey: String) {
        self.environmentKey = environmentKey
    }

    public func apply(_ phase: LaunchPhase) { self.phase = phase }

    public var bootstrap: Bootstrap? {
        if case let .ready(bootstrap, _) = phase { return bootstrap }
        return nil
    }

    public var isStale: Bool {
        if case let .ready(_, isStale) = phase { return isStale }
        return false
    }

    /// The snapshot the route registry authorizes against.
    ///
    /// Derived from the bootstrap every time rather than cached, so a
    /// relationship that changed on the server cannot leave a stale permission
    /// behind in the navigation layer.
    public var routeSnapshot: RouteRegistry.SessionSnapshot {
        guard let bootstrap else {
            return RouteRegistry.SessionSnapshot(isAuthenticated: false, capabilities: [])
        }
        var access: [String: Bool] = [:]
        var blocked: Set<String> = []
        for relationship in bootstrap.relationships {
            access[relationship.churchSlug] = relationship.canReadPublishedContent
            if relationship.state == .blocked { blocked.insert(relationship.churchSlug) }
        }
        return RouteRegistry.SessionSnapshot(
            isAuthenticated: true,
            capabilities: Set(bootstrap.enabledCapabilities),
            churchAccess: access,
            blockedChurches: blocked
        )
    }

    /// True when the person has not accepted the versions this server requires.
    public var needsPolicyAcceptance: Bool {
        guard let bootstrap else { return false }
        return bootstrap.profile.termsVersion != bootstrap.requiredTermsVersion
            || bootstrap.profile.privacyVersion != bootstrap.requiredPrivacyVersion
    }
}
