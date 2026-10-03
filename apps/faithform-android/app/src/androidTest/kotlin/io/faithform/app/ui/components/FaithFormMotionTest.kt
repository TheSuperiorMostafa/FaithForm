package io.faithform.app.ui.components

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.MenuBook
import androidx.compose.material.icons.outlined.Slideshow
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.faithform.app.design.FaithFormTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class FaithFormMotionTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    @Test fun screenMotionRetainsStateAndEachTapRunsOnce() {
        rule.setContent {
            FaithFormTheme {
                var screen by remember { mutableIntStateOf(0) }
                Column(Modifier.motionReveal(screen)) {
                    var count by remember { mutableIntStateOf(0) }
                    FaithFormButton(onClick = { count++ }) { Text("Count $count") }
                    FaithFormTextButton(onClick = { screen++ }) { Text("Change screen") }
                }
            }
        }
        rule.onNodeWithText("Count 0").performClick()
        rule.onNodeWithText("Change screen").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Count 1").assertIsDisplayed().performClick()
        rule.onNodeWithText("Count 2").assertIsDisplayed()
        rule.onAllNodesWithText("Count 2").assertCountEquals(1)
    }

    @Test fun sermonActionsStayAccessibleAndLoadingLabelsAreStaticAndDisabled() {
        var notes = 0
        var slides = 0
        rule.setContent {
            FaithFormTheme(reduceMotion = true) {
                Column {
                    Row(Modifier.width(320.dp)) {
                        SermonActionButton("Notes", Icons.AutoMirrored.Outlined.MenuBook, true, { notes++ }, Modifier.weight(1f))
                        SermonActionButton("Slides", Icons.Outlined.Slideshow, false, { slides++ }, Modifier.weight(1f))
                    }
                    SermonHubCardSkeleton(Modifier.width(320.dp))
                }
            }
        }
        val notesNodes = rule.onAllNodesWithText("Notes")
        notesNodes.assertCountEquals(2)
        notesNodes[0].assertIsEnabled().assertHeightIsAtLeast(48.dp).performClick()
        notesNodes[1].assertIsNotEnabled().assertHeightIsAtLeast(48.dp)
        val slideNodes = rule.onAllNodesWithText("Slides")
        slideNodes[0].assertIsEnabled().performClick()
        slideNodes[1].assertIsNotEnabled()
        rule.runOnIdle { assertEquals(1, notes); assertEquals(1, slides) }
    }
}
