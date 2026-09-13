package io.faithform.app.network

import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.Call
import okhttp3.Callback
import okhttp3.Headers
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response

/**
 * One HTTP exchange, performed by OkHttp.
 *
 * The only file in FaithForm that touches the network stack. `ApiClient` and
 * `SupabaseAuthClient` in `:core:network` decide everything about a request —
 * its headers, its idempotency key, what a status means — and hand it here
 * already built. This class sends it and reports what came back, and nothing
 * more.
 *
 * ## The contract with the clients above
 *
 * * **Any HTTP status is an answer, not a failure.** A 401, a 429 and a 503
 *   come back as an [HttpResponse] with that status and its body, because the
 *   clients map statuses and error envelopes themselves — and a transport that
 *   threw on 4xx would turn "your password is wrong" into "you're offline".
 * * **No answer at all is an [IOException].** DNS failure, a refused
 *   connection, a TLS failure, a timeout, a cleartext request the platform
 *   refused: each surfaces as the one exception type both clients already
 *   translate into their offline states (`ApiException.transport()` and
 *   `AuthException.Kind.OFFLINE`). A malformed URL is folded into the same
 *   type rather than escaping as something a caller would not expect.
 * * **Cancellation cancels the call.** A screen that goes away stops its
 *   request instead of leaving a socket open for a response nobody will read.
 *
 * ## What is deliberately absent
 *
 * No interceptor that logs bodies or headers: an `Authorization` header, a
 * refresh token and a Stripe client secret all pass through here. No cookie
 * jar: the API is bearer-authenticated and a cookie would be a second, silent
 * credential. No HTTP cache: several routes answer `no-store`, the rest are
 * revalidated explicitly with ETags by the clients, and a disk cache would be a
 * copy of a church's private content outside every purge. And no cleartext
 * override — OkHttp defers to Android's network security configuration, which
 * refuses cleartext in every build except the debug build's emulator loopback.
 */
class OkHttpExchange(private val client: OkHttpClient = defaultClient()) {

    suspend fun perform(request: HttpRequest): HttpResponse {
        val call = client.newCall(build(request))
        return suspendCancellableCoroutine { continuation ->
            continuation.invokeOnCancellation { call.cancel() }
            call.enqueue(object : Callback {
                override fun onFailure(call: Call, e: IOException) {
                    if (continuation.isActive) continuation.resumeWithException(e)
                }

                override fun onResponse(call: Call, response: Response) {
                    val translated = try {
                        response.use(::translate)
                    } catch (error: IOException) {
                        // The status line arrived and the body did not: the
                        // connection dropped mid-read. That is still "no
                        // answer", not a half-answer to act on.
                        if (continuation.isActive) continuation.resumeWithException(error)
                        return
                    }
                    if (continuation.isActive) continuation.resume(translated)
                }
            })
        }
    }

    private fun build(request: HttpRequest): Request {
        val url = request.url.toHttpUrlOrNull()
            ?: throw IOException("FaithForm could not build that request.")

        val headers = Headers.Builder().apply {
            request.headers.forEach { (name, value) -> add(name, value) }
        }.build()

        return Request.Builder()
            .url(url)
            .headers(headers)
            .method(request.method.uppercase(), body(request))
            .build()
    }

    /**
     * The request body, with the content type the client chose.
     *
     * OkHttp refuses a POST, PUT or PATCH with no body at all, and several
     * FaithForm commands carry none — signing out, following a church,
     * requesting to join. Those send an empty body rather than failing before
     * they leave the phone.
     */
    private fun body(request: HttpRequest): RequestBody? {
        val contentType = request.headers.entries
            .firstOrNull { it.key.equals("Content-Type", ignoreCase = true) }
            ?.value
            ?.toMediaTypeOrNull()

        request.body?.let { return it.toRequestBody(contentType) }

        return when (request.method.uppercase()) {
            "POST", "PUT", "PATCH" -> ByteArray(0).toRequestBody(contentType)
            else -> null
        }
    }

    private fun translate(response: Response): HttpResponse {
        // Headers can repeat. The clients read single-valued ones (`ETag`,
        // `X-Request-Id`, `Retry-After`), so repeats are joined the way HTTP
        // itself defines a combined field value rather than silently dropped.
        val headers = response.headers.names().associateWith { name ->
            response.headers.values(name).joinToString(", ")
        }
        return HttpResponse(
            status = response.code,
            body = response.body?.string(),
            headers = headers,
        )
    }

    companion object {
        /**
         * The client every request in the app goes through.
         *
         * Timeouts are set rather than inherited. OkHttp's defaults have no
         * overall call timeout, so a church hall with one bar of signal can
         * hold a spinner open indefinitely; with these the worst case is a
         * clear "could not reach FaithForm" in about a minute, which is a state
         * the person can do something about.
         *
         * Redirects are followed only within the same scheme. An https request
         * that answers with a redirect to http is refused rather than quietly
         * downgraded with a bearer token attached.
         */
        fun defaultClient(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .callTimeout(60, TimeUnit.SECONDS)
            .followSslRedirects(false)
            .build()

        /** The transport the container wires. One place, so a test can hold it to it. */
        fun transport(exchange: OkHttpExchange = OkHttpExchange()): HttpTransport =
            OkHttpTransport(exchange::perform)
    }
}
