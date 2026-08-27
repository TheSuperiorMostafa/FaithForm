package io.faithform.faithful

import io.faithform.faithful.network.ApiClient
import io.faithform.faithful.network.ApiEnvironment
import io.faithform.faithful.network.HttpRequest
import io.faithform.faithful.network.HttpResponse
import io.faithform.faithful.network.HttpTransport
import io.faithform.faithful.network.SupabaseSession
import io.faithform.faithful.session.SessionGateway
import io.faithform.faithful.session.StoredSession
import io.faithform.faithful.storage.PartitionedCache
import io.faithform.faithful.ui.auth.AuthUiError
import io.faithform.faithful.ui.auth.AuthUiPhase
import io.faithform.faithful.ui.auth.AuthViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * The complete first-run path, from a fresh install to a working home — every
 * state a person can land in, none of them a dead end.
 */

private class ScriptedTransport : HttpTransport {
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

private class FakeSessions(var session: StoredSession? = null) :
    SessionGateway, io.faithform.faithful.network.TokenProvider {
    var purged = false

    override fun current(): StoredSession? = session
    override fun adopt(session: StoredSession) { this.session = session }
    override fun purgeEverything() { session = null; purged = true }
    override suspend fun validAccessToken(): String =
        session?.accessToken ?: error("not signed in")
    override suspend fun invalidate() { session = null }
}

private fun envelope(data: String): String =
    """{"ok":true,"data":$data,
       "meta":{"apiVersion":"1.0","apiMajor":1,"requestId":"r","minimumSupportedClientBuild":1}}"""

private fun failureEnvelope(code: String): String =
    """{"ok":false,"error":{"code":"$code","message":"server sentence","retryable":false},
       "meta":{"apiVersion":"1.0","apiMajor":1,"requestId":"r","minimumSupportedClientBuild":1}}"""

private fun bootstrapJson(termsVersion: String? = "2026-08-01"): String {
    val terms = termsVersion?.let { "\"$it\"" } ?: "null"
    return """{"profile":{"displayName":null,"avatarUrl":null,"status":"active",
        "termsVersion":$terms,"termsAcceptedAt":null,
        "privacyVersion":$terms,"privacyAcceptedAt":null,
        "autoAttendanceConsent":"unset","communicationPrefs":{},
        "selectedChurchSlug":null,"authorizationVersion":1},
        "relationships":[],"pendingRequests":[],
        "requiredTermsVersion":"2026-08-01","requiredPrivacyVersion":"2026-08-01",
        "enabledCapabilities":["account"],"serverTime":"2026-08-26T00:00:00Z"}"""
}

private fun onboardingJson(needsOnboarding: Boolean): String =
    """{"needsOnboarding":$needsOnboarding,"hasAnyRelationship":${!needsOnboarding},
        "selectedChurchSlug":null,"activeChurchCount":${if (needsOnboarding) 0 else 1},
        "requiresChurchChooser":false}"""

private fun session(env: String = "development") = StoredSession(
    accessToken = "access-1",
    refreshToken = "refresh-1",
    expiresAtMillis = System.currentTimeMillis() + 3_600_000,
    accountId = "account-1",
    environmentKey = env
)

private const val TOKEN_32 = "abcdefghabcdefghabcdefghabcdefgh"

class FirstRunTest {

    private lateinit var transport: ScriptedTransport
    private lateinit var sessions: FakeSessions

    @Before
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        transport = ScriptedTransport()
        sessions = FakeSessions()
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun viewModel(): AppViewModel = AppViewModel(
        api = ApiClient(
            environment = ApiEnvironment("development", "https://api.example"),
            clientBuild = 1,
            transport = transport,
            tokens = sessions
        ),
        sessions = sessions,
        cache = PartitionedCache(),
        environmentKey = "development"
    )

    @Test
    fun `a fresh install is signed out, with no network attempted`() = runTest {
        val model = viewModel()
        model.load()

        assertEquals(LaunchPhase.SignedOut, model.state.value)
        assertTrue(transport.received.isEmpty())
    }

    @Test
    fun `an existing session loads bootstrap and lands on home`() = runTest {
        sessions.session = session()
        transport.queue.add(HttpResponse(200, envelope(bootstrapJson()), emptyMap()))
        transport.queue.add(HttpResponse(200, envelope(onboardingJson(needsOnboarding = false)), emptyMap()))

        val model = viewModel()
        model.load()

        assertTrue(model.state.value is LaunchPhase.Ready)
        assertEquals("Bearer access-1", transport.received.first().headers["Authorization"])
    }

    @Test
    fun `no church yet means the server routes first-run to onboarding`() = runTest {
        sessions.session = session()
        transport.queue.add(HttpResponse(200, envelope(bootstrapJson()), emptyMap()))
        transport.queue.add(HttpResponse(200, envelope(onboardingJson(needsOnboarding = true)), emptyMap()))

        val model = viewModel()
        model.load()

        assertTrue(model.state.value is LaunchPhase.Onboarding)
    }

    @Test
    fun `a rejected token is signed out, not an error with a useless retry`() = runTest {
        sessions.session = session()
        transport.queue.add(HttpResponse(401, failureEnvelope("unauthenticated"), emptyMap()))

        val model = viewModel()
        model.load()

        assertEquals(LaunchPhase.SignedOut, model.state.value)
        // The dead token was cleared exactly once, so nothing replays it.
        assertNull(sessions.session)
    }

    @Test
    fun `no network with nothing cached says so`() = runTest {
        sessions.session = session()
        // Empty queue: the transport throws.

        val model = viewModel()
        model.load()

        assertEquals(LaunchPhase.OfflineNoCache, model.state.value)
    }

    @Test
    fun `completing auth adopts the session and loads home`() = runTest {
        transport.queue.add(HttpResponse(200, envelope(bootstrapJson()), emptyMap()))
        transport.queue.add(HttpResponse(200, envelope(onboardingJson(needsOnboarding = false)), emptyMap()))

        val model = viewModel()
        model.completeAuth(
            SupabaseSession("access-1", "refresh-1", 3600, "account-1"),
            displayName = null
        )

        assertNotNull(sessions.session)
        assertEquals("development", sessions.session?.environmentKey)
        assertTrue(model.state.value is LaunchPhase.Ready)
    }

    @Test
    fun `a typed name is sent to the profile after auth`() = runTest {
        transport.queue.add(HttpResponse(200, envelope("""{"displayName":"Sarah"}"""), emptyMap()))
        transport.queue.add(HttpResponse(200, envelope(bootstrapJson()), emptyMap()))
        transport.queue.add(HttpResponse(200, envelope(onboardingJson(needsOnboarding = false)), emptyMap()))

        val model = viewModel()
        model.completeAuth(
            SupabaseSession("access-1", "refresh-1", 3600, "account-1"),
            displayName = "Sarah"
        )

        val profile = transport.requests("account/profile").single()
        assertEquals("PATCH", profile.method)
        assertTrue(profile.body.orEmpty().contains("Sarah"))
    }

    @Test
    fun `an invitation deep link signed out is held, silently`() = runTest {
        val model = viewModel()
        model.handleDeepLink("faithful://invite/$TOKEN_32")

        assertEquals(TOKEN_32, model.pendingInvitationToken.value)
        assertTrue(transport.received.isEmpty())
    }

    @Test
    fun `a held invitation is redeemed right after sign-in, before first render`() = runTest {
        transport.queue.add(
            HttpResponse(200, envelope("""{"churchSlug":"grace","churchName":"Grace","state":"joined"}"""), emptyMap())
        )
        transport.queue.add(HttpResponse(200, envelope(bootstrapJson()), emptyMap()))
        transport.queue.add(HttpResponse(200, envelope(onboardingJson(needsOnboarding = false)), emptyMap()))

        val model = viewModel()
        model.handleDeepLink("faithful://invite/$TOKEN_32")
        model.completeAuth(SupabaseSession("access-1", "refresh-1", 3600, "account-1"), null)

        val accept = transport.requests("invitations/accept").single()
        assertTrue(accept.body.orEmpty().contains(TOKEN_32))
        assertNotNull(accept.headers["Idempotency-Key"])
        assertNull(model.pendingInvitationToken.value)
    }

    @Test
    fun `an invitation while signed in is redeemed on the spot`() = runTest {
        sessions.session = session()
        transport.queue.add(
            HttpResponse(200, envelope("""{"churchSlug":"grace","churchName":"Grace","state":"joined"}"""), emptyMap())
        )
        transport.queue.add(HttpResponse(200, envelope(bootstrapJson()), emptyMap()))
        transport.queue.add(HttpResponse(200, envelope(onboardingJson(needsOnboarding = false)), emptyMap()))

        val model = viewModel()
        model.handleDeepLink("faithful://invite/$TOKEN_32")

        assertEquals(1, transport.requests("invitations/accept").size)
    }

    @Test
    fun `an expired invitation surfaces its own failure, not a crash`() = runTest {
        sessions.session = session()
        transport.queue.add(HttpResponse(410, failureEnvelope("invitation_expired"), emptyMap()))

        val model = viewModel()
        model.acceptInvitation(TOKEN_32)

        val phase = model.invitationPhase.value
        assertTrue(phase is InvitationPhase.Failed)
        assertEquals(
            io.faithform.faithful.contract.MobileErrorCode.INVITATION_EXPIRED,
            (phase as InvitationPhase.Failed).code
        )
    }

    @Test
    fun `first bootstrap with no accepted policy records the required versions`() = runTest {
        sessions.session = session()
        transport.queue.add(HttpResponse(200, envelope(bootstrapJson(termsVersion = null)), emptyMap()))
        transport.queue.add(HttpResponse(200, envelope("""{"termsVersion":"2026-08-01"}"""), emptyMap()))
        transport.queue.add(HttpResponse(200, envelope(onboardingJson(needsOnboarding = true)), emptyMap()))

        val model = viewModel()
        model.load()

        val consent = transport.requests("account/consent").single()
        assertTrue(consent.body.orEmpty().contains("2026-08-01"))
    }

    @Test
    fun `an already-accepted policy is not re-recorded`() = runTest {
        sessions.session = session()
        transport.queue.add(HttpResponse(200, envelope(bootstrapJson(termsVersion = "2026-08-01")), emptyMap()))
        transport.queue.add(HttpResponse(200, envelope(onboardingJson(needsOnboarding = false)), emptyMap()))

        val model = viewModel()
        model.load()

        assertTrue(transport.requests("account/consent").isEmpty())
    }

    @Test
    fun `signing out clears everything local and lands signed out`() = runTest {
        sessions.session = session()
        transport.queue.add(HttpResponse(200, envelope("""{"signedOut":true,"authorizationVersion":2}"""), emptyMap()))

        val model = viewModel()
        model.signOut()

        assertEquals(LaunchPhase.SignedOut, model.state.value)
        assertTrue(sessions.purged)
        assertEquals(1, transport.requests("account/sign-out").size)
    }
}

/**
 * Failed and cancelled authentication: a wrong password is a sentence, a
 * cancelled attempt is nothing at all, and no phase strands the person.
 */
class AuthViewModelTest {

    @Before
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private class AuthTransport(val responses: ArrayDeque<HttpResponse>) : HttpTransport {
        override suspend fun perform(request: HttpRequest): HttpResponse {
            if (responses.isEmpty()) throw java.io.IOException("no network")
            return responses.removeFirst()
        }
    }

    private fun client(vararg responses: HttpResponse) =
        io.faithform.faithful.network.SupabaseAuthClient(
            io.faithform.faithful.network.SupabaseAuthConfig("https://identity.example", "anon"),
            AuthTransport(ArrayDeque(responses.toList()))
        )

    @Test
    fun `a successful sign-in hands the session to the composition root`() {
        var received: SupabaseSession? = null
        val model = AuthViewModel(
            client(
                HttpResponse(
                    200,
                    """{"access_token":"a","refresh_token":"r","expires_in":3600,"user":{"id":"u"}}""",
                    emptyMap()
                )
            )
        ) { session, _ -> received = session }

        model.updateEmail("p@example.org")
        model.updatePassword("pw123456")
        model.signIn()

        assertEquals("u", received?.accountId)
        assertEquals(AuthUiPhase.Idle, model.phase.value)
    }

    @Test
    fun `a wrong password is a sentence the screen can show`() {
        val model = AuthViewModel(
            client(HttpResponse(400, """{"error_code":"invalid_credentials"}""", emptyMap()))
        ) { _, _ -> }

        model.updateEmail("p@example.org")
        model.updatePassword("wrong")
        model.signIn()

        assertEquals(AuthUiPhase.Failed(AuthUiError.INVALID_CREDENTIALS), model.phase.value)
    }

    @Test
    fun `an empty form never reaches the network`() {
        val model = AuthViewModel(client()) { _, _ -> }
        model.signIn()
        assertEquals(AuthUiPhase.Failed(AuthUiError.EMAIL_INVALID), model.phase.value)

        model.updateEmail("p@example.org")
        model.updatePassword("short")
        model.createAccount()
        assertEquals(AuthUiPhase.Failed(AuthUiError.WEAK_PASSWORD), model.phase.value)
    }

    @Test
    fun `confirmation-required lands on check-email, not an error`() {
        val model = AuthViewModel(
            client(HttpResponse(200, """{"id":"u","confirmation_sent_at":"2026-08-26T00:00:00Z"}""", emptyMap()))
        ) { _, _ -> throw AssertionError("no session should be handed over") }

        model.updateEmail("p@example.org")
        model.updatePassword("pw123456")
        model.createAccount()

        assertEquals(AuthUiPhase.CheckEmail, model.phase.value)
    }

    @Test
    fun `no configured provider fails closed with its own message`() {
        val model = AuthViewModel(null) { _, _ -> }
        model.updateEmail("p@example.org")
        model.updatePassword("pw123456")
        model.signIn()

        assertEquals(AuthUiPhase.Failed(AuthUiError.NOT_CONFIGURED), model.phase.value)
    }

    @Test
    fun `cancelling — walking away — leaves no password behind`() {
        val model = AuthViewModel(null) { _, _ -> }
        model.updateEmail("p@example.org")
        model.updatePassword("secret99")

        model.resetForNewScreen()

        assertEquals("", model.password.value)
        assertEquals(AuthUiPhase.Idle, model.phase.value)
        assertEquals("p@example.org", model.email.value)
    }
}
