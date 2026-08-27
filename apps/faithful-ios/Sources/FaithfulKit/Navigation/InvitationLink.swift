import Foundation

/// Recognises `faithful://invite/<token>`.
///
/// Deliberately separate from `DeepLinkParser`: an invitation is a credential
/// to redeem, not a destination to navigate to, and it is valid for a
/// signed-out person — the token is held across sign-in and posted afterwards.
/// Everything else about the parser's posture carries over: fail closed,
/// return nil, never partially accept.
public enum InvitationLink {
    /// The character set invitation tokens are minted from (base64url).
    private static let allowed = CharacterSet(
        charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
    )

    public static func token(from url: URL) -> String? {
        guard url.scheme?.lowercased() == "faithful" else { return nil }
        guard url.host?.lowercased() == "invite" else { return nil }

        let segments = url.pathComponents.filter { $0 != "/" }
        guard segments.count == 1, let candidate = segments.first else { return nil }

        // The contract bounds tokens to 16–512 characters; anything outside
        // that or off-alphabet is refused rather than sent to the server.
        guard candidate.count >= 16, candidate.count <= 512 else { return nil }
        guard candidate.unicodeScalars.allSatisfy(allowed.contains) else { return nil }

        return candidate
    }
}
