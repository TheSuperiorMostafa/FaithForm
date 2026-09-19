package io.faithform.app.ui.groups

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.faithform.app.design.FaithFormTheme
import io.faithform.app.network.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

@RunWith(AndroidJUnit4::class)
class GroupsScreenTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()
    private val group = """{"id":"00000000-0000-4000-8000-000000000001","name":"The Table","summary":null,"coverImageUrl":null,"type":{"id":"life","name":"Life group","icon":"users"},"memberCount":14,"capacity":20,"enrollment":"open","visibility":"public","status":"active","scheduleText":"Tuesdays at 6:30 pm","meetingDays":[2],"campusName":null,"locationName":null,"nextEvent":null,"membershipState":"member","groupRole":"member","joinAction":"leave","chat":null,"isYouth":false,"version":1}"""
    private val api = ApiClient(ApiEnvironment("groups-test", "https://example.invalid"), 1, object : HttpTransport {
        override suspend fun perform(request: HttpRequest): HttpResponse {
            val data = if (request.url.contains("/filters")) """{"types":[],"campuses":[],"days":[]}""" else if (request.url.contains("/discover")) """{"items":[],"nextCursor":null}""" else """{"items":[$group],"directMessagesEnabled":false,"messagingAvailable":false}"""
            return HttpResponse(200, """{"ok":true,"data":$data,"meta":{"apiVersion":"2026-08-24","apiMajor":1,"requestId":"groups-test","minimumSupportedClientBuild":1}}""", emptyMap())
        }
    }, object : TokenProvider { override suspend fun validAccessToken() = "groups-test"; override suspend fun invalidate() {} })

    @Test fun groupsShowMembershipAndDiscoveryEmptyState() {
        rule.setContent { FaithFormTheme { GroupsHost(api, "grace", "groups-test") } }
        rule.waitUntil(10000) { rule.onAllNodesWithText("The Table").fetchSemanticsNodes().isNotEmpty() }
        rule.onNodeWithText("You belong here.").assertIsDisplayed()
        rule.onNodeWithText("The Table").assertIsDisplayed()
        val file = File(rule.activity.getExternalFilesDir(null), "groups-android.png")
        file.outputStream().use { rule.onRoot().captureToImage().asAndroidBitmap().compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
        rule.onNodeWithText("Discover", useUnmergedTree = true).performClick()
        rule.waitUntil(10000) { rule.onAllNodesWithText("No groups found").fetchSemanticsNodes().isNotEmpty() }
        rule.onNodeWithText("No groups found").assertIsDisplayed()
        rule.onNodeWithText("Messages").assertDoesNotExist()
    }
}
