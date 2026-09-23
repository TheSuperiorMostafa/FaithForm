import Foundation
import FaithFormKit

/// Builds the identity-provider client from the bundle, or declines to.
///
/// Reads the same two keys `SupabaseSessionRefresher` reads —
/// `FaithFormSupabaseURL` and `FaithFormSupabaseAnonKey`, both public by design —
/// and fails closed the same way: a build with no provider configured gets a
/// nil client, and the sign-in screen says so rather than spinning.
enum SupabaseAuthLoader {
    static func load(
        environment: APIEnvironment,
        info: [String: Any] = Bundle.main.infoDictionary ?? [:],
        flowState: AuthFlowStateStoring? = nil
    ) -> SessionAuthenticating? {
        let rawURL = (info["FaithFormSupabaseURL"] as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let anonKey = (info["FaithFormSupabaseAnonKey"] as? String)?
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
                // Confirmation emails return to this build's own web origin,
                // which hands off to `faithform://auth/callback` from a page
                // rather than from a redirect — a browser will not follow a
                // `302` into a custom scheme, and every confirmation ended on
                // a connection error while this was the scheme itself. Derived
                // from configuration, never from a request or a link; without
                // it the provider falls back to its Site URL, which is the
                // church dashboard, not this app.
                signUpRedirectURL: AuthCallbackLink.confirmRedirect(
                    origin: environment.baseURL
                )
            ),
            transport: URLSessionTransport(),
            flowState: flowState
        )
    }
}
