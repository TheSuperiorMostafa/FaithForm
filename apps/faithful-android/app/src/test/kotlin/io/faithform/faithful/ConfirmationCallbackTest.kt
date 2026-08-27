package io.faithform.faithful

import io.faithform.faithful.network.ApiClient
import io.faithform.faithful.network.ApiEnvironment
import io.faithform.faithful.network.HttpRequest
import io.faithform.faithful.network.HttpResponse
import io.faithform.faithful.network.HttpTransport
import io.faithform.faithful.network.CodeVerifierStore
import io.faithform.faithful.network.SupabaseAuthClient
import io.faithform.faithful.network.SupabaseAuthConfig
import io.faithform.faithful.session.SessionGateway
import io.faithform.faithful.session.StoredSession
import io.faithform.faithful.storage.PartitionedCache
import io.faithform.faithful.ui.auth.AuthUiError
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * The confirmation link's journey through the shell: parsed, exchanged exactly
 * once, adopted, and bootstrapped into the ordinary visitor flow — with every
 * replay, retry, and failure a defined state rather than a corrupted one.
 */

private class CallbackTransport : HttpTransport {
    val queue = ArrayDeque<HttpResponse>()
    val received = mutableListOf<HttpRequest>()

    override suspend fun perform(request: HttpRequest): HttpResponse {
        received.add(request)
        if (queue.isEmpty()) throw java.io.IOException("no network scripted")
        return queue.removeFirst()
    }

    fun requests(matching: String): List<HttpRequest> =
        received.filter { it.url.contains(matching) }
}

private class CallbackSessions(var session: StoredSession? = null) :
    SessionGateway, io.faithform.faithful.network.TokenProvider {

    override fun current(): StoredSession? = session
    override fun adopt(session: StoredSession) { this.session = session }
    override fun purgeEverything() { session = null }
    override suspend fun validAccessToken(): String =
        session?.accessToken ?: error("not signed in")
    override suspend fun invalidate() { session = null }
}

private class CallbackVerifierStore(var verifier: String? = null) : CodeVerifierStore {
    override fun save(verifier: String) { this.verifier = verifier }
    override fun load(): String? = verifier
    override fun clear() { verifier = null }
}

private fun callbackEnvelope(data: String): String =
    """{"ok":true,"data":$data,
       "meta":{"apiVersion":"1.0","apiMajor":1,"requestId":"r","minimumSupportedClientBuild":1}}"""

private fun callbackBootstrapJson(): String =
    """{"profile":{"displayName":null,"avatarUrl":null,"status":"active",
        "termsVersion":"2026-08-01","termsAcceptedAt":null,
        "privacyVersion":"2026-08-01","privacyAcceptedAt":null,
        "autoAttendanceConsent":"unset","communicationPrefs":{},
        "selectedChurchSlug":null,"authorizationVersion":1},
        "relationships":[],"pendingRequests":[],
        "requiredTermsVersion":"2026-08-01","requiredPrivacyVersion":"2026-08-01",
        "enabledCapabilities":["account"],"serverTime":"2026-08-26T00:00:00Z"}"""

private fun callbackOnboardingJson(needsOnboarding: Boolean): String =
    """{"needsOnboarding":$needsOnboarding,"hasAnyRelationship":${!needsOnboarding},
        "selectedChurchSlug":null,"activeChurchCount":${if (needsOnboarding) 0 else 1},
        "requiresChurchChooser":false}"""

private fun callbackSessionBody(): String =
    """{"access_token":"access-1","refresh_token":"refresh-1","expires_in":3600,
       "user":{"id":"account-1"}}"""

private const val CALLBACK_URL = "faithful://auth/callback?code=9c1e02f3-4d69-4b8c-a44f-3a9bb75d0a01"

class ConfirmationCallbackTest {

    private lateinit var transport: CallbackTransport
    private lateinit var sessions: CallbackSessions
    private lateinit var verifiers: CallbackVerifierStore

    @Before
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        transport = CallbackTransport()
        sessions = CallbackSessions()
        verifiers = CallbackVerifierStore("stored-verifier-stored-verifier-stored-verifier")
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun viewModel(withAuth: Boolean = true): AppViewModel = AppViewModel(
        api = ApiClient(
            environment = ApiEnvironment("development", "https://api.example"),
            clientBuild = 1,
            transport = transport,
            tokens = sessions
        ),
        sessions = sessions,
        cache = PartitionedCache(),
        environmentKey = "development",
        auth = if (withAuth) {
            SupabaseAuthClient(
                SupabaseAuthConfig(
                    url = "https://identity.example",
                    anonKey = "anon-key",
                    signUpRedirect = "faithful://auth/callback"
                ),
                transport,
                verifierStore = verifiers
            )
        } else {
            null
        }
    )

    @Test
    fun `a valid callback exchanges once and lands in visitor onboarding`() = runTest {
        transport.queue.add(HttpResponse(200, callbackSessionBody(), emptyMap()))
        transport.queue.add(HttpResponse(200, callbackEnvelope(callbackBootstrapJson()), emptyMap()))
        transport.queue.add(HttpResponse(200, callbackEnvelope(callbackOnboardingJson(needsOnboarding = true)), emptyMap()))

        val model = viewModel()
        model.handleDeepLink(CALLBACK_URL)

        assertEquals(1, transport.requests("auth/v1/token").size)
        // The session was adopted, stamped for this environment.
        assertEquals("development", sessions.session?.environmentKey)
        assertEquals("account-1", sessions.session?.accountId)
        // A confirmed visitor with no church lands in discovery/onboarding —
        // the server's decision — not on a staff screen or a dead end.
        assertTrue(model.state.value is LaunchPhase.Onboarding)
        assertEquals(ConfirmationPhase.Idle, model.confirmationPhase.value)
    }

    @Test
    fun `replaying the same callback does not exchange again or corrupt the session`() = runTest {
        transport.queue.add(HttpResponse(200, callbackSessionBody(), emptyMap()))
        transport.queue.add(HttpResponse(200, callbackEnvelope(callbackBootstrapJson()), emptyMap()))
        transport.queue.add(HttpResponse(200, callbackEnvelope(callbackOnboardingJson(needsOnboarding = true)), emptyMap()))

        val model = viewModel()
        model.handleDeepLink(CALLBACK_URL)
        val adopted = sessions.session

        // The person taps the email link again; the app is already signed in.
        // The reload is quiet and nothing about the credential changes.
        transport.queue.add(HttpResponse(200, callbackEnvelope(callbackBootstrapJson()), emptyMap()))
        transport.queue.add(HttpResponse(200, callbackEnvelope(callbackOnboardingJson(needsOnboarding = true)), emptyMap()))
        model.handleDeepLink(CALLBACK_URL)

        assertEquals(1, transport.requests("auth/v1/token").size)
        assertEquals(adopted, sessions.session)
    }

    @Test
    fun `a callback while signed in is a quiet refresh, never an exchange`() = runTest {
        sessions.session = StoredSession(
            accessToken = "access-0",
            refreshToken = "refresh-0",
            expiresAtMillis = System.currentTimeMillis() + 3_600_000,
            accountId = "account-1",
            environmentKey = "development"
        )
        transport.queue.add(HttpResponse(200, callbackEnvelope(callbackBootstrapJson()), emptyMap()))
        transport.queue.add(HttpResponse(200, callbackEnvelope(callbackOnboardingJson(needsOnboarding = false)), emptyMap()))

        val model = viewModel()
        model.handleDeepLink(CALLBACK_URL)

        assertTrue(transport.requests("auth/v1/token").isEmpty())
        assertEquals("access-0", sessions.session?.accessToken)
        assertTrue(model.state.value is LaunchPhase.Ready)
    }

    @Test
    fun `a provider failure in the link is its own sentence, with no network`() = runTest {
        val model = viewModel()
        model.handleDeepLink(
            "faithful://auth/callback#error=access_denied&error_code=otp_expired"
        )

        assertEquals(
            ConfirmationPhase.Failed(AuthUiError.LINK_EXPIRED),
            model.confirmationPhase.value
        )
        assertTrue(transport.received.isEmpty())
    }

    @Test
    fun `a spent code fails as an expired link and stays consumed`() = runTest {
        transport.queue.add(
            HttpResponse(400, """{"error_code":"invalid_grant","msg":"internal"}""", emptyMap())
        )

        val model = viewModel()
        model.handleDeepLink(CALLBACK_URL)

        assertEquals(
            ConfirmationPhase.Failed(AuthUiError.LINK_EXPIRED),
            model.confirmationPhase.value
        )

        // Tapping the same dead link again does nothing further.
        model.handleDeepLink(CALLBACK_URL)
        assertEquals(1, transport.requests("auth/v1/token").size)
    }

    @Test
    fun `an offline exchange leaves the code retryable`() = runTest {
        // First attempt: no network scripted, the transport throws.
        val model = viewModel()
        model.handleDeepLink(CALLBACK_URL)
        assertEquals(
            ConfirmationPhase.Failed(AuthUiError.OFFLINE),
            model.confirmationPhase.value
        )

        // Back online, the same link completes normally.
        transport.queue.add(HttpResponse(200, callbackSessionBody(), emptyMap()))
        transport.queue.add(HttpResponse(200, callbackEnvelope(callbackBootstrapJson()), emptyMap()))
        transport.queue.add(HttpResponse(200, callbackEnvelope(callbackOnboardingJson(needsOnboarding = true)), emptyMap()))
        model.handleDeepLink(CALLBACK_URL)

        assertNotNull(sessions.session)
        assertTrue(model.state.value is LaunchPhase.Onboarding)
    }

    @Test
    fun `no configured provider fails closed with the configuration state`() = runTest {
        val model = viewModel(withAuth = false)
        model.handleDeepLink(CALLBACK_URL)

        assertEquals(
            ConfirmationPhase.Failed(AuthUiError.NOT_CONFIGURED),
            model.confirmationPhase.value
        )
        assertTrue(transport.received.isEmpty())
    }

    /**
     * The real shape of email confirmation: sign up, leave for the mail app,
     * and come back to a process the system killed in between. Everything the
     * flow needs must be on disk, not in memory — the store outlives both the
     * client and the view model.
     */
    @Test
    fun `a verifier written at signup completes an exchange after a restart`() = runTest {
        val store = CallbackVerifierStore()

        // Launch one: sign up.
        transport.queue.add(HttpResponse(200, """{"id":"account-1"}""", emptyMap()))
        SupabaseAuthClient(
            SupabaseAuthConfig(
                url = "https://identity.example",
                anonKey = "anon-key",
                signUpRedirect = "faithful://auth/callback"
            ),
            transport,
            verifierStore = store
        ).signUp("p@example.org", "pw123456")
        assertNotNull(store.verifier)

        // The process dies here. Launch two builds everything afresh, reading
        // only what was persisted.
        verifiers = store
        transport.queue.add(HttpResponse(200, callbackSessionBody(), emptyMap()))
        transport.queue.add(HttpResponse(200, callbackEnvelope(callbackBootstrapJson()), emptyMap()))
        transport.queue.add(
            HttpResponse(200, callbackEnvelope(callbackOnboardingJson(needsOnboarding = true)), emptyMap())
        )

        val model = viewModel()
        model.handleDeepLink(CALLBACK_URL)

        assertEquals("account-1", sessions.session?.accountId)
        assertTrue(model.state.value is LaunchPhase.Onboarding)
    }

    @Test
    fun `a session written at sign-in is restored after a restart, without refreshing`() = runTest {
        val stored = StoredSession(
            accessToken = "access-1",
            refreshToken = "refresh-1",
            expiresAtMillis = System.currentTimeMillis() + 3_600_000,
            accountId = "account-1",
            environmentKey = "development"
        )
        sessions.session = stored

        // Launch two: a new view model over the same session store.
        transport.queue.add(HttpResponse(200, callbackEnvelope(callbackBootstrapJson()), emptyMap()))
        transport.queue.add(
            HttpResponse(200, callbackEnvelope(callbackOnboardingJson(needsOnboarding = false)), emptyMap())
        )

        val model = viewModel()
        model.load()

        assertEquals(stored, sessions.session)
        assertTrue(model.state.value is LaunchPhase.Ready)
        // An unexpired session is used as-is; nothing was renewed.
        assertTrue(transport.requests("auth/v1/token").isEmpty())
    }
}
