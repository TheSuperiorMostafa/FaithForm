import Foundation
import Testing
@testable import FaithfulKit

// MARK: - Doubles

private func authConfig(resetOrigin: String? = nil) -> SupabaseAuthConfiguration {
    SupabaseAuthConfiguration(
        url: URL(string: "https://identity.example")!,
        anonKey: "anon-key",
        environmentKey: "development",
        resetRedirectOrigin: resetOrigin.flatMap(URL.init(string:))
    )
}

private func sessionJSON(expiresIn: Int = 3600) -> Data {
    Data("""
    {"access_token":"access-1","refresh_token":"refresh-1","expires_in":\(expiresIn),
     "user":{"id":"account-1"}}
    """.utf8)
}

private func goTrueError(_ code: String, status: Int = 400) -> StubTransport.Exchange {
    StubTransport.Exchange(
        status: status,
        body: Data("{\"error_code\":\"\(code)\",\"msg\":\"internal wording\"}".utf8)
    )
}

/// Scripts the identity provider at the protocol seam, for model tests.
private final class ScriptedAuth: SessionAuthenticating, @unchecked Sendable {
    var signUpResult: Result<SignUpOutcome, Error>
    var signInResult: Result<StoredSession, Error>
    var confirmationResult: Result<StoredSession, Error>
    var resetError: Error?
    private(set) var resetRequests: [String] = []
    private(set) var confirmationCodes: [String] = []

    init(
        signUp: Result<SignUpOutcome, Error> = .failure(AuthFailure(kind: .other, message: "unused")),
        signIn: Result<StoredSession, Error> = .failure(AuthFailure(kind: .other, message: "unused")),
        confirmation: Result<StoredSession, Error> = .failure(AuthFailure(kind: .other, message: "unused"))
    ) {
        signUpResult = signUp
        signInResult = signIn
        confirmationResult = confirmation
    }

    func signUp(email: String, password: String) async throws -> SignUpOutcome {
        try signUpResult.get()
    }

    func signIn(email: String, password: String) async throws -> StoredSession {
        try signInResult.get()
    }

    func sendPasswordReset(email: String) async throws {
        resetRequests.append(email)
        if let resetError { throw resetError }
    }

    func completeEmailConfirmation(code: String) async throws -> StoredSession {
        confirmationCodes.append(code)
        return try confirmationResult.get()
    }
}

private func storedSession(account: String = "account-1") -> StoredSession {
    StoredSession(
        accessToken: "access-1",
        refreshToken: "refresh-1",
        expiresAt: Date().addingTimeInterval(3600),
        accountId: account,
        environmentKey: "development"
    )
}

// MARK: - SupabaseAuthClient

@Suite("Supabase auth client")
struct SupabaseAuthClientTests {

    @Test("signing in decodes a session for this environment")
    func signInDecodesSession() async throws {
        let transport = StubTransport([.init(status: 200, body: sessionJSON())])
        let client = SupabaseAuthClient(configuration: authConfig(), transport: transport)

        let session = try await client.signIn(email: "p@example.org", password: "pw123456")

        #expect(session.accessToken == "access-1")
        #expect(session.refreshToken == "refresh-1")
        #expect(session.accountId == "account-1")
        #expect(session.environmentKey == "development")
    }

    @Test("the request carries the anon key and the password grant")
    func signInRequestShape() async throws {
        let transport = StubTransport([.init(status: 200, body: sessionJSON())])
        let client = SupabaseAuthClient(configuration: authConfig(), transport: transport)

        _ = try await client.signIn(email: "p@example.org", password: "pw123456")

        let apikey = await transport.header("apikey", at: 0)
        #expect(apikey == "anon-key")
        let url = await transport.received.first?.url?.absoluteString ?? ""
        #expect(url.contains("auth/v1/token"))
        #expect(url.contains("grant_type=password"))
    }

    @Test("a wrong password becomes a sentence, never the provider's wording")
    func wrongPasswordMapped() async {
        let transport = StubTransport([goTrueError("invalid_credentials")])
        let client = SupabaseAuthClient(configuration: authConfig(), transport: transport)

        await #expect(throws: AuthFailure.self) {
            _ = try await client.signIn(email: "p@example.org", password: "nope")
        }
        // And the mapped failure is the friendly one:
        do {
            _ = try await client.signIn(email: "p@example.org", password: "nope")
        } catch let failure as AuthFailure {
            #expect(failure.kind == .offline) // queue exhausted -> transport error
        } catch {
            Issue.record("unexpected error type")
        }
    }

    @Test("signup with autoconfirm returns a session")
    func signUpSession() async throws {
        let transport = StubTransport([.init(status: 200, body: sessionJSON())])
        let client = SupabaseAuthClient(configuration: authConfig(), transport: transport)

        let outcome = try await client.signUp(email: "p@example.org", password: "pw123456")

        guard case let .session(session) = outcome else {
            Issue.record("expected a session")
            return
        }
        #expect(session.accountId == "account-1")
    }

    @Test("signup under email confirmation reports confirmationRequired, not an error")
    func signUpConfirmationRequired() async throws {
        let body = Data("{\"id\":\"account-1\",\"email\":\"p@example.org\",\"confirmation_sent_at\":\"2026-08-26T00:00:00Z\"}".utf8)
        let transport = StubTransport([.init(status: 200, body: body)])
        let client = SupabaseAuthClient(configuration: authConfig(), transport: transport)

        let outcome = try await client.signUp(email: "p@example.org", password: "pw123456")
        #expect(outcome == .confirmationRequired)
    }

    @Test("an existing account maps to accountExists")
    func signUpExistingAccount() async {
        let transport = StubTransport([goTrueError("user_already_exists", status: 422)])
        let client = SupabaseAuthClient(configuration: authConfig(), transport: transport)

        do {
            _ = try await client.signUp(email: "p@example.org", password: "pw123456")
            Issue.record("expected a failure")
        } catch let failure as AuthFailure {
            #expect(failure.kind == .accountExists)
            #expect(!failure.message.contains("internal wording"))
        } catch {
            Issue.record("unexpected error type")
        }
    }

    @Test("429 maps to rateLimited")
    func rateLimited() async {
        let transport = StubTransport([.init(status: 429, body: Data("{}".utf8))])
        let client = SupabaseAuthClient(configuration: authConfig(), transport: transport)

        do {
            _ = try await client.signIn(email: "p@example.org", password: "pw123456")
            Issue.record("expected a failure")
        } catch let failure as AuthFailure {
            #expect(failure.kind == .rateLimited)
        } catch {
            Issue.record("unexpected error type")
        }
    }

    @Test("no network maps to offline")
    func offline() async {
        let transport = StubTransport([]) // empty queue throws URLError
        let client = SupabaseAuthClient(configuration: authConfig(), transport: transport)

        do {
            _ = try await client.signIn(email: "p@example.org", password: "pw123456")
            Issue.record("expected a failure")
        } catch let failure as AuthFailure {
            #expect(failure.kind == .offline)
        } catch {
            Issue.record("unexpected error type")
        }
    }

    @Test("a reset request points the email at this build's own origin")
    func resetCarriesRedirect() async throws {
        let transport = StubTransport([.init(status: 200, body: Data("{}".utf8))])
        let client = SupabaseAuthClient(
            configuration: authConfig(resetOrigin: "https://app.example"),
            transport: transport
        )

        try await client.sendPasswordReset(email: "p@example.org")

        let url = await transport.received.first?.url?.absoluteString ?? ""
        #expect(url.contains("auth/v1/recover"))
        #expect(url.contains("redirect_to="))
        #expect(url.contains("app.example"))
    }

    @Test("an unknown address reads exactly like success")
    func resetDoesNotConfirmAccounts() async throws {
        let transport = StubTransport([goTrueError("user_not_found", status: 400)])
        let client = SupabaseAuthClient(configuration: authConfig(), transport: transport)

        // No throw: the reply is indistinguishable from the happy path.
        try await client.sendPasswordReset(email: "unknown@example.org")
    }
}

// MARK: - AuthModel

@MainActor
@Suite("Auth model")
struct AuthModelTests {

    @Test("a successful sign-in hands the session to the composition root")
    func signInSuccess() async {
        let auth = ScriptedAuth(signIn: .success(storedSession()))
        var received: StoredSession?
        let model = AuthModel(auth: auth) { session, _ in received = session }
        model.email = "p@example.org"
        model.password = "pw123456"

        await model.signIn()

        #expect(received?.accountId == "account-1")
        #expect(model.phase == .idle)
    }

    @Test("creating an account passes the typed name through for the profile")
    func signUpPassesName() async {
        let auth = ScriptedAuth(signUp: .success(.session(storedSession())))
        var receivedName: String??
        let model = AuthModel(auth: auth) { _, name in receivedName = name }
        model.name = "  Sarah Okafor  "
        model.email = "p@example.org"
        model.password = "pw123456"

        await model.createAccount()

        #expect(receivedName == "Sarah Okafor")
    }

    @Test("confirmation-required lands on checkEmail, not on an error")
    func signUpConfirmationRequired() async {
        let auth = ScriptedAuth(signUp: .success(.confirmationRequired))
        let model = AuthModel(auth: auth) { _, _ in
            Issue.record("no session should be handed over")
        }
        model.email = "p@example.org"
        model.password = "pw123456"

        await model.createAccount()

        #expect(model.phase == .checkEmail)
    }

    @Test("an empty form never reaches the network")
    func localValidation() async {
        let auth = ScriptedAuth()
        let model = AuthModel(auth: auth) { _, _ in }

        await model.signIn()
        guard case .failed = model.phase else {
            Issue.record("expected a validation failure")
            return
        }

        model.email = "p@example.org"
        model.password = "short"
        await model.createAccount()
        #expect(model.phase == .failed(L.authErrorWeakPassword))
    }

    @Test("a failed sign-in shows the failure's own sentence")
    func signInFailure() async {
        let auth = ScriptedAuth(
            signIn: .failure(AuthFailure(kind: .invalidCredentials, message: L.authErrorInvalidCredentials))
        )
        let model = AuthModel(auth: auth) { _, _ in }
        model.email = "p@example.org"
        model.password = "wrong-password"

        await model.signIn()

        #expect(model.phase == .failed(L.authErrorInvalidCredentials))
    }

    @Test("no configured provider fails closed with its own sentence")
    func unconfigured() async {
        let model = AuthModel(auth: nil) { _, _ in }
        model.email = "p@example.org"
        model.password = "pw123456"

        await model.signIn()

        #expect(model.phase == .failed(L.authErrorUnconfigured))
    }

    @Test("leaving a screen clears the password and the error, never the email")
    func resetForNewScreen() async {
        let model = AuthModel(auth: nil) { _, _ in }
        model.email = "p@example.org"
        model.password = "pw123456"
        await model.signIn() // -> failed(unconfigured)

        model.resetForNewScreen()

        #expect(model.password.isEmpty)
        #expect(model.phase == .idle)
        #expect(model.email == "p@example.org")
    }
}

// MARK: - Invitation links

@Suite("Invitation links")
struct InvitationLinkTests {

    @Test("a well-formed invite link yields its token")
    func parsesToken() {
        let token = String(repeating: "a", count: 32)
        let url = URL(string: "faithful://invite/\(token)")!
        #expect(InvitationLink.token(from: url) == token)
    }

    @Test("everything else is refused", arguments: [
        "https://invite/aaaaaaaaaaaaaaaaaaaaaaaa",       // wrong scheme
        "faithful://home",                                // wrong host
        "faithful://invite/short",                        // too short
        "faithful://invite/aaaaaaaaaaaaaaaa/extra",       // extra segment
        "faithful://invite/aaaaaaaa!aaaaaaaaaa",          // off-alphabet
        "faithful://invite/",                             // empty
    ])
    func refuses(_ raw: String) {
        let url = URL(string: raw)!
        #expect(InvitationLink.token(from: url) == nil)
    }
}

// MARK: - OnboardingModel

@MainActor
@Suite("Onboarding model")
struct OnboardingModelTests {

    private func client(_ exchanges: [StubTransport.Exchange]) -> (APIClient, StubTransport) {
        let transport = StubTransport(exchanges)
        let client = APIClient(
            configuration: .init(
                environment: APIEnvironment(key: "development", baseURL: URL(string: "https://api.example")!),
                clientBuild: 1
            ),
            transport: transport,
            tokens: StaticTokens()
        )
        return (client, transport)
    }

    private actor StaticTokens: TokenProviding {
        func validAccessToken() async throws -> String { "token" }
        func invalidate() async {}
    }

    private func envelope(_ json: String) -> Data {
        Data("""
        {"ok":true,"data":\(json),
         "meta":{"apiVersion":"1.0","apiMajor":1,"requestId":"r","minimumSupportedClientBuild":1}}
        """.utf8)
    }

    private func failureEnvelope(code: String, status: Int) -> StubTransport.Exchange {
        .init(status: status, body: Data("""
        {"ok":false,"error":{"code":"\(code)","message":"server sentence","retryable":false},
         "meta":{"apiVersion":"1.0","apiMajor":1,"requestId":"r","minimumSupportedClientBuild":1}}
        """.utf8))
    }

    @Test("the first screen is the server's decision, fetched not inferred")
    func refreshFetchesState() async {
        let (api, transport) = client([.init(status: 200, body: envelope("""
        {"needsOnboarding":true,"hasAnyRelationship":false,"selectedChurchSlug":null,
         "activeChurchCount":0,"requiresChurchChooser":false}
        """))])
        let model = OnboardingModel(api: api)

        let state = await model.refresh()

        #expect(state?.needsOnboarding == true)
        let url = await transport.received.first?.url?.absoluteString ?? ""
        #expect(url.contains("api/mobile/v1/onboarding"))
    }

    @Test("accepting an invitation posts the token with an idempotency key")
    func acceptPostsIdempotently() async {
        let token = String(repeating: "b", count: 32)
        let (api, transport) = client([
            .init(status: 200, body: envelope("{\"churchSlug\":\"grace\",\"churchName\":\"Grace\",\"state\":\"joined\"}"))
        ])
        let model = OnboardingModel(api: api)

        let accepted = await model.acceptInvitation(token)

        #expect(accepted)
        let key = await transport.header("Idempotency-Key", at: 0)
        #expect(key?.isEmpty == false)
    }

    @Test("an invitation is named without being spent")
    func previewNamesChurchWithoutRedeeming() async {
        let token = String(repeating: "d", count: 32)
        let (api, transport) = client([
            .init(status: 200, body: envelope(
                "{\"churchSlug\":\"grace\",\"churchName\":\"Grace\",\"logoUrl\":null}"
            ))
        ])
        let model = OnboardingModel(api: api)

        await model.resolveChurchContext(invitationToken: token)

        #expect(model.churchContext?.churchName == "Grace")
        #expect(model.churchContext?.isInvitation == true)
        // Preview, never accept: a single-use invitation read on the sign-in
        // screen must still work when the person finishes signing up.
        let url = await transport.received.first?.url?.absoluteString ?? ""
        #expect(url.contains("invitations/preview"))
        let calls = await transport.received.count
        #expect(calls == 1)
    }

    @Test("an unusable invitation leaves an ordinary sign-up screen behind")
    func previewFailureIsSilent() async {
        let (api, _) = client([failureEnvelope(code: "not_found", status: 404)])
        let model = OnboardingModel(api: api)

        await model.resolveChurchContext(invitationToken: String(repeating: "e", count: 32))

        // No context, no error state, no dead end — just the generic front door.
        #expect(model.churchContext == nil)
    }

    @Test("a church link names the church and carries no authority")
    func slugContextCarriesNoToken() async {
        let (api, _) = client([.init(status: 200, body: envelope("""
        {"slug":"grace","name":"Grace","logoUrl":null,"coverImageUrl":null,"publicSummary":null,
         "tagline":null,"denomination":null,"address":null,"city":null,"state":null,
         "postalCode":null,"website":null,"phone":null,"email":null,"joinPolicy":"open",
         "timezone":"UTC","publicProfileVersion":1,"campuses":[],"serviceTimes":[],
         "relationshipState":null}
        """))])
        let model = OnboardingModel(api: api)

        await model.resolveChurchContext(churchSlug: "grace")

        #expect(model.churchContext?.churchSlug == "grace")
        #expect(model.churchContext?.invitationToken == nil)
        #expect(model.churchContext?.isInvitation == false)
    }

    @Test("disowning the church drops the invitation it arrived with")
    func clearingContextDropsHeldToken() async {
        let token = String(repeating: "f", count: 32)
        let (api, _) = client([
            .init(status: 200, body: envelope(
                "{\"churchSlug\":\"grace\",\"churchName\":\"Grace\",\"logoUrl\":null}"
            ))
        ])
        let model = OnboardingModel(api: api)
        model.hold(invitationToken: token)
        await model.resolveChurchContext(invitationToken: token)

        model.clearChurchContext()

        // "Not your church?" has to mean it. A context the person disowned must
        // not quietly redeem itself once they finish signing up.
        #expect(model.churchContext == nil)
        #expect(model.pendingInvitationToken == nil)
    }

    @Test("a retry of the same token reuses the same idempotency key")
    func retryReusesKey() async {
        let token = String(repeating: "c", count: 32)
        let (api, transport) = client([
            failureEnvelope(code: "unavailable", status: 503),
            .init(status: 200, body: envelope("{\"churchSlug\":\"grace\",\"churchName\":\"Grace\",\"state\":\"joined\"}")),
        ])
        let model = OnboardingModel(api: api)

        _ = await model.acceptInvitation(token)
        _ = await model.acceptInvitation(token)

        let first = await transport.header("Idempotency-Key", at: 0)
        let second = await transport.header("Idempotency-Key", at: 1)
        #expect(first != nil)
        #expect(first == second)
    }

    @Test("a token too short to be real is refused before any network call")
    func shortTokenRefusedLocally() async {
        let (api, transport) = client([])
        let model = OnboardingModel(api: api)

        let accepted = await model.acceptInvitation("tiny")

        #expect(!accepted)
        #expect(model.invitationPhase == .failed(L.invitationErrorInvalid))
        let count = await transport.requestCount()
        #expect(count == 0)
    }

    @Test("an expired invitation gets its own sentence")
    func expiredInvitation() async {
        let token = String(repeating: "d", count: 32)
        let (api, _) = client([failureEnvelope(code: "invitation_expired", status: 410)])
        let model = OnboardingModel(api: api)

        let accepted = await model.acceptInvitation(token)

        #expect(!accepted)
        #expect(model.invitationPhase == .failed(L.invitationErrorExpired))
    }

    @Test("a deep-linked token is held, and cleared once redeemed")
    func pendingTokenLifecycle() async {
        let token = String(repeating: "e", count: 32)
        let (api, _) = client([
            .init(status: 200, body: envelope("{\"churchSlug\":\"grace\",\"churchName\":\"Grace\",\"state\":\"joined\"}"))
        ])
        let model = OnboardingModel(api: api)

        model.hold(invitationToken: token)
        #expect(model.pendingInvitationToken == token)

        _ = await model.acceptInvitation(token)
        #expect(model.pendingInvitationToken == nil)
    }

    @Test("a pasted link is normalized to its token")
    func normalizesPastedLink() {
        let token = String(repeating: "f", count: 32)
        let (api, _) = client([])
        let model = OnboardingModel(api: api)

        #expect(model.normalize("faithful://invite/\(token)") == token)
        #expect(model.normalize("https://faithform.io/faithful/invite/\(token)") == token)
        #expect(model.normalize("  \(token)  ") == token)
    }

    @Test("consent is recorded only when no version was ever accepted")
    func consentOnlyWhenNull() async throws {
        let accepted = try JSONDecoder.faithful.decode(
            Bootstrap.self,
            from: bootstrapJSON(termsVersion: "2026-08-01", privacyVersion: "2026-08-01")
        )
        let fresh = try JSONDecoder.faithful.decode(
            Bootstrap.self,
            from: bootstrapJSON(termsVersion: nil, privacyVersion: nil)
        )

        let (api1, transport1) = client([])
        await OnboardingModel(api: api1).recordInitialConsent(for: accepted)
        let untouched = await transport1.requestCount()
        #expect(untouched == 0)

        let (api2, transport2) = client([.init(status: 200, body: envelope("{\"termsVersion\":\"2026-08-01\"}"))])
        await OnboardingModel(api: api2).recordInitialConsent(for: fresh)
        let posted = await transport2.requestCount()
        #expect(posted == 1)
        let url = await transport2.received.first?.url?.absoluteString ?? ""
        #expect(url.contains("account/consent"))
    }

    private func bootstrapJSON(termsVersion: String?, privacyVersion: String?) -> Data {
        let terms = termsVersion.map { "\"\($0)\"" } ?? "null"
        let privacy = privacyVersion.map { "\"\($0)\"" } ?? "null"
        return Data("""
        {"profile":{"displayName":null,"avatarUrl":null,"status":"active",
          "termsVersion":\(terms),"termsAcceptedAt":null,
          "privacyVersion":\(privacy),"privacyAcceptedAt":null,
          "autoAttendanceConsent":"unset","communicationPrefs":{},
          "selectedChurchSlug":null,"authorizationVersion":1},
         "relationships":[],"pendingRequests":[],
         "requiredTermsVersion":"2026-08-01","requiredPrivacyVersion":"2026-08-01",
         "enabledCapabilities":["account"],"serverTime":"2026-08-26T00:00:00Z"}
        """.utf8)
    }
}
