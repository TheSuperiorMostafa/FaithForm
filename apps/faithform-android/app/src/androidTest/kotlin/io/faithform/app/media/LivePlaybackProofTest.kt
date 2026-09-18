package io.faithform.app.media

import android.util.Log
import android.view.View
import android.view.ViewGroup
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.media3.common.C
import androidx.media3.ui.PlayerView
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import io.faithform.app.R
import io.faithform.app.WatchingLive
import io.faithform.app.network.ApiClient
import io.faithform.app.network.ApiEnvironment
import io.faithform.app.network.OkHttpExchange
import io.faithform.app.network.ProjectionCache
import io.faithform.app.network.TokenProvider
import io.faithform.app.storage.CachePartition
import io.faithform.app.storage.PartitionedCache
import io.faithform.app.ui.media.LivePlayerScreen
import java.util.concurrent.ConcurrentLinkedQueue
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Plays a live-shaped HLS stream through the shipping player, on a device.
 *
 * Unit tests cannot reach Media3's decoders, so this is where the adapter and
 * the full-screen screen meet real segments. `scripts/verify-android-live-playback.sh`
 * serves an ffmpeg live stream laid out as the delivery route serves one, plus
 * a grant and a live projection, and passes its origin as the `liveOrigin`
 * instrumentation argument. Without it these are skipped.
 */
@RunWith(AndroidJUnit4::class)
class LivePlaybackProofTest {

    @get:Rule
    val rule = createAndroidComposeRule<ComponentActivity>()

    private val arguments = InstrumentationRegistry.getArguments()
    private val origin: String? = arguments.getString("liveOrigin")
    private val holdSeconds: Long = arguments.getString("liveHoldSeconds")?.toLongOrNull() ?: 0
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private val partition = CachePartition("proof", "account-a", "grace", 1)

    private fun client() = MediaClient(
        ApiClient(
            environment = ApiEnvironment("proof", origin!!),
            clientBuild = 1,
            transport = OkHttpExchange.transport(),
            tokens = object : TokenProvider {
                override suspend fun validAccessToken() = "proof"
                override suspend fun invalidate() = Unit
            },
        ),
        ProjectionCache(PartitionedCache()),
    )

    @Test
    fun aLiveStreamPlaysThroughTheAdapterWithMovingPictures() = runBlocking {
        assumeTrue("no liveOrigin argument", origin != null)
        val adapter = Media3PlayerAdapter(context)
        val events = ConcurrentLinkedQueue<PlayerEvent>()
        adapter.setEventHandler { events += it }

        // Through the real client: the grant, its expiry and its URL resolution.
        val grant = client().grant("grace", MediaPlaybackKind.LIVE, "e1")
        adapter.send(
            PlayerCommand.Load(
                PlaybackRequest(grant.deliveryUrl, grant.capability, MediaPlaybackKind.LIVE, grant.renditionKind),
            ),
        )
        adapter.send(PlayerCommand.Play)

        withTimeout(20_000) { while (PlayerEvent.Playing !in events) delay(50) }
        val player = adapter.videoPlayerState.value
        assertNotNull("the surface was never offered a player", player)

        // Video is being played, not just sound. (With no surface attached
        // here nothing is drawn, so the picture itself is asserted by the
        // full-screen test below.) And a frozen stream has no clock.
        val video = withContext(Dispatchers.Main) {
            player!!.currentTracks.groups
                .firstOrNull { it.type == C.TRACK_TYPE_VIDEO && it.isSelected }
                ?.getTrackFormat(0)
        }
        assertTrue("no video track is playing", (video?.width ?: 0) > 0)
        val before = withContext(Dispatchers.Main) { player!!.currentPosition }
        delay(1_500)
        val after = withContext(Dispatchers.Main) { player!!.currentPosition }
        assertTrue("playback did not advance", after > before)
        assertFalse(events.any { it is PlayerEvent.Failed })

        adapter.send(PlayerCommand.Stop)
        assertTrue(adapter.videoPlayerState.value == null)
    }

    @Test
    fun watchLiveOpensFullScreenAndPlaysWithoutASecondTap() {
        assumeTrue("no liveOrigin argument", origin != null)
        val card = MediaLiveCard(
            state = "live",
            mediaId = "e1",
            title = "Sunday Worship",
            startsAt = "2026-09-20T14:00:00Z",
            posterUrl = null,
            churchName = "Grace Community",
            churchTimezone = "America/New_York",
        )
        rule.setContent {
            LivePlayerScreen(
                watching = WatchingLive("grace", card),
                client = client(),
                resumePositions = InMemoryResumePositionStore(),
                partition = partition,
                onClose = {},
            )
        }

        // Nobody pressed anything: the Pause control appears because it plays.
        val pause = context.getString(R.string.media_pause)
        rule.waitUntil(20_000) {
            rule.onAllNodesWithContentDescription(pause).fetchSemanticsNodes().isNotEmpty()
        }

        // And the surface shows that player — the regression was a view bound
        // once, to null, before the first play created the player.
        var bound = false
        var width = 0
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            val view = rule.activity.window.decorView.findPlayerView()
            bound = view?.player != null
            width = view?.player?.videoSize?.width ?: 0
        }
        assertTrue("the PlayerView has no player", bound)
        assertTrue("the PlayerView's player has no picture", width > 0)

        if (holdSeconds > 0) {
            Log.i("LiveProof", "LIVE_PROOF_ON_SCREEN")
            Thread.sleep(holdSeconds * 1_000)
        }
    }

    private fun View.findPlayerView(): PlayerView? {
        if (this is PlayerView) return this
        if (this is ViewGroup) {
            for (index in 0 until childCount) getChildAt(index).findPlayerView()?.let { return it }
        }
        return null
    }
}
