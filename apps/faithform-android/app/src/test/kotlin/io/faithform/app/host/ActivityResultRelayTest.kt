package io.faithform.app.host

import java.io.File
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.yield
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The relay between retained view models and short-lived Activities — and the
 * rotation bug it exists to prevent, stated as a test.
 */
class ActivityResultRelayTest {

    @Test
    fun `an answer delivered to a recreated Activity still reaches the request that raised the dialog`() = runTest {
        val relay = ActivityResultRelay<String, Boolean>(unavailable = false)
        val raisedBy = mutableListOf<String>()

        val first: (String) -> Unit = { raisedBy += "first:$it" }
        relay.attach(first)

        val answer = async(start = CoroutineStart.UNDISPATCHED) { relay.request("location") }
        assertEquals(listOf("first:location"), raisedBy)

        // Rotation: the new Activity attaches before the old one is destroyed.
        val second: (String) -> Unit = { raisedBy += "second:$it" }
        relay.attach(second)
        relay.detach(first)
        assertTrue("the old Activity's teardown unbound the new one", relay.isAttached)

        // The system answers the new instance.
        relay.deliver(true)
        assertTrue(answer.await())
    }

    @Test
    fun `with no Activity attached a request is answered unavailable rather than hanging`() = runTest {
        val relay = ActivityResultRelay<Unit, String>(unavailable = "FAILED")
        assertEquals("FAILED", relay.request(Unit))
    }

    @Test
    fun `a second request supersedes the first, which is told unavailable`() = runTest {
        val relay = ActivityResultRelay<Int, String>(unavailable = "unavailable")
        relay.attach { }
        val first = async(start = CoroutineStart.UNDISPATCHED) { relay.request(1) }
        val second = async(start = CoroutineStart.UNDISPATCHED) { relay.request(2) }
        relay.deliver("granted")
        assertEquals("unavailable", first.await())
        assertEquals("granted", second.await())
    }

    @Test
    fun `an answer nobody asked for is dropped`() = runTest {
        val relay = ActivityResultRelay<Int, String>(unavailable = "unavailable")
        relay.attach { }
        relay.deliver("stray")
        val later = async(start = CoroutineStart.UNDISPATCHED) { relay.request(1) }
        yield()
        assertFalse("a stray answer satisfied a later request", later.isCompleted)
        relay.deliver("real")
        assertEquals("real", later.await())
    }

    @Test
    fun `a cancelled request does not swallow the next answer`() = runTest {
        val relay = ActivityResultRelay<Int, String>(unavailable = "unavailable")
        relay.attach { }
        val abandoned = async(start = CoroutineStart.UNDISPATCHED) { relay.request(1) }
        abandoned.cancel()
        val next = async(start = CoroutineStart.UNDISPATCHED) { relay.request(2) }
        relay.deliver("answer")
        assertEquals("answer", next.await())
    }
}

/**
 * The Activity's wiring, read from the source that ships.
 *
 * `MainActivity` cannot be launched under Robolectric here — the application
 * builds an `EncryptedSharedPreferences` on the Android Keystore, which a JVM
 * does not have — so the property that fixes rotation is held in place by
 * reading it: the shell's view model is fetched from a `ViewModelProvider`,
 * never constructed in `onCreate`, and no launcher is handed to a view model.
 */
class ActivityWiringTest {

    private val activity = File("src/main/kotlin/io/faithform/app/MainActivity.kt").readText()
    private val code = activity.lines()
        .filterNot { it.trimStart().startsWith("*") || it.trimStart().startsWith("//") }
        .joinToString("\n")

    @Test
    fun `the shell's view model is retained, not rebuilt on every onCreate`() {
        assertTrue(code.contains("ViewModelProvider(this, AppViewModelFactory(container, registry))[AppViewModel::class.java]"))
        val onCreate = code.substringAfter("override fun onCreate").substringBefore("override fun onDestroy")
        assertFalse("onCreate constructs AppViewModel directly", Regex("""=\s*AppViewModel\(""").containsMatchIn(onCreate))
    }

    @Test
    fun `the first load runs once per view model, not once per rotation`() {
        assertTrue(code.contains("viewModel.start()"))
        assertFalse(Regex("""viewModel\.load\(\)""").containsMatchIn(code))
    }

    @Test
    fun `location permissions reach the discovery model only through the app-scoped relay`() {
        assertTrue(code.contains("container.locationPermissions.attach(launchLocationDialog)"))
        assertTrue(code.contains("locationPermissions?.detach(launchLocationDialog)"))
        assertTrue(code.contains("container.locationPermissions.request("))
        // The provider gets the application context, never the Activity.
        assertTrue(code.contains("context = applicationContext"))
    }

    @Test
    fun `the payment sheet answers through the relay the giving model holds`() {
        assertTrue(code.contains("StripePaymentSheetAdapter(this, container.paymentSheets)"))
    }
}
