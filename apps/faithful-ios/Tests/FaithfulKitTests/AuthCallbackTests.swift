import Foundation
import Testing
@testable import FaithfulKit

// MARK: - Doubles

private final class MemoryFlowStore: AuthFlowStateStoring, @unchecked Sendable {
    private var verifier: String?
    private let lock = NSLock()

    init(verifier: String? = nil) { self.verifier = verifier }

    func saveVerifier(_ verifier: String) {
        lock.lock(); defer { lock.unlock() }
        self.verifier = verifier
    }
    func loadVerifier() -> String? {
        lock.lock(); defer { lock.unlock() }
        return verifier
    }
    func clearVerifier() {
        lock.lock(); defer { lock.unlock() }
        verifier = nil
    }
}

private func pkceConfig(redirect: String? = AuthCallbackLink.canonical) -> SupabaseAuthConfiguration {
    SupabaseAuthConfiguration(
        url: URL(string: "https://identity.example")!,
        anonKey: "anon-key",
        environmentKey: "development",
        signUpRedirectURL: redirect.flatMap(URL.init(string:))
    )
}

private func sessionJSON() -> Data {
    Data("""
    {"access_token":"access-1","refresh_token":"refresh-1","expires_in":3600,
     "user":{"id":"account-1"}}
    """.utf8)
}

private func bodyJSON(of request: URLRequest?) -> [String: String] {
    guard let body = request?.httpBody,
          let decoded = try? JSONDecoder().decode([String: String].self, from: body)
    else { return [:] }
    return decoded
}

// MARK: - The shared contract

/// `contracts/faithful/v1/auth-callback.json`, decoded loosely so an added
/// field cannot break three test suites at once.
private struct CallbackContract {
    let json: [String: Any]

    init() throws {
        let data = try Fixtures.contract("auth-callback")
        json = try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    var faithful: [String: Any] { json["faithful"] as? [String: Any] ?? [:] }
    var vectors: [String: Any] { json["vectors"] as? [String: Any] ?? [:] }

    func vectorList(_ name: String) throws -> [[String: Any]] {
        try #require(vectors[name] as? [[String: Any]])
    }
}

@Suite("Auth callback contract")
struct AuthCallbackContractTests {

    @Test("the constants this app registers are the contract's, verbatim")
    func constantsMatchContract() throws {
        let contract = try CallbackContract()
        #expect(AuthCallbackLink.scheme == contract.faithful["scheme"] as? String)
        #expect(AuthCallbackLink.host == contract.faithful["host"] as? String)
        #expect(AuthCallbackLink.path == contract.faithful["path"] as? String)
        #expect(AuthCallbackLink.canonical == contract.faithful["canonical"] as? String)
    }

    @Test("every accepted vector yields exactly its code")
    func acceptedVectors() throws {
        for vector in try CallbackContract().vectorList("accepted") {
            let raw = try #require(vector["url"] as? String)
            let url = try #require(URL(string: raw))
            let expected = try #require(vector["code"] as? String)
            #expect(AuthCallbackLink.parse(url) == .code(expected), "\(url)")
        }
    }

    @Test("every failure vector is a visible failure state, never an exchange")
    func failureVectors() throws {
        for vector in try CallbackContract().vectorList("failures") {
            let raw = try #require(vector["url"] as? String)
            let url = try #require(URL(string: raw))
            let reason: AuthCallbackLink.FailureReason =
                (vector["reason"] as? String) == "expired" ? .expired : .invalid
            #expect(AuthCallbackLink.parse(url) == .failure(reason), "\(url)")
        }
    }

    @Test("every rejected vector is not an auth callback at all")
    func rejectedVectors() throws {
        for vector in try CallbackContract().vectorList("rejected") {
            let raw = try #require(vector["url"] as? String)
            let url = try #require(URL(string: raw))
            #expect(AuthCallbackLink.parse(url) == nil, "\(url)")
        }
    }
}

// MARK: - PKCE

@Suite("PKCE")
struct PKCETests {

    @Test("the verifier is long, unreserved, and fresh every time")
    func verifierShape() {
        let allowed = CharacterSet(
            charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
        )
        let first = PKCE.makeVerifier()
        let second = PKCE.makeVerifier()
        #expect(first.count == 64)
        #expect(first.unicodeScalars.allSatisfy(allowed.contains))
        #expect(first != second)
    }

    @Test("the challenge is base64url(SHA-256), pinned to a known vector")
    func challengeKnownAnswer() {
        // RFC 7636 appendix B's example pair.
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
        #expect(PKCE.challenge(for: verifier) == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
    }
}

// MARK: - SupabaseAuthClient, confirmation flow

@Suite("Supabase auth client — confirmation")
struct SupabaseAuthConfirmationTests {

    @Test("signup carries the app's own callback and a hashed challenge")
    func signUpCarriesRedirectAndChallenge() async throws {
        let transport = StubTransport([.init(status: 200, body: Data("{\"id\":\"account-1\"}".utf8))])
        let store = MemoryFlowStore()
        let client = SupabaseAuthClient(
            configuration: pkceConfig(),
            transport: transport,
            flowState: store
        )

        let outcome = try await client.signUp(email: "p@example.org", password: "pw123456")
        #expect(outcome == .confirmationRequired)

        let request = await transport.received.first
        let url = request?.url?.absoluteString ?? ""
        #expect(url.contains("auth/v1/signup"))
        #expect(url.contains("redirect_to=faithful%3A%2F%2Fauth%2Fcallback"))

        let body = bodyJSON(of: request)
        let verifier = try #require(store.loadVerifier())
        #expect(body["code_challenge"] == PKCE.challenge(for: verifier))
        #expect(body["code_challenge_method"] == "s256")
        // The verifier itself never travels.
        #expect(body["code_challenge"] != verifier)
        #expect(!url.contains(verifier))
    }

    @Test("the verifier is stored before the request leaves, surviving a mid-flow kill")
    func verifierStoredBeforeNetwork() async {
        let transport = StubTransport([]) // network fails
        let store = MemoryFlowStore()
        let client = SupabaseAuthClient(
            configuration: pkceConfig(),
            transport: transport,
            flowState: store
        )

        _ = try? await client.signUp(email: "p@example.org", password: "pw123456")
        #expect(store.loadVerifier() != nil)
    }

    @Test("without a configured redirect, signup stays exactly as it was")
    func signUpWithoutRedirectUnchanged() async throws {
        let transport = StubTransport([.init(status: 200, body: Data("{\"id\":\"a\"}".utf8))])
        let client = SupabaseAuthClient(
            configuration: pkceConfig(redirect: nil),
            transport: transport,
            flowState: MemoryFlowStore()
        )

        _ = try await client.signUp(email: "p@example.org", password: "pw123456")

        let request = await transport.received.first
        let requestURL = request?.url?.absoluteString ?? ""
        #expect(requestURL.contains("redirect_to") == false)
        #expect(bodyJSON(of: request)["code_challenge"] == nil)
    }

    @Test("the exchange spends the code against this build's own provider only")
    func exchangeShape() async throws {
        let transport = StubTransport([.init(status: 200, body: sessionJSON())])
        let store = MemoryFlowStore(verifier: "stored-verifier-stored-verifier-stored-verifier")
        let client = SupabaseAuthClient(
            configuration: pkceConfig(),
            transport: transport,
            flowState: store
        )

        let session = try await client.completeEmailConfirmation(code: "code-123456")

        let request = await transport.received.first
        let url = request?.url?.absoluteString ?? ""
        // The URL comes from configuration. Nothing in the callback can point
        // the exchange anywhere else, which is what makes a cross-environment
        // or hijacked link worthless.
        #expect(url.hasPrefix("https://identity.example/"))
        #expect(url.contains("auth/v1/token"))
        #expect(url.contains("grant_type=pkce"))

        let body = bodyJSON(of: request)
        #expect(body["auth_code"] == "code-123456")
        #expect(body["code_verifier"] == "stored-verifier-stored-verifier-stored-verifier")

        #expect(session.environmentKey == "development")
        #expect(session.accountId == "account-1")
        // Spent: the flow cannot be replayed from this device.
        #expect(store.loadVerifier() == nil)
    }

    @Test("no stored verifier is a spent link, refused before any network call")
    func missingVerifierFailsClosed() async {
        let transport = StubTransport([.init(status: 200, body: sessionJSON())])
        let client = SupabaseAuthClient(
            configuration: pkceConfig(),
            transport: transport,
            flowState: MemoryFlowStore()
        )

        do {
            _ = try await client.completeEmailConfirmation(code: "code-123456")
            Issue.record("expected a failure")
        } catch let failure as AuthFailure {
            #expect(failure.kind == .linkExpired)
        } catch {
            Issue.record("unexpected error type")
        }
        let count = await transport.requestCount()
        #expect(count == 0)
    }

    @Test("a provider-rejected code becomes linkExpired, never a password sentence")
    func rejectedCodeMapped() async {
        let transport = StubTransport([
            .init(status: 400, body: Data("{\"error_code\":\"invalid_grant\",\"msg\":\"internal wording\"}".utf8))
        ])
        let client = SupabaseAuthClient(
            configuration: pkceConfig(),
            transport: transport,
            flowState: MemoryFlowStore(verifier: "stored-verifier-stored-verifier-stored-verifier")
        )

        do {
            _ = try await client.completeEmailConfirmation(code: "code-123456")
            Issue.record("expected a failure")
        } catch let failure as AuthFailure {
            #expect(failure.kind == .linkExpired)
            #expect(!failure.message.contains("internal wording"))
            #expect(!failure.message.lowercased().contains("password is incorrect"))
        } catch {
            Issue.record("unexpected error type")
        }
    }

    @Test("no network during the exchange stays offline — the link may still be good")
    func offlineExchange() async {
        let transport = StubTransport([])
        let client = SupabaseAuthClient(
            configuration: pkceConfig(),
            transport: transport,
            flowState: MemoryFlowStore(verifier: "stored-verifier-stored-verifier-stored-verifier")
        )

        do {
            _ = try await client.completeEmailConfirmation(code: "code-123456")
            Issue.record("expected a failure")
        } catch let failure as AuthFailure {
            #expect(failure.kind == .offline)
        } catch {
            Issue.record("unexpected error type")
        }
    }
}

// MARK: - AuthModel, confirmation callback

@MainActor
@Suite("Auth model — confirmation callback")
struct AuthModelConfirmationTests {

    private final class ScriptedConfirmation: SessionAuthenticating, @unchecked Sendable {
        var results: [Result<StoredSession, Error>]
        private(set) var codes: [String] = []

        init(_ results: [Result<StoredSession, Error>]) { self.results = results }

        func signUp(email: String, password: String) async throws -> SignUpOutcome {
            .confirmationRequired
        }
        func signIn(email: String, password: String) async throws -> StoredSession {
            throw AuthFailure(kind: .other, message: "unused")
        }
        func sendPasswordReset(email: String) async throws {}
        func completeEmailConfirmation(code: String) async throws -> StoredSession {
            codes.append(code)
            guard !results.isEmpty else { throw AuthFailure(kind: .other, message: "unused") }
            return try results.removeFirst().get()
        }
    }

    private func session() -> StoredSession {
        StoredSession(
            accessToken: "access-1",
            refreshToken: "refresh-1",
            expiresAt: Date().addingTimeInterval(3600),
            accountId: "account-1",
            environmentKey: "development"
        )
    }

    @Test("a valid code signs the person in through the ordinary path")
    func codeCompletes() async {
        let auth = ScriptedConfirmation([.success(session())])
        var received: StoredSession?
        let model = AuthModel(auth: auth) { adopted, _ in received = adopted }

        await model.handleConfirmationCallback(.code("code-123456"))

        #expect(received?.accountId == "account-1")
        #expect(model.phase == .idle)
        #expect(auth.codes == ["code-123456"])
    }

    @Test("the same code delivered twice is exchanged exactly once")
    func duplicateDeliveryConsumedOnce() async {
        let auth = ScriptedConfirmation([.success(session())])
        var adoptions = 0
        let model = AuthModel(auth: auth) { _, _ in adoptions += 1 }

        await model.handleConfirmationCallback(.code("code-123456"))
        await model.handleConfirmationCallback(.code("code-123456"))

        #expect(adoptions == 1)
        #expect(auth.codes.count == 1)
    }

    @Test("a spent link is its own sentence, and stays consumed")
    func expiredLinkSentence() async {
        let auth = ScriptedConfirmation([
            .failure(AuthFailure(kind: .linkExpired, message: L.authErrorLinkExpired))
        ])
        let model = AuthModel(auth: auth) { _, _ in
            Issue.record("no session should be handed over")
        }

        await model.handleConfirmationCallback(.code("code-123456"))
        #expect(model.phase == .failed(L.authErrorLinkExpired))

        // Re-delivery of a code the provider already refused does nothing.
        await model.handleConfirmationCallback(.code("code-123456"))
        #expect(auth.codes.count == 1)
    }

    @Test("an offline exchange leaves the code retryable")
    func offlineRetryable() async {
        let auth = ScriptedConfirmation([
            .failure(AuthFailure(kind: .offline, message: L.authErrorOffline)),
            .success(session()),
        ])
        var adoptions = 0
        let model = AuthModel(auth: auth) { _, _ in adoptions += 1 }

        await model.handleConfirmationCallback(.code("code-123456"))
        #expect(model.phase == .failed(L.authErrorOffline))

        // The person taps the same email link again once they're back online.
        await model.handleConfirmationCallback(.code("code-123456"))
        #expect(adoptions == 1)
        #expect(model.phase == .idle)
    }

    @Test("a failure callback shows its own sentence without any exchange")
    func failureCallbackSentences() async {
        let auth = ScriptedConfirmation([])
        let model = AuthModel(auth: auth) { _, _ in }

        await model.handleConfirmationCallback(.failure(.expired))
        #expect(model.phase == .failed(L.authErrorLinkExpired))

        await model.handleConfirmationCallback(.failure(.invalid))
        #expect(model.phase == .failed(L.authErrorLinkInvalid))

        #expect(auth.codes.isEmpty)
    }

    @Test("no configured provider fails closed with the configuration sentence")
    func unconfigured() async {
        let model = AuthModel(auth: nil) { _, _ in }
        await model.handleConfirmationCallback(.code("code-123456"))
        #expect(model.phase == .failed(L.authErrorUnconfigured))
    }
}

// MARK: - The secure flow store

@Suite("Secure auth flow store")
struct SecureAuthFlowStoreTests {

    @Test("save, load and clear round-trip through the secure store")
    func roundTrip() {
        let backing = InMemorySecureStore()
        let store = SecureAuthFlowStore(store: backing, environmentKey: "development")

        #expect(store.loadVerifier() == nil)
        store.saveVerifier("verifier-value")
        #expect(store.loadVerifier() == "verifier-value")
        store.clearVerifier()
        #expect(store.loadVerifier() == nil)
    }

    @Test("environments never read each other's verifier")
    func environmentIsolation() {
        let backing = InMemorySecureStore()
        let development = SecureAuthFlowStore(store: backing, environmentKey: "development")
        let staging = SecureAuthFlowStore(store: backing, environmentKey: "staging")

        development.saveVerifier("dev-verifier")
        #expect(staging.loadVerifier() == nil)
        #expect(development.loadVerifier() == "dev-verifier")
    }

    @Test("sign-out's deleteAll sweeps the verifier with the session")
    func sweptBySignOut() throws {
        let backing = InMemorySecureStore()
        let store = SecureAuthFlowStore(store: backing, environmentKey: "development")
        store.saveVerifier("verifier-value")

        try backing.deleteAll()
        #expect(store.loadVerifier() == nil)
    }
}

// MARK: - Surviving a restart

/// The real shape of email confirmation: sign up, leave for the mail app, and
/// come back to a process that was killed in between. Everything the flow needs
/// must be on disk, not in memory.
@Suite("Confirmation across an app restart")
struct ConfirmationRestartTests {

    @Test("a verifier written at signup completes an exchange after a restart")
    func verifierSurvivesRestart() async throws {
        // One backing store stands in for the keychain, which outlives both.
        let keychain = InMemorySecureStore()

        // Launch one: sign up.
        let signUpTransport = StubTransport([
            .init(status: 200, body: Data("{\"id\":\"account-1\"}".utf8))
        ])
        let signUpClient = SupabaseAuthClient(
            configuration: pkceConfig(),
            transport: signUpTransport,
            flowState: SecureAuthFlowStore(store: keychain, environmentKey: "development")
        )
        let outcome = try await signUpClient.signUp(email: "p@example.org", password: "pw123456")
        #expect(outcome == .confirmationRequired)

        // The process dies here. Launch two builds everything afresh, reading
        // only what was persisted.
        let exchangeTransport = StubTransport([.init(status: 200, body: sessionJSON())])
        let restartedStore = SecureAuthFlowStore(store: keychain, environmentKey: "development")
        let restartedClient = SupabaseAuthClient(
            configuration: pkceConfig(),
            transport: exchangeTransport,
            flowState: restartedStore
        )

        let session = try await restartedClient.completeEmailConfirmation(code: "code-123456")
        #expect(session.accountId == "account-1")
        #expect(restartedStore.loadVerifier() == nil)
    }

    @Test("a session written at sign-in is restored by a fresh SessionManager")
    func sessionSurvivesRestart() async throws {
        let keychain = InMemorySecureStore()
        let stored = StoredSession(
            accessToken: "access-1",
            refreshToken: "refresh-1",
            expiresAt: Date().addingTimeInterval(3600),
            accountId: "account-1",
            environmentKey: "development"
        )

        let first = SessionManager(
            store: keychain,
            refresher: NeverRefreshes(),
            environmentKey: "development"
        )
        try await first.adopt(stored)

        // Launch two: a new manager over the same keychain, no memory carried.
        let restarted = SessionManager(
            store: keychain,
            refresher: NeverRefreshes(),
            environmentKey: "development"
        )
        let restored = await restarted.currentSession()
        #expect(restored == stored)
        let token = try await restarted.validAccessToken()
        #expect(token == "access-1")
    }

    /// A refresher that would fail the test if a restored, unexpired session
    /// were needlessly renewed.
    private struct NeverRefreshes: SessionRefreshing {
        func refresh(refreshToken: String) async throws -> StoredSession {
            throw AuthFailure(kind: .other, message: "should not refresh")
        }
    }
}
