import Foundation
import Testing
@testable import FaithFormKit

private actor PickupTokens: TokenProviding {
    func validAccessToken() async throws -> String { "test-token" }
    func invalidate() async {}
}

private actor HeldPickupTransport: HTTPTransport {
    private var continuation: CheckedContinuation<Void, Never>?
    private(set) var requests = 0
    func perform(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        requests += 1
        await withCheckedContinuation { continuation = $0 }
        return (try Fixtures.data("kids-checkin-household"), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
    }
    func release() { continuation?.resume(); continuation = nil }
}

private struct SlowPickupTransport: HTTPTransport {
    func perform(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        try await Task.sleep(for: .seconds(60))
        throw URLError(.timedOut)
    }
}

@Suite("Household pickup loading") @MainActor
struct HouseholdPickupTests {
    private func client(_ transport: any HTTPTransport) -> APIClient {
        APIClient(configuration: .init(environment: .init(key: "test", baseURL: URL(string: "https://example.invalid")!), clientBuild: 42), transport: transport, tokens: PickupTokens())
    }

    @Test("a stalled request times out and restores the retry action")
    func timeout() async {
        let model = HouseholdPickupModel(requestTimeout: .milliseconds(10))
        await model.load(api: client(SlowPickupTransport()), churchSlug: "test")
        #expect(!model.isLoading)
        #expect(model.errorMessage != nil)
        #expect(model.data == nil)
    }

    @Test("failure ends loading and an explicit retry recovers")
    func retry() async throws {
        let transport = StubTransport([
            .init(status: 500),
            .init(body: try Fixtures.data("kids-checkin-household"))
        ])
        let api = client(transport)
        let model = HouseholdPickupModel()
        await model.load(api: api, churchSlug: "test")
        #expect(!model.isLoading)
        #expect(model.errorMessage != nil)
        #expect(model.errorMessage?.contains("internet") == false)
        await model.load(api: api, churchSlug: "test")
        #expect(!model.isLoading)
        #expect(model.errorMessage == nil)
        #expect(model.data?.households.first?.pickupCode == "012345")
    }

    @Test("failed revalidation removes old pickup credentials")
    func revokesOldCodes() async throws {
        let api = client(StubTransport([.init(body: try Fixtures.data("kids-checkin-household")), .init(status: 500)]))
        let model = HouseholdPickupModel()
        await model.load(api: api, churchSlug: "test")
        #expect(model.data != nil)
        await model.load(api: api, churchSlug: "test")
        #expect(model.data == nil)
        #expect(model.errorMessage != nil)
        #expect(!model.isLoading)
    }

    @Test("concurrent refreshes make one request and cleared screens reject late responses")
    func singleFlightAndClear() async {
        let transport = HeldPickupTransport()
        let api = client(transport)
        let model = HouseholdPickupModel()
        let first = Task { await model.load(api: api, churchSlug: "test") }
        while await transport.requests == 0 { await Task.yield() }
        await model.load(api: api, churchSlug: "test")
        #expect(await transport.requests == 1)
        model.clear()
        await transport.release()
        await first.value
        #expect(model.data == nil)
        #expect(model.errorMessage == nil)
        #expect(!model.isLoading)
    }

    @Test("cancellation finishes loading without reporting an internet failure")
    func cancellation() async {
        let transport = HeldPickupTransport()
        let model = HouseholdPickupModel()
        let api = client(transport)
        let task = Task { await model.load(api: api, churchSlug: "test") }
        while await transport.requests == 0 { await Task.yield() }
        task.cancel()
        await transport.release()
        await task.value
        #expect(!model.isLoading)
        #expect(model.errorMessage == nil)
        #expect(model.data == nil)
    }
}
