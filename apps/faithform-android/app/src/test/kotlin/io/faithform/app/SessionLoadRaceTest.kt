package io.faithform.app

import io.faithform.app.contract.Bootstrap
import io.faithform.app.host.bootstrap
import io.faithform.app.network.*
import io.faithform.app.session.*
import io.faithform.app.storage.PartitionedCache
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.test.*
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import java.nio.file.Files

private class RaceSessions(var value: StoredSession?) : SessionGateway, TokenProvider {
    override fun current() = value
    override fun adopt(session: StoredSession) { value = session }
    override fun purgeEverything() { value = null }
    override suspend fun validAccessToken() = value!!.accessToken
    override suspend fun invalidate() { value = null }
    override suspend fun invalidateIfCurrent(accessToken: String): Boolean {
        if (value?.accessToken != accessToken) return false
        value = null
        return true
    }
}

class SessionLoadRaceTest {
    @Before fun setUp() = Dispatchers.setMain(UnconfinedTestDispatcher())
    @After fun tearDown() = Dispatchers.resetMain()

    private fun stored(id: String) = StoredSession("access-$id", "refresh-$id", System.currentTimeMillis() + 3_600_000, id, "development")
    private fun response(data: String) = HttpResponse(200, """{"ok":true,"data":$data,"meta":{"apiVersion":"1.0","apiMajor":1,"requestId":"r","minimumSupportedClientBuild":1}}""", emptyMap())
    private fun boot(name: String): HttpResponse {
        val value = bootstrap().let { it.copy(profile = it.profile.copy(displayName = name)) }
        return response(FaithFormJson.encodeToString(Bootstrap.serializer(), value))
    }

    private fun transport(delayed: CompletableDeferred<HttpResponse>) = object : HttpTransport {
        var delayedOnce = false
        override suspend fun perform(request: HttpRequest): HttpResponse {
            if (request.url.endsWith("account/bootstrap")) {
                if (!delayedOnce) { delayedOnce = true; return delayed.await() }
                return boot("Account B")
            }
            if (request.url.endsWith("onboarding")) return response("""{"needsOnboarding":false,"hasAnyRelationship":true,"selectedChurchSlug":null,"activeChurchCount":1,"requiresChurchChooser":false}""")
            return response("""{"signedOut":true}""")
        }
    }

    @Test fun `a late bootstrap cannot reopen the shell or recreate snapshots after signout`() = runTest {
        val directory = Files.createTempDirectory("ff-race").toFile()
        try {
            val snapshots = AccountSnapshotStore(directory)
            val sessions = RaceSessions(stored("a"))
            val delayed = CompletableDeferred<HttpResponse>()
            val model = AppViewModel(ApiClient(ApiEnvironment("development", "https://api.example"), 1, transport(delayed), sessions), sessions, PartitionedCache(), "development", snapshots = snapshots)
            model.load()
            model.signOut()
            assertEquals(LaunchPhase.SignedOut, model.state.value)
            delayed.complete(boot("Account A"))
            assertEquals(LaunchPhase.SignedOut, model.state.value)
            assertNull(snapshots.load("development", "a"))
        } finally { directory.deleteRecursively() }
    }

    @Test fun `a late account A bootstrap cannot replace account B or poison its snapshot`() = runTest {
        val directory = Files.createTempDirectory("ff-race").toFile()
        try {
            val snapshots = AccountSnapshotStore(directory)
            val sessions = RaceSessions(stored("a"))
            val delayed = CompletableDeferred<HttpResponse>()
            val model = AppViewModel(ApiClient(ApiEnvironment("development", "https://api.example"), 1, transport(delayed), sessions), sessions, PartitionedCache(), "development", snapshots = snapshots)
            model.load()
            model.signOut()
            model.completeAuth(SupabaseSession("access-b", "refresh-b", 3600, "b"), null)
            delayed.complete(boot("Account A"))
            assertEquals("Account B", (model.state.value as LaunchPhase.Ready).bootstrap.profile.displayName)
            assertEquals("Account B", snapshots.load("development", "b")!!.bootstrap.profile.displayName)
            assertNull(snapshots.load("development", "a"))
        } finally { directory.deleteRecursively() }
    }

    @Test fun `a late failure cannot restore offline content after signout`() = runTest {
        val sessions = RaceSessions(stored("a"))
        val delayed = CompletableDeferred<HttpResponse>()
        val model = AppViewModel(ApiClient(ApiEnvironment("development", "https://api.example"), 1, transport(delayed), sessions), sessions, PartitionedCache(), "development")
        model.load()
        model.signOut()
        delayed.completeExceptionally(java.io.IOException("offline"))
        assertEquals(LaunchPhase.SignedOut, model.state.value)
    }

    @Test fun `an old unauthorized response cannot end the newly adopted session`() = runTest {
        val sessions = RaceSessions(stored("a"))
        val delayed = CompletableDeferred<HttpResponse>()
        val model = AppViewModel(ApiClient(ApiEnvironment("development", "https://api.example"), 1, transport(delayed), sessions), sessions, PartitionedCache(), "development")
        model.load()
        model.signOut()
        model.completeAuth(SupabaseSession("access-b", "refresh-b", 3600, "b"), null)
        delayed.complete(HttpResponse(401, """{"ok":false,"error":{"code":"session_expired","message":"Expired","retryable":false},"meta":{"apiVersion":"1.0","apiMajor":1,"requestId":"r","minimumSupportedClientBuild":1}}""", emptyMap()))
        assertEquals("b", sessions.current()!!.accountId)
        assertEquals("Account B", (model.state.value as LaunchPhase.Ready).bootstrap.profile.displayName)
    }
}
