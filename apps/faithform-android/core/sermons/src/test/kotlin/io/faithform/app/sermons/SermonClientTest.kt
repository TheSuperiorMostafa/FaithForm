package io.faithform.app.sermons

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
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

private fun envelope(data: String) =
    """{"ok":true,"data":$data,
       "meta":{"apiVersion":"1.0","apiMajor":1,"requestId":"r","minimumSupportedClientBuild":1}}"""

private fun failure(code: String) =
    """{"ok":false,"error":{"code":"$code","message":"Server sentence.","retryable":false},
       "meta":{"apiVersion":"1.0","apiMajor":1,"requestId":"r","minimumSupportedClientBuild":1}}"""

private fun item(id: String) = """{"sermonId":"$id","title":"Sermon $id","summary":null,
    "publishedAt":"2026-09-01T00:00:00Z","preachedOn":"2026-08-31","scriptureRefs":["John 3:16"],"seriesName":null,
    "publicationVersion":1,"churchSlug":"grace","churchName":"Grace Chapel","churchTimezone":"America/Chicago"}"""

private fun page(vararg ids: String, next: String? = null) =
    """{"items":[${ids.joinToString(",") { item(it) }}],"nextCursor":${next?.let { "\"$it\"" } ?: "null"},"sermonVersion":2}"""

private const val DETAIL = """{"sermonId":"s1","title":"Born again","summary":"Nicodemus",
    "publishedAt":"2026-09-01T00:00:00Z","preachedOn":null,"scriptureRefs":["John 3"],"seriesName":"John",
    "publicationVersion":1,"churchSlug":"grace","churchName":"Grace Chapel","churchTimezone":"America/Chicago",
    "outline":{"intro":null,"points":[{"title":"Night","summary":"He came by night","scripture":null}],
    "application":null,"closing":null},"discussionQuestions":[{"category":"reflect","question":"When did you?"}]}"""

private object Tokens : TokenProvider {
    override suspend fun validAccessToken() = "access-1"
    override suspend fun invalidate() = Unit
}

private val PARTITION = CachePartition("test", "account-a", "grace", 1)

class SermonClientTest {

    private fun ok(data: String, etag: String? = null) =
        HttpResponse(200, envelope(data), etag?.let { mapOf("ETag" to it) } ?: emptyMap())

    private fun setup(vararg responses: HttpResponse): Pair<SermonClient, RecordingTransport> {
        val transport = RecordingTransport(responses.toMutableList())
        val api = ApiClient(ApiEnvironment("test", "https://faithform.test"), 1, transport, Tokens)
        return SermonClient(api, ProjectionCache(PartitionedCache())) to transport
    }

    @Test
    fun `the archive and a sermon are read from the routes iOS reads`() = runTest {
        val (client, transport) = setup(ok(page("s1")), ok(DETAIL))
        client.archive("grace", null, null, PARTITION)
        val detail = client.detail("grace", "s1", PARTITION)

        assertEquals("https://faithform.test/api/mobile/v1/sermons/grace/archive", transport.received[0].url)
        assertEquals("https://faithform.test/api/mobile/v1/sermons/grace/item/s1", transport.received[1].url)
        assertEquals("Night", detail.outline?.points?.single()?.title)
    }

    @Test
    fun `the first page revalidates, a search does not touch the cache`() = runTest {
        val (client, transport) = setup(
            ok(page("s1"), etag = "\"p1\""),
            ok(page("s9"), etag = "\"q1\""),
            HttpResponse(304, null, emptyMap()),
        )
        client.archive("grace", null, null, PARTITION)
        client.archive("grace", "  lent  ", null, PARTITION)
        val again = client.archive("grace", null, null, PARTITION)

        assertTrue(transport.received[1].url.endsWith("archive?q=lent"))
        assertNull(transport.received[1].headers["If-None-Match"])
        assertEquals("\"p1\"", transport.received[2].headers["If-None-Match"])
        // The 304 served the unfiltered page, not the search result.
        assertEquals(listOf("s1"), again.items.map { it.sermonId })
    }
}

class SermonListModelTest {

    private fun model(vararg responses: HttpResponse): Pair<SermonListModel, RecordingTransport> {
        val transport = RecordingTransport(responses.toMutableList())
        val api = ApiClient(ApiEnvironment("test", "https://faithform.test"), 1, transport, Tokens)
        return SermonListModel(SermonClient(api, ProjectionCache(PartitionedCache())), "grace", PARTITION) to transport
    }

    private fun ok(data: String) = HttpResponse(200, envelope(data), emptyMap())

    @Test
    fun `a church with nothing published and a search with no match read differently`() = runTest {
        val (published, _) = model(ok(page()))
        published.load()
        assertTrue(published.state.value.showsEmptyState)
        assertFalse(published.state.value.emptyIsSearch)

        val (searched, _) = model(ok(page()))
        searched.search("advent")
        assertTrue(searched.state.value.emptyIsSearch)
    }

    @Test
    fun `failures map through the shared rules`() = runTest {
        val (blocked, _) = model(HttpResponse(404, failure("not_found"), emptyMap()))
        blocked.load()
        assertEquals(SermonListPhase.Blocked, blocked.state.value.phase)

        val (offline, _) = model()
        offline.load()
        assertEquals(SermonListPhase.Offline, offline.state.value.phase)
    }

    @Test
    fun `paging appends and stops cleanly`() = runTest {
        val (model, transport) = model(ok(page("s1", next = "c2")), ok(page("s2")))
        model.load()
        assertTrue(model.state.value.canLoadMore)

        model.loadMore()
        assertEquals(listOf("s1", "s2"), model.state.value.items.map { it.sermonId })
        assertTrue(transport.received.last().url.endsWith("?cursor=c2"))
        assertFalse(model.state.value.canLoadMore)

        // Nothing more to ask for: no request is made.
        model.loadMore()
        assertEquals(2, transport.received.size)
    }
}

class SermonDetailModelTest {

    private fun detail(vararg responses: HttpResponse): SermonDetailModel {
        val transport = RecordingTransport(responses.toMutableList())
        val api = ApiClient(ApiEnvironment("test", "https://faithform.test"), 1, transport, Tokens)
        return SermonDetailModel(SermonClient(api, ProjectionCache(PartitionedCache())), "grace", "s1", PARTITION)
    }

    @Test
    fun `a sermon loads, a removed one is unavailable, no network is offline`() = runTest {
        val loaded = detail(HttpResponse(200, envelope(DETAIL), emptyMap()))
        loaded.load()
        assertTrue(loaded.phase.value is SermonDetailPhase.Loaded)

        val removed = detail(HttpResponse(404, failure("not_found"), emptyMap()))
        removed.load()
        assertEquals(SermonDetailPhase.Unavailable, removed.phase.value)

        val offline = detail()
        offline.load()
        assertEquals(SermonDetailPhase.Offline, offline.phase.value)
    }
}
