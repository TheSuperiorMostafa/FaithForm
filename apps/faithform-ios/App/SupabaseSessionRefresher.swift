import Foundation
import FaithFormKit

/// Exchanges a refresh token for a new session, against Supabase's token
/// endpoint.
///
/// ## Why this lives in the app and not the library
///
/// It is the one piece of the session that depends on *which* identity provider
/// this deployment uses. `SessionStore` owns the lifecycle — expiry,
/// single-flight refresh, invalidation — and takes a `SessionRefreshing` so that
/// choice stays at the composition root. Android has the same seam.
///
/// ## What it may hold
///
/// The Supabase URL and the **publishable/anon** key, both of which are designed
/// to ship in clients and neither of which authorises anything on its own —
/// row-level security decides what a token can reach. A service-role key must
/// never appear here, and a scan asserts it does not.
///
/// ## The other half
///
/// Sessions are *created* by `SupabaseAuthClient` in FaithFormKit, behind the
/// sign-in flow. This stays separate and refresh-only: renewal runs inside
/// `SessionManager`'s single-flight path with no UI anywhere near it.
///
/// ## Which failures end a session
///
/// Exactly one: Supabase refusing the refresh token, decided by
/// `SupabaseRefreshRejection` and thrown as `.sessionExpired`. No network, a
/// timeout, a 5xx, a rate limit or an unreadable body are thrown as
/// `.unavailable`, and `SessionManager` keeps the session through them — see
/// `SessionRefreshing`.
struct SupabaseSessionRefresher: SessionRefreshing {
    private let environment: APIEnvironment
    private let supabaseURL: URL?
    private let anonKey: String?

    init(environment: APIEnvironment, info: [String: Any] = Bundle.main.infoDictionary ?? [:]) {
        self.environment = environment
        let url = (info["FaithFormSupabaseURL"] as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        self.supabaseURL = url.isEmpty ? nil : URL(string: url)
        let key = (info["FaithFormSupabaseAnonKey"] as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        self.anonKey = key.isEmpty ? nil : key
    }

    func refresh(refreshToken: String) async throws -> StoredSession {
        // Fails closed, and names the missing key rather than the value. A build
        // with no identity provider configured cannot refresh, and pretending
        // otherwise would leave a person staring at a spinner. Not a rejection
        // of the token, though, so the session is kept.
        guard let supabaseURL, let anonKey else {
            throw APIError(
                code: .unavailable,
                message: L.signInBody,
                requestId: "config:FaithFormSupabaseURL/FaithFormSupabaseAnonKey"
            )
        }

        var request = URLRequest(
            url: supabaseURL.appendingPathComponent("auth/v1/token")
        )
        request.url = URL(string: request.url!.absoluteString + "?grant_type=refresh_token")
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(anonKey, forHTTPHeaderField: "apikey")
        request.httpBody = try JSONEncoder().encode(["refresh_token": refreshToken])
        request.timeoutInterval = 20

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            // A screen that went away is not an answer about the token.
            if error.isCancellation { throw CancellationError() }
            // Offline, timed out, DNS, TLS. The request never got an answer
            // about the token, so this must not read as one.
            throw APIError.transport(error)
        }

        guard let http = response as? HTTPURLResponse else {
            throw APIError.transport(URLError(.badServerResponse))
        }

        guard (200..<300).contains(http.statusCode) else {
            // The provider's body can name an account and an error code written
            // for a developer. It is read only to decide *which* of two classes
            // this is, and only the class crosses back.
            if SupabaseRefreshRejection.isDefinitive(status: http.statusCode, body: data) {
                throw APIError(code: .sessionExpired, message: L.signInBody)
            }
            throw APIError.transport(URLError(.badServerResponse))
        }

        struct TokenResponse: Decodable {
            let access_token: String
            let refresh_token: String
            let expires_in: Int
            struct User: Decodable { let id: String }
            let user: User
        }

        let decoded: TokenResponse
        do {
            decoded = try JSONDecoder().decode(TokenResponse.self, from: data)
        } catch {
            // A 200 nobody could read — a captive portal's page, most often.
            throw APIError.transport(error)
        }
        return StoredSession(
            accessToken: decoded.access_token,
            refreshToken: decoded.refresh_token,
            expiresAt: Date().addingTimeInterval(TimeInterval(decoded.expires_in)),
            accountId: decoded.user.id,
            environmentKey: environment.key
        )
    }
}
