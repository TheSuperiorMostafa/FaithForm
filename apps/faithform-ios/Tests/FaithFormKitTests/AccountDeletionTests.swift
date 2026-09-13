import Foundation
import Testing
@testable import FaithFormKit

/// Deleting an account from the phone: what is sent, what is kept across a
/// retry, and what a failure leaves the person holding.

private func success(kind: String = "deletion") -> Data {
    Data("""
    {"ok":true,"data":{"id":"req-1","kind":"\(kind)","status":"pending","requestedAt":"2026-09-13T10:00:00Z","completedAt":null},"meta":{"apiVersion":"2026-08-24","apiMajor":1,"requestId":"r-1","minimumSupportedClientBuild":1}}
    """.utf8)
}

private func failure(code: String, message: String) -> Data {
    Data("""
    {"ok":false,"error":{"code":"\(code)","message":"\(message)","retryable":false},"meta":{"apiVersion":"2026-08-24","apiMajor":1,"requestId":"r-2","minimumSupportedClientBuild":1}}
    """.utf8)
}

private actor DeletionTokens: TokenProviding {
    func validAccessToken() async throws -> String { "test-token" }
    func invalidate() async {}
}

private final class KeyCounter: @unchecked Sendable {
    private let lock = NSLock()
    private var count = 0

    func next() -> String {
        lock.lock()
        defer { lock.unlock() }
        count += 1
        return "key-\(count)"
    }
}

@Suite("Account deletion")
@MainActor
struct AccountDeletionTests {

    private func model(
        _ exchanges: [StubTransport.Exchange],
        keys: KeyCounter = KeyCounter()
    ) -> (AccountDeletionModel, StubTransport) {
        let transport = StubTransport(exchanges)
        let api = APIClient(
            configuration: .init(
                environment: APIEnvironment(key: "test", baseURL: URL(string: "https://example.invalid")!),
                clientBuild: 7
            ),
            transport: transport,
            tokens: DeletionTokens()
        )
        return (AccountDeletionModel(api: api, makeIdempotencyKey: { keys.next() }), transport)
    }

    @Test("the request is a deletion, posted with an idempotency key")
    func request() async throws {
        let (model, transport) = model([.init(body: success())])

        #expect(await model.requestDeletion())
        #expect(model.phase == .requested)

        let sent = try #require(await transport.received.first)
        #expect(sent.httpMethod == "POST")
        #expect(sent.url?.path == "/api/mobile/v1/account/requests")
        #expect(sent.value(forHTTPHeaderField: "Idempotency-Key") == "key-1")
        let body = try JSONSerialization.jsonObject(with: try #require(sent.httpBody)) as? [String: String]
        #expect(body == ["kind": "deletion"])
    }

    @Test("a failure says why, and the retry joins the request that may already exist")
    func retryReusesKey() async throws {
        // A gateway error the first time — the shape of a request that may well
        // have reached the server and lost its answer on the way back.
        let keys = KeyCounter()
        let (model, transport) = model(
            [.init(status: 503, body: Data("<html>".utf8)), .init(body: success())],
            keys: keys
        )

        #expect(await model.requestDeletion() == false)
        #expect(model.phase == .failed(L.deleteAccountFailedBody))

        model.acknowledgeFailure()
        #expect(model.phase == .idle)

        #expect(await model.requestDeletion())
        // One key for both attempts: a lost response must not become two
        // requests.
        #expect(await transport.header("Idempotency-Key", at: 0) == "key-1")
        #expect(await transport.header("Idempotency-Key", at: 1) == "key-1")
    }

    @Test("a refusal shows the server's own sentence and stays signed in")
    func refusal() async {
        let (model, _) = model([
            .init(status: 400, body: failure(code: "invalid_request", message: "Choose export or deletion.")),
        ])
        #expect(await model.requestDeletion() == false)
        #expect(model.phase == .failed("Choose export or deletion."))
    }

    @Test("an account that is already deleted counts as done")
    func alreadyDeleted() async {
        let (model, _) = model([
            .init(status: 403, body: failure(code: "account_inactive", message: "This account is already deleted.")),
        ])
        #expect(await model.requestDeletion())
        #expect(model.phase == .requested)
    }

    @Test("an unreachable server is a failure, never a success")
    func offline() async {
        let (model, transport) = model([])
        #expect(await model.requestDeletion() == false)
        #expect(model.phase == .failed(L.deleteAccountFailedBody))
        #expect(await transport.requestCount() == 1)
    }

    @Test("a second tap while the first is in flight sends nothing")
    func doubleTap() async {
        let (model, transport) = model([.init(body: success())])
        async let first = model.requestDeletion()
        async let second = model.requestDeletion()
        let results = await [first, second]
        #expect(results.filter { $0 }.count == 1)
        #expect(await transport.requestCount() == 1)
    }

    @Test("the terms notice links both documents, in the browser")
    func termsNotice() {
        let notice = LegalLinks.termsNotice()
        let links = notice.runs.compactMap(\.link)
        #expect(links == [LegalLinks.termsOfService, LegalLinks.privacyPolicy])
        #expect(String(notice.characters).contains(L.termsOfService))
        #expect(String(notice.characters).contains(L.privacyPolicy))
        for url in [LegalLinks.privacyPolicy, LegalLinks.termsOfService, LegalLinks.accountDeletion] {
            #expect(url.scheme == "https")
            #expect(url.host == "faithform.io")
        }
    }
}
