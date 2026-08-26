package io.faithform.faithful.network

/**
 * The production transport is supplied by the app module so this pure-JVM
 * module stays testable without a network stack. The app binds OkHttp to it.
 */
class OkHttpTransport(
    private val delegate: suspend (HttpRequest) -> HttpResponse = { throw NotImplementedError() }
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
