package io.faithform.faithful.network

import io.faithform.faithful.contract.MobileErrorCode
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
    private val tokens: TokenProvider?
) {
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
        val queryString = if (query.isEmpty()) "" else {
            query.entries.sortedBy { it.key }
                .joinToString("&", prefix = "?") { "${it.key}=${it.value}" }
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
                put("Authorization", "Bearer ${provider.validAccessToken()}")
            }
        }

        val response = runCatching {
            transport.perform(
                HttpRequest(
                    method = method,
                    url = "${environment.baseUrl.trimEnd('/')}/$path$queryString",
                    headers = headers,
                    body = body
                )
            )
        }.getOrElse { throw ApiException.transport() }

        val requestId = response.header("X-Request-Id")
        val etag = response.header("ETag")

        if (response.status == 304) {
            return ApiResult(null, etag, notModified = true, requestId = requestId)
        }

        if (response.status in 200..299) {
            val decoded = runCatching {
                FaithfulJson.decodeFromString(serializer, response.body.orEmpty())
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
        if (failure.code == MobileErrorCode.UNAUTHENTICATED ||
            failure.code == MobileErrorCode.SESSION_EXPIRED
        ) {
            tokens?.invalidate()
        }
        throw failure
    }
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
