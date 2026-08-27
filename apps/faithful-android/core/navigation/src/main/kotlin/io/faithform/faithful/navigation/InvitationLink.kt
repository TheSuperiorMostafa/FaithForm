package io.faithform.faithful.navigation

/**
 * Recognises `faithful://invite/<token>`.
 *
 * Deliberately separate from [DeepLinkParser]: an invitation is a credential
 * to redeem, not a destination to navigate to, and it is valid for a
 * signed-out person — the token is held across sign-in and posted afterwards.
 * The parser's posture carries over: fail closed, return null, never partially
 * accept. Mirrors `InvitationLink.swift` on iOS, rule for rule.
 */
object InvitationLink {
    private val allowed = Regex("^[A-Za-z0-9_-]+$")

    fun token(raw: String): String? {
        val trimmed = raw.trim()
        val prefix = "faithful://invite/"
        if (!trimmed.lowercase().startsWith(prefix)) return null

        val remainder = trimmed.substring(prefix.length).trimEnd('/')
        // One path segment, nothing else — no query, no fragment, no nesting.
        if (remainder.isEmpty()) return null
        if (remainder.any { it == '/' || it == '?' || it == '#' }) return null

        // The contract bounds tokens to 16–512 characters; anything outside
        // that or off-alphabet is refused rather than sent to the server.
        if (remainder.length < 16 || remainder.length > 512) return null
        if (!allowed.matches(remainder)) return null

        return remainder
    }
}
