import Foundation

/// Recognises custom-scheme and verified faithform.io church invitation links.
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
        guard url.query == nil, url.fragment == nil, url.user == nil, url.password == nil, url.port == nil else { return nil }
        let segments = url.pathComponents.filter { $0 != "/" }
        let candidate: String
        if url.scheme?.lowercased() == "faithform", url.host?.lowercased() == "invite", segments.count == 1 {
            candidate = segments[0]
        } else if url.scheme?.lowercased() == "https", url.port == nil,
                  ["faithform.io", "www.faithform.io"].contains(url.host?.lowercased() ?? ""),
                  segments.count == 3, segments[0] == "faithform", segments[1] == "invite" {
            candidate = segments[2]
        } else { return nil }

        // The contract bounds tokens to 16–512 characters; anything outside
        // that or off-alphabet is refused rather than sent to the server.
        guard candidate.count >= 16, candidate.count <= 512 else { return nil }
        guard candidate.unicodeScalars.allSatisfy(allowed.contains) else { return nil }

        return candidate
    }
}
