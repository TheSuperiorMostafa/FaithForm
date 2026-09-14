package io.faithform.app.sermons

import io.faithform.app.network.ApiClient
import io.faithform.app.network.ApiEnvironment
import io.faithform.app.network.HttpRequest
import io.faithform.app.network.HttpResponse
import io.faithform.app.network.HttpTransport
import io.faithform.app.network.ProjectionCache
import io.faithform.app.network.RecordingTransport
import io.faithform.app.network.TokenProvider
import io.faithform.app.storage.CachePartition
import io.faithform.app.storage.PartitionedCache
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
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
        // Typing only records the term; the load that follows asks with it.
        searched.search("advent")
        searched.load()
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

/**
 * Answers the archive by query and cursor, each after its own delay in virtual
 * time — so a test can make an old search slower than a new one.
 */
private class ScriptedArchive : HttpTransport {
    val received = mutableListOf<HttpRequest>()
    private val answers = mutableMapOf<String, ArrayDeque<Pair<Long, HttpResponse?>>>()

    /** [response] null is a dropped connection. */
    fun on(query: String = "", cursor: String? = null, afterMillis: Long = 0, response: HttpResponse?) {
        answers.getOrPut("$query|${cursor.orEmpty()}") { ArrayDeque() }.addLast(afterMillis to response)
    }

    override suspend fun perform(request: HttpRequest): HttpResponse {
        received += request
        fun param(name: String) = Regex("[?&]$name=([^&]*)").find(request.url)?.groupValues?.get(1)
        val key = "${param("q").orEmpty()}|${param("cursor").orEmpty()}"
        val (wait, response) = answers[key]?.removeFirstOrNull() ?: error("unscripted request $key")
        delay(wait)
        return response ?: throw java.io.IOException("dropped")
    }
}

@OptIn(ExperimentalCoroutinesApi::class)
class SermonListRefreshAndSearchTest {

    private fun ok(data: String) = HttpResponse(200, envelope(data), emptyMap())

    private fun model(transport: HttpTransport, clock: () -> Long = { 0L }): SermonListModel {
        val api = ApiClient(ApiEnvironment("test", "https://faithform.test"), 1, transport, Tokens)
        return SermonListModel(SermonClient(api, ProjectionCache(PartitionedCache())), "grace", PARTITION, clock)
    }

    private fun SermonListModel.ids() = state.value.items.map { it.sermonId }

    @Test
    fun `a failed next page keeps its cursor and is asked for again only from the retry`() = runTest {
        val transport = RecordingTransport(
            mutableListOf(
                ok(page("s1", next = "c2")),
                HttpResponse(503, failure("unavailable"), emptyMap()),
                ok(page("s2")),
            ),
        )
        val model = model(transport)
        model.load()

        model.loadMore()
        assertEquals(listOf("s1"), model.ids())
        assertTrue(model.state.value.loadMoreFailed)
        assertTrue(model.state.value.showsLoadMoreRetry)
        assertTrue("pagination ended for good", model.state.value.hasMore)
        assertFalse(model.state.value.canLoadMore)

        // Scrolling to the end again does not re-ask on its own.
        model.loadMore()
        assertEquals(2, transport.received.size)

        model.retryLoadMore()
        assertTrue(transport.received.last().url.endsWith("?cursor=c2"))
        assertEquals(listOf("s1", "s2"), model.ids())
        assertFalse(model.state.value.loadMoreFailed)
        assertFalse(model.state.value.showsLoadMoreRetry)
    }

    @Test
    fun `typing is sent once, for what was typed when typing paused`() = runTest {
        val transport = ScriptedArchive().apply {
            on(response = ok(page("all")))
            on("grace", response = ok(page("g1")))
        }
        val model = model(transport)
        model.load()
        backgroundScope.launch { model.observeSearch() }
        runCurrent()

        for (term in listOf("g", "gr", "gra", "grac")) {
            model.search(term)
            advanceTimeBy(100)
        }
        model.search("grace")
        advanceTimeBy(SermonListModel.SEARCH_DEBOUNCE_MILLIS - 1)
        runCurrent()
        assertEquals("a keystroke was sent before typing paused", 1, transport.received.size)
        assertEquals("grace", model.state.value.searchTerm)

        advanceTimeBy(2)
        runCurrent()
        assertEquals(2, transport.received.size)
        assertTrue(transport.received.last().url.endsWith("archive?q=grace"))
        assertEquals(listOf("g1"), model.ids())
    }

    @Test
    fun `a slow answer for an older term never replaces the newer term's results`() = runTest {
        val transport = ScriptedArchive().apply {
            on(response = ok(page("all")))
            on("gra", response = ok(page("gra-1")))
            // The refresh of "gra" is slow; the search for "grace" is fast.
            on("gra", afterMillis = 2_000, response = ok(page("gra-stale")))
            on("grace", afterMillis = 10, response = ok(page("grace-1")))
        }
        val model = model(transport)
        model.load()
        backgroundScope.launch { model.observeSearch() }
        runCurrent()

        model.search("gra")
        advanceTimeBy(SermonListModel.SEARCH_DEBOUNCE_MILLIS + 1)
        assertEquals(listOf("gra-1"), model.ids())

        // A pull-to-refresh of "gra" goes out, then "grace" is typed.
        val refreshing = launch { model.refresh() }
        runCurrent()
        assertTrue(model.state.value.isRefreshing)
        model.search("grace")
        advanceTimeBy(SermonListModel.SEARCH_DEBOUNCE_MILLIS + 20)
        assertEquals(listOf("grace-1"), model.ids())

        refreshing.join()
        assertEquals("the stale answer landed", listOf("grace-1"), model.ids())
        assertFalse(model.state.value.isRefreshing)
    }

    @Test
    fun `a newer keystroke cancels a search already sent`() = runTest {
        val transport = ScriptedArchive().apply {
            on(response = ok(page("all")))
            on("lent", afterMillis = 5_000, response = ok(page("lent-1")))
            on("lenten", afterMillis = 10, response = ok(page("lenten-1")))
        }
        val model = model(transport)
        model.load()
        backgroundScope.launch { model.observeSearch() }
        runCurrent()

        model.search("lent")
        advanceTimeBy(SermonListModel.SEARCH_DEBOUNCE_MILLIS + 1)
        assertEquals(2, transport.received.size)

        model.search("lenten")
        advanceTimeBy(SermonListModel.SEARCH_DEBOUNCE_MILLIS + 20)
        assertEquals(listOf("lenten-1"), model.ids())
        assertEquals(3, transport.received.size)

        // Long after the cancelled request would have answered, nothing changes.
        advanceTimeBy(10_000)
        assertEquals(listOf("lenten-1"), model.ids())
    }

    @Test
    fun `the next page asks with the query that produced the list, not what is being typed`() = runTest {
        val transport = ScriptedArchive().apply {
            on(response = ok(page("all")))
            on("grace", response = ok(page("g1", next = "c2")))
            on("grace", cursor = "c2", response = ok(page("g2")))
            on("gracious", response = ok(page("x1")))
        }
        val model = model(transport)
        model.load()
        backgroundScope.launch { model.observeSearch() }
        runCurrent()

        model.search("grace")
        advanceTimeBy(SermonListModel.SEARCH_DEBOUNCE_MILLIS + 1)
        model.search("gracious")
        model.loadMore()
        // Query parameters are sent sorted by name.
        assertTrue(transport.received.last().url.endsWith("archive?cursor=c2&q=grace"))
        assertEquals(listOf("g1", "g2"), model.ids())

        advanceTimeBy(SermonListModel.SEARCH_DEBOUNCE_MILLIS + 1)
        assertEquals(listOf("x1"), model.ids())
    }

    @Test
    fun `a page that lands after its list was replaced is dropped, and paging carries on`() = runTest {
        val transport = ScriptedArchive().apply {
            on(response = ok(page("a1", next = "ca")))
            on(cursor = "ca", afterMillis = 1_000, response = ok(page("a2")))
            on(response = ok(page("b1", next = "cb")))
            on(cursor = "cb", response = ok(page("b2")))
        }
        val model = model(transport)
        model.load()

        val paging = launch { model.loadMore() }
        runCurrent()
        model.refresh()
        assertEquals(listOf("b1"), model.ids())
        assertFalse("a second page was asked for over one in flight", model.state.value.canLoadMore)

        paging.join()
        assertEquals("page two of the old list landed on the new one", listOf("b1"), model.ids())
        assertTrue(model.state.value.canLoadMore)

        model.loadMore()
        assertTrue(transport.received.last().url.endsWith("?cursor=cb"))
        assertEquals(listOf("b1", "b2"), model.ids())
    }

    @Test
    fun `clearing the search restores the full list without waiting`() = runTest {
        val transport = ScriptedArchive().apply {
            on(response = ok(page("s1", "s2")))
            on("advent", response = ok(page()))
            on(response = ok(page("s1", "s2", "s3")))
        }
        val model = model(transport)
        model.load()
        backgroundScope.launch { model.observeSearch() }
        runCurrent()

        model.search("advent")
        advanceTimeBy(SermonListModel.SEARCH_DEBOUNCE_MILLIS + 1)
        assertTrue(model.state.value.emptyIsSearch)

        model.search("")
        runCurrent()
        assertEquals(listOf("s1", "s2", "s3"), model.ids())
        assertFalse(model.state.value.emptyIsSearch)
    }

    @Test
    fun `entering the screen loads once, then asks again only when the list is stale`() = runTest {
        var now = 1_000_000L
        val transport = RecordingTransport(
            mutableListOf(ok(page("s1")), ok(page("s1", "s0"))),
        )
        val model = model(transport) { now }

        model.refreshIfStale()
        assertEquals(1, transport.received.size)
        assertEquals(listOf("s1"), model.ids())

        now += SermonListModel.STALE_AFTER_MILLIS - 1
        model.refreshIfStale()
        assertEquals("a fresh list was asked for again", 1, transport.received.size)

        now += 1
        model.refreshIfStale()
        assertEquals(2, transport.received.size)
        assertEquals(listOf("s1", "s0"), model.ids())
    }

    @Test
    fun `a refresh that cannot reach the server keeps the list, marked stale`() = runTest {
        val transport = ScriptedArchive().apply {
            on(response = ok(page("s1")))
            on(afterMillis = 50, response = null)
            on(response = ok(page("s1", "s2")))
        }
        val model = model(transport)
        model.load()

        val refreshing = launch { model.refresh() }
        runCurrent()
        assertTrue(model.state.value.isRefreshing)
        refreshing.join()

        val phase = model.state.value.phase as SermonListPhase.Loaded
        assertTrue(phase.isStale)
        assertEquals(listOf("s1"), phase.items.map { it.sermonId })
        assertFalse(model.state.value.isRefreshing)

        // A stale list is asked for again on the next entry, however recent.
        model.refreshIfStale()
        assertEquals(listOf("s1", "s2"), model.ids())
        assertFalse((model.state.value.phase as SermonListPhase.Loaded).isStale)
    }

    @Test
    fun `a blocked church replaces the list rather than leaving its notes readable`() = runTest {
        val transport = RecordingTransport(
            mutableListOf(ok(page("s1", next = "c2")), HttpResponse(403, failure("blocked"), emptyMap())),
        )
        val model = model(transport)
        model.load()
        model.refresh()
        assertEquals(SermonListPhase.Blocked, model.state.value.phase)
        assertFalse(model.state.value.hasMore)
    }
}
