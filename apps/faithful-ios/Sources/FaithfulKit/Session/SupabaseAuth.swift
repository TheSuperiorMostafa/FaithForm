import Foundation

/// Signing in and creating an account, against Supabase's GoTrue endpoints.
///
/// ## Where this sits
///
/// `SessionManager` owns the token lifecycle and `SessionRefreshing` renews a
/// session that already exists. This is the missing third piece: the calls that
/// *create* one. It lives in the library, behind `HTTPTransport`, so every path
/// through it — success, wrong password, unconfirmed email, rate limit, no
/// network — is testable without a device or a live identity provider.
///
/// ## What it may hold
///
/// The Supabase URL and the **publishable/anon** key, both designed to ship in
/// clients. Neither authorises anything on its own — row-level security decides
/// what a token can reach. A service-role key must never appear here.
public struct SupabaseAuthConfiguration: Sendable {
    public let url: URL
    public let anonKey: String
    public let environmentKey: String
    /// The web app's origin, used only to send password-reset emails back to
    /// the product's own reset screen. Optional: without it the reset email
    /// falls back to the identity provider's configured site URL.
    public let resetRedirectOrigin: URL?

    public init(
        url: URL,
        anonKey: String,
        environmentKey: String,
        resetRedirectOrigin: URL? = nil
    ) {
        self.url = url
        self.anonKey = anonKey
        self.environmentKey = environmentKey
        self.resetRedirectOrigin = resetRedirectOrigin
    }
}

/// What creating an account produced.
///
/// Both cases are success. A project with email confirmation switched on
/// returns the person, not a session — and pretending otherwise would leave
/// them staring at a spinner waiting for a token that is in their inbox.
public enum SignUpOutcome: Sendable, Equatable {
    case session(StoredSession)
    case confirmationRequired
}

/// Why an auth call failed, in terms a screen can act on.
///
/// The `message` is already the sentence to show. No provider string crosses
/// this boundary: GoTrue's error bodies name accounts and internals written
/// for a developer, and only the *class* of failure is allowed through.
public struct AuthFailure: Error, Sendable, Equatable {
    public enum Kind: Sendable, Equatable {
        case invalidCredentials
        case accountExists
        case weakPassword
        case emailNotConfirmed
        case rateLimited
        case offline
        case notConfigured
        case other
    }

    public let kind: Kind
    public let message: String

    public init(kind: Kind, message: String) {
        self.kind = kind
        self.message = message
    }
}

/// The seam feature models depend on, so a test can script outcomes without
/// ever constructing a transport.
public protocol SessionAuthenticating: Sendable {
    func signUp(email: String, password: String) async throws -> SignUpOutcome
    func signIn(email: String, password: String) async throws -> StoredSession
    func sendPasswordReset(email: String) async throws
}

public struct SupabaseAuthClient: SessionAuthenticating {
    private let configuration: SupabaseAuthConfiguration
    private let transport: HTTPTransport
    private let now: @Sendable () -> Date

    public init(
        configuration: SupabaseAuthConfiguration,
        transport: HTTPTransport,
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.configuration = configuration
        self.transport = transport
        self.now = now
    }

    // MARK: - Calls

    public func signUp(email: String, password: String) async throws -> SignUpOutcome {
        let (data, http) = try await post(
            path: "auth/v1/signup",
            body: ["email": email, "password": password]
        )

        guard (200..<300).contains(http.statusCode) else {
            throw Self.failure(from: data, status: http.statusCode)
        }

        // With autoconfirm on, signup answers with a full session. With email
        // confirmation on, it answers with the user alone — the session comes
        // later, after they sign in with a confirmed address.
        if let session = try? decodeSession(from: data) {
            return .session(session)
        }
        return .confirmationRequired
    }

    public func signIn(email: String, password: String) async throws -> StoredSession {
        let (data, http) = try await post(
            path: "auth/v1/token",
            query: "grant_type=password",
            body: ["email": email, "password": password]
        )

        guard (200..<300).contains(http.statusCode) else {
            throw Self.failure(from: data, status: http.statusCode)
        }

        do {
            return try decodeSession(from: data)
        } catch {
            throw AuthFailure(kind: .other, message: L.authErrorGeneric)
        }
    }

    public func sendPasswordReset(email: String) async throws {
        // The link lands on the web app's own reset screen. The origin is the
        // same one this build already talks to, so a staging build's reset
        // email cannot point at production.
        var query: String?
        if let origin = configuration.resetRedirectOrigin {
            let next = "/set-password?reason=recovery"
            let callback = "\(origin.absoluteString)/auth/callback?next=" +
                (next.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? "")
            let encoded = callback.addingPercentEncoding(
                withAllowedCharacters: .urlQueryAllowed.subtracting(CharacterSet(charactersIn: "&=?"))
            ) ?? callback
            query = "redirect_to=\(encoded)"
        }

        let (data, http) = try await post(
            path: "auth/v1/recover",
            query: query,
            body: ["email": email]
        )

        guard (200..<300).contains(http.statusCode) else {
            let failure = Self.failure(from: data, status: http.statusCode)
            // "No such account" must read exactly like success, or this form
            // becomes a way to test addresses. Only a real obstacle surfaces.
            if failure.kind == .rateLimited || failure.kind == .offline { throw failure }
            return
        }
    }

    // MARK: - Plumbing

    private func post(
        path: String,
        query: String? = nil,
        body: [String: String]
    ) async throws -> (Data, HTTPURLResponse) {
        var absolute = configuration.url.appendingPathComponent(path).absoluteString
        if let query { absolute += "?\(query)" }
        guard let url = URL(string: absolute) else {
            throw AuthFailure(kind: .notConfigured, message: L.authErrorUnconfigured)
        }

        var request = URLRequest(url: url, timeoutInterval: 20)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(configuration.anonKey, forHTTPHeaderField: "apikey")
        request.httpBody = try JSONEncoder.faithful.encode(body)

        do {
            return try await transport.perform(request)
        } catch {
            throw AuthFailure(kind: .offline, message: L.authErrorOffline)
        }
    }

    private struct TokenResponse: Decodable {
        let access_token: String
        let refresh_token: String
        let expires_in: Int
        struct User: Decodable { let id: String }
        let user: User
    }

    private func decodeSession(from data: Data) throws -> StoredSession {
        let decoded = try JSONDecoder.faithful.decode(TokenResponse.self, from: data)
        return StoredSession(
            accessToken: decoded.access_token,
            refreshToken: decoded.refresh_token,
            expiresAt: now().addingTimeInterval(TimeInterval(decoded.expires_in)),
            accountId: decoded.user.id,
            environmentKey: configuration.environmentKey
        )
    }

    /// GoTrue has answered with several error shapes over its lifetime. All of
    /// them are read, none of them is shown: what crosses back is a typed kind
    /// and one of our own sentences.
    private struct GoTrueError: Decodable {
        let error_code: String?
        let error: String?
        let msg: String?
        let error_description: String?
    }

    static func failure(from data: Data, status: Int) -> AuthFailure {
        let decoded = try? JSONDecoder.faithful.decode(GoTrueError.self, from: data)
        let code = decoded?.error_code ?? decoded?.error ?? ""
        let text = (decoded?.msg ?? decoded?.error_description ?? "").lowercased()

        if status == 429 || code == "over_request_rate_limit" || code == "over_email_send_rate_limit" {
            return AuthFailure(kind: .rateLimited, message: L.authErrorRateLimited)
        }
        if code == "invalid_credentials" || code == "invalid_grant"
            || text.contains("invalid login credentials") {
            return AuthFailure(kind: .invalidCredentials, message: L.authErrorInvalidCredentials)
        }
        if code == "user_already_exists" || code == "email_exists"
            || text.contains("already registered") {
            return AuthFailure(kind: .accountExists, message: L.authErrorAccountExists)
        }
        if code == "weak_password" || text.contains("password") && text.contains("at least") {
            return AuthFailure(kind: .weakPassword, message: L.authErrorWeakPassword)
        }
        if code == "email_not_confirmed" || text.contains("email not confirmed") {
            return AuthFailure(kind: .emailNotConfirmed, message: L.authErrorEmailUnconfirmed)
        }
        if status >= 500 {
            return AuthFailure(kind: .offline, message: L.authErrorOffline)
        }
        return AuthFailure(kind: .other, message: L.authErrorGeneric)
    }
}
