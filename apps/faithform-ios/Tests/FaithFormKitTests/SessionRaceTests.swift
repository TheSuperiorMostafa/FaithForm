import Foundation
import Testing
@testable import FaithFormKit

private actor PausedSessionRefresher: SessionRefreshing {
    private var waiting: CheckedContinuation<StoredSession, Error>?
    func refresh(refreshToken: String) async throws -> StoredSession {
        try await withCheckedThrowingContinuation { waiting = $0 }
    }
    func started() -> Bool { waiting != nil }
    func finish(_ session: StoredSession) { waiting?.resume(returning: session); waiting = nil }
}

private actor PausedSessionTransport: HTTPTransport {
    private var waiting: CheckedContinuation<Void, Never>?
    let status: Int
    init(status: Int) { self.status = status }
    func perform(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        await withCheckedContinuation { waiting = $0 }
        let body = status == 200 ? "{\"ok\":true,\"data\":{\"value\":1}}" : "{\"ok\":false,\"error\":{\"code\":\"session_expired\",\"message\":\"Your session has expired.\",\"retryable\":false},\"meta\":{\"apiVersion\":\"2026-08-24\",\"apiMajor\":1,\"requestId\":\"3f1a0c9e-1b2d-4c5e-8f90-a1b2c3d4e5f6\",\"minimumSupportedClientBuild\":1}}"
        return (Data(body.utf8), HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
    }
    func started() -> Bool { waiting != nil }
    func finish() { waiting?.resume(); waiting = nil }
}

private actor SessionEndEvents {
    var count = 0
    func record() { count += 1 }
}

@Suite("Session response races")
struct SessionRaceTests {
    private func session(_ account: String, expired: Bool = false) -> StoredSession {
        StoredSession(accessToken: "access-\(account)", refreshToken: "refresh-\(account)", expiresAt: Date().addingTimeInterval(expired ? -60 : 3600), accountId: account, environmentKey: "test")
    }

    @Test("ordinary token refresh keeps the same account request lifetime")
    func ordinaryRefreshLifetime() async throws {
        let manager = SessionManager(store: InMemorySecureStore(), refresher: CountingRefresher(), environmentKey: "test")
        try await manager.adopt(session("old", expired: true))
        let revision = await manager.sessionRevision()
        _ = try await manager.validAccessToken()
        #expect(await manager.sessionRevision() == revision)
    }

    @Test("a late refresh cannot restore a purged session")
    func lateRefreshAfterPurge() async throws {
        let refresher = PausedSessionRefresher()
        let manager = SessionManager(store: InMemorySecureStore(), refresher: refresher, environmentKey: "test")
        try await manager.adopt(session("old", expired: true))
        let task = Task { try await manager.validAccessToken() }
        while !(await refresher.started()) { await Task.yield() }
        await manager.purgeEverything()
        await refresher.finish(session("old"))
        do { _ = try await task.value; Issue.record("late refresh succeeded") } catch { #expect(error is CancellationError) }
        #expect(await manager.currentSession() == nil)
    }

    @Test("a late refresh cannot overwrite an adopted account")
    func lateRefreshAfterAdoption() async throws {
        let refresher = PausedSessionRefresher()
        let manager = SessionManager(store: InMemorySecureStore(), refresher: refresher, environmentKey: "test")
        try await manager.adopt(session("old", expired: true))
        let task = Task { try await manager.validAccessToken() }
        while !(await refresher.started()) { await Task.yield() }
        try await manager.adopt(session("new"))
        await refresher.finish(session("old"))
        do { _ = try await task.value; Issue.record("late refresh succeeded") } catch { #expect(error is CancellationError) }
        #expect(await manager.currentSession()?.accountId == "new")
    }

    @Test("old HTTP success and rejection cannot affect a newly adopted account", arguments: [200, 401])
    func lateHTTPResponse(status: Int) async throws {
        let manager = SessionManager(store: InMemorySecureStore(), refresher: CountingRefresher(), environmentKey: "test")
        let events = SessionEndEvents()
        await manager.setSessionEndedHandler { _ in await events.record() }
        try await manager.adopt(session("old"))
        let transport = PausedSessionTransport(status: status)
        let api = APIClient(configuration: .init(environment: APIEnvironment(key: "test", baseURL: URL(string: "https://test.invalid")!), clientBuild: 1), transport: transport, tokens: manager)
        struct Reply: Decodable, Sendable { let value: Int }
        let task = Task { try await api.send("private", as: Reply.self) }
        while !(await transport.started()) { await Task.yield() }
        try await manager.adopt(session("new"))
        await transport.finish()
        do { _ = try await task.value; Issue.record("old response delivered") } catch { #expect(error is CancellationError) }
        #expect(await manager.currentSession()?.accountId == "new")
        #expect(await events.count == 0)
    }

    @Test("a definitive child-request rejection announces session end once")
    func childRejection() async throws {
        let manager = SessionManager(store: InMemorySecureStore(), refresher: CountingRefresher(), environmentKey: "test")
        try await manager.adopt(session("old"))
        let events = SessionEndEvents()
        await manager.setSessionEndedHandler { _ in await events.record() }
        let api = APIClient(configuration: .init(environment: APIEnvironment(key: "test", baseURL: URL(string: "https://test.invalid")!), clientBuild: 1), transport: StubTransport([.init(status: 401, body: Data("{\"ok\":false,\"error\":{\"code\":\"session_expired\",\"message\":\"Your session has expired.\",\"retryable\":false},\"meta\":{\"apiVersion\":\"2026-08-24\",\"apiMajor\":1,\"requestId\":\"3f1a0c9e-1b2d-4c5e-8f90-a1b2c3d4e5f6\",\"minimumSupportedClientBuild\":1}}".utf8))]), tokens: manager)
        struct Reply: Decodable, Sendable { let value: Int }
        _ = try? await api.send("private", as: Reply.self)
        #expect(await events.count == 1)
        await manager.invalidate()
        #expect(await manager.currentSession() == nil)
        #expect(await events.count == 1)
    }
}
