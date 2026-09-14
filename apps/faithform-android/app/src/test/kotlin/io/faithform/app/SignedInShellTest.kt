package io.faithform.app

import io.faithform.app.host.HostTab
import io.faithform.app.host.bootstrap
import io.faithform.app.host.relationship
import io.faithform.app.host.shippedRegistry
import io.faithform.app.network.ApiClient
import io.faithform.app.network.ApiEnvironment
import io.faithform.app.network.AuthException
import io.faithform.app.network.FaithFormJson
import io.faithform.app.network.HttpRequest
import io.faithform.app.network.HttpResponse
import io.faithform.app.network.HttpTransport
import io.faithform.app.network.TokenProvider
import io.faithform.app.session.SessionGateway
import io.faithform.app.session.StoredSession
import io.faithform.app.storage.CachePartition
import io.faithform.app.storage.PartitionedCache
import io.faithform.app.contract.Bootstrap
import io.faithform.app.contract.RelationshipState
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * The signed-in shell's own decisions: account deletion, sessions that end
 * elsewhere, church selection, and links that arrive before the app is ready.
 */
private fun envelope(data: String) =
    """{"ok":true,"data":$data,
       "meta":{"apiVersion":"1.0","apiMajor":1,"requestId":"r","minimumSupportedClientBuild":1}}"""

private fun failure(code: String, message: String = "Server sentence.", retryable: Boolean = false) =
    """{"ok":false,"error":{"code":"$code","message":"$message","retryable":$retryable},
       "meta":{"apiVersion":"1.0","apiMajor":1,"requestId":"r","minimumSupportedClientBuild":1}}"""

private fun bootstrapBody(value: Bootstrap) = envelope(FaithFormJson.encodeToString(Bootstrap.serializer(), value))

private fun onboarding(selected: String? = null) =
    envelope("""{"needsOnboarding":false,"hasAnyRelationship":true,"selectedChurchSlug":${selected?.let { "\"$it\"" } ?: "null"},"activeChurchCount":1,"requiresChurchChooser":false}""")

private const val DELETION_REPLY = """{"id":"req-1","kind":"deletion","status":"pending","requestedAt":"2026-09-13T00:00:00Z"}"""

/** Answers by route; anything unscripted is a dropped connection. */
private class RouteServer : HttpTransport {
    val received = mutableListOf<HttpRequest>()
    val routes = mutableMapOf<String, ArrayDeque<HttpResponse>>()

    fun on(fragment: String, vararg responses: HttpResponse) {
        routes.getOrPut(fragment) { ArrayDeque() }.addAll(responses)
    }

    override suspend fun perform(request: HttpRequest): HttpResponse {
        received += request
        val queue = routes.entries.firstOrNull { request.url.contains(it.key) }?.value
        return queue?.removeFirstOrNull() ?: throw java.io.IOException("no network scripted")
    }

    fun requests(fragment: String) = received.filter { it.url.contains(fragment) }
}

private class Sessions(var session: StoredSession?) : SessionGateway, TokenProvider {
    var purged = 0
    var refuseRefresh = false

    override fun current() = session
    override fun adopt(session: StoredSession) { this.session = session }
    override fun purgeEverything() { session = null; purged += 1 }
    override suspend fun validAccessToken(): String {
        if (refuseRefresh) throw AuthException(AuthException.Kind.INVALID_CREDENTIALS)
        return session?.accessToken ?: error("not signed in")
    }
    override suspend fun invalidate() { session = null }
}

private fun storedSession() = StoredSession("access-1", "refresh-1", System.currentTimeMillis() + 3_600_000, "account-1", "development")

class SignedInShellTest {

    private lateinit var server: RouteServer
    private lateinit var sessions: Sessions
    private lateinit var cache: PartitionedCache
    private lateinit var ended: MutableSharedFlow<Unit>

    @Before
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        server = RouteServer()
        sessions = Sessions(storedSession())
        cache = PartitionedCache()
        ended = MutableSharedFlow(extraBufferCapacity = 1)
    }

    @After
    fun tearDown() = Dispatchers.resetMain()

    private fun model() = AppViewModel(
        api = ApiClient(ApiEnvironment("development", "https://api.example"), 1, server, sessions) { ended.tryEmit(Unit) },
        sessions = sessions,
        cache = cache,
        environmentKey = "development",
        registry = shippedRegistry,
        sessionEnded = ended,
    )

    private fun ready(value: Bootstrap = bootstrap(relationships = listOf(relationship("grace"), relationship("hope"))), selected: String? = null): AppViewModel {
        server.on("account/bootstrap", HttpResponse(200, bootstrapBody(value), emptyMap()))
        server.on("onboarding", HttpResponse(200, onboarding(selected), emptyMap()))
        return model().also { it.load() }
    }

    // -----------------------------------------------------------------------
    // Account deletion
    // -----------------------------------------------------------------------

    @Test
    fun `opening the confirmation sends nothing`() = runTest {
        val model = ready()
        model.beginDeletion()
        assertEquals(DeletionPhase.Confirming, model.deletion.value)
        assertTrue(server.requests("account/requests").isEmpty())
        model.cancelDeletion()
        assertEquals(DeletionPhase.Idle, model.deletion.value)
    }

    @Test
    fun `a recorded request signs out and clears every private partition`() = runTest {
        val model = ready()
        cache.store("feed", CachePartition("development", "account-1", "grace", 1), "{}", 1L)
        server.on("account/requests", HttpResponse(200, envelope(DELETION_REPLY), emptyMap()))

        model.beginDeletion()
        model.confirmDeletion()

        val sent = server.requests("account/requests").single()
        assertEquals("POST", sent.method)
        assertEquals("""{"kind":"deletion"}""", sent.body)
        assertNotNull("deletion carried no idempotency key", sent.headers["Idempotency-Key"])
        assertEquals(LaunchPhase.SignedOut, model.state.value)
        assertEquals(DeletionPhase.Idle, model.deletion.value)
        assertNull(sessions.session)
        assertEquals(0, cache.count())
        // The sign-in screen explains why the person is there.
        assertTrue(model.deletionRequested.value)
        model.dismissDeletionNotice()
        assertEquals(false, model.deletionRequested.value)
    }

    @Test
    fun `a refused request stays signed in and says the account was not deleted`() = runTest {
        val model = ready()
        server.on("account/requests", HttpResponse(409, failure("conflict", "Already being deleted."), emptyMap()))

        model.beginDeletion()
        model.confirmDeletion()

        assertEquals(DeletionPhase.Failed("Already being deleted."), model.deletion.value)
        assertTrue(model.state.value is LaunchPhase.Ready)
        assertNotNull("a failed deletion signed the person out", sessions.session)
        assertEquals(0, sessions.purged)
        assertEquals(false, model.deletionRequested.value)
    }

    @Test
    fun `no network is its own failure, and the retry reuses the same idempotency key`() = runTest {
        val model = ready()
        model.beginDeletion()
        model.confirmDeletion() // nothing scripted: the connection drops
        assertEquals(DeletionPhase.Failed(null), model.deletion.value)
        assertNotNull(sessions.session)

        server.on("account/requests", HttpResponse(200, envelope(DELETION_REPLY), emptyMap()))
        model.confirmDeletion()

        val keys = server.requests("account/requests").map { it.headers["Idempotency-Key"] }
        assertEquals(2, keys.size)
        assertEquals("a retry opened a second request", keys[0], keys[1])
        assertEquals(LaunchPhase.SignedOut, model.state.value)
    }

    @Test
    fun `deletion is reachable when home never loaded`() = runTest {
        // Offline at launch: no bootstrap, no tabs — and the account can still
        // be deleted from the offline screen.
        val model = model()
        model.load()
        assertEquals(LaunchPhase.OfflineNoCache, model.state.value)

        server.on("account/requests", HttpResponse(200, envelope(DELETION_REPLY), emptyMap()))
        model.beginDeletion()
        model.confirmDeletion()
        assertEquals(LaunchPhase.SignedOut, model.state.value)
    }

    @Test
    fun `a new confirmation after cancelling gets a new key`() = runTest {
        val model = ready()
        model.beginDeletion()
        model.confirmDeletion()
        model.cancelDeletion()
        server.on("account/requests", HttpResponse(200, envelope(DELETION_REPLY), emptyMap()))
        model.beginDeletion()
        model.confirmDeletion()
        val keys = server.requests("account/requests").map { it.headers["Idempotency-Key"] }
        assertTrue(keys[0] != keys[1])
    }

    // -----------------------------------------------------------------------
    // Sessions that end somewhere else
    // -----------------------------------------------------------------------

    @Test
    fun `a 401 from any screen signs the shell out`() = runTest {
        val model = ready()
        server.on("feed/grace", HttpResponse(401, failure("session_expired"), emptyMap()))

        runCatching {
            ApiClient(ApiEnvironment("development", "https://api.example"), 1, server, sessions) { ended.tryEmit(Unit) }
                .send("api/mobile/v1/feed/grace", io.faithform.app.network.MobileSuccess.serializer(io.faithform.app.contract.FeedPage.serializer()))
        }

        assertEquals(LaunchPhase.SignedOut, model.state.value)
        assertEquals(HostTab.HOME, model.selectedTab.value)
        assertNull(model.selectedChurchSlug.value)
    }

    @Test
    fun `a refresh token the provider refuses lands on sign-in, not on offline`() = runTest {
        sessions.refuseRefresh = true
        val model = model()
        model.load()
        assertEquals(LaunchPhase.SignedOut, model.state.value)
        assertNull(sessions.session)
    }

    // -----------------------------------------------------------------------
    // Church selection and links
    // -----------------------------------------------------------------------

    @Test
    fun `after bootstrap the server's preferred church is selected`() = runTest {
        val model = ready(selected = "hope")
        assertEquals("hope", model.selectedChurchSlug.value)
    }

    @Test
    fun `tapping a church selects it at once and records the preference`() = runTest {
        val model = ready()
        server.on("account/selected-church", HttpResponse(200, envelope("""{"selectedChurchSlug":"hope","authorizationVersion":1}"""), emptyMap()))

        model.selectChurch("hope")

        assertEquals("hope", model.selectedChurchSlug.value)
        val put = server.requests("account/selected-church").single()
        assertEquals("PUT", put.method)
        assertEquals("""{"churchSlug":"hope"}""", put.body)
    }

    @Test
    fun `a church the account cannot read is not selectable`() = runTest {
        val model = ready(bootstrap(relationships = listOf(relationship("grace"), relationship("closed", RelationshipState.BLOCKED, canRead = false))))
        model.selectChurch("closed")
        assertEquals("grace", model.selectedChurchSlug.value)
        assertTrue(server.requests("account/selected-church").isEmpty())
    }

    @Test
    fun `a moved authorization version reloads rather than reading stale partitions`() = runTest {
        val model = ready()
        cache.store("feed", CachePartition("development", "account-1", "grace", 1), "{}", 1L)
        server.on("account/selected-church", HttpResponse(200, envelope("""{"selectedChurchSlug":"hope","authorizationVersion":2}"""), emptyMap()))
        server.on("account/bootstrap", HttpResponse(200, bootstrapBody(bootstrap(relationships = listOf(relationship("grace"), relationship("hope")), authorizationVersion = 2)), emptyMap()))
        server.on("onboarding", HttpResponse(200, onboarding("hope"), emptyMap()))

        model.selectChurch("hope")

        assertEquals(0, cache.count())
        assertEquals(2, (model.state.value as LaunchPhase.Ready).bootstrap.profile.authorizationVersion)
        assertEquals(2, model.partition("hope")?.authorizationVersion)
    }

    @Test
    fun `a give link that arrived at a cold start opens Give for that church once home loads`() = runTest {
        server.on("account/bootstrap", HttpResponse(200, bootstrapBody(bootstrap(relationships = listOf(relationship("grace"), relationship("hope")))), emptyMap()))
        server.on("onboarding", HttpResponse(200, onboarding("grace"), emptyMap()))
        val model = model()

        model.handleDeepLink("faithform://church/hope/give")
        model.load()

        assertEquals(HostTab.GIVE, model.selectedTab.value)
        assertEquals("hope", model.selectedChurchSlug.value)
        assertNull("the link was not consumed", model.consumePendingDestination())
    }

    @Test
    fun `a link while home is showing acts at once, and a stranger's church does nothing`() = runTest {
        val model = ready()
        model.handleDeepLink("faithform://church/hope/watch")
        assertEquals(HostTab.WATCH, model.selectedTab.value)
        assertEquals("hope", model.selectedChurchSlug.value)

        model.handleDeepLink("faithform://church/stranger/give")
        assertEquals(HostTab.WATCH, model.selectedTab.value)
        assertEquals("hope", model.selectedChurchSlug.value)
    }

    @Test
    fun `a sermons link selects its church and asks Services for messages`() = runTest {
        val model = ready()
        model.handleDeepLink("faithform://church/hope/sermons")
        assertEquals(HostTab.WATCH, model.selectedTab.value)
        assertEquals("hope", model.selectedChurchSlug.value)
        assertTrue("the link only opened the Services tab", model.sermonsRequested.value)

        // The tab shows them once; the request is then spent.
        model.consumeSermonsRequest()
        assertFalse(model.sermonsRequested.value)

        // Any other link, or a tab chosen by hand, is not a request for notes.
        model.handleDeepLink("faithform://church/grace/sermons")
        model.selectTab(HostTab.HOME)
        assertFalse(model.sermonsRequested.value)
        model.handleDeepLink("faithform://church/hope/watch")
        assertFalse(model.sermonsRequested.value)
    }

    @Test
    fun `a sermons link that arrived at a cold start opens messages once home loads`() = runTest {
        server.on("account/bootstrap", HttpResponse(200, bootstrapBody(bootstrap(relationships = listOf(relationship("grace"), relationship("hope")))), emptyMap()))
        server.on("onboarding", HttpResponse(200, onboarding("grace"), emptyMap()))
        val model = model()

        model.handleDeepLink("faithform://church/hope/sermons")
        assertFalse(model.sermonsRequested.value)
        model.load()

        assertEquals(HostTab.WATCH, model.selectedTab.value)
        assertEquals("hope", model.selectedChurchSlug.value)
        assertTrue(model.sermonsRequested.value)
    }

    @Test
    fun `sermon notes open from Home only through the gates a link passes`() = runTest {
        val model = ready()
        model.openSermons("grace")
        assertEquals(HostTab.WATCH, model.selectedTab.value)
        assertTrue(model.sermonsRequested.value)

        val withoutSermons = ready(bootstrap(capabilities = bootstrap().enabledCapabilities - "sermons"))
        withoutSermons.openSermons("grace")
        assertEquals(HostTab.HOME, withoutSermons.selectedTab.value)
        assertFalse(withoutSermons.sermonsRequested.value)

        model.signOut()
        assertFalse("a request outlived the session", model.sermonsRequested.value)
    }

    @Test
    fun `signing out forgets the selection and the tab`() = runTest {
        val model = ready()
        model.selectTab(HostTab.ACCOUNT)
        model.signOut()
        assertEquals(HostTab.HOME, model.selectedTab.value)
        assertNull(model.selectedChurchSlug.value)
        assertNull(model.partition("grace"))
    }
}
