package io.faithform.faithful.navigation

import java.net.URLDecoder

/**
 * Recognises `faithful://auth/callback`, the one link an email-confirmation
 * flow may return to this app on.
 *
 * The shape is a contract, shared byte-for-byte with iOS and the web test
 * suite through `contracts/faithful/v1/auth-callback.json`, and this mirrors
 * `AuthCallbackLink.swift` rule for rule. The posture matches [InvitationLink]:
 * fail closed, return null, never partially accept. The dashboard's own
 * callback — an `https` URL — is deliberately unparseable here, so a web link
 * can never be consumed as a mobile one, and a redirect destination is never
 * taken from the link itself: the only thing a callback may carry in is a
 * code or a failure.
 */
object AuthCallbackLink {
    const val SCHEME = "faithful"
    const val HOST = "auth"
    const val PATH = "/callback"

    /**
     * The exact redirect this app registers with the identity provider. One
     * value for every environment by construction — there is one custom
     * scheme — and each environment's Supabase project allow-lists it.
     */
    const val CANONICAL = "faithful://auth/callback"

    /** Bounds from the contract: what a provider-minted code may look like.
     * Anything outside is refused before any network call. */
    private val codePattern = Regex("^[A-Za-z0-9._~-]{8,512}$")

    enum class FailureReason {
        /** The provider said the link was already used or timed out. */
        EXPIRED,

        /** Our callback shape carrying neither a usable code nor a recognised
         * failure — a truncated or tampered link. */
        INVALID
    }

    sealed interface Outcome {
        data class Code(val value: String) : Outcome
        data class Failure(val reason: FailureReason) : Outcome
    }

    /**
     * Null when the raw string is not this app's auth callback at all — a
     * different deep link, a web URL, a lookalike. Non-null is always a real
     * state to show: a code to exchange, or a failure to explain.
     */
    fun parse(raw: String): Outcome? {
        // Split by hand rather than through `java.net.URI`, which *throws* on
        // input it considers malformed — a provider error description with a
        // broken percent escape would then read as "not our link at all"
        // instead of as the failure it is. A parser for untrusted input may
        // return nothing; it may not lose a real state, so this one is total.
        val trimmed = raw.trim()
        val schemeEnd = trimmed.indexOf("://")
        if (schemeEnd <= 0) return null
        if (!trimmed.substring(0, schemeEnd).equals(SCHEME, ignoreCase = true)) return null

        var rest = trimmed.substring(schemeEnd + 3)

        val hashIndex = rest.indexOf('#')
        val rawFragment = if (hashIndex >= 0) rest.substring(hashIndex + 1) else null
        if (hashIndex >= 0) rest = rest.substring(0, hashIndex)

        val questionIndex = rest.indexOf('?')
        val rawQuery = if (questionIndex >= 0) rest.substring(questionIndex + 1) else null
        if (questionIndex >= 0) rest = rest.substring(0, questionIndex)

        val slashIndex = rest.indexOf('/')
        val host = if (slashIndex >= 0) rest.substring(0, slashIndex) else rest
        val path = if (slashIndex >= 0) rest.substring(slashIndex) else ""
        if (!host.equals(HOST, ignoreCase = true)) return null

        // Strict: exactly the registered callback path, nothing appended.
        // This URL is minted by us and returned by the provider verbatim, so
        // there is no legitimate variant to tolerate.
        if (path != PATH) return null

        val query = items(rawQuery)
        val fragment = items(rawFragment)

        // The provider reports failures in the fragment (and some versions in
        // the query). Only the machine-readable code is read — the
        // description is provider wording and never crosses this boundary.
        val errorCode = query["error_code"] ?: fragment["error_code"]
        val error = query["error"] ?: fragment["error"]
        if (errorCode != null || error != null) {
            return Outcome.Failure(
                if (errorCode == "otp_expired" || error == "access_denied") {
                    FailureReason.EXPIRED
                } else {
                    FailureReason.INVALID
                }
            )
        }

        val code = query["code"] ?: return Outcome.Failure(FailureReason.INVALID)
        if (!codePattern.matches(code)) return Outcome.Failure(FailureReason.INVALID)
        return Outcome.Code(code)
    }

    private fun items(rawQuery: String?): Map<String, String> {
        if (rawQuery.isNullOrEmpty()) return emptyMap()
        return rawQuery.split('&').mapNotNull { pair ->
            val index = pair.indexOf('=')
            if (index <= 0) return@mapNotNull null
            val name = pair.substring(0, index)
            val rawValue = pair.substring(index + 1)
            // A malformed escape in one value must not discard the pair beside
            // it: `URLDecoder` throws on `%zz`, so the raw text stands in.
            val value = runCatching {
                URLDecoder.decode(rawValue, Charsets.UTF_8.name())
            }.getOrElse { rawValue.replace('+', ' ') }
            name to value
        }.toMap()
    }
}
