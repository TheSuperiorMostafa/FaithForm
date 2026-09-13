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

/// Renews a session from its refresh token.
///
/// ## The one distinction a conformer must get right
///
/// Throw `APIError` with `.sessionExpired` (or `.unauthenticated`) **only** when
/// the identity provider looked at the refresh token and refused it — spent,
/// revoked, never issued. That is the one failure that ends a session.
///
/// Everything else is not an answer about the token at all: no network, a
/// timeout, a 5xx, a rate limit, a body nobody could read, a build with no
/// provider configured. Throw anything else for those — `APIError.transport`,
/// `.unavailable`, a `URLError` — and `SessionManager` keeps the session so the
/// next attempt, on a better connection, can still succeed.
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
            // A caller that joined someone else's refresh sees the same public
            // answer the owner does. The owner alone decides whether to
            // invalidate, so a rejection is not acted on twice.
            do {
                return try await existing.value.accessToken
            } catch {
                throw Self.publicError(for: error)
            }
        }

        let task = Task<StoredSession, Error> { [refresher, session] in
            try await refresher.refresh(refreshToken: session.refreshToken)
        }
        inFlightRefresh = task

        defer { inFlightRefresh = nil }

        let refreshed: StoredSession
        do {
            refreshed = try await task.value
        } catch {
            if Self.isDefinitiveRejection(error) {
                // The provider refused this refresh token. That is terminal for
                // the session: keeping a dead token would make every later call
                // fail in a less obvious way.
                await invalidate()
            }
            // **Anything else keeps the session.** This used to invalidate on
            // every failure, network included — so opening the app on a train
            // an hour after the access token expired signed the person out, and
            // they had to find their password to read a feed that was cached.
            // A refresh that never reached the provider says nothing about the
            // token, and the next attempt on a better connection will work.
            throw Self.publicError(for: error)
        }

        try adopt(refreshed)
        return refreshed.accessToken
    }

    /// Whether a refresher's failure is the provider refusing the token.
    ///
    /// Only the two codes `SessionRefreshing` reserves for it. Deliberately not
    /// "any `APIError`": a transport failure is an `APIError` too, and treating
    /// it as a rejection is exactly the bug this exists to prevent.
    static func isDefinitiveRejection(_ error: Error) -> Bool {
        guard let error = error as? APIError else { return false }
        return error.code == .sessionExpired || error.code == .unauthenticated
    }

    /// What a caller of `validAccessToken` is told.
    ///
    /// A rejection becomes `sessionExpired`, which the app reads as signed out.
    /// Everything else becomes the same retryable `unavailable` a dropped
    /// connection produces, which the app reads as offline — with the session
    /// still on the device.
    static func publicError(for error: Error) -> APIError {
        if isDefinitiveRejection(error) {
            return APIError(code: .sessionExpired, message: "Your session has expired.")
        }
        return APIError.transport(error)
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
