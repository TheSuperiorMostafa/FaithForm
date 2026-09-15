package io.faithform.app.ui.feed

import io.faithform.app.network.ApiClient
import io.faithform.app.network.ApiEnvironment
import io.faithform.app.network.HttpResponse
import io.faithform.app.network.ProjectionCache
import io.faithform.app.network.RecordingTransport
import io.faithform.app.network.TokenProvider
import io.faithform.app.storage.CachePartition
import io.faithform.app.storage.PartitionedCache
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

private fun envelope(data: String) =
    """{"ok":true,"data":$data,
       "meta":{"apiVersion":"1.0","apiMajor":1,"requestId":"r","minimumSupportedClientBuild":1}}"""

private fun failure(code: String) =
    """{"ok":false,"error":{"code":"$code","message":"Server sentence.","retryable":false},
       "meta":{"apiVersion":"1.0","apiMajor":1,"requestId":"r","minimumSupportedClientBuild":1}}"""

private fun item(id: String) = """{"id":"$id","title":"Notice $id","body":"Body","startAt":"2026-09-13T15:00:00Z",
    "endAt":null,"allDay":false,"location":null,"posterUrl":null,"posterAltText":null,"isPinned":false,"visibility":"members",
    "publicationVersion":1,"publishedAt":"2026-09-10T00:00:00Z","isEvent":false,"churchSlug":"grace",
    "churchName":"Grace Chapel","churchTimezone":"America/Chicago"}"""

private fun page(vararg ids: String, next: String? = null) =
    """{"items":[${ids.joinToString(",") { item(it) }}],"nextCursor":${next?.let { "\"$it\"" } ?: "null"},"feedVersion":3}"""

private object Tokens : TokenProvider {
    override suspend fun validAccessToken() = "access-1"
    override suspend fun invalidate() = Unit
}

/**
 * The Home feed: cached first, revalidated, blocked means gone, and paging
 * never throws away what is on screen.
 */
class FeedModelTest {

    private val partition = CachePartition("development", "account-1", "grace", 1)
    private val backing = PartitionedCache()
    private var now = 1_000_000L
    private val projections = ProjectionCache(backing, clock = { now })

    private fun model(transport: RecordingTransport) = FeedModel(
        api = ApiClient(ApiEnvironment("development", "https://api.example"), 1, transport, Tokens),
        cache = projections,
        churchSlug = "grace",
        partition = partition,
        clock = { now },
    )

    @Test
    fun `the feed loads from the church's own route`() = runTest {
        val transport = RecordingTransport(mutableListOf(HttpResponse(200, envelope(page("a1", "a2")), emptyMap())))
        val model = model(transport)
        model.load()

        assertEquals("https://api.example/api/mobile/v1/feed/grace", transport.received.single().url)
        assertEquals(listOf("a1", "a2"), (model.phase.value as FeedPhase.Loaded).items.map { it.id })
    }

    @Test
    fun `a returning visit shows the cache at once and a 304 promotes it out of stale`() = runTest {
        model(RecordingTransport(mutableListOf(HttpResponse(200, envelope(page("a1")), mapOf("ETag" to "\"f3\""))))).load()

        now += 10 * 60_000 // older than the five-minute freshness window
        val transport = RecordingTransport(mutableListOf(HttpResponse(304, null, emptyMap())))
        val returning = model(transport)
        returning.load()

        assertEquals("\"f3\"", transport.received.single().headers["If-None-Match"])
        val loaded = returning.phase.value as FeedPhase.Loaded
        assertEquals(listOf("a1"), loaded.items.map { it.id })
        assertEquals(false, loaded.isStale)
    }

    @Test
    fun `no network keeps a cached feed on screen, labelled stale`() = runTest {
        model(RecordingTransport(mutableListOf(HttpResponse(200, envelope(page("a1")), emptyMap())))).load()
        now += 10 * 60_000

        val offline = model(RecordingTransport(mutableListOf()))
        offline.load()

        val loaded = offline.phase.value as FeedPhase.Loaded
        assertTrue(loaded.isStale)
    }

    @Test
    fun `no network with nothing cached says offline`() = runTest {
        val model = model(RecordingTransport(mutableListOf()))
        model.load()
        assertEquals(FeedPhase.OfflineNoCache, model.phase.value)
    }

    @Test
    fun `being blocked drops the cached copy instead of leaving it readable`() = runTest {
        model(RecordingTransport(mutableListOf(HttpResponse(200, envelope(page("a1")), emptyMap())))).load()
        assertEquals(1, backing.count())

        val blocked = model(RecordingTransport(mutableListOf(HttpResponse(403, failure("blocked"), emptyMap()))))
        blocked.load()

        assertEquals(FeedPhase.Blocked, blocked.phase.value)
        assertEquals(0, backing.count())
    }

    @Test
    fun `an empty feed is its own state`() = runTest {
        val model = model(RecordingTransport(mutableListOf(HttpResponse(200, envelope(page()), emptyMap()))))
        model.load()
        assertEquals(FeedPhase.Empty, model.phase.value)
    }

    @Test
    fun `paging appends, and a failed page keeps page one`() = runTest {
        val transport = RecordingTransport(
            mutableListOf(
                HttpResponse(200, envelope(page("a1", next = "c2")), emptyMap()),
                HttpResponse(200, envelope(page("a2", next = "c3")), emptyMap()),
            ),
        )
        val model = model(transport)
        model.load()
        model.loadMore()
        assertTrue(transport.received.last().url.endsWith("feed/grace?cursor=c2"))
        assertEquals(listOf("a1", "a2"), (model.phase.value as FeedPhase.Loaded).items.map { it.id })

        model.loadMore() // nothing scripted
        assertEquals(listOf("a1", "a2"), (model.phase.value as FeedPhase.Loaded).items.map { it.id })

        model.loadMore() // the failure stopped paging: no request at all
        assertEquals(3, transport.received.size)
        assertNull(null)
    }
}
