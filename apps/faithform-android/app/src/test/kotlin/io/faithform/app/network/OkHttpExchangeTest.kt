package io.faithform.app.network

import io.faithform.app.contract.MobileErrorCode
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.Serializable
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test

/**
 * The real exchange, against a real HTTP server on the loopback.
 *
 * Plain JUnit rather than Robolectric: OkHttp and MockWebServer are ordinary
 * JVM libraries, and what is under test is bytes on a socket — the method, the
 * path, the headers and the body that actually arrive, and what the exchange
 * reports back. A scripted transport cannot prove any of that; it is the very
 * layer that used to be missing.
 */
private fun envelope(data: String): String =
    """{"ok":true,"data":$data,
       "meta":{"apiVersion":"1.0","apiMajor":1,"requestId":"req-1","minimumSupportedClientBuild":1}}"""

@Serializable
private data class Greeting(val hello: String)

class OkHttpExchangeTest {

    private lateinit var server: MockWebServer

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
    }

    @After
    fun tearDown() {
        runCatching { server.shutdown() }
    }

    private fun url(path: String) = server.url(path).toString()

    @Test
    fun `a GET arrives with its path, query and headers, and the answer comes back whole`() = runTest {
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setHeader("ETag", "\"v7\"")
                .setHeader("X-Request-Id", "req-9")
                .setBody("""{"ok":true}"""),
        )

        val response = OkHttpExchange().perform(
            HttpRequest(
                method = "GET",
                url = url("/api/mobile/v1/feed/grace?cursor=abc"),
                headers = mapOf(
                    "Accept" to "application/json",
                    "Authorization" to "Bearer access-1",
                    "If-None-Match" to "\"v6\"",
                ),
            ),
        )

        val recorded = server.takeRequest(5, TimeUnit.SECONDS)!!
        assertEquals("GET", recorded.method)
        assertEquals("/api/mobile/v1/feed/grace?cursor=abc", recorded.path)
        assertEquals("Bearer access-1", recorded.getHeader("Authorization"))
        assertEquals("\"v6\"", recorded.getHeader("If-None-Match"))
        assertEquals(0L, recorded.bodySize)

        assertEquals(200, response.status)
        assertEquals("""{"ok":true}""", response.body)
        assertEquals("\"v7\"", response.header("etag"))
        assertEquals("req-9", response.header("x-request-id"))
    }

    @Test
    fun `a POST body arrives byte for byte with its content type`() = runTest {
        server.enqueue(MockResponse().setResponseCode(201).setBody("{}"))
        val body = """{"churchSlug":"grace","amountCents":2500,"note":"é ✓"}"""

        OkHttpExchange().perform(
            HttpRequest(
                method = "POST",
                url = url("/api/mobile/v1/giving/donate"),
                headers = mapOf("Content-Type" to "application/json", "Idempotency-Key" to "k-1"),
                body = body,
            ),
        )

        val recorded = server.takeRequest(5, TimeUnit.SECONDS)!!
        assertEquals("POST", recorded.method)
        assertEquals(body, recorded.body.readUtf8())
        assertTrue(recorded.getHeader("Content-Type")!!.startsWith("application/json"))
        assertEquals("k-1", recorded.getHeader("Idempotency-Key"))
    }

    @Test
    fun `a command with no body still leaves the phone`() = runTest {
        // OkHttp refuses a bodiless POST outright. Sign-out and follow carry no
        // body, and used to be exactly the requests that would have thrown.
        for (method in listOf("POST", "PUT", "PATCH", "DELETE")) {
            server.enqueue(MockResponse().setResponseCode(200).setBody("{}"))
            val response = OkHttpExchange().perform(
                HttpRequest(method = method, url = url("/api/mobile/v1/account/sign-out"), headers = emptyMap()),
            )
            assertEquals(method, 200, response.status)
            assertEquals(method, server.takeRequest(5, TimeUnit.SECONDS)!!.method)
        }
    }

    @Test
    fun `an error status is an answer, with its body, not an exception`() = runTest {
        val failure = """{"ok":false,"error":{"code":"forbidden","message":"No.","retryable":false}}"""
        for (status in listOf(400, 401, 403, 404, 409, 429, 500, 503)) {
            server.enqueue(MockResponse().setResponseCode(status).setBody(failure))
            val response = OkHttpExchange().perform(
                HttpRequest("GET", url("/api/x"), emptyMap()),
            )
            assertEquals(status, response.status)
            assertEquals(failure, response.body)
        }
    }

    @Test
    fun `a 304 comes back as a status with nothing to read`() = runTest {
        server.enqueue(MockResponse().setResponseCode(304).setHeader("ETag", "\"v1\""))
        val response = OkHttpExchange().perform(
            HttpRequest("GET", url("/api/x"), mapOf("If-None-Match" to "\"v1\"")),
        )
        assertEquals(304, response.status)
        assertTrue(response.body.isNullOrEmpty())
        assertEquals("\"v1\"", response.header("ETag"))
    }

    @Test
    fun `no server at all is an IOException, which is what both clients translate`() = runTest {
        val unreachable = url("/api/x")
        server.shutdown()

        try {
            OkHttpExchange().perform(HttpRequest("GET", unreachable, emptyMap()))
            fail("expected an IOException")
        } catch (_: IOException) {
            // Correct.
        }
    }

    @Test
    fun `a connection dropped mid-response is an IOException, not a half answer`() = runTest {
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setBody("{\"partial\":")
                .setSocketPolicy(SocketPolicy.DISCONNECT_DURING_RESPONSE_BODY),
        )
        try {
            OkHttpExchange().perform(HttpRequest("GET", url("/api/x"), emptyMap()))
            fail("expected an IOException")
        } catch (_: IOException) {
        }
    }

    @Test
    fun `a server that never answers times out rather than spinning forever`() = runTest {
        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE))
        val impatient = OkHttpExchange(
            OkHttpClient.Builder().readTimeout(200, TimeUnit.MILLISECONDS).build(),
        )
        try {
            impatient.perform(HttpRequest("GET", url("/api/x"), emptyMap()))
            fail("expected a timeout")
        } catch (_: IOException) {
        }
    }

    @Test
    fun `a malformed URL is folded into the transport failure type`() = runTest {
        try {
            OkHttpExchange().perform(HttpRequest("GET", "not a url", emptyMap()))
            fail("expected an IOException")
        } catch (_: IOException) {
        }
    }

    @Test
    fun `the default client has a ceiling on every wait and refuses a scheme downgrade`() {
        val client = OkHttpExchange.defaultClient()
        assertEquals(15_000, client.connectTimeoutMillis)
        assertEquals(30_000, client.readTimeoutMillis)
        assertEquals(30_000, client.writeTimeoutMillis)
        assertEquals(60_000, client.callTimeoutMillis)
        assertFalse("an https request may be redirected to http", client.followSslRedirects)
        // No cookie jar and no disk cache: bearer auth only, and nothing of a
        // church's private content kept outside the partitioned cache.
        assertEquals(okhttp3.CookieJar.NO_COOKIES, client.cookieJar)
        assertNull(client.cache)
        assertTrue("an interceptor could log a token", client.interceptors.isEmpty())
        assertTrue(client.networkInterceptors.isEmpty())
    }

    // -----------------------------------------------------------------------
    // End to end through the clients the app actually uses
    // -----------------------------------------------------------------------

    @Test
    fun `ApiClient over the real exchange decodes an envelope and keeps the validator`() = runTest {
        server.enqueue(
            MockResponse().setResponseCode(200).setHeader("ETag", "\"g1\"")
                .setBody(envelope("""{"hello":"Grace"}""")),
        )
        val api = ApiClient(
            environment = ApiEnvironment("development", server.url("/").toString()),
            clientBuild = 7,
            transport = OkHttpExchange.transport(),
            tokens = null,
        )

        val result = api.send(
            path = "api/mobile/v1/churches/search",
            serializer = MobileSuccess.serializer(Greeting.serializer()),
            query = mapOf("q" to "grace & truth"),
            authenticated = false,
        )

        assertEquals("Grace", result.value?.hello)
        assertEquals("\"g1\"", result.etag)
        val recorded = server.takeRequest(5, TimeUnit.SECONDS)!!
        assertEquals("/api/mobile/v1/churches/search?q=grace%20%26%20truth", recorded.path)
        assertEquals("7", recorded.getHeader("X-FaithForm-Client-Build"))
        assertEquals(null, recorded.getHeader("Authorization"))
    }

    @Test
    fun `ApiClient over the real exchange reads a server refusal as the server's own code`() = runTest {
        server.enqueue(
            MockResponse().setResponseCode(403).setBody(
                """{"ok":false,"error":{"code":"blocked","message":"Not available.","retryable":false},
                   "meta":{"apiVersion":"1.0","apiMajor":1,"requestId":"req-2","minimumSupportedClientBuild":1}}""",
            ),
        )
        val api = ApiClient(
            ApiEnvironment("development", server.url("/").toString()), 7, OkHttpExchange.transport(), null,
        )
        try {
            api.send("api/x", MobileSuccess.serializer(Greeting.serializer()), authenticated = false)
            fail("expected a refusal")
        } catch (error: ApiException) {
            assertEquals(MobileErrorCode.BLOCKED, error.code)
            assertEquals("req-2", error.requestId)
        }
    }

    @Test
    fun `ApiClient over an unreachable server says offline, which is now the truth`() = runTest {
        val base = server.url("/").toString()
        server.shutdown()
        val api = ApiClient(ApiEnvironment("development", base), 7, OkHttpExchange.transport(), null)
        try {
            api.send("api/x", MobileSuccess.serializer(Greeting.serializer()), authenticated = false)
            fail("expected offline")
        } catch (error: ApiException) {
            assertEquals(MobileErrorCode.UNAVAILABLE, error.code)
            assertTrue(error.retryable)
        }
    }

    @Test
    fun `the identity client over the real exchange sends the anon key and reads the session`() = runTest {
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """{"access_token":"a","refresh_token":"r","expires_in":3600,"user":{"id":"u-1"}}""",
            ),
        )
        val auth = SupabaseAuthClient(
            SupabaseAuthConfig(url = server.url("/").toString(), anonKey = "anon-public"),
            OkHttpExchange.transport(),
        )

        val session = auth.signIn("person@example.org", "correct horse")

        assertEquals("u-1", session.accountId)
        val recorded = server.takeRequest(5, TimeUnit.SECONDS)!!
        assertEquals("/auth/v1/token?grant_type=password", recorded.path)
        assertEquals("anon-public", recorded.getHeader("apikey"))
        assertTrue(recorded.body.readUtf8().contains("person@example.org"))
    }

    @Test
    fun `the identity client over an unreachable server is offline, not a wrong password`() = runTest {
        val base = server.url("/").toString()
        server.shutdown()
        val auth = SupabaseAuthClient(SupabaseAuthConfig(url = base, anonKey = "anon"), OkHttpExchange.transport())
        try {
            auth.sendPasswordReset("person@example.org")
            fail("expected offline")
        } catch (error: AuthException) {
            assertEquals(AuthException.Kind.OFFLINE, error.kind)
        }
    }

    @Test
    fun `cancelling the caller cancels the call on the wire`() = runBlocking {
        // Real time, not the test scheduler's: the point is that a caller who
        // stops waiting gets control back promptly instead of after OkHttp's
        // sixty-second ceiling.
        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE))
        val exchange = OkHttpExchange()
        val started = System.nanoTime()
        val outcome = runCatching {
            withTimeout(300) { exchange.perform(HttpRequest("GET", url("/api/slow"), emptyMap())) }
        }
        val elapsedMillis = (System.nanoTime() - started) / 1_000_000
        assertTrue("the call outlived its caller", outcome.isFailure)
        assertTrue("cancellation took $elapsedMillis ms", elapsedMillis < 5_000)
    }
}

/**
 * The line that was wrong, held to the fix.
 *
 * `AppContainer` cannot be constructed on a JVM — it opens an
 * `EncryptedSharedPreferences` backed by the Android Keystore — so its wiring is
 * asserted by reading the source that ships, the same way the Stripe and camera
 * sweeps assert their absences. `OkHttpTransport` itself can no longer be built
 * without an exchange, which makes the old mistake a compile error; this test
 * makes a *new* stub, or a transport that bypasses OkHttp, a failure too.
 */
class NetworkWiringTest {

    private val container = File("src/main/kotlin/io/faithform/app/session/AppContainer.kt")
        .readText()
        .lines()
        .filterNot { it.trimStart().startsWith("*") || it.trimStart().startsWith("//") }
        .joinToString("\n")

    @Test
    fun `the container's transport is the OkHttp exchange`() {
        assertTrue(
            "AppContainer no longer wires OkHttpExchange.transport()",
            container.contains("val transport: HttpTransport = OkHttpExchange.transport()"),
        )
    }

    @Test
    fun `nothing in the container constructs a transport of its own`() {
        for (stub in listOf("OkHttpTransport(", "NotImplementedError", "RecordingTransport", "object : HttpTransport")) {
            assertFalse("AppContainer contains $stub", container.contains(stub))
        }
    }

    @Test
    fun `both clients share that one transport`() {
        // A second transport would be a second place for timeouts, TLS and
        // cleartext rules to drift.
        assertEquals(1, Regex("""OkHttpExchange\.transport\(""").findAll(container).count())
        assertTrue(container.contains("transport = transport"))
        assertTrue(Regex("""\),\s*transport,""").containsMatchIn(container))
    }
}
