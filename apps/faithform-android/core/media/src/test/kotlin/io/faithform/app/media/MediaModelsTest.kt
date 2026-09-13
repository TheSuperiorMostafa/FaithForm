package io.faithform.app.media

import io.faithform.app.network.HttpResponse
import io.faithform.app.network.ProjectionCache
import io.faithform.app.network.RecordingTransport
import io.faithform.app.storage.PartitionedCache
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The Watch tab's models: what a response becomes on screen, what a failure
 * means, and that paging never throws away a list someone is reading.
 */
class MediaListModelTest {

    private fun ok(data: String) = HttpResponse(200, envelope(data), emptyMap())

    private fun model(vararg responses: HttpResponse): Pair<MediaListModel, RecordingTransport> {
        val transport = RecordingTransport(responses.toMutableList())
        val client = MediaClient(api(transport), ProjectionCache(PartitionedCache()))
        return MediaListModel(client, "grace", PARTITION) to transport
    }

    @Test
    fun `no live service means no live area, not a placeholder`() = runTest {
        val (model, _) = model(ok(LIVE_NONE), ok(archivePage("r1", "r2")))
        model.load()

        val state = model.state.value
        assertFalse(state.showsLiveArea)
        assertNull(state.liveCard)
        assertEquals(listOf("r1", "r2"), state.items.map { it.mediaId })
        assertNull(state.emptyReason)
    }

    @Test
    fun `a live service is carried through with a watch button`() = runTest {
        val (model, _) = model(ok(LIVE_ON), ok(archivePage()))
        model.load()

        val live = model.state.value.liveCard!!
        assertTrue(live.offersWatch)
        assertEquals("live-1", live.mediaId)
        assertEquals(MediaScreenState.EmptyReason.NOTHING_PUBLISHED, model.state.value.emptyReason)
    }

    @Test
    fun `a search that finds nothing says so, differently`() = runTest {
        val (model, transport) = model(ok(LIVE_NONE), ok(archivePage()))
        model.search("advent")

        assertEquals(MediaScreenState.EmptyReason.NO_MATCHES, model.state.value.emptyReason)
        assertTrue(transport.received.any { it.url.endsWith("archive?q=advent") })
    }

    @Test
    fun `a hidden church, an unknown slug and a blocked visitor are one answer`() = runTest {
        for (code in listOf("not_found", "blocked", "forbidden")) {
            val (model, _) = model(
                HttpResponse(404, failure(code), emptyMap()),
                HttpResponse(404, failure(code), emptyMap()),
            )
            model.load()
            assertEquals(code, MediaListPhase.Blocked, model.state.value.phase)
        }
    }

    @Test
    fun `no network is offline with a retry`() = runTest {
        val (model, _) = model()
        model.load()
        assertEquals(MediaListPhase.Offline, model.state.value.phase)
        assertTrue(model.state.value.showsRetry)
    }

    @Test
    fun `the next page appends, and a failed page keeps what is on screen`() = runTest {
        val (model, transport) = model(ok(LIVE_NONE), ok(archivePage("r1", next = "c2")), ok(archivePage("r2", next = "c3")))
        model.load()
        assertTrue(model.state.value.hasMore)

        model.loadMore()
        assertEquals(listOf("r1", "r2"), model.state.value.items.map { it.mediaId })
        assertTrue(transport.received.last().url.endsWith("archive?cursor=c2"))

        // The third page fails: nothing scripted.
        model.loadMore()
        assertEquals(listOf("r1", "r2"), model.state.value.items.map { it.mediaId })
        assertTrue(model.state.value.phase is MediaListPhase.Loaded)
        assertFalse("a failed page kept offering more", model.state.value.hasMore)
        assertFalse(model.state.value.isLoadingMore)
    }
}

class MediaDetailModelTest {

    @Test
    fun `a recording loads its detail and plays through a fresh grant`() = runTest {
        val transport = RecordingTransport(mutableListOf(HttpResponse(200, envelope(DETAIL), emptyMap())))
        val client = MediaClient(api(transport), ProjectionCache(PartitionedCache()))
        val player = FakePlayer()
        val granter = FakeGranter()
        val model = MediaDetailModel(
            client = client,
            coordinator = MediaPlaybackCoordinator(granter, player, InMemoryResumePositionStore()),
            churchSlug = "grace",
            mediaId = "r1",
            kind = MediaPlaybackKind.RECORDING,
            partition = PARTITION,
        )

        model.load()
        assertEquals("The road to Emmaus", model.state.value.detail?.title)
        assertTrue(model.state.value.offersPlay)

        model.play()
        assertEquals(1, granter.calls.size)
        assertEquals(1, player.loadCount)
        assertTrue(player.commands.last() is PlayerCommand.Play)

        // Pause, then play again: the same session resumes, no second grant.
        model.handle(PlayerEvent.Playing)
        model.pause()
        model.play()
        assertEquals("resuming asked for a new capability", 1, granter.calls.size)
        assertEquals(1, player.loadCount)
    }

    @Test
    fun `a recording taken down since the list loaded says it is unavailable`() = runTest {
        val transport = RecordingTransport(mutableListOf(HttpResponse(404, failure("not_found"), emptyMap())))
        val model = MediaDetailModel(
            client = MediaClient(api(transport), ProjectionCache(PartitionedCache())),
            coordinator = MediaPlaybackCoordinator(FakeGranter(), FakePlayer(), InMemoryResumePositionStore()),
            churchSlug = "grace",
            mediaId = "gone",
            kind = MediaPlaybackKind.RECORDING,
            partition = PARTITION,
        )
        model.load()
        assertTrue(model.state.value.isUnavailable)
        assertFalse(model.state.value.isOffline)
        assertFalse(model.state.value.offersPlay)
    }

    @Test
    fun `live needs no detail request - the card the list showed is the page`() = runTest {
        val transport = RecordingTransport(mutableListOf())
        val card = MediaArchiveCard("live-1", "Sunday service", null, "2026-09-13T15:00:00Z", null, null, null, emptyList(), "UTC")
        val model = MediaDetailModel(
            client = MediaClient(api(transport), ProjectionCache(PartitionedCache())),
            coordinator = MediaPlaybackCoordinator(FakeGranter(), FakePlayer(), InMemoryResumePositionStore()),
            churchSlug = "grace",
            mediaId = "live-1",
            kind = MediaPlaybackKind.LIVE,
            partition = PARTITION,
            knownCard = card,
        )
        model.load()
        assertTrue(transport.received.isEmpty())
        assertEquals(card, model.state.value.detail)
    }

    @Test
    fun `a refused grant is a failure the screen can explain`() = runTest {
        val granter = FakeGranter().apply { refuse = true }
        val model = MediaDetailModel(
            client = MediaClient(api(RecordingTransport(mutableListOf())), ProjectionCache(PartitionedCache())),
            coordinator = MediaPlaybackCoordinator(granter, FakePlayer(), InMemoryResumePositionStore()),
            churchSlug = "grace",
            mediaId = "r1",
            kind = MediaPlaybackKind.RECORDING,
            partition = PARTITION,
        )
        model.play()
        assertEquals(PlayerFailure.UNAVAILABLE, model.state.value.failure)
    }
}

class InMemoryResumePositionStoreTest {

    @Test
    fun `positions are kept per partition and bounded by the resume policy`() = runTest {
        val store = InMemoryResumePositionStore()
        val now = 1_800_000_000_000L
        repeat(ResumePolicy.MAX_ENTRIES + 5) { index ->
            store.record(ResumePosition("m$index", "grace", 60_000, now + index), "a", now + index)
        }
        assertNull("the oldest survived pruning", store.position("m0", "a", now + 100))
        assertEquals(60_000L, store.position("m24", "a", now + 100)?.millis)
        assertNull("another account read a position", store.position("m24", "b", now + 100))

        store.clearAll()
        assertNull(store.position("m24", "a", now + 100))
    }

    @Test
    fun `a month-old position is forgotten`() = runTest {
        val store = InMemoryResumePositionStore()
        store.record(ResumePosition("m1", "grace", 90_000, 0), "a", 0)
        assertNull(store.position("m1", "a", ResumePolicy.MAX_AGE_MILLIS + 1))
    }
}
