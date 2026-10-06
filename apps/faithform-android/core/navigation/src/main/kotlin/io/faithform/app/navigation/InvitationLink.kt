package io.faithform.app.navigation

import java.net.URI

/**
 * Recognises custom-scheme and verified faithform.io church invitation links.
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
        val uri = try { URI(trimmed) } catch (_: Exception) { return null }
        if (uri.rawQuery != null || uri.rawFragment != null || uri.rawUserInfo != null || uri.port != -1) return null
        val parts = uri.path.orEmpty().trim('/').split('/')
        val remainder = when {
            uri.scheme?.lowercase() == "faithform" && uri.host?.lowercase() == "invite" && parts.size == 1 -> parts[0]
            uri.scheme?.lowercase() == "https" && uri.host?.lowercase() in setOf("faithform.io", "www.faithform.io") &&
                parts.size == 3 && parts[0] == "faithform" && parts[1] == "invite" -> parts[2]
            else -> return null
        }
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
