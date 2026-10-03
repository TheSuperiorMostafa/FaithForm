import Foundation
import Testing
@testable import FaithForm
import FaithFormKit

private struct UnusedRootRefresher: SessionRefreshing {
    func refresh(refreshToken: String) async throws -> StoredSession { throw URLError(.notConnectedToInternet) }
}

private actor RootRaceTransport: HTTPTransport {
    private var delayedBootstrap: CheckedContinuation<Void, Never>?
    private var delayNextBootstrap = false
    private var failDelayed = false
    private let bootstrap: Data
    init(bootstrap: Data) { self.bootstrap = bootstrap }
    func pauseNextBootstrap(fail: Bool = false) { delayNextBootstrap = true; failDelayed = fail }
    func started() -> Bool { delayedBootstrap != nil }
    func finish() { delayedBootstrap?.resume(); delayedBootstrap = nil }
    func perform(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let path = request.url!.path
        var responseBootstrap = bootstrap
        if path.hasSuffix("account/bootstrap"), delayNextBootstrap {
            delayNextBootstrap = false
            let shouldFail = failDelayed
            responseBootstrap = Data(String(decoding: bootstrap, as: UTF8.self).replacingOccurrences(of: "\"displayName\":\"Sam\"", with: "\"displayName\":\"Stale account data\"").utf8)
            await withCheckedContinuation { delayedBootstrap = $0 }
            if shouldFail { throw URLError(.notConnectedToInternet) }
        }
        let status = path.hasSuffix("child/rejected") ? 401 : 200
        let data = path.hasSuffix("account/bootstrap") ? responseBootstrap : Data((status == 401 ? "{\"ok\":false,\"error\":{\"code\":\"session_expired\",\"message\":\"Your session has expired.\",\"retryable\":false},\"meta\":{\"apiVersion\":\"2026-08-24\",\"apiMajor\":1,\"requestId\":\"3f1a0c9e-1b2d-4c5e-8f90-a1b2c3d4e5f6\",\"minimumSupportedClientBuild\":1}}" : "{\"ok\":true,\"data\":{\"signedOut\":true}}").utf8)
        return (data, HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
    }
}

@Suite("Root account lifecycle races", .serialized)
@MainActor
struct RootSessionRaceTests {
    private func session(_ account: String) -> StoredSession {
        StoredSession(accessToken: "access-\(account)", refreshToken: "refresh-\(account)", expiresAt: Date().addingTimeInterval(3600), accountId: account, environmentKey: "test")
    }
    private func dependencies() async throws -> (AppDependencies, RootRaceTransport, URL) {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let transport = RootRaceTransport(bootstrap: try Data(contentsOf: root.appendingPathComponent("contracts/faithform/v1/fixtures/bootstrap-multi-church.json")))
        let store = InMemorySecureStore()
        let manager = SessionManager(store: store, refresher: UnusedRootRefresher(), environmentKey: "test")
        try await manager.adopt(session("old"))
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let dependencies = AppDependencies(environment: .init(key: "test", baseURL: URL(string: "https://test.invalid")!), clientBuild: 1, allowsDebugControls: false, applePayMerchantID: nil, secureStore: store, session: manager, auth: nil, transport: transport, storageDirectory: directory, startBackgroundFeatures: false)
        return (dependencies, transport, directory)
    }

    @Test("late success or failure cannot reopen the shell after sign-out", arguments: [false, true])
    func lateLoadAfterSignOut(fail: Bool) async throws {
        let (dependencies, transport, directory) = try await dependencies()
        defer { try? FileManager.default.removeItem(at: directory) }
        let model = RootModel(dependencies: dependencies)
        await model.load()
        await transport.pauseNextBootstrap(fail: fail)
        let load = Task { await model.load(quiet: true) }
        while !(await transport.started()) { await Task.yield() }
        await model.signOut()
        await transport.finish()
        await load.value
        #expect(model.state.phase == .signedOut)
        #expect(model.accountId == nil)
        #expect(model.features == nil)
        #expect(dependencies.snapshots.load(environment: "test", accountId: "old") == nil)
        #expect(await dependencies.session.currentSession() == nil)
    }

    @Test("a response for another account cannot replace current private models or snapshot")
    func lateLoadAfterAccountAdoption() async throws {
        let (dependencies, transport, directory) = try await dependencies()
        defer { try? FileManager.default.removeItem(at: directory) }
        let model = RootModel(dependencies: dependencies)
        await model.load()
        await transport.pauseNextBootstrap()
        let load = Task { await model.load(quiet: true) }
        while !(await transport.started()) { await Task.yield() }
        await model.completeAuth(session("new"), displayName: nil)
        let currentFeatures = model.features
        let currentSnapshot = dependencies.snapshots.load(environment: "test", accountId: "new")
        await transport.finish()
        await load.value
        #expect(model.accountId == "new")
        #expect(model.features === currentFeatures)
        #expect(dependencies.snapshots.load(environment: "test", accountId: "new")?.bootstrap == currentSnapshot?.bootstrap)
    }

    @Test("child feature rejection clears private root state, snapshots, secure data and attendance")
    func childRejectionTeardown() async throws {
        let (dependencies, _, directory) = try await dependencies()
        defer { try? FileManager.default.removeItem(at: directory) }
        let model = RootModel(dependencies: dependencies)
        await model.load()
        try dependencies.secureStore.write(Data("private".utf8), for: "pending-gift")
        struct Reply: Decodable, Sendable { let signedOut: Bool }
        do { _ = try await dependencies.api.send("child/rejected", as: Reply.self); Issue.record("rejection succeeded") }
        catch let error as APIError { #expect(error.code == .sessionExpired) }
        await model.waitForSessionTeardown()
        #expect(model.state.phase == .signedOut)
        #expect(model.accountId == nil)
        #expect(model.features == nil)
        #expect(dependencies.snapshots.load(environment: "test", accountId: "old") == nil)
        #expect(try dependencies.secureStore.read("pending-gift") == nil)
        #expect(await dependencies.attendance.snapshot().isSignedIn == false)
    }
}
