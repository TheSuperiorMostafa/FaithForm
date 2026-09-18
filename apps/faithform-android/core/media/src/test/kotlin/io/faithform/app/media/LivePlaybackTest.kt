package io.faithform.app.media

import io.faithform.app.network.HttpResponse
import io.faithform.app.network.ProjectionCache
import io.faithform.app.network.RecordingTransport
import io.faithform.app.storage.PartitionedCache
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Keeping "live" current, and the full-screen live player. Mirrors
 * `LivePlaybackTests.swift`.
 */
class LiveStatusTest {

    private fun ok(data: String) = HttpResponse(200, envelope(data), emptyMap())

    private fun model(vararg responses: HttpResponse): Pair<MediaListModel, RecordingTransport> {
        val transport = RecordingTransport(responses.toMutableList())
        val client = MediaClient(api(transport), ProjectionCache(PartitionedCache()))
        return MediaListModel(client, "grace", PARTITION) to transport
    }

    @Test
    fun `a service that starts after Home loaded appears without a relaunch`() = runTest {
        val (model, transport) = model(ok(LIVE_NONE), ok(archivePage("r1")), ok(LIVE_ON))
        model.refresh()
        assertNull(model.state.value.liveCard)

        model.refreshLive()

        assertEquals("live-1", model.state.value.liveCard?.mediaId)
        assertTrue(model.state.value.liveCard?.offersWatch == true)
        // Only the live projection is asked again; the archive is left alone.
        assertEquals(3, transport.received.size)
        assertEquals(listOf("r1"), model.state.value.items.map { it.mediaId })
    }

    @Test
    fun `a missed poll leaves the screen as it was`() = runTest {
        val (model, _) = model(ok(LIVE_ON), ok(archivePage("r1")))
        model.refresh()

        model.refreshLive()

        assertEquals("live-1", model.state.value.liveCard?.mediaId)
        assertTrue(model.state.value.phase is MediaListPhase.Loaded)
    }

    @Test
    fun `a poll with nothing on screen yet loads the whole screen`() = runTest {
        val (model, transport) = model(ok(LIVE_ON), ok(archivePage("r1")))

        model.refreshLive()

        assertEquals("live-1", model.state.value.liveCard?.mediaId)
        assertEquals(2, transport.received.size)
    }

    @Test
    fun `a live 404 is the stream not being there yet, a refusal is still a refusal`() {
        val live = MediaPlaybackKind.LIVE
        val recording = MediaPlaybackKind.RECORDING
        assertEquals(PlayerFailure.NETWORK, PlayerFailureMapping.fromStatus(404, live))
        assertEquals(PlayerFailure.NETWORK, PlayerFailureMapping.fromStatus(410, live))
        assertEquals(PlayerFailure.UNAVAILABLE, PlayerFailureMapping.fromStatus(401, live))
        assertEquals(PlayerFailure.UNAVAILABLE, PlayerFailureMapping.fromStatus(403, live))
        assertEquals(PlayerFailure.UNAVAILABLE, PlayerFailureMapping.fromStatus(404, recording))
        assertEquals(
            PlayerFailure.NETWORK,
            PlayerFailureMapping.fromPlayerError(PlayerFailureMapping.ERROR_BEHIND_LIVE_WINDOW, null, live),
        )
        assertEquals(
            PlayerFailure.NETWORK,
            PlayerFailureMapping.fromPlayerError(PlayerFailureMapping.ERROR_IO_BAD_HTTP_STATUS, 404, live),
        )
    }
}

class LivePlayerModelTest {

    /** Retry delays pass in virtual time; the end-of-service check waits to be asked for. */
    private val instantRetries: suspend (Long) -> Unit = { millis ->
        if (millis == LivePlayerModel.MONITOR_INTERVAL_MILLIS) awaitCancellation() else delay(millis)
    }

    private fun TestScope.live(
        granter: FakeGranter,
        player: FakePlayer,
        scope: CoroutineScope = this,
        sleep: suspend (Long) -> Unit = instantRetries,
        availability: suspend () -> LiveAvailability,
    ): LivePlayerModel {
        val detail = MediaDetailModel(
            client = MediaClient(api(RecordingTransport(mutableListOf())), ProjectionCache(PartitionedCache())),
            coordinator = MediaPlaybackCoordinator(granter, player, InMemoryResumePositionStore()),
            churchSlug = "grace",
            mediaId = "live-1",
            kind = MediaPlaybackKind.LIVE,
            partition = PARTITION,
        )
        return LivePlayerModel(detail, availability, scope, sleep)
    }

    @Test
    fun `opening it starts the service with no second tap`() = runTest {
        val granter = FakeGranter()
        val player = FakePlayer()
        val model = live(granter, player) { LiveAvailability.LIVE }

        model.start()

        assertEquals(listOf(Triple("grace", MediaPlaybackKind.LIVE, "live-1")), granter.calls)
        assertTrue(player.commands.contains(PlayerCommand.Play))
        assertEquals(LivePlayerModel.Phase.CONNECTING, model.phase.value)

        model.handle(PlayerEvent.Playing)
        assertEquals(LivePlayerModel.Phase.PLAYING, model.phase.value)
        model.stop()
    }

    @Test
    fun `a dropped stream reconnects by itself while the church is still live`() = runTest {
        val granter = FakeGranter()
        val player = FakePlayer()
        val model = live(granter, player) { LiveAvailability.LIVE }
        model.start()
        model.handle(PlayerEvent.Playing)

        model.handle(PlayerEvent.Failed(PlayerFailure.NETWORK))
        advanceUntilIdle()

        assertEquals(2, granter.calls.size)
        assertEquals(2, player.loadCount)
        assertEquals(LivePlayerModel.Phase.RECONNECTING, model.phase.value)

        model.handle(PlayerEvent.Playing)
        assertEquals(LivePlayerModel.Phase.PLAYING, model.phase.value)
        model.stop()
    }

    @Test
    fun `a stream that is not up yet is waited for, not reported as gone`() = runTest {
        val granter = FakeGranter()
        val model = live(granter, FakePlayer()) { LiveAvailability.LIVE }
        model.start()

        // The playlist 404s while the encoder connects: transient for live.
        model.handle(PlayerEvent.Failed(PlayerFailureMapping.fromStatus(404, MediaPlaybackKind.LIVE)))
        advanceUntilIdle()

        assertEquals(2, granter.calls.size)
        assertFalse(model.isTerminal)
        model.stop()
    }

    @Test
    fun `a failure after the service ended says it ended, and stops`() = runTest {
        val granter = FakeGranter()
        val player = FakePlayer()
        val model = live(granter, player) { LiveAvailability.ENDED }
        model.start()
        model.handle(PlayerEvent.Playing)

        model.handle(PlayerEvent.Failed(PlayerFailure.NETWORK))
        advanceUntilIdle()

        assertEquals(LivePlayerModel.Phase.ENDED, model.phase.value)
        assertTrue(player.commands.last() is PlayerCommand.Stop)
        assertEquals(1, granter.calls.size)
        model.stop()
    }

    @Test
    fun `refused twice while still listed as live means this account may not watch`() = runTest {
        val granter = FakeGranter()
        val model = live(granter, FakePlayer()) { LiveAvailability.LIVE }
        model.start()
        granter.refuse = true

        model.handle(PlayerEvent.Failed(PlayerFailure.UNAVAILABLE))
        advanceUntilIdle()

        assertEquals(LivePlayerModel.Phase.UNAVAILABLE, model.phase.value)
        model.stop()
    }

    @Test
    fun `reconnecting gives up after its budget, and Try again starts over`() = runTest {
        val granter = FakeGranter()
        val model = live(granter, FakePlayer()) { LiveAvailability.UNKNOWN }
        model.start()

        repeat(LivePlayerModel.MAX_ATTEMPTS) {
            val before = granter.calls.size
            model.handle(PlayerEvent.Failed(PlayerFailure.NETWORK))
            advanceUntilIdle()
            assertEquals(before + 1, granter.calls.size)
        }
        model.handle(PlayerEvent.Failed(PlayerFailure.NETWORK))
        advanceUntilIdle()
        assertEquals(LivePlayerModel.Phase.FAILED, model.phase.value)

        val before = granter.calls.size
        model.retry()
        assertEquals(LivePlayerModel.Phase.CONNECTING, model.phase.value)
        assertEquals(before + 1, granter.calls.size)
        model.stop()
    }

    @Test
    fun `a service that ends while playing is noticed, not left buffering`() = runTest {
        val player = FakePlayer()
        // The end-of-service check runs on its real interval, in virtual time.
        val model = live(FakeGranter(), player, sleep = { delay(it) }) { LiveAvailability.ENDED }
        model.start()
        model.handle(PlayerEvent.Playing)

        advanceUntilIdle()

        assertEquals(LivePlayerModel.Phase.ENDED, model.phase.value)
        assertTrue(player.commands.last() is PlayerCommand.Stop)
        model.stop()
    }

    @Test
    fun `resuming after a pause rejoins at the live edge`() = runTest {
        val granter = FakeGranter()
        val player = FakePlayer()
        val model = live(granter, player) { LiveAvailability.LIVE }
        model.start()
        model.handle(PlayerEvent.Playing)

        model.pause()
        assertTrue(player.commands.last() is PlayerCommand.Pause)
        model.handle(PlayerEvent.Paused)
        assertEquals(LivePlayerModel.Phase.PAUSED, model.phase.value)

        model.resume()
        // A fresh grant and a fresh load: where it paused may already have
        // scrolled out of the relay's window.
        assertEquals(2, granter.calls.size)
        assertEquals(2, player.loadCount)
        model.stop()
    }

    @Test
    fun `coming back to the app rejoins the service where it now is`() = runTest {
        val granter = FakeGranter()
        val player = FakePlayer()
        val model = live(granter, player) { LiveAvailability.LIVE }
        model.start()
        model.handle(PlayerEvent.Playing)

        model.enterBackground()
        assertTrue(player.commands.last() is PlayerCommand.Pause)
        model.handle(PlayerEvent.Paused)

        model.enterForeground()
        assertEquals(2, granter.calls.size)
        assertEquals(LivePlayerModel.Phase.CONNECTING, model.phase.value)
        model.stop()
    }

    @Test
    fun `a service the person paused stays paused when they come back`() = runTest {
        val granter = FakeGranter()
        val model = live(granter, FakePlayer()) { LiveAvailability.LIVE }
        model.start()
        model.handle(PlayerEvent.Playing)
        model.pause()
        model.handle(PlayerEvent.Paused)

        model.enterBackground()
        model.enterForeground()

        assertEquals(1, granter.calls.size)
        assertEquals(LivePlayerModel.Phase.PAUSED, model.phase.value)
        model.stop()
    }

    @Test
    fun `after closing, nothing is retried`() = runTest {
        val granter = FakeGranter()
        val player = FakePlayer()
        val model = live(granter, player) { LiveAvailability.LIVE }
        model.start()

        model.stop()
        model.handle(PlayerEvent.Failed(PlayerFailure.NETWORK))
        advanceUntilIdle()

        assertEquals(1, granter.calls.size)
        assertTrue(player.commands.last() is PlayerCommand.Stop)
    }
}
