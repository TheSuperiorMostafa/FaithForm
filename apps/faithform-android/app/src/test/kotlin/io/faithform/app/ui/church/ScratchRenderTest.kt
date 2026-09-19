package io.faithform.app.ui.church

import android.graphics.Bitmap
import android.graphics.Canvas
import android.os.Looper
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.test.core.app.ActivityScenario
import io.faithform.app.contract.ChurchProfile
import io.faithform.app.contract.ChurchQuickLink
import io.faithform.app.contract.ChurchSocialLink
import io.faithform.app.contract.JoinPolicy
import io.faithform.app.contract.PublicCampus
import io.faithform.app.contract.PublicServiceTime
import io.faithform.app.contract.RelationshipState
import io.faithform.app.design.FaithFormTheme
import java.io.File
import java.io.FileOutputStream
import java.time.Duration
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

private val OUT = File("/private/tmp/claude-501/-Users-mostafamahdi-Desktop-Dev-Projects-FaithForm/41df90e9-a626-4bda-bfa6-b0557ebe967f/scratchpad/renders")

private fun sample(state: RelationshipState?, policy: JoinPolicy = JoinPolicy.OPEN) = ChurchProfile(
    slug = "grace",
    name = "Grace Community Church",
    tagline = "Love God. Love people.",
    denomination = "Non-denominational",
    address = "1200 Main St",
    city = "Louisville",
    state = "KY",
    postalCode = "40202",
    website = "https://www.gracecommunity.org",
    phone = "+1 (502) 555-0100",
    email = "hello@gracecommunity.org",
    joinPolicy = policy,
    timezone = "America/New_York",
    publicProfileVersion = 1,
    campuses = listOf(
        PublicCampus("downtown", "Downtown", "1200 Main St", "Louisville", "KY", "40202", 38.25, -85.75, "America/New_York", true),
        PublicCampus("east", "East End", "88 Shelbyville Rd", "Louisville", "KY", "40207", null, null, "America/New_York", false),
    ),
    serviceTimes = listOf(
        PublicServiceTime("", "Prayer night", 3, "19:00:00", "regular"),
        PublicServiceTime("downtown", "Morning worship", 0, "09:00:00", "regular"),
        PublicServiceTime("downtown", "Late service", 0, "11:15:00", "regular"),
        PublicServiceTime("east", "Family service", 0, "10:00:00", "regular"),
    ),
    relationshipState = state,
    about = "Grace Community is a church in the heart of Louisville. We gather every Sunday to worship, " +
        "learn from the Bible and share life together. Whether you have followed Jesus for years or are just " +
        "curious, you are welcome here. We have groups for kids, students, young adults and families, and we " +
        "serve our neighbours through food drives, tutoring and a Saturday clinic. Come as you are.",
    socialLinks = listOf(
        ChurchSocialLink("instagram", "https://instagram.com/grace"),
        ChurchSocialLink("facebook", "https://facebook.com/grace"),
        ChurchSocialLink("youtube", "https://youtube.com/@grace"),
        ChurchSocialLink("tiktok", "https://tiktok.com/@grace"),
        ChurchSocialLink("x", "https://x.com/grace"),
        ChurchSocialLink("podcast", "https://podcasts.example/grace"),
    ),
    quickLinks = listOf(
        ChurchQuickLink("Plan your visit", "https://www.gracecommunity.org/visit"),
        ChurchQuickLink("Kids check-in", "https://kids.gracecommunity.org"),
    ),
)

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], application = android.app.Application::class)
class ScratchRenderTest {

    private fun render(name: String, dark: Boolean, phase: ChurchProfilePhase, hasOther: Boolean) {
        OUT.mkdirs()
        val scenario = ActivityScenario.launch(ComponentActivity::class.java)
        scenario.onActivity { activity ->
            activity.setContent {
                FaithFormTheme(darkTheme = dark) {
                    ChurchInfoScreen(
                        phase = phase,
                        hasOtherChurch = hasOther,
                        currentChurchName = "Hope Chapel",
                        isActing = false,
                        actionError = null,
                        isRefreshing = false,
                        onRefresh = {},
                        onRetry = {},
                        onBack = {},
                        onAdd = {},
                        onHaveInvitation = {},
                        onChangeChurch = {},
                        onRemove = {},
                    )
                }
            }
        }
        repeat(20) { shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(100)) }
        scenario.onActivity { activity ->
            val view = activity.window.decorView
            val bitmap = Bitmap.createBitmap(view.width, view.height, Bitmap.Config.ARGB_8888)
            view.draw(Canvas(bitmap))
            FileOutputStream(File(OUT, "$name.png")).use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        }
        scenario.close()
    }

    @Test
    @Config(qualifiers = "w400dp-h2300dp-xhdpi")
    fun discoveryLightTall() = render("discovery-light-tall", false, ChurchProfilePhase.Loaded(sample(null)), hasOther = true)

    @Test
    @Config(qualifiers = "w400dp-h2300dp-night-xhdpi")
    fun currentDarkTall() = render("current-dark-tall", true, ChurchProfilePhase.Loaded(sample(RelationshipState.FOLLOWING)), hasOther = false)

    @Test
    @Config(qualifiers = "w360dp-h780dp-xhdpi")
    fun discoveryLightPhone() = render("discovery-light-phone", false, ChurchProfilePhase.Loaded(sample(null)), hasOther = false)

    @Test
    @Config(qualifiers = "w360dp-h780dp-xhdpi", fontScale = 2.0f)
    fun inviteLargeFont() = render("invite-large-font", false, ChurchProfilePhase.Loaded(sample(null, JoinPolicy.INVITE_ONLY)), hasOther = false)

    @Test
    @Config(qualifiers = "w360dp-h780dp-xhdpi")
    fun loading() = render("loading", false, ChurchProfilePhase.Loading, hasOther = false)
}
