import Foundation
import Testing
@testable import FaithFormKit

/// Counts refreshes so the single-flight guarantee can be asserted rather than
/// assumed, and can be made slow enough for callers to genuinely overlap.
actor CountingRefresher: SessionRefreshing {
    private(set) var calls = 0
    private let delay: Duration
    private let shouldFail: Bool

    init(delay: Duration = .milliseconds(40), shouldFail: Bool = false) {
        self.delay = delay
        self.shouldFail = shouldFail
    }

    func callCount() -> Int { calls }

    func refresh(refreshToken: String) async throws -> StoredSession {
        calls += 1
        try? await Task.sleep(for: delay)
        if shouldFail {
            throw APIError(code: .sessionExpired, message: "expired")
        }
        return StoredSession(
            accessToken: "fresh-\(calls)",
            refreshToken: "next-\(calls)",
            expiresAt: Date().addingTimeInterval(3600),
            accountId: "account-1",
            environmentKey: "test"
        )
    }
}

/// The ways a refresh fails *without* the provider saying anything about the
/// token.
enum TransientFailure: String, CaseIterable, Sendable, CustomTestStringConvertible {
    case noNetwork
    case serverUnavailable
    case unreadable

    var error: Error {
        switch self {
        case .noNetwork: return URLError(.notConnectedToInternet)
        case .serverUnavailable: return APIError.transport(URLError(.badServerResponse))
        case .unreadable: return DecodingError.dataCorrupted(.init(codingPath: [], debugDescription: "html"))
        }
    }

    var testDescription: String { rawValue }
}

/// Plays back a fixed sequence of refresh outcomes, one per call.
actor ScriptedRefresher: SessionRefreshing {
    enum Step: Sendable {
        case succeed
        case fail(any Error & Sendable)
    }

    private var steps: [Step]
    private var calls = 0

    init(_ steps: [Step]) { self.steps = steps }

    func callCount() -> Int { calls }

    func refresh(refreshToken: String) async throws -> StoredSession {
        calls += 1
        // Long enough for concurrent callers to genuinely overlap.
        try? await Task.sleep(for: .milliseconds(30))
        let step = steps.isEmpty ? .succeed : steps.removeFirst()
        switch step {
        case .succeed:
            return StoredSession(
                accessToken: "fresh-\(calls)",
                refreshToken: "next-\(calls)",
                expiresAt: Date().addingTimeInterval(3600),
                accountId: "account-1",
                environmentKey: "test"
            )
        case let .fail(error):
            throw error
        }
    }
}

@Suite("Session lifecycle")
struct SessionTests {

    private func session(expiresIn: TimeInterval, environment: String = "test") -> StoredSession {
        StoredSession(
            accessToken: "current",
            refreshToken: "refresh",
            expiresAt: Date().addingTimeInterval(expiresIn),
            accountId: "account-1",
            environmentKey: environment
        )
    }

    @Test("a valid token is returned without refreshing")
    func validToken() async throws {
        let refresher = CountingRefresher()
        let manager = SessionManager(
            store: InMemorySecureStore(),
            refresher: refresher,
            environmentKey: "test"
        )
        try await manager.adopt(session(expiresIn: 3600))
        #expect(try await manager.validAccessToken() == "current")
        #expect(await refresher.callCount() == 0)
    }

    @Test("an expiring token refreshes once")
    func refreshesWhenExpiring() async throws {
        let refresher = CountingRefresher()
        let manager = SessionManager(
            store: InMemorySecureStore(),
            refresher: refresher,
            environmentKey: "test"
        )
        // Inside the 60s leeway, so it is treated as already expired.
        try await manager.adopt(session(expiresIn: 30))
        #expect(try await manager.validAccessToken() == "fresh-1")
        #expect(await refresher.callCount() == 1)
    }

    @Test("concurrent callers share one refresh instead of racing")
    func singleFlightRefresh() async throws {
        let refresher = CountingRefresher()
        let manager = SessionManager(
            store: InMemorySecureStore(),
            refresher: refresher,
            environmentKey: "test"
        )
        try await manager.adopt(session(expiresIn: 5))

        // Twelve simultaneous callers. Spending the refresh token twelve times
        // would invalidate the session on a real provider.
        let tokens = try await withThrowingTaskGroup(of: String.self) { group in
            for _ in 0..<12 {
                group.addTask { try await manager.validAccessToken() }
            }
            var results: [String] = []
            for try await token in group { results.append(token) }
            return results
        }

        #expect(await refresher.callCount() == 1)
        #expect(Set(tokens) == ["fresh-1"])
    }

    @Test("a refused refresh clears the session rather than leaving a dead token")
    func failedRefreshInvalidates() async throws {
        let store = InMemorySecureStore()
        let manager = SessionManager(
            store: store,
            refresher: CountingRefresher(shouldFail: true),
            environmentKey: "test"
        )
        try await manager.adopt(session(expiresIn: 5))

        await #expect(throws: APIError.self) {
            _ = try await manager.validAccessToken()
        }
        #expect(await manager.currentSession() == nil)
        #expect(store.isEmpty())
    }

    @Test("a refresh that cannot reach the provider keeps the session", arguments: [
        TransientFailure.noNetwork,
        TransientFailure.serverUnavailable,
        TransientFailure.unreadable,
    ])
    func transientRefreshKeepsSession(_ failure: TransientFailure) async throws {
        // **The regression this guards.** Opening the app offline an hour after
        // the access token expired used to delete the stored session, so the
        // person was signed out for having no signal. A refresh that never got
        // an answer about the token says nothing about the token.
        let store = InMemorySecureStore()
        let refresher = ScriptedRefresher([.fail(failure.error), .succeed])
        let manager = SessionManager(
            store: store,
            refresher: refresher,
            environmentKey: "test"
        )
        let expired = session(expiresIn: 5)
        try await manager.adopt(expired)

        do {
            _ = try await manager.validAccessToken()
            Issue.record("a failed refresh returned a token")
        } catch let error as APIError {
            // Reported the way a dropped connection is, so the app shows
            // offline rather than the sign-in screen.
            #expect(error.code == .unavailable)
            #expect(error.retryable)
            #expect(error.requestId == nil)
        }

        #expect(await manager.currentSession() == expired)
        #expect(!store.isEmpty())

        // Back on a network: the same refresh token still works.
        #expect(try await manager.validAccessToken() == "fresh-2")
        #expect(await refresher.callCount() == 2)
    }

    @Test("a refresh token the provider refuses ends the session")
    func definitiveRejectionClearsSession() async throws {
        let store = InMemorySecureStore()
        let manager = SessionManager(
            store: store,
            refresher: ScriptedRefresher([
                .fail(APIError(code: .sessionExpired, message: "refresh token revoked")),
            ]),
            environmentKey: "test"
        )
        try await manager.adopt(session(expiresIn: 5))

        do {
            _ = try await manager.validAccessToken()
            Issue.record("a refused refresh returned a token")
        } catch let error as APIError {
            #expect(error.code == .sessionExpired)
        }
        #expect(await manager.currentSession() == nil)
        #expect(store.isEmpty())
    }

    @Test("callers sharing a refresh that failed offline all keep the session")
    func sharedTransientFailure() async throws {
        let store = InMemorySecureStore()
        let refresher = ScriptedRefresher([.fail(URLError(.notConnectedToInternet))])
        let manager = SessionManager(
            store: store,
            refresher: refresher,
            environmentKey: "test"
        )
        try await manager.adopt(session(expiresIn: 5))

        let codes = await withTaskGroup(of: MobileErrorCode?.self) { group in
            for _ in 0..<6 {
                group.addTask {
                    do {
                        _ = try await manager.validAccessToken()
                        return nil
                    } catch {
                        return (error as? APIError)?.code
                    }
                }
            }
            var collected: [MobileErrorCode?] = []
            for await code in group { collected.append(code) }
            return collected
        }

        #expect(codes.allSatisfy { $0 == .unavailable })
        #expect(await refresher.callCount() == 1)
        #expect(!store.isEmpty())
    }

    @Test("only a refusal that names the token counts as one", arguments: [
        // GoTrue's current shape.
        (400, #"{"code":400,"error_code":"refresh_token_not_found","msg":"Invalid Refresh Token: Refresh Token Not Found"}"#, true),
        (400, #"{"error_code":"refresh_token_already_used","msg":"Invalid Refresh Token: Already Used"}"#, true),
        // OAuth's older shape.
        (400, #"{"error":"invalid_grant","error_description":"Invalid Refresh Token: Refresh Token Not Found"}"#, true),
        (403, #"{"error_code":"session_not_found","msg":"Session from session_id claim in JWT does not exist"}"#, true),
        (401, #"{"msg":"Invalid Refresh Token: Revoked"}"#, true),
        // A bad key is a broken build, not a person to sign out.
        (401, #"{"message":"Invalid API key"}"#, false),
        // Not about the token at all.
        (400, #"{"error_code":"validation_failed","msg":"refresh_token is required"}"#, false),
        (429, #"{"error_code":"over_request_rate_limit"}"#, false),
        (500, #"{"error_code":"unexpected_failure"}"#, false),
        (502, "<html>Bad Gateway</html>", false),
        (400, "", false),
    ])
    func refreshRejectionClassification(_ status: Int, _ body: String, _ expected: Bool) {
        #expect(
            SupabaseRefreshRejection.isDefinitive(status: status, body: Data(body.utf8)) == expected
        )
    }

    @Test("a session from another environment is never adopted or used")
    func environmentIsolation() async throws {
        let store = InMemorySecureStore()
        let manager = SessionManager(
            store: store,
            refresher: CountingRefresher(),
            environmentKey: "production"
        )
        await #expect(throws: APIError.self) {
            try await manager.adopt(session(expiresIn: 3600, environment: "staging"))
        }
        #expect(await manager.currentSession() == nil)
    }

    @Test("sign-out purges every stored credential")
    func purge() async throws {
        let store = InMemorySecureStore()
        let manager = SessionManager(
            store: store,
            refresher: CountingRefresher(),
            environmentKey: "test"
        )
        try await manager.adopt(session(expiresIn: 3600))
        #expect(!store.isEmpty())

        await manager.purgeEverything()
        #expect(store.isEmpty())
        #expect(await manager.currentSession() == nil)
    }

    @Test("expiry uses leeway so a request does not race the clock")
    func leeway() {
        let now = Date()
        let almostExpired = StoredSession(
            accessToken: "a", refreshToken: "r",
            expiresAt: now.addingTimeInterval(30),
            accountId: "x", environmentKey: "test"
        )
        #expect(almostExpired.isExpired(now: now))

        let comfortable = StoredSession(
            accessToken: "a", refreshToken: "r",
            expiresAt: now.addingTimeInterval(600),
            accountId: "x", environmentKey: "test"
        )
        #expect(!comfortable.isExpired(now: now))
    }
}
