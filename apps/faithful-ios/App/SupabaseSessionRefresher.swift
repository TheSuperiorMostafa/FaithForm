import Foundation
import FaithfulKit

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
/// ## What does not exist yet
///
/// **There is no sign-in flow on either platform.** This refreshes a session that
/// already exists; nothing creates one. That is the single blocker to a church
/// pilot, it predates Prompt 12, and it is recorded in
/// `P12_DEVICE_PILOT_RUNBOOK.md` rather than papered over with a placeholder
/// screen that pretends to sign someone in.
struct SupabaseSessionRefresher: SessionRefreshing {
    private let environment: APIEnvironment
    private let supabaseURL: URL?
    private let anonKey: String?

    init(environment: APIEnvironment, info: [String: Any] = Bundle.main.infoDictionary ?? [:]) {
        self.environment = environment
        let url = (info["FaithfulSupabaseURL"] as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        self.supabaseURL = url.isEmpty ? nil : URL(string: url)
        let key = (info["FaithfulSupabaseAnonKey"] as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        self.anonKey = key.isEmpty ? nil : key
    }

    func refresh(refreshToken: String) async throws -> StoredSession {
        // Fails closed, and names the missing key rather than the value. A build
        // with no identity provider configured cannot refresh, and pretending
        // otherwise would leave a person staring at a spinner.
        guard let supabaseURL, let anonKey else {
            throw APIError(
                code: .unavailable,
                message: L.signInBody,
                requestId: "config:FaithfulSupabaseURL/FaithfulSupabaseAnonKey"
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

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            // The provider's body can name an account and an error code written
            // for a developer. Only the class of failure crosses back.
            throw APIError(code: .sessionExpired, message: L.signInBody)
        }

        struct TokenResponse: Decodable {
            let access_token: String
            let refresh_token: String
            let expires_in: Int
            struct User: Decodable { let id: String }
            let user: User
        }

        let decoded = try JSONDecoder().decode(TokenResponse.self, from: data)
        return StoredSession(
            accessToken: decoded.access_token,
            refreshToken: decoded.refresh_token,
            expiresAt: Date().addingTimeInterval(TimeInterval(decoded.expires_in)),
            accountId: decoded.user.id,
            environmentKey: environment.key
        )
    }
}
