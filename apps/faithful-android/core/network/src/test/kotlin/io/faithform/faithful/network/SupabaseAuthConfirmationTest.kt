package io.faithform.faithful.network

import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
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
 * The email-confirmation flow, without a network: PKCE travels with signup, the
 * verifier survives on the device, the exchange spends the code against this
 * build's own provider only, and every failure is a typed kind — never a
 * provider sentence, and never "wrong password" for a spent link.
 */
private class ConfirmationTransport(
    private val exchanges: MutableList<HttpResponse>
) : HttpTransport {
    val received = mutableListOf<HttpRequest>()

    override suspend fun perform(request: HttpRequest): HttpResponse {
        received.add(request)
        if (exchanges.isEmpty()) throw java.io.IOException("no network")
        return exchanges.removeAt(0)
    }
}

private class MemoryVerifierStore(var verifier: String? = null) : CodeVerifierStore {
    override fun save(verifier: String) { this.verifier = verifier }
    override fun load(): String? = verifier
    override fun clear() { verifier = null }
}

private fun pkceConfig(redirect: String? = "faithful://auth/callback") = SupabaseAuthConfig(
    url = "https://identity.example",
    anonKey = "anon-key",
    signUpRedirect = redirect
)

private fun confirmationSessionBody(): String =
    """{"access_token":"access-1","refresh_token":"refresh-1","expires_in":3600,
       "user":{"id":"account-1"}}"""

private fun bodyField(request: HttpRequest, name: String): String? =
    Json.parseToJsonElement(request.body.orEmpty()).jsonObject[name]?.jsonPrimitive?.content

class SupabaseAuthConfirmationTest {

    @Test
    fun `the challenge is base64url of SHA-256, pinned to the RFC 7636 vector`() {
        assertEquals(
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
            Pkce.challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")
        )
    }

    @Test
    fun `the verifier is long, unreserved, and fresh every time`() {
        val first = Pkce.makeVerifier()
        val second = Pkce.makeVerifier()
        assertEquals(64, first.length)
        assertTrue(first.all { it.isLetterOrDigit() || it in "-._~" })
        assertFalse(first == second)
    }

    @Test
    fun `signup carries the app's own callback and a hashed challenge`() = runTest {
        val transport = ConfirmationTransport(mutableListOf(HttpResponse(200, """{"id":"a"}""", emptyMap())))
        val store = MemoryVerifierStore()
        val client = SupabaseAuthClient(pkceConfig(), transport, verifierStore = store)

        val outcome = client.signUp("p@example.org", "pw123456")
        assertTrue(outcome is SignUpOutcome.ConfirmationRequired)

        val request = transport.received.single()
        assertTrue(request.url.contains("auth/v1/signup"))
        assertTrue(request.url.contains("redirect_to=faithful%3A%2F%2Fauth%2Fcallback"))

        val verifier = store.verifier
        assertNotNull(verifier)
        assertEquals(Pkce.challenge(verifier!!), bodyField(request, "code_challenge"))
        assertEquals("s256", bodyField(request, "code_challenge_method"))
        // The verifier itself never travels.
        assertFalse(request.body.orEmpty().contains(verifier))
        assertFalse(request.url.contains(verifier))
    }

    @Test
    fun `the verifier is stored before the request leaves`() = runTest {
        val transport = ConfirmationTransport(mutableListOf()) // network fails
        val store = MemoryVerifierStore()
        val client = SupabaseAuthClient(pkceConfig(), transport, verifierStore = store)

        runCatching { client.signUp("p@example.org", "pw123456") }
        assertNotNull(store.verifier)
    }

    @Test
    fun `without a configured redirect, signup stays exactly as it was`() = runTest {
        val transport = ConfirmationTransport(mutableListOf(HttpResponse(200, """{"id":"a"}""", emptyMap())))
        val client = SupabaseAuthClient(
            pkceConfig(redirect = null),
            transport,
            verifierStore = MemoryVerifierStore()
        )

        client.signUp("p@example.org", "pw123456")

        val request = transport.received.single()
        assertFalse(request.url.contains("redirect_to"))
        assertNull(bodyField(request, "code_challenge"))
    }

    @Test
    fun `the exchange spends the code against this build's own provider only`() = runTest {
        val transport = ConfirmationTransport(mutableListOf(HttpResponse(200, confirmationSessionBody(), emptyMap())))
        val store = MemoryVerifierStore("stored-verifier-stored-verifier-stored-verifier")
        val client = SupabaseAuthClient(pkceConfig(), transport, verifierStore = store)

        val session = client.completeEmailConfirmation("code-123456")

        val request = transport.received.single()
        // The URL comes from configuration. Nothing in the callback can point
        // the exchange anywhere else, which is what makes a cross-environment
        // or hijacked link worthless.
        assertTrue(request.url.startsWith("https://identity.example/"))
        assertTrue(request.url.contains("auth/v1/token"))
        assertTrue(request.url.contains("grant_type=pkce"))
        assertEquals("code-123456", bodyField(request, "auth_code"))
        assertEquals("stored-verifier-stored-verifier-stored-verifier", bodyField(request, "code_verifier"))

        assertEquals("account-1", session.accountId)
        // Spent: the flow cannot be replayed from this device.
        assertNull(store.verifier)
    }

    @Test
    fun `no stored verifier is a spent link, refused before any network call`() = runTest {
        val transport = ConfirmationTransport(mutableListOf(HttpResponse(200, confirmationSessionBody(), emptyMap())))
        val client = SupabaseAuthClient(pkceConfig(), transport, verifierStore = MemoryVerifierStore())

        try {
            client.completeEmailConfirmation("code-123456")
            fail("expected a failure")
        } catch (error: AuthException) {
            assertEquals(AuthException.Kind.LINK_EXPIRED, error.kind)
        }
        assertTrue(transport.received.isEmpty())
    }

    @Test
    fun `a provider-rejected code becomes LINK_EXPIRED, never a password kind`() = runTest {
        val transport = ConfirmationTransport(
            mutableListOf(HttpResponse(400, """{"error_code":"invalid_grant","msg":"internal wording"}""", emptyMap()))
        )
        val client = SupabaseAuthClient(
            pkceConfig(),
            transport,
            verifierStore = MemoryVerifierStore("stored-verifier-stored-verifier-stored-verifier")
        )

        try {
            client.completeEmailConfirmation("code-123456")
            fail("expected a failure")
        } catch (error: AuthException) {
            assertEquals(AuthException.Kind.LINK_EXPIRED, error.kind)
        }
    }

    @Test
    fun `no network during the exchange stays OFFLINE — the link may still be good`() = runTest {
        val transport = ConfirmationTransport(mutableListOf())
        val client = SupabaseAuthClient(
            pkceConfig(),
            transport,
            verifierStore = MemoryVerifierStore("stored-verifier-stored-verifier-stored-verifier")
        )

        try {
            client.completeEmailConfirmation("code-123456")
            fail("expected a failure")
        } catch (error: AuthException) {
            assertEquals(AuthException.Kind.OFFLINE, error.kind)
        }
    }
}
