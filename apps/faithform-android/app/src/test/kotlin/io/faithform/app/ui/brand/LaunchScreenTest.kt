package io.faithform.app.ui.brand

import androidx.compose.ui.graphics.toArgb
import io.faithform.app.design.FaithFormTokens
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * The hand-over from the system splash to the first frame, held in place.
 *
 * Launch should look like one screen: the splash's colour, mark and size are
 * resources the system reads before any Kotlin runs, and `LaunchLoadingView`
 * draws from the tokens. Nothing ties the two together at runtime, so this does.
 */
class LaunchScreenTest {

    private fun res(path: String) = File("src/main/res/$path").readText()

    private fun color(xml: String, name: String): Int {
        val hex = Regex("""<color name="$name">#([0-9A-Fa-f]{6})</color>""").find(xml)
            ?: error("no colour $name")
        return (0xFF000000L or hex.groupValues[1].toLong(16)).toInt()
    }

    private fun attr(xml: String, name: String): Float =
        Regex("""android:$name="(-?[\d.]+)"""").find(xml)!!.groupValues[1].toFloat()

    @Test
    fun `the splash ground and F are the page colours the loading view draws, day and night`() {
        val day = res("values/colors.xml")
        val night = res("values-night/colors.xml")

        assertEquals(FaithFormTokens.LIGHT.background.toArgb(), color(day, "launch_background"))
        assertEquals(FaithFormTokens.LIGHT.contentPrimary.toArgb(), color(day, "launch_mark_letter"))
        assertEquals(FaithFormTokens.DARK.background.toArgb(), color(night, "launch_background"))
        assertEquals(FaithFormTokens.DARK.contentPrimary.toArgb(), color(night, "launch_mark_letter"))
    }

    @Test
    fun `the splash icon is the drawn mark, centred, at the loading view's height`() {
        val icon = res("drawable/ic_launch_mark.xml")
        val paths = FaithFormMarkTest.pathData(icon)
        assertArrayEquals(FaithFormMarkGeometry.LETTER, paths[0], 0f)
        assertArrayEquals(FaithFormMarkGeometry.FOLD, paths[1], 0f)
        assertTrue(icon.contains("""android:fillColor="@color/launch_mark_letter""""))

        assertEquals(108f, attr(icon, "viewportHeight"))
        val scale = attr(icon, "scaleY")
        assertEquals(scale, attr(icon, "scaleX"))
        val pivotX = attr(icon, "pivotX")
        val pivotY = attr(icon, "pivotY")
        fun mapX(x: Float) = (x - pivotX) * scale + pivotX + attr(icon, "translateX")
        fun mapY(y: Float) = (y - pivotY) * scale + pivotY + attr(icon, "translateY")

        val left = mapX(FaithFormMarkGeometry.MIN_X)
        val right = mapX(FaithFormMarkGeometry.MIN_X + FaithFormMarkGeometry.WIDTH)
        val top = mapY(FaithFormMarkGeometry.MIN_Y)
        val bottom = mapY(FaithFormMarkGeometry.MIN_Y + FaithFormMarkGeometry.HEIGHT)
        assertEquals("not centred horizontally", 54f, (left + right) / 2, 0.01f)
        assertEquals("not centred vertically", 54f, (top + bottom) / 2, 0.01f)

        // The system draws a splash icon's 108-unit canvas at 288dp.
        val onScreenDp = (bottom - top) * 288f / 108f
        assertEquals(LaunchLoading.MARK_HEIGHT.value, onScreenDp, 0.05f)

        // Inside the 66dp safe zone's 33-unit radius, so no mask clips a corner.
        val corner = Math.hypot((right - 54f).toDouble(), (bottom - 54f).toDouble())
        assertTrue("corner at $corner units", corner < 33.0)
    }

    @Test
    fun `the activity starts on the splash theme and hands over to the app theme`() {
        val themes = res("values/themes.xml")
        val starting = themes.substringAfter("""<style name="Theme.FaithForm.Starting" parent="Theme.SplashScreen">""")
            .substringBefore("</style>")
        assertTrue(starting.contains("""<item name="windowSplashScreenBackground">@color/launch_background</item>"""))
        assertTrue(starting.contains("""<item name="windowSplashScreenAnimatedIcon">@drawable/ic_launch_mark</item>"""))
        assertTrue(starting.contains("""<item name="postSplashScreenTheme">@style/Theme.FaithForm</item>"""))

        val manifest = File("src/main/AndroidManifest.xml").readText()
        val activity = manifest.substringAfter("android:name=\".MainActivity\"").substringBefore(">")
        assertTrue(activity.contains("""android:theme="@style/Theme.FaithForm.Starting""""))
    }

    @Test
    fun `the splash is installed before super onCreate and never held for the network`() {
        val code = File("src/main/kotlin/io/faithform/app/MainActivity.kt").readText().lines()
            .filterNot { it.trimStart().startsWith("*") || it.trimStart().startsWith("//") }
            .joinToString("\n")
        val onCreate = code.substringAfter("override fun onCreate")
        val install = onCreate.indexOf("installSplashScreen()")
        assertTrue("installSplashScreen() is not called in onCreate", install >= 0)
        assertTrue("installSplashScreen() must precede super.onCreate", install < onCreate.indexOf("super.onCreate"))
        assertFalse("the splash is held on screen", code.contains("setKeepOnScreenCondition"))
    }

    @Test
    fun `the loading view is the mark, with no spinner`() {
        val view = File("src/main/kotlin/io/faithform/app/ui/brand/LaunchLoadingView.kt").readText()
        assertFalse("launch still draws a spinner", view.contains("CircularProgressIndicator"))
        assertFalse("launch still delays a spinner", view.contains("INDICATOR_DELAY"))
        assertFalse("launch must not loop the mark", view.contains("infiniteRepeatable"))
        assertTrue("the mark must still be drawn", view.contains("FaithFormMark"))
        assertTrue("the wordmark must fade in after the splash", view.contains("app_name"))
    }
}
