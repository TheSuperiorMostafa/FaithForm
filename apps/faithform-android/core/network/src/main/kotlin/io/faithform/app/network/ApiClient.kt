package io.faithform.app.network

import io.faithform.app.contract.MobileErrorCode
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.KSerializer

/** Where the app is pointed. An origin, never a secret. */
data class ApiEnvironment(val key: String, val baseUrl: String)

/** One HTTP exchange, kept abstract so every test runs without a network. */
interface HttpTransport {
    suspend fun perform(request: HttpRequest): HttpResponse
}

data class HttpRequest(
    val method: String,
    val url: String,
    val headers: Map<String, String>,
    val body: String? = null
)

data class HttpResponse(
    val status: Int,
    val body: String?,
    val headers: Map<String, String>
) {
    fun header(name: String): String? =
        headers.entries.firstOrNull { it.key.equals(name, ignoreCase = true) }?.value
}

interface TokenProvider {
    suspend fun validAccessToken(): String
    suspend fun invalidate()
}

data class ApiResult<T>(
    val value: T?,
    val etag: String?,
    val notModified: Boolean,
    val requestId: String?
)

/**
 * The typed client for `/api/mobile/v1`.
 *
 * Mirrors the iOS client's behaviour exactly — same headers, same conditional
 * requests, same idempotency, same error mapping — because the two share a
 * contract, not code.
 */
class ApiClient(
    private val environment: ApiEnvironment,
    private val clientBuild: Int,
    private val transport: HttpTransport,
    private val tokens: TokenProvider?,
    /**
     * Told whenever the server or the identity provider ends this session.
     *
     * Any screen can be the one whose request discovers it — a sermon list, a
     * gift, a check-in — and each of them would otherwise need to know how to
     * sign a person out. The shell subscribes once instead, and every feature
     * only has to report its own failure.
     */
    private val onSessionEnded: (() -> Unit)? = null
) {
    /**
     * An absolute URL for a server-relative path such as a playback grant's
     * `deliveryUrl`, on this build's own origin. Anything that is not a path is
     * refused — mirrors `APIClient.absoluteURL(for:)` on iOS — so a response can
     * never point the player at another host.
     */
    fun absoluteUrl(path: String): String? {
        if (!path.startsWith("/") || path.startsWith("//")) return null
        return environment.baseUrl.trimEnd('/') + path
    }

    suspend fun <T> send(
        path: String,
        serializer: KSerializer<MobileSuccess<T>>,
        method: String = "GET",
        body: String? = null,
        query: Map<String, String> = emptyMap(),
        ifNoneMatch: String? = null,
        idempotencyKey: String? = null,
        authenticated: Boolean = true
    ): ApiResult<T> {
        val cleanPath = path.substringBefore('?')
        val inlineQuery = if (path.contains('?')) {
            path.substringAfter('?')
                .split('&')
                .filter { it.isNotBlank() }
                .associate {
                    val parts = it.split('=', limit = 2)
                    decode(parts[0]) to (if (parts.size > 1) decode(parts[1]) else "")
                }
        } else emptyMap()
        val mergedQuery = inlineQuery + query

        // Percent-encoded, like `URLQueryItem` on iOS. A search for
        // "St. Mark's & St. John's" is a value, and an unencoded `&` would
        // silently split it into a second, meaningless parameter.
        val queryString = if (mergedQuery.isEmpty()) "" else {
            mergedQuery.entries.sortedBy { it.key }
                .joinToString("&", prefix = "?") { "${encode(it.key)}=${encode(it.value)}" }
        }

        val headers = buildMap {
            put("Accept", "application/json")
            put("X-FaithForm-Client-Build", clientBuild.toString())
            ifNoneMatch?.let { put("If-None-Match", it) }
            idempotencyKey?.let { put("Idempotency-Key", it) }
            if (body != null) put("Content-Type", "application/json")
            if (authenticated) {
                val provider = tokens ?: throw ApiException(
                    MobileErrorCode.UNAUTHENTICATED,
                    "Sign in to continue."
                )
                put("Authorization", "Bearer ${accessToken(provider)}")
            }
        }

        val response = try {
            transport.perform(
                HttpRequest(
                    method = method,
                    url = "${environment.baseUrl.trimEnd('/')}/${cleanPath.trimStart('/')}$queryString",
                    headers = headers,
                    body = body
                )
            )
        } catch (cancelled: CancellationException) {
            // A screen that went away is not a network failure. Mapping this to
            // "could not reach the server" would show an offline state for a
            // request nobody is waiting on — and swallow the cancellation.
            throw cancelled
        } catch (_: Exception) {
            throw ApiException.transport()
        }

        val requestId = response.header("X-Request-Id")
        val etag = response.header("ETag")

        if (response.status == 304) {
            return ApiResult(null, etag, notModified = true, requestId = requestId)
        }

        if (response.status in 200..299) {
            val decoded = runCatching {
                FaithFormJson.decodeFromString(serializer, response.body.orEmpty())
            }.getOrElse {
                throw ApiException(
                    MobileErrorCode.INTERNAL_ERROR,
                    "FaithForm could not read the response."
                )
            }
            return ApiResult(decoded.data, etag, notModified = false, requestId = requestId)
        }

        val failure = ApiException.from(response.body, response.status, requestId)
        // A rejected token is cleared exactly once so the next call
        // re-authenticates rather than replaying a credential known to be dead.
        if (authenticated && (failure.code == MobileErrorCode.UNAUTHENTICATED ||
                failure.code == MobileErrorCode.SESSION_EXPIRED)
        ) {
            tokens?.invalidate()
            onSessionEnded?.invoke()
        }
        throw failure
    }

    /**
     * A usable access token, or the one failure that describes why not.
     *
     * Renewing an expired token is itself a network call, to the identity
     * provider, and it can fail two very different ways:
     *
     * * **The provider could not be reached** (offline, a 5xx, rate limited).
     *   The session may be perfectly good; this is a transport error and the
     *   app says so and offers a retry.
     * * **The provider refused the refresh token** — `invalid_grant`,
     *   `refresh_token_not_found`, `refresh_token_already_used`, or anything
     *   else it answers with a 4xx. That session is over and no retry will
     *   revive it. It is invalidated and surfaced as `SESSION_EXPIRED`, which
     *   the shell turns into the sign-in screen.
     *
     * Before this, both escaped as an untyped exception and the shell showed
     * "you're offline" forever to someone whose refresh token had been revoked
     * — a dead end with a retry button that could never work.
     */
    private suspend fun accessToken(provider: TokenProvider): String = try {
        provider.validAccessToken()
    } catch (cancelled: CancellationException) {
        throw cancelled
    } catch (error: ApiException) {
        throw error
    } catch (error: AuthException) {
        when (error.kind) {
            AuthException.Kind.OFFLINE,
            AuthException.Kind.RATE_LIMITED -> throw ApiException.transport()
            else -> {
                provider.invalidate()
                onSessionEnded?.invoke()
                throw ApiException(
                    MobileErrorCode.SESSION_EXPIRED,
                    "Your session has ended. Sign in again."
                )
            }
        }
    } catch (_: Exception) {
        // No session at all, or no identity provider to renew one with. Either
        // way the only way forward is signing in.
        throw ApiException(MobileErrorCode.UNAUTHENTICATED, "Sign in to continue.")
    }

    private fun encode(value: String): String =
        java.net.URLEncoder.encode(value, Charsets.UTF_8.name()).replace("+", "%20")

    private fun decode(value: String): String =
        java.net.URLDecoder.decode(value, Charsets.UTF_8.name())
}

/**
 * Single-flight token refresh.
 *
 * Concurrent callers await the same in-flight refresh rather than each starting
 * their own, which is what stops a burst of parallel requests from spending the
 * refresh token several times and invalidating the session.
 */
class SingleFlightRefresher<T>(private val refresh: suspend () -> T) {
    private val mutex = Mutex()
    private var inFlight: CompletableDeferred<T>? = null

    suspend fun run(): T {
        val existing = mutex.withLock { inFlight }
        if (existing != null) return existing.await()

        val deferred = mutex.withLock {
            inFlight ?: CompletableDeferred<T>().also { inFlight = it }
        }
        if (deferred.isCompleted) return deferred.await()

        return try {
            val value = refresh()
            deferred.complete(value)
            value
        } catch (error: Throwable) {
            deferred.completeExceptionally(error)
            throw error
        } finally {
            mutex.withLock { inFlight = null }
        }
    }
}
