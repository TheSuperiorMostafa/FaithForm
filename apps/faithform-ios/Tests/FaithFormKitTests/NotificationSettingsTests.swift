import Foundation
import Testing
@testable import FaithFormKit

private func envelope(_ dataJSON: String) -> Data {
    Data("""
    {"ok":true,"data":\(dataJSON),"meta":{"apiVersion":"2026-08-24","apiMajor":1,"requestId":"r-1","minimumSupportedClientBuild":1}}
    """.utf8)
}

private func failure(_ code: String, status: Int) -> StubTransport.Exchange {
    StubTransport.Exchange(
        status: status,
        body: Data("""
        {"ok":false,"error":{"code":"\(code)","message":"No."},"meta":{"apiVersion":"2026-08-24","apiMajor":1,"requestId":"r-1","minimumSupportedClientBuild":1}}
        """.utf8)
    )
}

private actor TestTokens: TokenProviding {
    func validAccessToken() async throws -> String { "test-token" }
    func invalidate() async {}
}

private func api(_ transport: StubTransport) -> APIClient {
    APIClient(
        configuration: .init(
            environment: APIEnvironment(key: "test", baseURL: URL(string: "https://example.invalid")!),
            clientBuild: 7
        ),
        transport: transport,
        tokens: TestTokens()
    )
}

private let twoChurches = [(slug: "grace", name: "Grace Community"), (slug: "hope", name: "Hope Chapel")]

@Suite("Notification settings")
struct NotificationSettingsTests {
    @Test("A topic nobody has decided is on, because absence is not a refusal")
    @MainActor
    func defaultsToOn() async {
        let model = NotificationSettingsModel(api: api(StubTransport([
            .init(body: envelope(#"{"items":[]}"#))
        ])))
        await model.load(churches: twoChurches)

        #expect(model.churches.count == 2)
        #expect(model.churches.allSatisfy { $0.announcements && $0.events })
    }

    @Test("A stored opt-out turns that one switch off, and only that one")
    @MainActor
    func appliesStoredPreferences() async {
        let model = NotificationSettingsModel(api: api(StubTransport([
            .init(body: envelope(#"""
            {"items":[{"churchSlug":"grace","topic":"events","isEnabled":false}]}
            """#))
        ])))
        await model.load(churches: twoChurches)

        let grace = model.churches.first { $0.slug == "grace" }
        #expect(grace?.events == false)
        #expect(grace?.announcements == true)
        #expect(model.churches.first { $0.slug == "hope" }?.events == true)
    }

    @Test("A preference for a church this account no longer has is ignored")
    @MainActor
    func ignoresUnknownChurch() async {
        let model = NotificationSettingsModel(api: api(StubTransport([
            .init(body: envelope(#"""
            {"items":[{"churchSlug":"left-this-one","topic":"announcements","isEnabled":false}]}
            """#))
        ])))
        await model.load(churches: twoChurches)

        #expect(model.churches.count == 2)
        #expect(model.churches.allSatisfy { $0.announcements })
    }

    @Test("Turning one off sends that church, that topic, and false")
    @MainActor
    func writesTheChange() async throws {
        let transport = StubTransport([
            .init(body: envelope(#"{"items":[]}"#)),
            .init(body: envelope(#"{"churchSlug":"grace","topic":"announcements","isEnabled":false}"#)),
        ])
        let model = NotificationSettingsModel(api: api(transport))
        await model.load(churches: twoChurches)
        await model.set(.announcements, for: "grace", enabled: false)

        #expect(model.churches.first { $0.slug == "grace" }?.announcements == false)
        let requests = await transport.received
        let write = try #require(requests.last)
        #expect(write.httpMethod == "PUT")
        #expect(write.url?.path.hasSuffix("api/mobile/v1/preferences") == true)
        let body = try #require(write.httpBody)
        let sent = try JSONDecoder().decode(SetPreferenceRequest.self, from: body)
        #expect(sent.churchSlug == "grace")
        #expect(sent.topic == .announcements)
        #expect(sent.isEnabled == false)
    }

    @Test("A refused write puts the switch back, so it never shows a state the server is not in")
    @MainActor
    func rollsBackOnFailure() async {
        let model = NotificationSettingsModel(api: api(StubTransport([
            .init(body: envelope(#"{"items":[]}"#)),
            failure("unavailable", status: 503),
        ])))
        await model.load(churches: twoChurches)
        await model.set(.events, for: "hope", enabled: false)

        #expect(model.churches.first { $0.slug == "hope" }?.events == true)
        #expect(model.error != nil)
    }

    @Test("A list that cannot be read still renders every church, at its default")
    @MainActor
    func survivesAFailedLoad() async {
        let model = NotificationSettingsModel(api: api(StubTransport([failure("unavailable", status: 503)])))
        await model.load(churches: twoChurches)

        #expect(model.churches.count == 2)
        #expect(model.churches.allSatisfy { $0.announcements && $0.events })
        #expect(model.error != nil)
    }
}
