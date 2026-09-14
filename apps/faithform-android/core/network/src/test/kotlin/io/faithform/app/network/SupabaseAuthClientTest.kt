package io.faithform.app.network

import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/**
 * Every path through the identity client, without a network: success, wrong
 * password, unconfirmed email, existing account, rate limit, outage — and the
 * rule that no provider wording ever crosses the boundary, only a typed kind.
 */
private class ScriptedTransport(
    private val exchanges: MutableList<HttpResponse>
) : HttpTransport {
    val received = mutableListOf<HttpRequest>()

    override suspend fun perform(request: HttpRequest): HttpResponse {
        received.add(request)
        if (exchanges.isEmpty()) throw java.io.IOException("no network")
        return exchanges.removeAt(0)
    }
}

private fun config(resetOrigin: String? = null) = SupabaseAuthConfig(
    url = "https://identity.example",
    anonKey = "anon-key",
    resetRedirectOrigin = resetOrigin
)

private fun sessionBody(): String =
    """{"access_token":"access-1","refresh_token":"refresh-1","expires_in":3600,
       "user":{"id":"account-1"}}"""

private fun goTrueError(code: String): String =
    """{"error_code":"$code","msg":"internal wording"}"""

class SupabaseAuthClientTest {

    @Test
    fun `signing in decodes a session`() = runTest {
        val transport = ScriptedTransport(mutableListOf(HttpResponse(200, sessionBody(), emptyMap())))
        val client = SupabaseAuthClient(config(), transport)

        val session = client.signIn("p@example.org", "pw123456")

        assertEquals("access-1", session.accessToken)
        assertEquals("refresh-1", session.refreshToken)
        assertEquals(3600L, session.expiresInSeconds)
        assertEquals("account-1", session.accountId)
    }

    @Test
    fun `the request carries the anon key and the password grant`() = runTest {
        val transport = ScriptedTransport(mutableListOf(HttpResponse(200, sessionBody(), emptyMap())))
        val client = SupabaseAuthClient(config(), transport)

        client.signIn("p@example.org", "pw123456")

        val request = transport.received.single()
        assertEquals("anon-key", request.headers["apikey"])
        assertTrue(request.url.contains("auth/v1/token"))
        assertTrue(request.url.contains("grant_type=password"))
    }

    @Test
    fun `a wrong password becomes a typed kind, never the provider's wording`() = runTest {
        val transport = ScriptedTransport(
            mutableListOf(HttpResponse(400, goTrueError("invalid_credentials"), emptyMap()))
        )
        val client = SupabaseAuthClient(config(), transport)

        try {
            client.signIn("p@example.org", "nope")
            fail("expected a failure")
        } catch (error: AuthException) {
            assertEquals(AuthException.Kind.INVALID_CREDENTIALS, error.kind)
            assertFalse(error.message.orEmpty().contains("internal wording"))
        }
    }

    @Test
    fun `signup with autoconfirm returns a session`() = runTest {
        val transport = ScriptedTransport(mutableListOf(HttpResponse(200, sessionBody(), emptyMap())))
        val client = SupabaseAuthClient(config(), transport)

        val outcome = client.signUp("p@example.org", "pw123456", displayName = null)

        assertTrue(outcome is SignUpOutcome.Session)
        assertEquals("account-1", (outcome as SignUpOutcome.Session).session.accountId)
    }

    @Test
    fun `signup under email confirmation reports confirmation required`() = runTest {
        val body = """{"id":"account-1","email":"p@example.org","confirmation_sent_at":"2026-08-26T00:00:00Z"}"""
        val transport = ScriptedTransport(mutableListOf(HttpResponse(200, body, emptyMap())))
        val client = SupabaseAuthClient(config(), transport)

        assertEquals(SignUpOutcome.ConfirmationRequired, client.signUp("p@example.org", "pw123456", displayName = null))
    }

    @Test
    fun `an existing account maps to ACCOUNT_EXISTS`() = runTest {
        val transport = ScriptedTransport(
            mutableListOf(HttpResponse(422, goTrueError("user_already_exists"), emptyMap()))
        )
        val client = SupabaseAuthClient(config(), transport)

        try {
            client.signUp("p@example.org", "pw123456", displayName = null)
            fail("expected a failure")
        } catch (error: AuthException) {
            assertEquals(AuthException.Kind.ACCOUNT_EXISTS, error.kind)
        }
    }

    private fun sentBody(request: HttpRequest): JsonObject =
        Json.parseToJsonElement(request.body.orEmpty()).jsonObject

    @Test
    fun `signup carries the typed name as user metadata, trimmed`() = runTest {
        val transport = ScriptedTransport(mutableListOf(HttpResponse(200, """{"id":"a"}""", emptyMap())))
        val client = SupabaseAuthClient(config(), transport)

        client.signUp("p@example.org", "pw123456", displayName = "  Sarah Okafor \n")

        val body = sentBody(transport.received.single())
        assertEquals("p@example.org", body["email"]?.jsonPrimitive?.content)
        assertEquals("pw123456", body["password"]?.jsonPrimitive?.content)
        val metadata = body["data"]?.jsonObject
        assertEquals("Sarah Okafor", metadata?.get("display_name")?.jsonPrimitive?.content)
        assertEquals(setOf("display_name"), metadata?.keys)
    }

    @Test
    fun `signup with no name, or only spaces, sends no metadata at all`() = runTest {
        for (name in listOf(null, "", "   ")) {
            val transport = ScriptedTransport(mutableListOf(HttpResponse(200, """{"id":"a"}""", emptyMap())))
            val client = SupabaseAuthClient(config(), transport)

            client.signUp("p@example.org", "pw123456", displayName = name)

            val body = sentBody(transport.received.single())
            assertEquals("name: $name", setOf("email", "password"), body.keys)
        }
    }

    @Test
    fun `an overlong name is clamped to the profile's maximum without splitting a character`() {
        val max = SupabaseAuthClient.DISPLAY_NAME_MAX_LENGTH
        assertEquals(120, max)

        assertEquals("A".repeat(max), SupabaseAuthClient.metadataDisplayName("A".repeat(500)))

        // An emoji is two UTF-16 units: one short of the limit, it cannot fit.
        val emoji = "a".repeat(max - 1) + "😀"
        assertEquals("a".repeat(max - 1), SupabaseAuthClient.metadataDisplayName(emoji))

        // A clamp that ends on a space does not keep it.
        assertEquals("a".repeat(max - 1), SupabaseAuthClient.metadataDisplayName("a".repeat(max - 1) + " b"))

        assertEquals("Sarah", SupabaseAuthClient.metadataDisplayName(" Sarah "))
        assertNull(SupabaseAuthClient.metadataDisplayName("  "))
        assertNull(SupabaseAuthClient.metadataDisplayName(null))
    }

    @Test
    fun `429 maps to RATE_LIMITED`() = runTest {
        val transport = ScriptedTransport(mutableListOf(HttpResponse(429, "{}", emptyMap())))
        val client = SupabaseAuthClient(config(), transport)

        try {
            client.signIn("p@example.org", "pw123456")
            fail("expected a failure")
        } catch (error: AuthException) {
            assertEquals(AuthException.Kind.RATE_LIMITED, error.kind)
        }
    }

    @Test
    fun `no network maps to OFFLINE`() = runTest {
        val transport = ScriptedTransport(mutableListOf())
        val client = SupabaseAuthClient(config(), transport)

        try {
            client.signIn("p@example.org", "pw123456")
            fail("expected a failure")
        } catch (error: AuthException) {
            assertEquals(AuthException.Kind.OFFLINE, error.kind)
        }
    }

    @Test
    fun `refresh exchanges the refresh token for a new session`() = runTest {
        val transport = ScriptedTransport(mutableListOf(HttpResponse(200, sessionBody(), emptyMap())))
        val client = SupabaseAuthClient(config(), transport)

        val session = client.refresh("refresh-0")

        assertEquals("access-1", session.accessToken)
        val request = transport.received.single()
        assertTrue(request.url.contains("grant_type=refresh_token"))
        assertTrue(request.body.orEmpty().contains("refresh-0"))
    }

    @Test
    fun `a reset request points the email at this build's own origin`() = runTest {
        val transport = ScriptedTransport(mutableListOf(HttpResponse(200, "{}", emptyMap())))
        val client = SupabaseAuthClient(config(resetOrigin = "https://app.example"), transport)

        client.sendPasswordReset("p@example.org")

        val request = transport.received.single()
        assertTrue(request.url.contains("auth/v1/recover"))
        assertTrue(request.url.contains("redirect_to="))
        assertTrue(request.url.contains("app.example"))
    }

    @Test
    fun `an unknown address reads exactly like success`() = runTest {
        val transport = ScriptedTransport(
            mutableListOf(HttpResponse(400, goTrueError("user_not_found"), emptyMap()))
        )
        val client = SupabaseAuthClient(config(), transport)

        // No throw: the reply is indistinguishable from the happy path, so the
        // form cannot be used to test addresses.
        client.sendPasswordReset("unknown@example.org")
        assertNotNull(transport.received.singleOrNull())
    }
}
