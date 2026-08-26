import Foundation
import Testing
@testable import FaithfulKit

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

    @Test("a failed refresh clears the session rather than leaving a dead token")
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
