package io.faithform.app.network

import io.faithform.app.contract.MobileErrorCode
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.serializer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/**
 * The typed client's own rules, independent of any transport: what it sends,
 * what a status means, and — the part that used to be wrong — what a failed
 * token renewal means.
 */
private fun envelope(data: String): String =
    """{"ok":true,"data":$data,
       "meta":{"apiVersion":"1.0","apiMajor":1,"requestId":"r","minimumSupportedClientBuild":1}}"""

@Serializable
private data class Echo(val value: String)

private class FakeTokens(
    private val renew: suspend () -> String = { "access-1" },
) : TokenProvider {
    var invalidated = 0

    override suspend fun validAccessToken(): String = renew()
    override suspend fun invalidate() { invalidated += 1 }
}

class ApiClientTest {

    private fun client(transport: HttpTransport, tokens: TokenProvider? = FakeTokens()) = ApiClient(
        environment = ApiEnvironment("development", "https://api.example/"),
        clientBuild = 42,
        transport = transport,
        tokens = tokens,
    )

    private val echo = MobileSuccess.serializer(Echo.serializer())

    @Test
    fun `a request carries the build, the bearer token and a conditional validator`() = runTest {
        val transport = RecordingTransport(
            mutableListOf(HttpResponse(200, envelope("""{"value":"ok"}"""), mapOf("etag" to "\"v1\""))),
        )

        val result = client(transport).send(
            path = "api/mobile/v1/feed/grace",
            serializer = echo,
            ifNoneMatch = "\"v0\"",
            idempotencyKey = "key-1",
        )

        val sent = transport.received.single()
        assertEquals("https://api.example/api/mobile/v1/feed/grace", sent.url)
        assertEquals("42", sent.headers["X-FaithForm-Client-Build"])
        assertEquals("Bearer access-1", sent.headers["Authorization"])
        assertEquals("\"v0\"", sent.headers["If-None-Match"])
        assertEquals("key-1", sent.headers["Idempotency-Key"])
        // The header lookup is case-insensitive, because servers and proxies
        // do not agree on the case of `ETag`.
        assertEquals("\"v1\"", result.etag)
        assertEquals("ok", result.value?.value)
    }

    @Test
    fun `query values are percent-encoded rather than splitting into new parameters`() = runTest {
        val transport = RecordingTransport(
            mutableListOf(HttpResponse(200, envelope("""{"value":"ok"}"""), emptyMap())),
        )

        client(transport).send(
            path = "api/mobile/v1/churches/search",
            serializer = echo,
            query = mapOf("q" to "St. Mark's & St. John's", "cursor" to "a+b/c="),
            authenticated = false,
        )

        val url = transport.received.single().url
        assertEquals(
            "https://api.example/api/mobile/v1/churches/search" +
                "?cursor=a%2Bb%2Fc%3D&q=St.%20Mark%27s%20%26%20St.%20John%27s",
            url,
        )
        assertFalse("an unauthenticated request carried a token", url.contains("Bearer"))
    }

    @Test
    fun `an unauthenticated request never asks for a token`() = runTest {
        var asked = false
        val transport = RecordingTransport(
            mutableListOf(HttpResponse(200, envelope("""{"value":"ok"}"""), emptyMap())),
        )
        client(transport, FakeTokens { asked = true; "never" }).send(
            path = "api/mobile/v1/churches/search",
            serializer = echo,
            authenticated = false,
        )
        assertFalse(asked)
        assertFalse(transport.received.single().headers.containsKey("Authorization"))
    }

    @Test
    fun `a 304 is not modified, with no value to decode`() = runTest {
        val transport = RecordingTransport(mutableListOf(HttpResponse(304, null, mapOf("ETag" to "\"v1\""))))
        val result = client(transport).send(path = "api/x", serializer = echo, ifNoneMatch = "\"v1\"")
        assertTrue(result.notModified)
        assertEquals(null, result.value)
    }

    @Test
    fun `a transport that never answers is a retryable offline error`() = runTest {
        val transport = object : HttpTransport {
            override suspend fun perform(request: HttpRequest): HttpResponse =
                throw java.io.IOException("connection refused")
        }
        try {
            client(transport).send(path = "api/x", serializer = echo)
            fail("expected a transport failure")
        } catch (error: ApiException) {
            assertEquals(MobileErrorCode.UNAVAILABLE, error.code)
            assertTrue(error.retryable)
            // The exception's own wording never reaches the person.
            assertFalse(error.displayMessage.contains("refused"))
        }
    }

    @Test
    fun `cancellation passes through instead of reading as offline`() = runTest {
        val transport = object : HttpTransport {
            override suspend fun perform(request: HttpRequest): HttpResponse =
                throw CancellationException("screen closed")
        }
        try {
            client(transport).send(path = "api/x", serializer = echo)
            fail("expected cancellation")
        } catch (error: ApiException) {
            fail("a cancelled request became $error")
        } catch (_: CancellationException) {
            // Correct: the caller's scope is told the truth.
        }
    }

    @Test
    fun `a refresh token the provider refuses ends the session instead of reading as offline`() = runTest {
        val tokens = FakeTokens { throw AuthException(AuthException.Kind.INVALID_CREDENTIALS) }
        val transport = RecordingTransport(mutableListOf())

        try {
            client(transport, tokens).send(path = "api/mobile/v1/account/bootstrap", serializer = echo)
            fail("expected the session to end")
        } catch (error: ApiException) {
            assertEquals(MobileErrorCode.SESSION_EXPIRED, error.code)
            assertFalse("a dead session must not offer a retry", error.retryable)
        }
        // Cleared, so the next launch lands on sign-in rather than replaying it.
        assertEquals(1, tokens.invalidated)
        // And nothing was sent with a token that could not be renewed.
        assertTrue(transport.received.isEmpty())
    }

    @Test
    fun `every refusal shape the provider uses ends the session`() = runTest {
        // `invalid_grant` maps to INVALID_CREDENTIALS; `refresh_token_not_found`
        // and `refresh_token_already_used` arrive as OTHER. All three are the
        // same fact: this refresh token will never work again.
        for (kind in listOf(
            AuthException.Kind.INVALID_CREDENTIALS,
            AuthException.Kind.OTHER,
            AuthException.Kind.LINK_EXPIRED,
        )) {
            val tokens = FakeTokens { throw AuthException(kind) }
            try {
                client(RecordingTransport(mutableListOf()), tokens).send(path = "api/x", serializer = echo)
                fail("$kind did not end the session")
            } catch (error: ApiException) {
                assertEquals("$kind", MobileErrorCode.SESSION_EXPIRED, error.code)
            }
            assertEquals("$kind", 1, tokens.invalidated)
        }
    }

    @Test
    fun `a provider that cannot be reached keeps the session and offers a retry`() = runTest {
        for (kind in listOf(AuthException.Kind.OFFLINE, AuthException.Kind.RATE_LIMITED)) {
            val tokens = FakeTokens { throw AuthException(kind) }
            try {
                client(RecordingTransport(mutableListOf()), tokens).send(path = "api/x", serializer = echo)
                fail("$kind did not fail")
            } catch (error: ApiException) {
                assertEquals("$kind", MobileErrorCode.UNAVAILABLE, error.code)
                assertTrue("$kind", error.retryable)
            }
            // A phone in a basement must not be signed out for being in a basement.
            assertEquals("$kind invalidated a good session", 0, tokens.invalidated)
        }
    }

    @Test
    fun `no session on the device is unauthenticated, not offline`() = runTest {
        val tokens = FakeTokens { error("not signed in") }
        try {
            client(RecordingTransport(mutableListOf()), tokens).send(path = "api/x", serializer = echo)
            fail("expected unauthenticated")
        } catch (error: ApiException) {
            assertEquals(MobileErrorCode.UNAUTHENTICATED, error.code)
        }
    }

    @Test
    fun `a rejected access token is cleared exactly once`() = runTest {
        val tokens = FakeTokens()
        val body = """{"ok":false,"error":{"code":"session_expired","message":"Sign in again.","retryable":false},
            "meta":{"apiVersion":"1.0","apiMajor":1,"requestId":"r","minimumSupportedClientBuild":1}}"""
        val transport = RecordingTransport(mutableListOf(HttpResponse(401, body, emptyMap())))

        try {
            client(transport, tokens).send(path = "api/x", serializer = echo)
            fail("expected a failure")
        } catch (error: ApiException) {
            assertEquals(MobileErrorCode.SESSION_EXPIRED, error.code)
        }
        assertEquals(1, tokens.invalidated)
    }

    @Test
    fun `an unreadable success body is a typed error, never raw bytes`() = runTest {
        val transport = RecordingTransport(mutableListOf(HttpResponse(200, "<html>proxy</html>", emptyMap())))
        try {
            client(transport).send(path = "api/x", serializer = MobileSuccess.serializer(String.serializer()))
            fail("expected a decode failure")
        } catch (error: ApiException) {
            assertEquals(MobileErrorCode.INTERNAL_ERROR, error.code)
            assertFalse(error.displayMessage.contains("html"))
        }
    }

    @Test
    fun `the shell is told once when the server ends the session, and not for a public request`() = runTest {
        var ended = 0
        val body = """{"ok":false,"error":{"code":"unauthenticated","message":"Sign in.","retryable":false},
            "meta":{"apiVersion":"1.0","apiMajor":1,"requestId":"r","minimumSupportedClientBuild":1}}"""
        val transport = RecordingTransport(
            mutableListOf(HttpResponse(401, body, emptyMap()), HttpResponse(401, body, emptyMap())),
        )
        val api = ApiClient(ApiEnvironment("development", "https://api.example"), 1, transport, FakeTokens()) { ended += 1 }

        runCatching { api.send(path = "api/mobile/v1/feed/grace", serializer = echo) }
        assertEquals(1, ended)

        // A signed-out request that the server refuses says nothing about the
        // session on this device, and must not end it.
        runCatching { api.send(path = "api/mobile/v1/churches/search", serializer = echo, authenticated = false) }
        assertEquals(1, ended)
    }

    @Test
    fun `a refused refresh tells the shell too`() = runTest {
        var ended = 0
        val tokens = FakeTokens { throw AuthException(AuthException.Kind.INVALID_CREDENTIALS) }
        val api = ApiClient(ApiEnvironment("development", "https://api.example"), 1, RecordingTransport(mutableListOf()), tokens) { ended += 1 }
        runCatching { api.send(path = "api/x", serializer = echo) }
        assertEquals(1, ended)
    }

    @Test
    fun `a server-relative path becomes absolute on this origin, and nothing else does`() {
        val api = client(RecordingTransport(mutableListOf()))
        assertEquals(
            "https://api.example/api/media/v1/recording/grace/r1",
            api.absoluteUrl("/api/media/v1/recording/grace/r1"),
        )
        for (foreign in listOf("https://evil.example/x", "//evil.example/x", "relative/path", "")) {
            assertEquals("$foreign was accepted", null, api.absoluteUrl(foreign))
        }
    }
}
