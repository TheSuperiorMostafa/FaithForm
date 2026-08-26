import Foundation

/// The credential material, as stored. Kept minimal deliberately: no profile,
/// no church, nothing that belongs in an ordinary cache.
public struct StoredSession: Codable, Sendable, Equatable {
    public let accessToken: String
    public let refreshToken: String
    public let expiresAt: Date
    public let accountId: String
    public let environmentKey: String

    public init(
        accessToken: String,
        refreshToken: String,
        expiresAt: Date,
        accountId: String,
        environmentKey: String
    ) {
        self.accessToken = accessToken
        self.refreshToken = refreshToken
        self.expiresAt = expiresAt
        self.accountId = accountId
        self.environmentKey = environmentKey
    }

    /// Treated as expired slightly early so a request does not race the clock.
    public func isExpired(now: Date, leeway: TimeInterval = 60) -> Bool {
        now.addingTimeInterval(leeway) >= expiresAt
    }
}

public protocol SessionRefreshing: Sendable {
    func refresh(refreshToken: String) async throws -> StoredSession
}

/// Owns the token lifecycle.
///
/// Refresh is single-flight: concurrent callers that arrive while a refresh is
/// in progress await the same task rather than each starting their own, which
/// is what stops a burst of parallel requests from spending the refresh token
/// several times and invalidating the session.
public actor SessionManager: TokenProviding {
    private let store: SecureStoring
    private let refresher: SessionRefreshing
    private let environmentKey: String
    private let now: @Sendable () -> Date

    private var cached: StoredSession?
    private var inFlightRefresh: Task<StoredSession, Error>?

    private var storageKey: String { "session.\(environmentKey)" }

    public init(
        store: SecureStoring,
        refresher: SessionRefreshing,
        environmentKey: String,
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.store = store
        self.refresher = refresher
        self.environmentKey = environmentKey
        self.now = now
    }

    public func currentSession() -> StoredSession? {
        if let cached { return cached }
        guard
            let data = try? store.read(storageKey),
            let session = try? JSONDecoder().decode(StoredSession.self, from: data)
        else { return nil }

        // A session written under a different environment must never be used
        // here, even if it somehow shares a keychain item.
        guard session.environmentKey == environmentKey else { return nil }
        cached = session
        return session
    }

    public func adopt(_ session: StoredSession) throws {
        guard session.environmentKey == environmentKey else {
            throw APIError(code: .forbidden, message: "Wrong environment for this session.")
        }
        cached = session
        try store.write(try JSONEncoder().encode(session), for: storageKey)
    }

    public func validAccessToken() async throws -> String {
        guard let session = currentSession() else {
            throw APIError(code: .unauthenticated, message: "Sign in to continue.")
        }
        if !session.isExpired(now: now()) { return session.accessToken }

        if let existing = inFlightRefresh {
            return try await existing.value.accessToken
        }

        let task = Task<StoredSession, Error> { [refresher, session] in
            try await refresher.refresh(refreshToken: session.refreshToken)
        }
        inFlightRefresh = task

        defer { inFlightRefresh = nil }

        do {
            let refreshed = try await task.value
            try adopt(refreshed)
            return refreshed.accessToken
        } catch {
            // A refresh that fails is terminal for this session: keeping a dead
            // token would make every later call fail in a less obvious way.
            await invalidate()
            throw APIError(code: .sessionExpired, message: "Your session has expired.")
        }
    }

    public func invalidate() async {
        cached = nil
        inFlightRefresh?.cancel()
        inFlightRefresh = nil
        try? store.delete(storageKey)
    }

    /// Sign-out and account removal. Clears every environment's material, not
    /// just this one, so nothing survives in a bucket the app is not currently
    /// pointed at.
    public func purgeEverything() async {
        cached = nil
        inFlightRefresh?.cancel()
        inFlightRefresh = nil
        try? store.deleteAll()
    }
}
