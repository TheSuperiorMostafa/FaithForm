import Foundation
import CryptoKit

/// Recognises `faithful://auth/callback`, the one link an email-confirmation
/// flow may return to this app on.
///
/// The shape is a contract, shared byte-for-byte with Android and the web test
/// suite through `contracts/faithful/v1/auth-callback.json`. Everything about
/// the parser's posture matches `InvitationLink`: fail closed, return nil,
/// never partially accept. The dashboard's own callback — an `https` URL — is
/// deliberately unparseable here, so a web link can never be consumed as a
/// mobile one, and a redirect destination is never taken from the link itself:
/// the only thing a callback may carry in is a code or a failure.
public enum AuthCallbackLink {
    public static let scheme = "faithful"
    public static let host = "auth"
    public static let path = "/callback"
    /// The exact redirect this app registers with the identity provider.
    /// One value for every environment by construction — there is one custom
    /// scheme — and each environment's Supabase project allow-lists it.
    public static let canonical = "faithful://auth/callback"

    public static var canonicalURL: URL { URL(string: canonical)! }

    /// Bounds from the contract: what a provider-minted code may look like.
    /// Anything outside is refused before any network call.
    private static let codePattern = try! NSRegularExpression(
        pattern: "^[A-Za-z0-9._~-]{8,512}$"
    )

    public enum FailureReason: Equatable, Sendable {
        /// The provider said the link was already used or timed out.
        case expired
        /// Our callback shape carrying neither a usable code nor a recognised
        /// failure — a truncated or tampered link.
        case invalid
    }

    public enum Outcome: Equatable, Sendable {
        case code(String)
        case failure(FailureReason)
    }

    /// Nil when the URL is not this app's auth callback at all — a different
    /// deep link, a web URL, a lookalike. Non-nil is always a real state to
    /// show: a code to exchange, or a failure to explain.
    public static func parse(_ url: URL) -> Outcome? {
        guard url.scheme?.lowercased() == scheme else { return nil }
        guard url.host?.lowercased() == host else { return nil }

        // Strict: exactly the registered callback path, nothing appended.
        // This URL is minted by us and returned by the provider verbatim, so
        // there is no legitimate variant to tolerate.
        let segments = url.pathComponents.filter { $0 != "/" }
        guard segments == ["callback"] else { return nil }

        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        let query = components?.queryItems ?? []

        // The provider reports failures in the fragment (and some versions in
        // the query). Only the machine-readable code is read — the
        // description is provider wording and never crosses this boundary.
        // The *raw* fragment is used, so decoding happens exactly once.
        let fragmentItems = Self.items(fromFragment: components?.percentEncodedFragment)
        let errorCode = first("error_code", in: query) ?? first("error_code", in: fragmentItems)
        let error = first("error", in: query) ?? first("error", in: fragmentItems)

        if errorCode != nil || error != nil {
            return .failure(errorCode == "otp_expired" || error == "access_denied" ? .expired : .invalid)
        }

        guard let code = first("code", in: query), isValidCode(code) else {
            return .failure(.invalid)
        }
        return .code(code)
    }

    static func isValidCode(_ value: String) -> Bool {
        let range = NSRange(value.startIndex..., in: value)
        return codePattern.firstMatch(in: value, range: range) != nil
    }

    private static func first(_ name: String, in items: [URLQueryItem]) -> String? {
        items.first(where: { $0.name == name })?.value
    }

    /// Splits a raw fragment into pairs, by hand.
    ///
    /// Deliberately not `URLComponents.percentEncodedQuery`: that setter
    /// **traps** on a value containing characters it considers invalid, and a
    /// provider error description routinely does once decoded (`%20` → a
    /// space). A parser for untrusted input may return nothing; it may not
    /// crash the app, so this one is total by construction.
    private static func items(fromFragment fragment: String?) -> [URLQueryItem] {
        guard let fragment, !fragment.isEmpty else { return [] }

        return fragment.split(separator: "&").compactMap { pair in
            guard let separator = pair.firstIndex(of: "=") else { return nil }
            let name = String(pair[pair.startIndex..<separator])
            let rawValue = String(pair[pair.index(after: separator)...])
            guard !name.isEmpty else { return nil }
            // `+` is a space in form encoding; `removingPercentEncoding`
            // returns nil rather than trapping on a malformed escape.
            let value = rawValue.replacingOccurrences(of: "+", with: " ")
                .removingPercentEncoding ?? rawValue
            return URLQueryItem(name: name, value: value)
        }
    }
}

/// Proof-of-possession for the email-confirmation exchange (RFC 7636).
///
/// The verifier never leaves the device; the challenge travels with signup, and
/// the code the confirmation link carries is worthless without the verifier —
/// which is what makes a custom-scheme callback safe to use: another app that
/// hijacked the scheme would hold a code it cannot spend.
public enum PKCE {
    /// 64 characters from the RFC's unreserved set. `randomElement` draws from
    /// `SystemRandomNumberGenerator`, which is cryptographically secure on
    /// Apple platforms.
    public static func makeVerifier() -> String {
        let alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
        return String((0..<64).map { _ in alphabet.randomElement()! })
    }

    /// base64url(SHA-256(verifier)), no padding — the `s256` method.
    public static func challenge(for verifier: String) -> String {
        let digest = SHA256.hash(data: Data(verifier.utf8))
        return Data(digest)
            .base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

/// Holds the PKCE verifier between signup and the confirmation link's return —
/// across an app restart, because the person is in their mail client in
/// between. One instance per environment; the verifier is credential material
/// and lives wherever sessions live, never in an ordinary preference.
public protocol AuthFlowStateStoring: Sendable {
    func saveVerifier(_ verifier: String)
    func loadVerifier() -> String?
    func clearVerifier()
}

/// The production store: the same keychain service as `SessionManager`, under
/// its own per-environment key, so sign-out's `deleteAll` sweeps it too.
public struct SecureAuthFlowStore: AuthFlowStateStoring {
    private let store: SecureStoring
    private let key: String

    public init(store: SecureStoring, environmentKey: String) {
        self.store = store
        self.key = "authflow.\(environmentKey)"
    }

    public func saveVerifier(_ verifier: String) {
        try? store.write(Data(verifier.utf8), for: key)
    }

    public func loadVerifier() -> String? {
        guard let data = try? store.read(key) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    public func clearVerifier() {
        try? store.delete(key)
    }
}
