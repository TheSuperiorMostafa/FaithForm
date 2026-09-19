package io.faithform.app.ui.media

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performSemanticsAction
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.faithform.app.contract.LinkedService
import androidx.compose.ui.test.onNodeWithText
import io.faithform.app.design.FaithFormTheme
import io.faithform.app.media.MediaArchiveCard
import io.faithform.app.media.MediaDetailState
import io.faithform.app.media.MediaLiveCard
import io.faithform.app.media.PlaybackSessionState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class MediaStageTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    private val recording = MediaArchiveCard(
        "r1", "Sunday Worship", null, "2026-09-20T14:00:00Z", 60,
        null, null, emptyList(), "UTC", startOffsetSeconds = 12,
    )

    @Test fun recordingOffersFullScreenBeforePlayAndShowsLoadingInsteadOfPlayDuringPreparation() {
        var fullScreen = false
        rule.setContent {
            FaithFormTheme {
                RecordingStage(
                    state = MediaDetailState(detail = recording, playback = PlaybackSessionState.Preparing),
                    player = null, isFullScreen = false, onPlay = {}, onPause = {}, onSeek = {},
                    onToggleFullScreen = { fullScreen = true },
                    modifier = Modifier.fillMaxWidth().aspectRatio(16f / 9f),
                )
            }
        }
        rule.onNodeWithContentDescription("Loading video").assertIsDisplayed()
        rule.onNodeWithContentDescription("Play service").assertDoesNotExist()
        rule.onNodeWithContentDescription("Full screen").performClick()
        rule.runOnIdle { assertTrue(fullScreen) }
    }

    @Test fun replaySkipAndAccessibleScrubberSendPositionsRelativeToTheService() {
        var seek = -1L
        rule.setContent {
            FaithFormTheme {
                RecordingStage(
                    state = MediaDetailState(detail = recording, playback = PlaybackSessionState.Paused),
                    player = null, isFullScreen = false, onPlay = {}, onPause = {}, onSeek = { seek = it },
                    onToggleFullScreen = {}, modifier = Modifier.fillMaxWidth().aspectRatio(16f / 9f),
                )
            }
        }
        rule.onNodeWithContentDescription("Forward 15 seconds").performClick()
        rule.runOnIdle { assertEquals(15_000L, seek) }
        rule.onNodeWithContentDescription("Back 15 seconds").performClick()
        rule.runOnIdle { assertEquals(0L, seek) }
        rule.onNodeWithContentDescription("Playback position")
            .performSemanticsAction(SemanticsActions.SetProgress) { it(30_000f) }
        rule.runOnIdle { assertEquals(30_000L, seek) }
    }

    @Test fun endedServiceCardOpensThePublishedReplay() {
        var opened: String? = null
        rule.setContent {
            FaithFormTheme {
                LiveNowHero(
                    live = MediaLiveCard("recent_ended", "event1", "Sunday Worship", "2026-09-20T14:00:00Z",
                        null, "Grace Chapel", "UTC", replayMediaId = "recording1"),
                    onWatch = { error("An ended service cannot open live playback") },
                    onWatchReplay = { opened = it },
                )
            }
        }
        rule.onNodeWithContentDescription("Replay available. Sunday Worship. Grace Chapel. Watch the replay").performClick()
        rule.runOnIdle { assertEquals("recording1", opened) }
    }
    @Test fun sermonLinksOpenTheSelectedRecording() {
        val service = LinkedService("r1", "recording", "Sunday Worship", "2026-09-20T14:00:00Z", null)
        var opened: LinkedService? = null
        rule.setContent { FaithFormTheme { RelatedServices(listOf(service)) { opened = it } } }
        rule.onNodeWithText("Watch recording · Sunday Worship").performClick()
        rule.runOnIdle { assertEquals(service, opened) }
    }

}
