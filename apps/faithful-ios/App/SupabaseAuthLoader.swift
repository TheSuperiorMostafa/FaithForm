import Foundation
import FaithfulKit

/// Builds the identity-provider client from the bundle, or declines to.
///
/// Reads the same two keys `SupabaseSessionRefresher` reads —
/// `FaithfulSupabaseURL` and `FaithfulSupabaseAnonKey`, both public by design —
/// and fails closed the same way: a build with no provider configured gets a
/// nil client, and the sign-in screen says so rather than spinning.
enum SupabaseAuthLoader {
    static func load(
        environment: APIEnvironment,
        info: [String: Any] = Bundle.main.infoDictionary ?? [:],
        flowState: AuthFlowStateStoring? = nil
    ) -> SessionAuthenticating? {
        let rawURL = (info["FaithfulSupabaseURL"] as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let anonKey = (info["FaithfulSupabaseAnonKey"] as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""

        guard !rawURL.isEmpty, !anonKey.isEmpty, let url = URL(string: rawURL) else {
            return nil
        }

        return SupabaseAuthClient(
            configuration: SupabaseAuthConfiguration(
                url: url,
                anonKey: anonKey,
                environmentKey: environment.key,
                // Password-reset emails land on this build's own web origin,
                // so a staging build cannot mail someone a production link.
                resetRedirectOrigin: environment.baseURL,
                // Confirmation emails return to this app's own callback — the
                // contract constant, never a value a request or link supplied.
                // Without it the identity provider falls back to its Site URL,
                // which is the church dashboard, not this app.
                signUpRedirectURL: AuthCallbackLink.canonicalURL
            ),
            transport: URLSessionTransport(),
            flowState: flowState
        )
    }
}
