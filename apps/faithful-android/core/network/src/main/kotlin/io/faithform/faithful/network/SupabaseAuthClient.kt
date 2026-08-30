package io.faithform.faithful.network

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * Signing in and creating an account, against Supabase's GoTrue endpoints.
 *
 * The missing third piece beside `AndroidSessionStore` (lifecycle) and its
 * refresher (renewal): the calls that *create* a session. Pure JVM, behind
 * [HttpTransport], so every path — success, wrong password, unconfirmed email,
 * rate limit, no network — runs under `gradlew test` with no device.
 *
 * Holds the Supabase URL and the **publishable/anon** key, both designed to
 * ship in clients. Neither authorises anything on its own — row-level security
 * decides what a token can reach. A service-role key must never appear here.
 */
data class SupabaseAuthConfig(
    val url: String,
    val anonKey: String,
    /**
     * The web app's origin, used only to point password-reset emails at the
     * product's own reset screen. Null falls back to the identity provider's
     * configured site URL.
     */
    val resetRedirectOrigin: String? = null,
    /**
     * Where the confirmation email returns to: this app's own callback,
     * `AuthCallbackLink.CANONICAL`, allow-listed in the identity provider.
     *
     * Without it the provider falls back to its Site URL — the church
     * dashboard — which is precisely the misroute this field exists to end.
     * Never taken from a request or a link; it is build configuration.
     */
    val signUpRedirect: String? = null
)

/**
 * Holds the PKCE verifier between signup and the confirmation link's return —
 * across a process death, because the person is in their mail client in
 * between. One instance per environment; the verifier is credential material
 * and lives wherever sessions live, never in an ordinary preference.
 */
interface CodeVerifierStore {
    fun save(verifier: String)
    fun load(): String?
    fun clear()
}

/**
 * Proof-of-possession for the email-confirmation exchange (RFC 7636).
 *
 * The verifier never leaves the device; the challenge travels with signup, and
 * the code the confirmation link carries is worthless without the verifier —
 * which is what makes a custom-scheme callback safe to use: another app that
 * hijacked the scheme would hold a code it cannot spend.
 */
object Pkce {
    private const val ALPHABET =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"

    /** 64 characters from the RFC's unreserved set, from [java.security.SecureRandom]. */
    fun makeVerifier(): String {
        val random = java.security.SecureRandom()
        return buildString(64) {
            repeat(64) { append(ALPHABET[random.nextInt(ALPHABET.length)]) }
        }
    }

    /** base64url(SHA-256(verifier)), no padding — the `s256` method. */
    fun challenge(verifier: String): String {
        val digest = java.security.MessageDigest.getInstance("SHA-256")
            .digest(verifier.toByteArray(Charsets.US_ASCII))
        return java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(digest)
    }
}

/** A session as the identity provider minted it. The app maps it to storage. */
data class SupabaseSession(
    val accessToken: String,
    val refreshToken: String,
    val expiresInSeconds: Long,
    val accountId: String
)

/**
 * What creating an account produced. Both cases are success: a project with
 * email confirmation switched on returns the person, not a session.
 */
sealed interface SignUpOutcome {
    data class Session(val session: SupabaseSession) : SignUpOutcome
    data object ConfirmationRequired : SignUpOutcome
}

/**
 * Why an auth call failed, in terms a screen can act on. No provider string
 * crosses this boundary — GoTrue's error bodies name accounts and internals
 * written for a developer; only the *class* of failure is allowed through,
 * and the app layer turns it into one of its own sentences.
 */
class AuthException(val kind: Kind) : Exception(kind.name) {
    enum class Kind {
        INVALID_CREDENTIALS,
        ACCOUNT_EXISTS,
        WEAK_PASSWORD,
        EMAIL_NOT_CONFIRMED,
        RATE_LIMITED,
        OFFLINE,
        NOT_CONFIGURED,

        /** A confirmation link that was already spent, timed out, or belongs
         * to a flow this device no longer holds the verifier for. The way out
         * is always the same — sign in — and the UI sentence says so. */
        LINK_EXPIRED,
        OTHER
    }
}

class SupabaseAuthClient(
    private val config: SupabaseAuthConfig,
    private val transport: HttpTransport,
    private val verifierStore: CodeVerifierStore? = null,
    private val makeVerifier: () -> String = Pkce::makeVerifier
) {
    private val json = Json { ignoreUnknownKeys = true }

    @Serializable
    private data class Credentials(val email: String, val password: String)

    @Serializable
    private data class PkceCredentials(
        val email: String,
        val password: String,
        val code_challenge: String,
        val code_challenge_method: String
    )

    @Serializable
    private data class PkceExchange(val auth_code: String, val code_verifier: String)

    @Serializable
    private data class EmailOnly(val email: String)

    @Serializable
    private data class ResendRequest(
        val type: String,
        val email: String,
        val code_challenge: String? = null,
        val code_challenge_method: String? = null
    )

    @Serializable
    private data class RefreshBody(val refresh_token: String)

    @Serializable
    private data class TokenUser(val id: String)

    @Serializable
    private data class TokenResponse(
        val access_token: String? = null,
        val refresh_token: String? = null,
        val expires_in: Long? = null,
        val user: TokenUser? = null
    )

    @Serializable
    private data class GoTrueError(
        val error_code: String? = null,
        val error: String? = null,
        val msg: String? = null,
        val error_description: String? = null
    )

    suspend fun signUp(email: String, password: String): SignUpOutcome {
        val redirect = config.signUpRedirect
        val store = verifierStore

        // PKCE: the confirmation email returns to this app's own callback with
        // a code only this device can spend. Configured together — a redirect
        // without a verifier store would mint links nothing could complete.
        val response = if (redirect != null && store != null) {
            val verifier = makeVerifier()
            // Stored before the request leaves: the person is about to switch
            // to their mail client, and the process may not survive the trip.
            store.save(verifier)
            post(
                "auth/v1/signup",
                query = "redirect_to=" + urlEncode(redirect),
                body = json.encodeToString(
                    PkceCredentials.serializer(),
                    PkceCredentials(
                        email = email,
                        password = password,
                        code_challenge = Pkce.challenge(verifier),
                        code_challenge_method = "s256"
                    )
                )
            )
        } else {
            post(
                "auth/v1/signup",
                body = json.encodeToString(Credentials.serializer(), Credentials(email, password))
            )
        }
        if (response.status !in 200..299) throw failure(response)

        val session = decodeSession(response.body)
        return if (session != null) SignUpOutcome.Session(session)
        else SignUpOutcome.ConfirmationRequired
    }

    /**
     * Exchanges the code a confirmation link carried for a session, using the
     * verifier this device stored at signup. Consumes the flow: on success the
     * verifier is cleared and the code is spent server-side.
     */
    suspend fun completeEmailConfirmation(code: String): SupabaseSession {
        // No verifier means the flow was started elsewhere or the app was
        // reinstalled. The verify step already confirmed the address before
        // redirecting, so the honest way forward is an ordinary sign-in.
        val store = verifierStore ?: throw AuthException(AuthException.Kind.LINK_EXPIRED)
        val verifier = store.load() ?: throw AuthException(AuthException.Kind.LINK_EXPIRED)

        val response = post(
            "auth/v1/token",
            query = "grant_type=pkce",
            body = json.encodeToString(PkceExchange.serializer(), PkceExchange(code, verifier))
        )

        if (response.status !in 200..299) {
            val thrown = failure(response)
            // Rate limits and outages keep their own kinds — the link may
            // still be good. Everything else is a spent or foreign code, and
            // "email or password is incorrect" would be nonsense here.
            if (thrown.kind == AuthException.Kind.RATE_LIMITED ||
                thrown.kind == AuthException.Kind.OFFLINE
            ) {
                throw thrown
            }
            throw AuthException(AuthException.Kind.LINK_EXPIRED)
        }

        val session = decodeSession(response.body)
            ?: throw AuthException(AuthException.Kind.OTHER)
        store.clear()
        return session
    }

    suspend fun signIn(email: String, password: String): SupabaseSession {
        val response = post(
            "auth/v1/token",
            query = "grant_type=password",
            body = json.encodeToString(Credentials.serializer(), Credentials(email, password))
        )
        if (response.status !in 200..299) throw failure(response)
        return decodeSession(response.body) ?: throw AuthException(AuthException.Kind.OTHER)
    }

    /** Exchanges a refresh token for a new session — the Android counterpart
     * of iOS's `SupabaseSessionRefresher`, plugged into the session store. */
    suspend fun refresh(refreshToken: String): SupabaseSession {
        val response = post(
            "auth/v1/token",
            query = "grant_type=refresh_token",
            body = json.encodeToString(RefreshBody.serializer(), RefreshBody(refreshToken))
        )
        if (response.status !in 200..299) throw failure(response)
        return decodeSession(response.body) ?: throw AuthException(AuthException.Kind.OTHER)
    }

    suspend fun sendPasswordReset(email: String) {
        // The link lands on this build's own web origin, so a staging build's
        // reset email cannot point at production.
        val query = config.resetRedirectOrigin?.let { origin ->
            val next = urlEncode("/set-password?reason=recovery")
            "redirect_to=" + urlEncode("${origin.trimEnd('/')}/auth/callback?next=$next")
        }

        val response = post(
            "auth/v1/recover",
            query = query,
            body = json.encodeToString(EmailOnly.serializer(), EmailOnly(email))
        )
        if (response.status !in 200..299) {
            val thrown = failure(response)
            // "No such account" must read exactly like success, or this form
            // becomes a way to test addresses. Only a real obstacle surfaces.
            if (thrown.kind == AuthException.Kind.RATE_LIMITED ||
                thrown.kind == AuthException.Kind.OFFLINE
            ) {
                throw thrown
            }
        }
    }

    /**
     * Re-sends the signup confirmation.
     *
     * Carries the same PKCE challenge and the same redirect as the original
     * signup, so the new link is completable by this device exactly like the
     * first one. Without the challenge the fresh link would return a code
     * nothing on this device could spend — a worse outcome than not resending.
     *
     * The stored verifier is reused rather than reminted: a new one would
     * orphan the link already sitting in the person's inbox, and both should
     * work.
     */
    suspend fun resendConfirmation(email: String) {
        val redirect = config.signUpRedirect
        val store = verifierStore

        val body = if (redirect != null && store != null) {
            val verifier = store.load() ?: makeVerifier().also { store.save(it) }
            ResendRequest(
                type = "signup",
                email = email,
                code_challenge = Pkce.challenge(verifier),
                code_challenge_method = "s256"
            )
        } else {
            ResendRequest(type = "signup", email = email)
        }

        val response = post(
            "auth/v1/resend",
            query = redirect?.let { "redirect_to=" + urlEncode(it) },
            body = json.encodeToString(ResendRequest.serializer(), body)
        )
        // Rate limiting is the one failure worth surfacing: it is exactly what
        // someone hits when they tap "send it again" twice, and silence would
        // read as a second email that never comes.
        if (response.status !in 200..299) throw failure(response)
    }

    private suspend fun post(path: String, query: String? = null, body: String): HttpResponse {
        val base = config.url.trimEnd('/')
        val url = if (query != null) "$base/$path?$query" else "$base/$path"

        return runCatching {
            transport.perform(
                HttpRequest(
                    method = "POST",
                    url = url,
                    headers = mapOf(
                        "Content-Type" to "application/json",
                        "apikey" to config.anonKey
                    ),
                    body = body
                )
            )
        }.getOrElse { throw AuthException(AuthException.Kind.OFFLINE) }
    }

    private fun decodeSession(body: String?): SupabaseSession? {
        val decoded = runCatching {
            json.decodeFromString(TokenResponse.serializer(), body.orEmpty())
        }.getOrNull() ?: return null

        val access = decoded.access_token ?: return null
        val refresh = decoded.refresh_token ?: return null
        val expires = decoded.expires_in ?: return null
        val user = decoded.user ?: return null

        return SupabaseSession(
            accessToken = access,
            refreshToken = refresh,
            expiresInSeconds = expires,
            accountId = user.id
        )
    }

    private fun failure(response: HttpResponse): AuthException {
        val decoded = runCatching {
            json.decodeFromString(GoTrueError.serializer(), response.body.orEmpty())
        }.getOrNull()
        val code = decoded?.error_code ?: decoded?.error ?: ""
        val text = (decoded?.msg ?: decoded?.error_description ?: "").lowercase()

        val kind = when {
            response.status == 429 || code == "over_request_rate_limit" ||
                code == "over_email_send_rate_limit" -> AuthException.Kind.RATE_LIMITED
            code == "invalid_credentials" || code == "invalid_grant" ||
                "invalid login credentials" in text -> AuthException.Kind.INVALID_CREDENTIALS
            code == "user_already_exists" || code == "email_exists" ||
                "already registered" in text -> AuthException.Kind.ACCOUNT_EXISTS
            code == "weak_password" ||
                ("password" in text && "at least" in text) -> AuthException.Kind.WEAK_PASSWORD
            code == "email_not_confirmed" ||
                "email not confirmed" in text -> AuthException.Kind.EMAIL_NOT_CONFIRMED
            response.status >= 500 -> AuthException.Kind.OFFLINE
            else -> AuthException.Kind.OTHER
        }
        return AuthException(kind)
    }

    private fun urlEncode(value: String): String =
        java.net.URLEncoder.encode(value, Charsets.UTF_8.name())
}
