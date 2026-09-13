package io.faithform.app.network

/**
 * The production transport's seam: an [HttpTransport] whose one exchange is
 * supplied by the app module.
 *
 * This pure-JVM module has no network stack on purpose — every client above it
 * is tested against a scripted transport — so the real exchange (OkHttp) is
 * bound in `:app` by `OkHttpExchange`.
 *
 * ## Why the delegate has no default
 *
 * It used to default to `{ throw NotImplementedError() }`, and the container
 * constructed `OkHttpTransport()` with nothing passed. Every request then threw
 * before leaving the phone, `ApiClient` mapped the throw to a retryable
 * transport error exactly as it should for a dropped connection, and the whole
 * app reported "you're offline" on a working network. Nothing failed loudly,
 * because the failure looked like weather.
 *
 * A required parameter turns that mistake into a compile error. There is no
 * way to build this class without saying what actually performs the request.
 */
class OkHttpTransport(
    private val delegate: suspend (HttpRequest) -> HttpResponse,
) : HttpTransport {
    override suspend fun perform(request: HttpRequest): HttpResponse = delegate(request)
}

/**
 * Deterministic transport for tests. Records what it was asked, so a test can
 * assert on headers without a server.
 */
class RecordingTransport(private val queued: MutableList<HttpResponse>) : HttpTransport {
    val received = mutableListOf<HttpRequest>()

    override suspend fun perform(request: HttpRequest): HttpResponse {
        received += request
        if (queued.isEmpty()) throw IllegalStateException("no queued response")
        return queued.removeAt(0)
    }
}
